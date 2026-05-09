import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { scanImageData, setModuleArgs } from "@undecaf/zbar-wasm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, CameraOff, RotateCcw, Keyboard, Scan, Zap } from "lucide-react";

// Point the zbar-wasm loader at the packaged .wasm file via Vite's ?url import
// @ts-ignore
import zbarWasmUrl from "@undecaf/zbar-wasm/dist/zbar.wasm?url";
setModuleArgs({ locateFile: () => zbarWasmUrl });

// ── capability flags ────────────────────────────────────────────────────────
const hasBarcodeDetector = typeof window !== "undefined" && "BarcodeDetector" in window;

type Engine = "native" | "zbar" | "zxing";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  isActive: boolean;
  onToggle: () => void;
}

const ENGINE_LABELS: Record<Engine, string> = {
  native: "⚡ Fast mode (native)",
  zbar:   "⚡ Fast mode (ZBar)",
  zxing:  "Standard mode",
};

const CONFIRM_FRAMES = 3;
const SCAN_COOLDOWN_MS = 1500;

export function BarcodeScanner({ onScan, isActive, onToggle }: BarcodeScannerProps) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const zxingReader  = useRef<BrowserMultiFormatReader>();

  const candidateRef      = useRef<string>("");
  const candidateCountRef = useRef<number>(0);
  const cooldownUntilRef  = useRef<number>(0);
  const lastScanRef  = useRef<string>("");
  const lastTimeRef  = useRef<number>(0);

  const [isScanning, setIsScanning] = useState(false);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error,  setError]  = useState<string>("");
  const [lastScan, setLastScan] = useState<string>("");
  const [scanMode, setScanMode] = useState<"camera" | "manual">("manual");
  const [manualInput, setManualInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const confirmCode = useCallback((code: string): boolean => {
    const now = Date.now();
    if (now < cooldownUntilRef.current) return false;
    if (code === candidateRef.current) {
      candidateCountRef.current += 1;
    } else {
      candidateRef.current = code;
      candidateCountRef.current = 1;
    }
    return candidateCountRef.current >= CONFIRM_FRAMES;
  }, []);

  const emitScan = useCallback((code: string) => {
    const now = Date.now();
    if (code === lastScanRef.current && now - lastTimeRef.current < 2000) return;
    lastScanRef.current = code;
    lastTimeRef.current = now;
    cooldownUntilRef.current = now + SCAN_COOLDOWN_MS;
    candidateRef.current = "";
    candidateCountRef.current = 0;
    setLastScan(code);
    onScan(code);
  }, [onScan]);

  // ── 1. Native BarcodeDetector ─────────────────────────────────────────────
  const startNativeScanner = useCallback(async () => {
    try {
      detectorRef.current = new (window as any).BarcodeDetector({
        formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39",
                  "code_93","itf","qr_code","pdf417","data_matrix"],
      });
    } catch {
      detectorRef.current = new (window as any).BarcodeDetector();
    }

    const scan = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) { animFrameRef.current = requestAnimationFrame(scan); return; }
      try {
        const results = await detectorRef.current.detect(video);
        if (results.length > 0) {
          const code = results[0].rawValue;
          if (confirmCode(code)) emitScan(code);
        } else {
          candidateRef.current = "";
          candidateCountRef.current = 0;
        }
      } catch { /* no barcode in frame */ }
      animFrameRef.current = requestAnimationFrame(scan);
    };

    setEngine("native");
    animFrameRef.current = requestAnimationFrame(scan);
  }, [emitScan, confirmCode]);

  // ── 2. ZBar WASM ──────────────────────────────────────────────────────────
  const startZbarScanner = useCallback(async () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const scan = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) { animFrameRef.current = requestAnimationFrame(scan); return; }
      if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const results   = await scanImageData(imageData);
        if (results.length > 0) {
          const code = results[0].decode();
          if (confirmCode(code)) emitScan(code);
        } else {
          candidateRef.current = "";
          candidateCountRef.current = 0;
        }
      } catch { /* no barcode in frame */ }
      animFrameRef.current = requestAnimationFrame(scan);
    };

    setEngine("zbar");
    animFrameRef.current = requestAnimationFrame(scan);
  }, [emitScan, confirmCode]);

  // ── 3. ZXing fallback ─────────────────────────────────────────────────────
  const startZxingScanner = useCallback(async () => {
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    zxingReader.current = new BrowserMultiFormatReader(hints);
    await zxingReader.current.decodeFromVideoDevice(
      undefined,
      videoRef.current!,
      (result, err) => {
        if (result) {
          const code = result.getText();
          if (confirmCode(code)) emitScan(code);
        } else {
          candidateRef.current = "";
          candidateCountRef.current = 0;
        }
        if (err && err.name !== "NotFoundException") console.error("ZXing:", err);
      }
    );
    setEngine("zxing");
  }, [emitScan, confirmCode]);

  // ── Pause: stop scan loop but keep stream alive ───────────────────────────
  const pauseLoop = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    zxingReader.current?.stopContinuousDecode?.();
    setIsScanning(false);
    setEngine(null);
  }, []);

  // ── Full stop: release camera (call only on unmount) ──────────────────────
  const fullStop = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    zxingReader.current?.stopContinuousDecode?.();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsScanning(false);
    setEngine(null);
    lastScanRef.current = "";
  }, []);

  // ── Start camera (only requests getUserMedia if no stream yet) ────────────
  const startScanning = useCallback(async () => {
    setError("");
    try {
      // Reuse the existing stream so the browser doesn't re-prompt for permission
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width:  { ideal: 3840, min: 1280 },
            height: { ideal: 2160, min: 720  },
            // @ts-ignore
            advanced: [{ focusMode: "continuous" }],
          },
        });
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
      } else if (videoRef.current && !videoRef.current.srcObject) {
        // Stream alive but video was detached (e.g. scanMode toggled)
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play();
      }

      setIsScanning(true);

      if (hasBarcodeDetector) {
        await startNativeScanner();
      } else {
        try { await startZbarScanner(); }
        catch (e) { console.warn("ZBar failed, falling back to ZXing:", e); await startZxingScanner(); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start camera");
      setIsScanning(false);
    }
  }, [startNativeScanner, startZbarScanner, startZxingScanner]);

  const resetScanner = useCallback(() => {
    fullStop();
    setTimeout(() => { if (isActive && scanMode === "camera") startScanning(); }, 150);
  }, [fullStop, startScanning, isActive, scanMode]);

  // ── Lifecycle: respond to isActive / scanMode changes ────────────────────
  // When isActive goes false we only pause the scan loop — the camera stream
  // stays alive so the browser doesn't re-prompt for permission on next start.
  useEffect(() => {
    if (isActive && scanMode === "camera") {
      startScanning();
    } else {
      pauseLoop();
    }
    return () => pauseLoop();
  }, [isActive, scanMode]);

  // Release the camera only when the component unmounts
  useEffect(() => {
    return () => fullStop();
  }, []);

  useEffect(() => {
    if (scanMode === "manual") inputRef.current?.focus();
  }, [scanMode]);

  // ── Manual input ──────────────────────────────────────────────────────────
  const handleManualScan = () => {
    const code = manualInput.trim();
    if (!code) return;
    emitScan(code);
    setManualInput("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleManualScan();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>Barcode Scanner</span>
            {engine && engine !== "zxing" && (
              <span className="flex items-center gap-1 text-xs font-normal text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
                <Zap className="h-3 w-3" />
                {engine === "native" ? "Native" : "ZBar"} — fast mode
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {scanMode === "camera" && (
              <>
                <Button onClick={resetScanner} variant="outline" size="sm" disabled={!isActive} data-testid="button-reset-scanner">
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  onClick={onToggle}
                  variant={isActive ? "destructive" : "default"}
                  size="sm"
                  data-testid="button-toggle-scanner"
                >
                  {isActive ? <CameraOff className="h-4 w-4 mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
                  {isActive ? "Stop" : "Start"} Scanner
                </Button>
              </>
            )}
            {scanMode === "manual" && (
              <div className="text-sm text-muted-foreground">Ready for input</div>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <Tabs value={scanMode} onValueChange={v => setScanMode(v as "camera" | "manual")}>
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="manual" className="flex items-center space-x-2" data-testid="tab-manual">
              <Keyboard className="h-4 w-4" />
              <span>Manual Input</span>
            </TabsTrigger>
            <TabsTrigger value="camera" className="flex items-center space-x-2" data-testid="tab-camera">
              <Camera className="h-4 w-4" />
              <span>Camera Scan</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Manual tab ── */}
          <TabsContent value="manual" className="space-y-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="barcode-input">Barcode Input</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Type or use a Bluetooth scanner — press Enter to submit
                </p>
              </div>
              <div className="flex space-x-2">
                <Input
                  id="barcode-input"
                  ref={inputRef}
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Scan or type barcode here..."
                  className="flex-1"
                  data-testid="input-barcode"
                />
                <Button onClick={handleManualScan} disabled={!manualInput.trim()} data-testid="button-scan-manual">
                  <Scan className="h-4 w-4 mr-2" />
                  Scan
                </Button>
              </div>
              <div className="text-center text-sm text-muted-foreground">
                <p>✓ Bluetooth barcode scanners supported</p>
                <p>✓ Press Enter or click Scan to process</p>
              </div>
            </div>
          </TabsContent>

          {/* ── Camera tab ── */}
          <TabsContent value="camera" className="space-y-4">
            {error && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive">Error: {error}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Make sure your browser has camera permissions and try again.
                </p>
              </div>
            )}

            <div className="relative">
              <video
                ref={videoRef}
                className="w-full h-64 bg-black rounded-md object-cover"
                style={{ display: isActive && isScanning ? "block" : "none" }}
                muted
                playsInline
                data-testid="video-scanner"
              />
              <canvas ref={canvasRef} className="hidden" />

              {(!isActive || !isScanning) && (
                <div className="w-full h-64 bg-muted rounded-md flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">Click "Start Scanner" to begin</p>
                    <p className="text-xs text-emerald-600 mt-1 flex items-center justify-center gap-1">
                      <Zap className="h-3 w-3" />
                      {hasBarcodeDetector ? "Native fast scanning" : "ZBar fast scanning"} available
                    </p>
                  </div>
                </div>
              )}

              {isActive && isScanning && (
                <div className="absolute inset-0 border-2 border-primary rounded-md pointer-events-none">
                  <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-28 rounded-lg"
                    style={{ border: "3px solid rgba(99,102,241,0.7)", boxShadow: "0 0 0 2000px rgba(0,0,0,0.25)" }}
                  />
                </div>
              )}
            </div>

            {isScanning && engine && (
              <p className="text-center text-sm text-muted-foreground">
                Point your camera at a barcode · {ENGINE_LABELS[engine]}
              </p>
            )}
          </TabsContent>
        </Tabs>

        {lastScan && (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
            <p className="text-sm text-green-700 dark:text-green-400" data-testid="text-last-scan">
              <strong>Last scan:</strong> {lastScan}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
