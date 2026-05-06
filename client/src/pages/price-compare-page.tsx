import { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BarcodeScanner } from "@/components/barcode-scanner";
import {
  ArrowLeft, Upload, TrendingUp, TrendingDown,
  AlertCircle, CheckCircle, Download, RefreshCw, ChevronUp, ChevronDown,
  AlertTriangle, HelpCircle, Scan, FileText, Trash2, Package
} from "lucide-react";
import type { LiquorRecord } from "@shared/schema";

// ── Types ────────────────────────────────────────────────────────────────────

interface ComparisonRow {
  upc: string;
  name: string;
  registerPrice: number;
  department: string;
  liquorCode: string;
  matched: boolean;
  matchedBy: 'upc' | 'code' | null;
  multipleMatches: boolean;
  allMatches?: LiquorRecord[];
  resolvedByUser: boolean;
  michiganPrice: number | null;
  michiganName: string | null;
  michiganBottleSize: string | null;
  michiganLiquorCode: string | null;
  priceDiff: number | null;
  newPrice: number;
  useCustomName: boolean;
  customName: string;
}

interface ScanRow {
  localId: string;
  upc: string;
  michiganName: string | null;
  michiganBottleSize: string | null;
  michiganLiquorCode: string | null;
  michiganPrice: number | null;
  yourPrice: number;
  matched: boolean;
  requiresSelection: boolean;
  allMatches?: LiquorRecord[];
  resolvedByUser: boolean;
  scannedAt: Date;
}

type PageMode = "csv" | "scan";
type Filter = "all" | "increased" | "decreased" | "same" | "notfound" | "ambiguous";
type SortKey = "name" | "registerPrice" | "michiganPrice" | "priceDiff" | "newPrice";
type SortDir = "asc" | "desc";

// ── CSV export helpers ────────────────────────────────────────────────────────

function buildPtouchCsv(rows: ComparisonRow[], useCustomNames: boolean): string {
  const headers = [
    "Upc","Department","qty","cents","incltaxes","inclfees","Name","Price","size",
    "ebt","byweight","Fee Multiplier","cost_qty","cost_cents","variable_price",
    "addstock","setstock","pack_name","pack_qty","pack_upc","unit_upc","unit_count",
    "is_oneclick","oc_color","oc_border_color","oc_text_color","oc_fixedpos",
    "oc_page","oc_key","oc_relpos"
  ];
  const dataRows = rows.map(row => {
    const price  = row.newPrice;
    const cents  = Math.round(price * 100);
    const fmtPrice = `$${price.toFixed(2)}`;
    const name   = useCustomNames && row.useCustomName && row.customName.trim()
      ? row.customName.trim()
      : row.name;
    const dept   = useCustomNames ? (row.department === "Liquor" ? "Liquor 2" : row.department) : "Liquor";
    return [
      `"${row.upc}"`, dept, "1", cents.toString(), "n", "n",
      `"${name}"`, fmtPrice, `"${row.liquorCode}"`,
      "", "n", "1", "1", "0", "n", "", `"=""0"""`,
      "", "", "", "", "", "n", "", "", "", "", "", "", ""
    ].join(",");
  });
  return [headers.join(","), ...dataRows].join("\r\n");
}

function buildScanCsv(rows: ScanRow[]): string {
  const headers = [
    "Upc","Department","qty","cents","incltaxes","inclfees","Name","Price","size",
    "ebt","byweight","Fee Multiplier","cost_qty","cost_cents","variable_price",
    "addstock","setstock","pack_name","pack_qty","pack_upc","unit_upc","unit_count",
    "is_oneclick","oc_color","oc_border_color","oc_text_color","oc_fixedpos",
    "oc_page","oc_key","oc_relpos"
  ];
  const dataRows = rows.filter(r => r.matched).map(row => {
    const price = row.yourPrice;
    const cents = Math.round(price * 100);
    const fmtPrice = `$${price.toFixed(2)}`;
    const name = row.michiganName ?? "Unknown";
    return [
      `"${row.upc}"`, "Liquor", "1", cents.toString(), "n", "n",
      `"${name}"`, fmtPrice, `"${row.michiganLiquorCode ?? ''}"`,
      "", "n", "1", "1", "0", "n", "", `"=""0"""`,
      "", "", "", "", "", "n", "", "", "", "", "", "", ""
    ].join(",");
  });
  return [headers.join(","), ...dataRows].join("\r\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PriceComparePage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mode toggle
  const [pageMode, setPageMode] = useState<PageMode>("csv");

  // ── CSV mode state ──────────────────────────────────────────────────────────
  const [rows, setRows]           = useState<ComparisonRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [fileName, setFileName]   = useState("");
  const [filter, setFilter]       = useState<Filter>("all");
  const [sortKey, setSortKey]     = useState<SortKey>("name");
  const [sortDir, setSortDir]     = useState<SortDir>("asc");
  const [search, setSearch]       = useState("");
  const [dbEmpty, setDbEmpty]     = useState(false);

  // CSV disambiguation
  const [disambigRow, setDisambigRow] = useState<{ origIdx: number; row: ComparisonRow } | null>(null);

  // ── Scan mode state ─────────────────────────────────────────────────────────
  const [scanRows, setScanRows]         = useState<ScanRow[]>([]);
  const [scannerActive, setScannerActive] = useState(false);
  const [scanLookupId, setScanLookupId]  = useState<string | null>(null); // localId being disambiguated
  const [scanLookupPending, setScanLookupPending] = useState(false);

  // ── file handling ──────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ variant: "destructive", title: "Wrong file type", description: "Please upload a CSV file." });
      return;
    }
    setFileName(file.name);
    setLoading(true);
    try {
      const csvText = await file.text();
      const res = await fetch("/api/compare-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Unknown error");

      if (data.dbEmpty) {
        setDbEmpty(true);
        setRows([]);
        toast({ variant: "destructive", title: "Michigan database not loaded", description: "Go to the home page first to load the Michigan price book, then come back." });
        return;
      }

      setDbEmpty(false);

      const hydrated: ComparisonRow[] = data.rows.map((r: any) => ({
        ...r,
        resolvedByUser: false,
        newPrice:       r.registerPrice,
        useCustomName:  false,
        customName:     r.name,
      }));
      setRows(hydrated);
      setFilter("all");

      const changed    = hydrated.filter(r => r.priceDiff !== null && r.priceDiff !== 0).length;
      const notFound   = hydrated.filter(r => !r.matched).length;
      const ambiguous  = hydrated.filter(r => r.multipleMatches).length;
      const codeMatched = hydrated.filter(r => r.matchedBy === 'code').length;
      toast({
        title: "Comparison ready",
        description: `${hydrated.length} products · ${changed} price changes · ${notFound} not found in MI DB${codeMatched ? ` · ${codeMatched} matched by liquor code` : ""}${ambiguous ? ` · ${ambiguous} need review` : ""}`,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Import failed", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  };

  // ── CSV row editing ─────────────────────────────────────────────────────────

  const updateRow = (idx: number, patch: Partial<ComparisonRow>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const resetAllToMichigan = () => {
    setRows(prev => prev.map(r => ({ ...r, newPrice: r.michiganPrice ?? r.registerPrice })));
    toast({ title: "Prices reset", description: "All new prices set to Michigan price." });
  };

  const applyMatch = (origIdx: number, match: LiquorRecord) => {
    const row = rows[origIdx];
    const michiganPrice = match.shelfPrice ?? null;
    const priceDiff = michiganPrice !== null
      ? Math.round((michiganPrice - row.registerPrice) * 100) / 100
      : null;
    updateRow(origIdx, {
      matched: true, resolvedByUser: true,
      michiganPrice, priceDiff,
      michiganName:       `${match.brandName} ${match.bottleSize}`,
      michiganBottleSize: match.bottleSize ?? null,
      michiganLiquorCode: match.liquorCode ?? null,
      newPrice: michiganPrice ?? row.registerPrice,
    });
    setDisambigRow(null);
    toast({ title: "Match applied", description: `Linked to ${match.brandName} ${match.bottleSize}` });
  };

  // ── CSV sorting ─────────────────────────────────────────────────────────────

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // ── CSV derived data ────────────────────────────────────────────────────────

  const totalIncreased  = rows.filter(r => r.priceDiff !== null && r.priceDiff > 0).length;
  const totalDecreased  = rows.filter(r => r.priceDiff !== null && r.priceDiff < 0).length;
  const totalSame       = rows.filter(r => r.priceDiff === 0).length;
  const totalNotFound   = rows.filter(r => !r.matched).length;
  const totalAmbiguous  = rows.filter(r => r.multipleMatches && !r.resolvedByUser).length;

  const visible = rows
    .filter(r => {
      if (filter === "increased") return r.priceDiff !== null && r.priceDiff > 0;
      if (filter === "decreased") return r.priceDiff !== null && r.priceDiff < 0;
      if (filter === "same")      return r.priceDiff === 0;
      if (filter === "notfound")  return !r.matched;
      if (filter === "ambiguous") return r.multipleMatches && !r.resolvedByUser;
      return true;
    })
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.upc.includes(q);
    })
    .sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === "name")               { av = a.name;          bv = b.name; }
      else if (sortKey === "registerPrice") { av = a.registerPrice; bv = b.registerPrice; }
      else if (sortKey === "michiganPrice") { av = a.michiganPrice ?? -1; bv = b.michiganPrice ?? -1; }
      else if (sortKey === "priceDiff")     { av = a.priceDiff ?? 999; bv = b.priceDiff ?? 999; }
      else                                  { av = a.newPrice; bv = b.newPrice; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1  : -1;
      return 0;
    });

  const visibleWithIdx = visible.map(r => ({ row: r, origIdx: rows.indexOf(r) }));

  // ── Scan mode logic ─────────────────────────────────────────────────────────

  const handleBarcodeScan = useCallback(async (barcode: string) => {
    if (scanLookupPending) return;
    setScanLookupPending(true);

    const localId = `${Date.now()}-${Math.random()}`;

    try {
      const res = await fetch("/api/scan-barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode }),
      });
      const data = await res.json();

      if (!data.success && !data.requiresSelection) {
        setScanRows(prev => [{
          localId,
          upc: barcode,
          michiganName: null,
          michiganBottleSize: null,
          michiganLiquorCode: null,
          michiganPrice: null,
          yourPrice: 0,
          matched: false,
          requiresSelection: false,
          resolvedByUser: false,
          scannedAt: new Date(),
        }, ...prev]);
        toast({ variant: "destructive", title: "Not found", description: `No Michigan record for UPC ${barcode}` });
        return;
      }

      if (data.requiresSelection) {
        const firstMatch = data.matchedProducts[0];
        setScanRows(prev => [{
          localId,
          upc: barcode,
          michiganName:       `${firstMatch.brandName} ${firstMatch.bottleSize}`,
          michiganBottleSize: firstMatch.bottleSize ?? null,
          michiganLiquorCode: firstMatch.liquorCode ?? null,
          michiganPrice:      firstMatch.shelfPrice ?? null,
          yourPrice:          firstMatch.shelfPrice ?? 0,
          matched: true,
          requiresSelection: true,
          allMatches: data.matchedProducts,
          resolvedByUser: false,
          scannedAt: new Date(),
        }, ...prev]);
        setScanLookupId(localId);
        toast({ title: "Multiple matches", description: `${data.matchedProducts.length} Michigan records share this UPC — please pick one.` });
        return;
      }

      const p = data.matchedProduct;
      setScanRows(prev => [{
        localId,
        upc: barcode,
        michiganName:       `${p.brandName} ${p.bottleSize}`,
        michiganBottleSize: p.bottleSize ?? null,
        michiganLiquorCode: p.liquorCode ?? null,
        michiganPrice:      p.shelfPrice ?? null,
        yourPrice:          p.shelfPrice ?? 0,
        matched: true,
        requiresSelection: false,
        resolvedByUser: false,
        scannedAt: new Date(),
      }, ...prev]);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Lookup failed", description: err.message });
    } finally {
      setScanLookupPending(false);
    }
  }, [scanLookupPending, toast]);

  const updateScanRow = (localId: string, patch: Partial<ScanRow>) => {
    setScanRows(prev => prev.map(r => r.localId === localId ? { ...r, ...patch } : r));
  };

  const applyScanMatch = (localId: string, match: LiquorRecord) => {
    updateScanRow(localId, {
      matched: true,
      requiresSelection: false,
      resolvedByUser: true,
      michiganName:       `${match.brandName} ${match.bottleSize}`,
      michiganBottleSize: match.bottleSize ?? null,
      michiganLiquorCode: match.liquorCode ?? null,
      michiganPrice:      match.shelfPrice ?? null,
      yourPrice:          match.shelfPrice ?? 0,
    });
    setScanLookupId(null);
    toast({ title: "Match applied", description: `${match.brandName} ${match.bottleSize}` });
  };

  const removeScanRow = (localId: string) => {
    setScanRows(prev => prev.filter(r => r.localId !== localId));
  };

  const scanDisambigRow = scanLookupId ? scanRows.find(r => r.localId === scanLookupId) : null;

  // ── Scan export ─────────────────────────────────────────────────────────────

  const doScanExport = () => {
    const exportable = scanRows.filter(r => r.matched);
    if (exportable.length === 0) {
      toast({ variant: "destructive", title: "Nothing to export", description: "Scan some bottles first." });
      return;
    }
    const csv = buildScanCsv(scanRows);
    downloadCsv(csv, `shelf_scan_${new Date().toISOString().slice(0, 10)}.csv`);
    toast({ title: "Exported!", description: `Downloaded ${exportable.length} scanned products.` });
  };

  // ── CSV export ──────────────────────────────────────────────────────────────

  const doExport = (customNames: boolean) => {
    if (rows.length === 0) return;
    const csv  = buildPtouchCsv(rows, customNames);
    const stem = fileName.replace(/\.csv$/i, "");
    const suffix = customNames ? "_custom_updated" : "_updated";
    downloadCsv(csv, `${stem}${suffix}.csv`);
    toast({ title: "Exported!", description: `Downloaded ${rows.length} products with updated prices.` });
  };

  // ── Sub-components ──────────────────────────────────────────────────────────

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null :
    sortDir === "asc" ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;

  const Th = ({ label, k, className = "" }: { label: string; k: SortKey; className?: string }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap ${className}`}
    >
      {label}<SortIcon k={k} />
    </th>
  );

  const DiffBadge = ({ diff }: { diff: number | null }) => {
    if (diff === null) return <Badge variant="outline" className="text-xs">No match</Badge>;
    if (diff === 0)    return <Badge variant="secondary" className="text-xs">No change</Badge>;
    if (diff > 0)      return (
      <Badge className="text-xs bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
        <TrendingUp className="h-3 w-3 mr-1" />+${diff.toFixed(2)}
      </Badge>
    );
    return (
      <Badge className="text-xs bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
        <TrendingDown className="h-3 w-3 mr-1" />${diff.toFixed(2)}
      </Badge>
    );
  };

  const scanMatchedCount  = scanRows.filter(r => r.matched).length;
  const scanNeedsReview   = scanRows.filter(r => r.requiresSelection && !r.resolvedByUser).length;
  const scanNotFound      = scanRows.filter(r => !r.matched).length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="bg-primary text-primary-foreground p-2 rounded-lg">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Price Comparison</h1>
              <p className="text-xs text-muted-foreground">Compare your prices against Michigan's current price book</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setPageMode("csv")}
                data-testid="button-mode-csv"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  pageMode === "csv"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                <FileText className="h-4 w-4" />
                CSV Upload
              </button>
              <button
                onClick={() => setPageMode("scan")}
                data-testid="button-mode-scan"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  pageMode === "scan"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                <Scan className="h-4 w-4" />
                Scan Mode
              </button>
            </div>

            {/* CSV export buttons */}
            {pageMode === "csv" && rows.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={resetAllToMichigan}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Reset all to MI
                </Button>
                <Button variant="outline" size="sm" onClick={() => doExport(false)}>
                  <Download className="h-4 w-4 mr-1" /> Export P-touch CSV
                </Button>
                <Button size="sm" onClick={() => doExport(true)}>
                  <Download className="h-4 w-4 mr-1" /> With Custom Names
                </Button>
              </>
            )}

            {/* Scan export button */}
            {pageMode === "scan" && scanRows.length > 0 && (
              <Button size="sm" onClick={doScanExport} data-testid="button-scan-export">
                <Download className="h-4 w-4 mr-1" /> Export P-touch CSV
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">

        {/* ══════════════════════════════════════════════════════════════════
            CSV UPLOAD MODE
        ══════════════════════════════════════════════════════════════════ */}
        {pageMode === "csv" && (
          <>
            {dbEmpty && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-4 text-sm text-red-800">
                <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
                <div>
                  <p className="font-semibold">Michigan price book not loaded</p>
                  <p className="mt-1 text-red-700">
                    <Link href="/" className="underline font-medium hover:text-red-900">Go to the home page</Link>{" "}
                    to load it, then come back and upload your CSV.
                  </p>
                </div>
              </div>
            )}

            {/* Upload zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone-csv"
              className={`relative border-2 border-dashed rounded-xl cursor-pointer transition-all
                ${dragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/50 hover:bg-muted/30"}
                ${rows.length > 0 ? "p-4" : "p-12"}`}
            >
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
              <div className={`flex items-center gap-3 ${rows.length > 0 ? "justify-start" : "flex-col justify-center text-center"}`}>
                {loading ? (
                  <RefreshCw className={`text-primary animate-spin ${rows.length > 0 ? "h-5 w-5" : "h-10 w-10"}`} />
                ) : (
                  <Upload className={`text-muted-foreground ${rows.length > 0 ? "h-5 w-5" : "h-10 w-10"}`} />
                )}
                {rows.length > 0 ? (
                  <span className="text-sm text-muted-foreground">
                    {loading ? "Processing…" : <>Drop a new CSV here to replace <strong>{fileName}</strong></>}
                  </span>
                ) : (
                  <>
                    <div>
                      <p className="text-base font-medium text-foreground">
                        {loading ? "Processing your CSV…" : "Drop your register P-touch CSV here"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Upload the file exported from your scanner — P-touch CSV format
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Summary strip */}
            {rows.length > 0 && !loading && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setFilter("all")}>
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xl font-bold">{rows.length}</p>
                      <p className="text-xs text-muted-foreground">Total products</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="cursor-pointer hover:border-red-300 transition-colors" onClick={() => setFilter("increased")}>
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-red-500" />
                    <div>
                      <p className="text-xl font-bold text-red-600">{totalIncreased}</p>
                      <p className="text-xs text-muted-foreground">Price increased</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="cursor-pointer hover:border-green-300 transition-colors" onClick={() => setFilter("decreased")}>
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-xl font-bold text-green-600">{totalDecreased}</p>
                      <p className="text-xs text-muted-foreground">Price decreased</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="cursor-pointer hover:border-amber-300 transition-colors" onClick={() => setFilter("notfound")}>
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <div>
                      <p className="text-xl font-bold text-amber-600">{totalNotFound}</p>
                      <p className="text-xs text-muted-foreground">Not in MI DB</p>
                    </div>
                  </CardContent>
                </Card>
                <Card
                  className={`cursor-pointer transition-colors ${totalAmbiguous > 0 ? "hover:border-orange-400 border-orange-200 bg-orange-50/40" : "hover:border-muted"}`}
                  onClick={() => setFilter("ambiguous")}
                >
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <HelpCircle className={`h-4 w-4 ${totalAmbiguous > 0 ? "text-orange-500" : "text-muted-foreground"}`} />
                    <div>
                      <p className={`text-xl font-bold ${totalAmbiguous > 0 ? "text-orange-600" : "text-muted-foreground"}`}>{totalAmbiguous}</p>
                      <p className="text-xs text-muted-foreground">Need review</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Ambiguous banner */}
            {totalAmbiguous > 0 && !loading && (
              <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-500" />
                <span>
                  <strong>{totalAmbiguous} product{totalAmbiguous > 1 ? "s share" : " shares"} a UPC with multiple Michigan records.</strong>{" "}
                  Click the orange <strong>?</strong> badge on any row to pick the correct match.
                </span>
              </div>
            )}

            {/* Filter + search bar */}
            {rows.length > 0 && !loading && (
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ["all",       `All (${rows.length})`],
                  ["increased", `↑ Up (${totalIncreased})`],
                  ["decreased", `↓ Down (${totalDecreased})`],
                  ["same",      `— Same (${totalSame})`],
                  ["notfound",  `? Not found (${totalNotFound})`],
                  ["ambiguous", `⚠ Review (${totalAmbiguous})`],
                ] as [Filter, string][]).map(([f, label]) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      filter === f
                        ? f === "ambiguous"
                          ? "bg-orange-500 text-white"
                          : "bg-primary text-primary-foreground"
                        : f === "ambiguous" && totalAmbiguous > 0
                          ? "bg-orange-100 text-orange-700 hover:bg-orange-200"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <div className="ml-auto">
                  <Input
                    placeholder="Search name or UPC…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-8 w-52 text-sm"
                  />
                </div>
              </div>
            )}

            {/* Comparison table */}
            {rows.length > 0 && !loading && (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <Th label="Product name"     k="name"          className="min-w-[200px]" />
                        <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">UPC</th>
                        <Th label="Your price"        k="registerPrice" className="text-right" />
                        <Th label="MI price"          k="michiganPrice" className="text-right" />
                        <Th label="Change"            k="priceDiff"     />
                        <Th label="New price"         k="newPrice"      className="text-right" />
                        <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name override</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visibleWithIdx.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                            No products match this filter.
                          </td>
                        </tr>
                      )}
                      {visibleWithIdx.map(({ row, origIdx }) => {
                        const needsReview = row.multipleMatches && !row.resolvedByUser;
                        const rowBg = needsReview
                          ? "bg-orange-50/60"
                          : !row.matched
                            ? "bg-amber-50/40"
                            : row.priceDiff && row.priceDiff > 0
                              ? "bg-red-50/30"
                              : row.priceDiff && row.priceDiff < 0
                                ? "bg-green-50/30"
                                : "";
                        return (
                          <tr key={origIdx} className={`hover:bg-muted/20 transition-colors ${rowBg}`}>
                            <td className="px-3 py-2.5">
                              <div className="flex items-start gap-2">
                                {needsReview && (
                                  <button
                                    title="Multiple Michigan records share this UPC — click to pick the correct one"
                                    onClick={() => setDisambigRow({ origIdx, row })}
                                    className="flex-shrink-0 mt-0.5 bg-orange-100 hover:bg-orange-200 text-orange-600 rounded-full h-5 w-5 flex items-center justify-center transition-colors"
                                  >
                                    <HelpCircle className="h-3 w-3" />
                                  </button>
                                )}
                                {row.resolvedByUser && (
                                  <button
                                    title={`Resolved — click to change the match`}
                                    onClick={() => setDisambigRow({ origIdx, row })}
                                    className="flex-shrink-0 mt-0.5 bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-full h-5 w-5 flex items-center justify-center transition-colors"
                                  >
                                    <CheckCircle className="h-3 w-3" />
                                  </button>
                                )}
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground leading-tight">{row.name}</p>
                                  {row.michiganName && row.michiganName !== row.name && (
                                    <p className="text-xs text-muted-foreground mt-0.5">MI: {row.michiganName}</p>
                                  )}
                                  {row.matchedBy === 'code' && (
                                    <p className="text-xs text-blue-500 mt-0.5">matched by liquor code</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.upc}</td>
                            <td className="px-3 py-2.5 text-right font-medium tabular-nums">${row.registerPrice.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {row.michiganPrice !== null
                                ? <span className="font-medium">${row.michiganPrice.toFixed(2)}</span>
                                : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              {needsReview
                                ? <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 cursor-pointer" onClick={() => setDisambigRow({ origIdx, row })}>Pick match</Badge>
                                : <DiffBadge diff={row.priceDiff} />
                              }
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1 justify-end">
                                <span className="text-muted-foreground text-sm">$</span>
                                <input
                                  key={`${origIdx}-${row.newPrice}`}
                                  type="text"
                                  inputMode="decimal"
                                  defaultValue={row.newPrice.toFixed(2)}
                                  onBlur={e => {
                                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                                    const v = parseFloat(raw);
                                    const rounded = isNaN(v) ? row.newPrice : Math.round(v * 100) / 100;
                                    e.target.value = rounded.toFixed(2);
                                    updateRow(origIdx, { newPrice: rounded });
                                  }}
                                  className="w-20 text-right rounded border border-border bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
                                />
                                {row.michiganPrice !== null && row.newPrice !== row.michiganPrice && (
                                  <button
                                    title="Reset to MI price"
                                    onClick={() => updateRow(origIdx, { newPrice: row.michiganPrice! })}
                                    className="text-muted-foreground hover:text-primary transition-colors ml-0.5"
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5 min-w-[160px]">
                                <input
                                  type="checkbox"
                                  id={`override-${origIdx}`}
                                  checked={row.useCustomName}
                                  onChange={e => updateRow(origIdx, { useCustomName: e.target.checked })}
                                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                                />
                                {row.useCustomName ? (
                                  <input
                                    type="text"
                                    value={row.customName}
                                    onChange={e => updateRow(origIdx, { customName: e.target.value })}
                                    className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                    placeholder="Custom name…"
                                  />
                                ) : (
                                  <label htmlFor={`override-${origIdx}`} className="text-xs text-muted-foreground cursor-pointer">
                                    Use custom name
                                  </label>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>Showing {visibleWithIdx.length} of {rows.length} products</span>
                  <div className="flex gap-3">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => doExport(false)}>
                      <Download className="h-3 w-3 mr-1" /> P-touch CSV
                    </Button>
                    <Button size="sm" className="h-7 text-xs" onClick={() => doExport(true)}>
                      <Download className="h-3 w-3 mr-1" /> P-touch CSV (Custom Names)
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SCAN MODE
        ══════════════════════════════════════════════════════════════════ */}
        {pageMode === "scan" && (
          <div className="space-y-5">

            {/* Explainer */}
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
              <Scan className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-500" />
              <span>
                Scan bottles directly from your shelves. Each scan looks up the Michigan price book and adds the item to the list below.
                Set the price you currently charge on the right, then export when done.
              </span>
            </div>

            {/* Scanner + summary side by side on desktop */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-1">
                <BarcodeScanner
                  onScan={handleBarcodeScan}
                  isActive={scannerActive}
                  onToggle={() => setScannerActive(a => !a)}
                />
                {scanLookupPending && (
                  <p className="text-center text-sm text-muted-foreground mt-2 flex items-center justify-center gap-2">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Looking up…
                  </p>
                )}
              </div>

              {/* Stats column */}
              <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
                <Card>
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xl font-bold">{scanRows.length}</p>
                      <p className="text-xs text-muted-foreground">Scanned</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-xl font-bold text-green-600">{scanMatchedCount}</p>
                      <p className="text-xs text-muted-foreground">Matched in MI</p>
                    </div>
                  </CardContent>
                </Card>
                {scanNeedsReview > 0 && (
                  <Card className="border-orange-200 bg-orange-50/40">
                    <CardContent className="py-3 px-4 flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 text-orange-500" />
                      <div>
                        <p className="text-xl font-bold text-orange-600">{scanNeedsReview}</p>
                        <p className="text-xs text-muted-foreground">Need review</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {scanNotFound > 0 && (
                  <Card className="border-amber-200 bg-amber-50/40">
                    <CardContent className="py-3 px-4 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                      <div>
                        <p className="text-xl font-bold text-amber-600">{scanNotFound}</p>
                        <p className="text-xs text-muted-foreground">Not found</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {scanRows.length > 0 && (
                  <div className="col-span-full flex gap-2">
                    <Button onClick={doScanExport} className="flex-1" data-testid="button-scan-export-list">
                      <Download className="h-4 w-4 mr-2" /> Export P-touch CSV
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => { setScanRows([]); }}
                      data-testid="button-scan-clear"
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Clear list
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Scan list */}
            {scanRows.length > 0 && (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide min-w-[200px]">Product (Michigan name)</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">UPC</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">MI Shelf Price</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Your Price</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Difference</th>
                        <th className="px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {scanRows.map(row => {
                        const needsReview = row.requiresSelection && !row.resolvedByUser;
                        const diff = row.matched && row.michiganPrice !== null
                          ? Math.round((row.michiganPrice - row.yourPrice) * 100) / 100
                          : null;
                        const rowBg = needsReview
                          ? "bg-orange-50/60"
                          : !row.matched
                            ? "bg-amber-50/40"
                            : "";
                        return (
                          <tr key={row.localId} className={`hover:bg-muted/20 transition-colors ${rowBg}`}>
                            <td className="px-3 py-2.5">
                              <div className="flex items-start gap-2">
                                {needsReview && (
                                  <button
                                    title="Multiple Michigan records — click to pick the correct one"
                                    onClick={() => setScanLookupId(row.localId)}
                                    className="flex-shrink-0 mt-0.5 bg-orange-100 hover:bg-orange-200 text-orange-600 rounded-full h-5 w-5 flex items-center justify-center transition-colors"
                                    data-testid={`button-pick-match-${row.localId}`}
                                  >
                                    <HelpCircle className="h-3 w-3" />
                                  </button>
                                )}
                                <div className="min-w-0">
                                  {row.matched ? (
                                    <>
                                      <p className="font-medium text-foreground leading-tight">{row.michiganName}</p>
                                      {row.michiganBottleSize && (
                                        <p className="text-xs text-muted-foreground mt-0.5">{row.michiganBottleSize}</p>
                                      )}
                                      {needsReview && (
                                        <button
                                          onClick={() => setScanLookupId(row.localId)}
                                          className="text-xs text-orange-600 mt-0.5 hover:underline"
                                        >
                                          {row.allMatches?.length} matches — click to pick
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <p className="text-amber-700 font-medium">Not found in Michigan DB</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.upc}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {row.michiganPrice !== null
                                ? <span className="font-medium">${row.michiganPrice.toFixed(2)}</span>
                                : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1 justify-end">
                                <span className="text-muted-foreground text-sm">$</span>
                                <input
                                  key={`${row.localId}-${row.yourPrice}`}
                                  type="text"
                                  inputMode="decimal"
                                  defaultValue={row.yourPrice.toFixed(2)}
                                  onBlur={e => {
                                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                                    const v = parseFloat(raw);
                                    const rounded = isNaN(v) ? row.yourPrice : Math.round(v * 100) / 100;
                                    e.target.value = rounded.toFixed(2);
                                    updateScanRow(row.localId, { yourPrice: rounded });
                                  }}
                                  className="w-20 text-right rounded border border-border bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
                                  data-testid={`input-your-price-${row.localId}`}
                                />
                                {row.michiganPrice !== null && row.yourPrice !== row.michiganPrice && (
                                  <button
                                    title="Reset to MI price"
                                    onClick={() => updateScanRow(row.localId, { yourPrice: row.michiganPrice! })}
                                    className="text-muted-foreground hover:text-primary transition-colors ml-0.5"
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              {row.matched
                                ? <DiffBadge diff={diff} />
                                : <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Not found</Badge>
                              }
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                onClick={() => removeScanRow(row.localId)}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                title="Remove from list"
                                data-testid={`button-remove-scan-${row.localId}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>{scanRows.length} item{scanRows.length !== 1 ? "s" : ""} scanned · {scanMatchedCount} matched</span>
                  <Button size="sm" className="h-7 text-xs" onClick={doScanExport} data-testid="button-scan-export-footer">
                    <Download className="h-3 w-3 mr-1" /> Export P-touch CSV
                  </Button>
                </div>
              </div>
            )}

            {/* Empty state */}
            {scanRows.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
                <Scan className="h-12 w-12 opacity-30" />
                <p className="text-base font-medium">No bottles scanned yet</p>
                <p className="text-sm">Use the scanner on the left to scan bottles from your shelves.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── CSV Disambiguation dialog ──────────────────────────────────────── */}
      <Dialog open={!!disambigRow} onOpenChange={open => { if (!open) setDisambigRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-orange-500" />
              Multiple Michigan records for this UPC
            </DialogTitle>
            <DialogDescription>
              UPC <span className="font-mono">{disambigRow?.row.upc}</span> matches{" "}
              {disambigRow?.row.allMatches?.length ?? 0} products in the Michigan price book.
              Pick the one that matches <strong>{disambigRow?.row.name}</strong> on your register.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {disambigRow?.row.allMatches?.map((match, i) => {
              const miPrice = match.shelfPrice ?? null;
              const diff = miPrice !== null
                ? Math.round((miPrice - disambigRow.row.registerPrice) * 100) / 100
                : null;
              const isCurrentMatch = disambigRow.row.resolvedByUser
                && disambigRow.row.michiganName === `${match.brandName} ${match.bottleSize}`;
              return (
                <button
                  key={i}
                  onClick={() => applyMatch(disambigRow.origIdx, match)}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-colors
                    ${isCurrentMatch ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground leading-tight">{match.brandName}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {match.bottleSize}
                        {match.liquorCode ? <span className="ml-2 font-mono text-xs">#{match.liquorCode}</span> : null}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {miPrice !== null ? (
                        <>
                          <p className="font-bold text-foreground">${miPrice.toFixed(2)}</p>
                          {diff !== null && diff !== 0 && (
                            <p className={`text-xs font-medium ${diff > 0 ? "text-red-600" : "text-green-600"}`}>
                              {diff > 0 ? "+" : ""}{diff.toFixed(2)} vs yours
                            </p>
                          )}
                          {diff === 0 && <p className="text-xs text-muted-foreground">Same as yours</p>}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">No price</p>
                      )}
                    </div>
                  </div>
                  {isCurrentMatch && <p className="text-xs text-primary mt-1.5 font-medium">✓ Currently selected</p>}
                </button>
              );
            })}
          </div>
          <div className="pt-2 border-t border-border">
            <Button variant="outline" className="w-full" onClick={() => setDisambigRow(null)}>
              Cancel — keep current match
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Scan Mode Disambiguation dialog ───────────────────────────────── */}
      <Dialog open={!!scanDisambigRow} onOpenChange={open => { if (!open) setScanLookupId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-orange-500" />
              Multiple Michigan records for this UPC
            </DialogTitle>
            <DialogDescription>
              UPC <span className="font-mono">{scanDisambigRow?.upc}</span> matches{" "}
              {scanDisambigRow?.allMatches?.length ?? 0} products in the Michigan price book.
              Pick the correct one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {scanDisambigRow?.allMatches?.map((match, i) => {
              const miPrice = match.shelfPrice ?? null;
              const isCurrentMatch = scanDisambigRow.resolvedByUser
                && scanDisambigRow.michiganName === `${match.brandName} ${match.bottleSize}`;
              return (
                <button
                  key={i}
                  onClick={() => applyScanMatch(scanDisambigRow.localId, match)}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-colors
                    ${isCurrentMatch ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground leading-tight">{match.brandName}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {match.bottleSize}
                        {match.liquorCode ? <span className="ml-2 font-mono text-xs">#{match.liquorCode}</span> : null}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {miPrice !== null ? (
                        <p className="font-bold text-foreground">${miPrice.toFixed(2)}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No price</p>
                      )}
                    </div>
                  </div>
                  {isCurrentMatch && <p className="text-xs text-primary mt-1.5 font-medium">✓ Currently selected</p>}
                </button>
              );
            })}
          </div>
          <div className="pt-2 border-t border-border">
            <Button variant="outline" className="w-full" onClick={() => setScanLookupId(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
