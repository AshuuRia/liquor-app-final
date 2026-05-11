import { useEffect, useRef, useState, useCallback } from "react";
import { getAuthHeaders } from "@/lib/queryClient";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { scanImageData, setModuleArgs } from "@undecaf/zbar-wasm";
// @ts-ignore
import zbarWasmUrl from "@undecaf/zbar-wasm/dist/zbar.wasm?url";
import { X, Search, ScanLine, RotateCcw, TrendingUp, TrendingDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LiquorRecord } from "@shared/schema";

setModuleArgs({ locateFile: () => zbarWasmUrl });

const hasBarcodeDetector = typeof window !== "undefined" && "BarcodeDetector" in window;
const CONFIRM_FRAMES = 3;
const SCAN_COOLDOWN_MS = 2500;

function playBeep(success: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (success) {
      osc.frequency.setValueAtTime(1046, ctx.currentTime);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    } else {
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.setValueAtTime(300, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch { /* audio not critical */ }
}

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

function normalizeBarcode(raw: string): string {
  if (/^\d+$/.test(raw)) {
    if (raw.length === 14 && raw.startsWith("00")) return raw.slice(2);
    if (raw.length === 13 && raw.startsWith("0"))  return raw.slice(1);
  }
  return raw;
}

interface ProductInfo {
  record: LiquorRecord & { priceChange?: string | null };
  barcode: string;
  multiple?: Array<LiquorRecord & { priceChange?: string | null }>;
}

function fmt(price: number | string | null) {
  if (price == null) return "—";
  const n = typeof price === "number" ? price : parseFloat(price as string);
  return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
}

function PriceChangeBadge({ change }: { change: string | null | undefined }) {
  if (!change) return null;

  if (change === "new") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-bold">
        <Sparkles className="h-3 w-3" />
        New
      </span>
    );
  }

  const num = parseFloat(change);
  if (isNaN(num)) return null;

  if (num > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs font-bold">
        <TrendingUp className="h-3 w-3" />
        +${num.toFixed(2)}
      </span>
    );
  }

  if (num < 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs font-bold">
        <TrendingDown className="h-3 w-3" />
        -${Math.abs(num).toFixed(2)}
      </span>
    );
  }

  return null;
}

function ProductSheet({ info, onClose, onPickMultiple }: {
  info: ProductInfo;
  onClose: () => void;
  onPickMultiple?: (rec: LiquorRecord & { priceChange?: string | null }) => void;
}) {
  const r = info.record;
  const hasMultiple = info.multiple && info.multiple.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white dark:bg-zinc-900 rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </div>

        <div className="px-5 pb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                {r.brandName}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{r.vendorName}</p>
            </div>
            <button
              onClick={onClose}
              data-testid="button-close-product"
              className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center"
            >
              <X className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
            </button>
          </div>

          {/* Price change badge */}
          {r.priceChange && (
            <div className="mb-4">
              <PriceChangeBadge change={r.priceChange} />
            </div>
          )}

          {/* Price row */}
          <div className="flex gap-3 mb-5">
            <div className="flex-1 bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{fmt(r.shelfPrice)}</div>
              <div className="text-xs text-blue-500 dark:text-blue-300 mt-0.5">Shelf Price</div>
            </div>
            <div className="flex-1 bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-center">
              <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{fmt(r.offPremisePrice)}</div>
              <div className="text-xs text-zinc-500 mt-0.5">Off-Premise</div>
            </div>
            <div className="flex-1 bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-center">
              <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{fmt(r.onPremisePrice)}</div>
              <div className="text-xs text-zinc-500 mt-0.5">On-Premise</div>
            </div>
          </div>

          {/* Details grid */}
          <div className="space-y-2.5">
            {[
              ["Bottle Size", r.bottleSize],
              ["Proof", r.proof ? `${r.proof}°` : null],
              ["Liquor Code", r.liquorCode],
              ["ADA Number", r.adaNumber],
              ["ADA Name", r.adaName],
              ["Pack Size", r.packSize],
              ["UPC 1", r.upcCode1 !== "00000000000000" ? r.upcCode1 : null],
              ["UPC 2", r.upcCode2 !== "00000000000000" ? r.upcCode2 : null],
              ["Effective Date", r.effectiveDate],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label as string} className="flex items-center justify-between py-2 border-b border-zinc-100 dark:border-zinc-800">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 text-right max-w-[60%]">{value}</span>
              </div>
            ))}
          </div>

          {/* Scanned barcode */}
          <div className="mt-3 p-2.5 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Scanned barcode: {info.barcode}</p>
          </div>

          {/* Multiple matches */}
          {hasMultiple && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">Other matches for this barcode</p>
              <div className="space-y-1.5">
                {info.multiple!.filter(m => m.id !== r.id).map(m => (
                  <button
                    key={m.id}
                    onClick={() => onPickMultiple?.(m)}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 active:bg-zinc-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.brandName}</span>
                      {m.priceChange && <PriceChangeBadge change={m.priceChange} />}
                    </div>
                    <div className="text-xs text-zinc-500">{m.bottleSize} · {fmt(m.shelfPrice)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LookupPage() {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const animRef    = useRef<number>(0);
  const zxingRef   = useRef<BrowserMultiFormatReader>();
  const candidateRef  = useRef("");
  const countRef      = useRef(0);
  const cooldownRef   = useRef(0);
  const lastCodeRef   = useRef("");
  const lastTimeRef   = useRef(0);

  const [isScanning,     setIsScanning]     = useState(false);
  const [camError,       setCamError]       = useState("");
  const [product,        setProduct]        = useState<ProductInfo | null>(null);
  const [isLooking,      setIsLooking]      = useState(false);
  const [showManual,     setShowManual]     = useState(false);
  const [manualVal,      setManualVal]      = useState("");
  const [dbLoaded,       setDbLoaded]       = useState<number | null>(null);
  const [searchResults,  setSearchResults]  = useState<Array<LiquorRecord & { priceChange?: string | null }>>([]);
  const [searchLoading,  setSearchLoading]  = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load data count once (lightweight — just a count check, never re-imports)
  useEffect(() => {
    fetch("/api/db-status")
      .then(r => r.json())
      .then(d => d.count && setDbLoaded(d.count))
      .catch(() => {});
  }, []);

  const confirmCode = useCallback((code: string): boolean => {
    if (Date.now() < cooldownRef.current) return false;
    if (code === candidateRef.current) { countRef.current += 1; }
    else { candidateRef.current = code; countRef.current = 1; }
    return countRef.current >= CONFIRM_FRAMES;
  }, []);

  const lookupBarcode = useCallback(async (raw: string) => {
    const code = normalizeBarcode(raw);
    const now = Date.now();
    if (code === lastCodeRef.current && now - lastTimeRef.current < 2000) return;
    lastCodeRef.current = code;
    lastTimeRef.current = now;
    cooldownRef.current = now + SCAN_COOLDOWN_MS;
    candidateRef.current = "";
    countRef.current = 0;

    setIsLooking(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res  = await fetch("/api/scan-barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ barcode: code, sessionId: null }),
      });
      const data = await res.json();

      if (data.success && data.requiresSelection && data.matchedProducts?.length) {
        vibrate([80, 40, 80]);
        playBeep(true);
        setProduct({ record: data.matchedProducts[0], barcode: code, multiple: data.matchedProducts });
      } else if (data.success && data.matchedProduct) {
        vibrate(100);
        playBeep(true);
        setProduct({ record: data.matchedProduct, barcode: code });
      } else {
        vibrate([80, 60, 80, 60, 80]);
        playBeep(false);
      }
    } catch { /* ignore */ } finally {
      setIsLooking(false);
    }
  }, []);

  const emitScan = useCallback((code: string) => lookupBarcode(code), [lookupBarcode]);

  // ── native BarcodeDetector ────────────────────────────────────────────────
  const startNative = useCallback(async () => {
    let det: any;
    try { det = new (window as any).BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39"] }); }
    catch { det = new (window as any).BarcodeDetector(); }

    const scan = async () => {
      const v = videoRef.current;
      if (v && v.readyState >= 2) {
        try {
          const r = await det.detect(v);
          if (r.length > 0) { if (confirmCode(r[0].rawValue)) emitScan(r[0].rawValue); }
          else { candidateRef.current = ""; countRef.current = 0; }
        } catch { /* no barcode */ }
      }
      animRef.current = requestAnimationFrame(scan);
    };
    animRef.current = requestAnimationFrame(scan);
  }, [confirmCode, emitScan]);

  // ── ZBar WASM ─────────────────────────────────────────────────────────────
  const startZbar = useCallback(async () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const scan = async () => {
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        if (canvas.width !== v.videoWidth) { canvas.width = v.videoWidth; canvas.height = v.videoHeight; }
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        try {
          const r = await scanImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (r.length > 0) { if (confirmCode(r[0].decode())) emitScan(r[0].decode()); }
          else { candidateRef.current = ""; countRef.current = 0; }
        } catch { /* no barcode */ }
      }
      animRef.current = requestAnimationFrame(scan);
    };
    animRef.current = requestAnimationFrame(scan);
  }, [confirmCode, emitScan]);

  // ── ZXing fallback ────────────────────────────────────────────────────────
  const startZxing = useCallback(async () => {
    const hints = new Map(); hints.set(DecodeHintType.TRY_HARDER, true);
    zxingRef.current = new BrowserMultiFormatReader(hints);
    await zxingRef.current.decodeFromVideoDevice(undefined, videoRef.current!, (result, err) => {
      if (result) { const c = result.getText(); if (confirmCode(c)) emitScan(c); }
      else { candidateRef.current = ""; countRef.current = 0; }
    });
  }, [confirmCode, emitScan]);

  const startCamera = useCallback(async () => {
    setCamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      videoRef.current!.srcObject = stream;
      await videoRef.current!.play();
      setIsScanning(true);
      if (hasBarcodeDetector) { await startNative(); }
      else { try { await startZbar(); } catch { await startZxing(); } }
    } catch (e) {
      setCamError(e instanceof Error ? e.message : "Camera failed");
    }
  }, [startNative, startZbar, startZxing]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    zxingRef.current?.stopContinuousDecode?.();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsScanning(false);
  }, []);

  const resetCamera = useCallback(() => {
    stopCamera();
    setTimeout(startCamera, 200);
  }, [stopCamera, startCamera]);

  useEffect(() => {
    startCamera();
    return stopCamera;
  }, []);

  const handleClose = useCallback(() => {
    setProduct(null);
    lastCodeRef.current = "";
    cooldownRef.current = 0;
  }, []);

  // Debounced name/brand search
  const handleManualChange = (val: string) => {
    setManualVal(val);
    setSearchResults([]);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const trimmed = val.trim();
    if (!trimmed || trimmed.length < 2) return;
    // If it looks like a pure number, don't search by name — let them hit Look Up
    if (/^\d+$/.test(trimmed)) return;
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/search-liquor?query=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (data.success) setSearchResults(data.results || []);
      } catch { /* ignore */ } finally {
        setSearchLoading(false);
      }
    }, 300);
  };

  const handleSelectSearchResult = (rec: LiquorRecord & { priceChange?: string | null }) => {
    setProduct({ record: rec, barcode: rec.upcCode1 || rec.liquorCode || "" });
    setShowManual(false);
    setManualVal("");
    setSearchResults([]);
  };

  const handleManualSubmit = () => {
    const v = manualVal.trim();
    if (!v) return;
    lookupBarcode(v);
    setManualVal("");
    setShowManual(false);
    setSearchResults([]);
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden" style={{ paddingBottom: "4rem" }}>
      {/* Camera */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ display: isScanning ? "block" : "none" }}
        muted playsInline
        data-testid="video-lookup-scanner"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* No camera fallback */}
      {!isScanning && !camError && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="text-center">
            <ScanLine className="h-16 w-16 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400 text-sm">Starting camera…</p>
          </div>
        </div>
      )}

      {camError && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 px-8">
          <div className="text-center">
            <ScanLine className="h-16 w-16 text-red-500 mx-auto mb-3" />
            <p className="text-white font-semibold mb-1">Camera unavailable</p>
            <p className="text-zinc-400 text-sm mb-4">{camError}</p>
            <Button onClick={startCamera} variant="outline" size="sm">Try Again</Button>
          </div>
        </div>
      )}

      {/* Scan overlay */}
      {isScanning && !product && (
        <>
          {/* Dark vignette */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(ellipse 60% 40% at 50% 50%, transparent 0%, rgba(0,0,0,0.55) 100%)"
          }} />

          {/* Targeting reticle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ marginBottom: "4rem" }}>
            <div className="relative w-64 h-40">
              {[["top-0 left-0 border-t-4 border-l-4 rounded-tl-lg"], ["top-0 right-0 border-t-4 border-r-4 rounded-tr-lg"],
                ["bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg"], ["bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg"]]
                .map(([c], i) => (
                  <div key={i} className={`absolute w-8 h-8 border-white ${c}`} />
                ))}
              {isLooking && (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-blue-400 animate-pulse" />
              )}
            </div>
          </div>

          {/* Status label */}
          <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
            <div className="bg-black/60 backdrop-blur-sm rounded-full px-4 py-1.5">
              <p className="text-white/90 text-xs text-center">
                {isLooking ? "Looking up…" : "Point camera at a barcode"}
              </p>
            </div>
          </div>
        </>
      )}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
           style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        <div>
          <h1 className="text-white font-bold text-lg leading-none">Quick Lookup</h1>
          {dbLoaded && (
            <p className="text-white/60 text-xs mt-0.5">{dbLoaded.toLocaleString()} products</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isScanning && (
            <button
              onClick={resetCamera}
              data-testid="button-reset-camera"
              className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
            >
              <RotateCcw className="h-4 w-4 text-white" />
            </button>
          )}
          <button
            onClick={() => setShowManual(v => !v)}
            data-testid="button-manual-lookup"
            className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
          >
            <Search className="h-4 w-4 text-white" />
          </button>
        </div>
      </div>

      {/* Manual barcode / name search overlay */}
      {showManual && (
        <div className="absolute top-0 left-0 right-0 bottom-0 z-40 flex items-start justify-center bg-black/70 backdrop-blur-sm px-4 pt-16"
             onClick={() => { setShowManual(false); setSearchResults([]); setManualVal(""); }}>
          <div className="w-full bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 pb-3">
              <h3 className="text-base font-semibold mb-3 text-zinc-900 dark:text-white">Search Products</h3>
              <Input
                autoFocus
                value={manualVal}
                onChange={e => handleManualChange(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleManualSubmit()}
                placeholder="Brand name, UPC, or liquor code…"
                className="mb-3"
                data-testid="input-manual-barcode"
              />
              <div className="flex gap-2">
                <Button onClick={handleManualSubmit} className="flex-1" disabled={!manualVal.trim()} data-testid="button-manual-submit">
                  Look Up
                </Button>
                <Button onClick={() => { setShowManual(false); setSearchResults([]); setManualVal(""); }} variant="outline" className="flex-1">
                  Cancel
                </Button>
              </div>
            </div>

            {/* Search results */}
            {searchLoading && (
              <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500 text-center">
                Searching…
              </div>
            )}
            {!searchLoading && searchResults.length > 0 && (
              <div className="border-t border-zinc-100 dark:border-zinc-800 max-h-64 overflow-y-auto">
                {searchResults.map(r => (
                  <button
                    key={r.id}
                    onClick={() => handleSelectSearchResult(r)}
                    className="w-full text-left px-4 py-3 border-b border-zinc-50 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:bg-zinc-100 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{r.brandName}</p>
                        <p className="text-xs text-zinc-500 truncate">{r.bottleSize} · {r.vendorName}</p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{fmt(r.shelfPrice)}</p>
                        {r.priceChange && <PriceChangeBadge change={r.priceChange} />}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!searchLoading && manualVal.trim().length >= 2 && !/^\d+$/.test(manualVal.trim()) && searchResults.length === 0 && (
              <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500 text-center">
                No products found
              </div>
            )}
          </div>
        </div>
      )}

      {/* Product sheet */}
      {product && (
        <ProductSheet
          info={product}
          onClose={handleClose}
          onPickMultiple={rec => setProduct(p => p ? { ...p, record: rec } : null)}
        />
      )}
    </div>
  );
}
