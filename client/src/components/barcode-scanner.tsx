import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, CameraOff, RotateCcw, Keyboard, Scan, Zap } from "lucide-react";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  isActive: boolean;
  onToggle: () => void;
}

// Check if the native BarcodeDetector API is available (Chrome/Edge)
const hasBarcodeDetector = typeof window !== "undefined" && "BarcodeDetector" in window;

export function BarcodeScanner({ onScan, isActive, onToggle }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const zxingReader = useRef<BrowserMultiFormatReader>();
  const lastScanRef = useRef<string>("");
  const lastScanTimeRef = useRef<number>(0);

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string>("");
  const [lastScan, setLastScan] = useState<string>("");
  const [scanMode, setScanMode] = useState<"camera" | "manual">("manual");
  const [manualInput, setManualInput] = useState("");
  const [usingNativeApi, setUsingNativeApi] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce: ignore the same barcode within 2 seconds
  const emitScan = useCallback((code: string) => {
    const now = Date.now();
    if (code === lastScanRef.current && now - lastScanTimeRef.current < 2000) return;
    lastScanRef.current = code;
    lastScanTimeRef.current = now;
    setLastScan(code);
    onScan(code);
  }, [onScan]);

  // ── Native BarcodeDetector loop ──────────────────────────────────────────
  const startNativeScanner = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      (detectorRef.current as any) = new (window as any).BarcodeDetector({
        formats: [
          "ean_13", "ean_8", "upc_a", "upc_e",
          "code_128", "code_39", "code_93", "itf",
          "qr_code", "pdf417", "data_matrix",
        ],
      });
    } catch {
      // Some browsers support BarcodeDetector but with limited formats
      (detectorRef.current as any) = new (window as any).BarcodeDetector();
    }

    const scan = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(scan);
        return;
      }
      try {
        const barcodes = await detectorRef.current.detect(video);
        if (barcodes.length > 0) {
          emitScan(barcodes[0].rawValue);
        }
      } catch {
        // Ignore detection errors (e.g. no barcode in frame)
      }
      animFrameRef.current = requestAnimationFrame(scan);
    };

    animFrameRef.current = requestAnimationFrame(scan);
  }, [emitScan]);

  // ── ZXing fallback loop ──────────────────────────────────────────────────
  const startZxingScanner = useCallback(async () => {
    if (!videoRef.current) return;

    // TRY_HARDER makes ZXing spend more effort per frame — critical for
    // reading barcodes that are small or at a slight angle (i.e. from a distance)
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);

    zxingReader.current = new BrowserMultiFormatReader(hints);

    await zxingReader.current.decodeFromVideoDevice(
      undefined,
      videoRef.current,
      (result, err) => {
        if (result) emitScan(result.getText());
        if (err && err.name !== "NotFoundException") {
          console.error("ZXing error:", err);
        }
      }
    );
  }, [emitScan]);

  // ── Start camera + chosen engine ─────────────────────────────────────────
  const startScanning = useCallback(async () => {
    setError("");
    try {
      // High resolution gives the decoder many more pixels to work with,
      // which is the single biggest factor in reading barcodes from a distance.
      // The iPhone 17 Pro Max camera can do 4K — ask for it and let the OS
      // downscale if needed. Continuous autofocus keeps things sharp while moving.
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: "environment",
          width:  { ideal: 3840, min: 1280 },
          height: { ideal: 2160, min: 720 },
          // @ts-ignore — advanced constraints are valid but not in all TS definitions
          advanced: [{ focusMode: "continuous" }],
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      setIsScanning(true);

      if (hasBarcodeDetector) {
        setUsingNativeApi(true);
        await startNativeScanner();
      } else {
        setUsingNativeApi(false);
        await startZxingScanner();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start camera";
      setError(msg);
      setIsScanning(false);
    }
  }, [startNativeScanner, startZxingScanner]);

  // ── Stop everything ──────────────────────────────────────────────────────
  const stopScanning = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    zxingReader.current?.stopContinuousDecode?.();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;

    setIsScanning(false);
    lastScanRef.current = "";
  }, []);

  const resetScanner = useCallback(() => {
    stopScanning();
    setTimeout(() => { if (isActive && scanMode === "camera") startScanning(); }, 150);
  }, [stopScanning, startScanning, isActive, scanMode]);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isActive && scanMode === "camera") {
      startScanning();
    } else {
      stopScanning();
    }
    return stopScanning;
  }, [isActive, scanMode]);

  useEffect(() => {
    if (scanMode === "manual") inputRef.current?.focus();
  }, [scanMode]);

  // ── Manual input ─────────────────────────────────────────────────────────
  const handleManualScan = () => {
    const code = manualInput.trim();
    if (!code) return;
    emitScan(code);
    setManualInput("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleManualScan();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>Barcode Scanner</span>
            {usingNativeApi && isScanning && (
              <span className="flex items-center gap-1 text-xs font-normal text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
                <Zap className="h-3 w-3" /> Fast mode
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
        <Tabs value={scanMode} onValueChange={(v) => setScanMode(v as "camera" | "manual")}>
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
                  onChange={(e) => setManualInput(e.target.value)}
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
              {/* Video element — always rendered so the ref is stable */}
              <video
                ref={videoRef}
                className="w-full h-64 bg-black rounded-md object-cover"
                style={{ display: isActive && isScanning ? "block" : "none" }}
                muted
                playsInline
                data-testid="video-scanner"
              />
              {/* Hidden canvas used if we ever need frame capture */}
              <canvas ref={canvasRef} className="hidden" />

              {(!isActive || !isScanning) && (
                <div className="w-full h-64 bg-muted rounded-md flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">Click "Start Scanner" to begin</p>
                    {hasBarcodeDetector && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center justify-center gap-1">
                        <Zap className="h-3 w-3" /> Native fast scanning available
                      </p>
                    )}
                  </div>
                </div>
              )}

              {isActive && isScanning && (
                <div className="absolute inset-0 border-2 border-primary rounded-md pointer-events-none">
                  {/* Aim overlay */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-28 rounded-lg"
                    style={{ border: "3px solid rgba(99,102,241,0.7)", boxShadow: "0 0 0 2000px rgba(0,0,0,0.25)" }} />
                  {/* Corner marks */}
                  {[
                    "top-[calc(50%-56px)] left-[calc(50%-112px)]",
                    "top-[calc(50%-56px)] right-[calc(50%-112px)]",
                    "bottom-[calc(50%-56px)] left-[calc(50%-112px)]",
                    "bottom-[calc(50%-56px)] right-[calc(50%-112px)]",
                  ].map((cls, i) => (
                    <div key={i} className={`absolute w-4 h-4 border-primary ${cls}`}
                      style={{
                        borderWidth: "3px 0 0 3px",
                        transform: i === 1 ? "scaleX(-1)" : i === 2 ? "scaleY(-1)" : i === 3 ? "scale(-1,-1)" : undefined,
                      }} />
                  ))}
                </div>
              )}
            </div>

            {isScanning && (
              <p className="text-center text-sm text-muted-foreground">
                Point your camera at a barcode to scan
                {usingNativeApi ? " — using fast native detection" : ""}
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
