import { useState, useRef, useCallback, useEffect } from "react";
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
  AlertTriangle, HelpCircle, Scan, FileText, Trash2, Package, XCircle,
  Cloud, CloudOff, Save
} from "lucide-react";
import type { LiquorRecord } from "@shared/schema";
import { getAuthHeaders } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

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

type PageMode = "csv" | "scan";
type Filter = "all" | "increased" | "decreased" | "same" | "notfound" | "ambiguous";
type SortKey = "name" | "registerPrice" | "michiganPrice" | "priceDiff" | "newPrice";
type SortDir = "asc" | "desc";

// ── CSV export helpers ─────────────────────────────────────────────────────────

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

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function normalizeBarcode(raw: string): string {
  const s = raw.replace(/\D/g, '');
  if (s.length === 14 && s.startsWith('00')) return s.slice(2);
  if (s.length === 13 && s.startsWith('0'))  return s.slice(1);
  return s || raw;
}

// ── Local (localStorage) save/load — always works, instant ────────────────────

const LOCAL_KEY = "price_compare_session";

function saveLocalSession(fileName: string, rows: ComparisonRow[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ fileName, rows }));
  } catch { /* storage full — ignore */ }
}

function loadLocalSession(): { fileName: string; rows: ComparisonRow[] } | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fileName: string; rows: ComparisonRow[] };
    if (!parsed.rows?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearLocalSession(): void {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
}

// ── Cloud save/load helpers ───────────────────────────────────────────────────

async function loadCloudSession(): Promise<{ fileName: string; rows: ComparisonRow[] } | null> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch("/api/price-compare/session", {
      credentials: "include",
      headers: authHeaders,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.session?.rowsJson) return null;
    const rows = JSON.parse(data.session.rowsJson) as ComparisonRow[];
    return { fileName: data.session.fileName, rows };
  } catch {
    return null;
  }
}

async function saveCloudSession(fileName: string, rows: ComparisonRow[]): Promise<void> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch("/api/price-compare/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      credentials: "include",
      body: JSON.stringify({ fileName, rowsJson: JSON.stringify(rows) }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (e) {
    console.warn("[price-compare] cloud save failed:", e);
    throw e;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PriceComparePage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pageMode, setPageMode] = useState<PageMode>("csv");
  const [rows, setRows]         = useState<ComparisonRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [filter, setFilter]     = useState<Filter>("all");
  const [sortKey, setSortKey]   = useState<SortKey>("name");
  const [sortDir, setSortDir]   = useState<SortDir>("asc");
  const [search, setSearch]     = useState("");
  const [dbEmpty, setDbEmpty]   = useState(false);

  const [disambigRow, setDisambigRow] = useState<{ origIdx: number; row: ComparisonRow } | null>(null);

  const [scannedIndices, setScannedIndices] = useState<number[]>([]);
  const [scannerActive, setScannerActive]   = useState(false);
  const [scanSearch, setScanSearch]         = useState("");

  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudSaved, setCloudSaved]   = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs that always hold the latest values so unmount cleanup can read them synchronously
  const rowsRef     = useRef<ComparisonRow[]>([]);
  const fileNameRef = useRef<string>("");
  useEffect(() => { rowsRef.current     = rows;     }, [rows]);
  useEffect(() => { fileNameRef.current = fileName; }, [fileName]);

  // ── Save on every rows/fileName change ────────────────────────────────────
  // localStorage: synchronous, instant, always works (primary for same-device)
  // cloud:        debounced 2 s, requires auth (primary for cross-device)

  useEffect(() => {
    if (!fileName || rows.length === 0) return;

    // localStorage — always runs, no async, no auth needed
    saveLocalSession(fileName, rows);

    // cloud — debounced
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setCloudSaved(false);
    const snap = { fileName, rows };
    saveTimerRef.current = setTimeout(async () => {
      setCloudSaving(true);
      try {
        await saveCloudSession(snap.fileName, snap.rows);
        setCloudSaved(true);
      } catch (e: any) {
        setCloudSaved(false);
        console.error("[price-compare] cloud save failed:", e?.message ?? e);
        toast({
          variant: "destructive",
          title: "Cloud save failed",
          description: e?.message ?? "Could not save to your account. Data is preserved locally.",
        });
      } finally {
        setCloudSaving(false);
      }
    }, 2000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, fileName]);

  // ── Load on mount: cloud first, fall back to localStorage ─────────────────

  useEffect(() => {
    let cancelled = false;

    // Show localStorage data immediately (instant, no network)
    const local = loadLocalSession();
    if (local && local.rows.length > 0) {
      setRows(local.rows);
      setFileName(local.fileName);
      setCloudSaved(false);
    }

    // Then try to load fresher data from the cloud
    loadCloudSession().then(saved => {
      if (cancelled) return;
      if (saved && saved.rows.length > 0) {
        setRows(saved.rows);
        setFileName(saved.fileName);
        setCloudSaved(true);
        if (!local || local.rows.length === 0) {
          toast({
            title: "Session restored",
            description: `Loaded ${saved.rows.length} products from your last session.`,
          });
        }
      }
    });

    return () => { cancelled = true; };
  }, []);

  // ── On unmount: flush localStorage (sync), kick off cloud save (async) ────

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const fn = fileNameRef.current;
      const rs = rowsRef.current;
      if (fn && rs.length > 0) {
        saveLocalSession(fn, rs);          // synchronous — always succeeds
        saveCloudSession(fn, rs).catch(() => {}); // best-effort async
      }
    };
  }, []);


  // ── File handling ─────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ variant: "destructive", title: "Wrong file type", description: "Please upload a CSV file." });
      return;
    }
    setFileName(file.name);
    setLoading(true);
    try {
      const csvText = await file.text();
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/compare-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Unknown error");

      if (data.dbEmpty) {
        setDbEmpty(true);
        setRows([]);
        toast({ variant: "destructive", title: "Michigan database not loaded", description: "Go to More → Refresh Data first, then come back." });
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
      setScannedIndices([]);
      setFilter("all");

      const changed     = hydrated.filter(r => r.priceDiff !== null && r.priceDiff !== 0).length;
      const notFound    = hydrated.filter(r => !r.matched).length;
      const ambiguous   = hydrated.filter(r => r.multipleMatches).length;
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

  // ── Row editing ───────────────────────────────────────────────────────────

  const updateRow = (idx: number, patch: Partial<ComparisonRow>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const resetAllToMichigan = (targetRows: { origIdx: number }[]) => {
    const idxSet = new Set(targetRows.map(x => x.origIdx));
    setRows(prev => prev.map((r, i) =>
      idxSet.has(i) ? { ...r, newPrice: r.michiganPrice ?? r.registerPrice } : r
    ));
    toast({ title: "Prices reset", description: "New prices set to Michigan price." });
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

  // ── Sorting ───────────────────────────────────────────────────────────────

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  const totalIncreased = rows.filter(r => r.priceDiff !== null && r.priceDiff > 0).length;
  const totalDecreased = rows.filter(r => r.priceDiff !== null && r.priceDiff < 0).length;
  const totalSame      = rows.filter(r => r.priceDiff === 0).length;
  const totalNotFound  = rows.filter(r => !r.matched).length;
  const totalAmbiguous = rows.filter(r => r.multipleMatches && !r.resolvedByUser).length;
  const totalChanged   = rows.filter(r => Math.round((r.newPrice - r.registerPrice) * 100) !== 0).length;

  const applyFilters = (source: { row: ComparisonRow; origIdx: number }[]) =>
    source
      .filter(({ row: r }) => {
        if (filter === "increased") return r.priceDiff !== null && r.priceDiff > 0;
        if (filter === "decreased") return r.priceDiff !== null && r.priceDiff < 0;
        if (filter === "same")      return r.priceDiff === 0;
        if (filter === "notfound")  return !r.matched;
        if (filter === "ambiguous") return r.multipleMatches && !r.resolvedByUser;
        return true;
      })
      .filter(({ row: r }) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return r.name.toLowerCase().includes(q) || r.upc.includes(q) || (r.michiganLiquorCode || '').includes(q);
      })
      .sort((a, b) => {
        let av: any, bv: any;
        if (sortKey === "name")               { av = a.row.name;          bv = b.row.name; }
        else if (sortKey === "registerPrice") { av = a.row.registerPrice; bv = b.row.registerPrice; }
        else if (sortKey === "michiganPrice") { av = a.row.michiganPrice ?? -1; bv = b.row.michiganPrice ?? -1; }
        else if (sortKey === "priceDiff")     { av = a.row.priceDiff ?? 999; bv = b.row.priceDiff ?? 999; }
        else                                  { av = a.row.newPrice; bv = b.row.newPrice; }
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1  : -1;
        return 0;
      });

  const allRowsWithIdx = rows.map((row, origIdx) => ({ row, origIdx }));
  const visible = applyFilters(allRowsWithIdx);

  // ── Scan mode ─────────────────────────────────────────────────────────────

  const handleBarcodeScan = useCallback((barcode: string) => {
    if (rows.length === 0) {
      toast({ variant: "destructive", title: "No CSV loaded", description: "Upload your register CSV first, then scan bottles." });
      return;
    }
    const norm = normalizeBarcode(barcode);
    const matchingIndices = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        const rowUpc = normalizeBarcode(r.upc);
        return rowUpc === norm || rowUpc === barcode;
      })
      .map(({ i }) => i);

    if (matchingIndices.length === 0) {
      toast({ variant: "destructive", title: "Not in your CSV", description: `UPC ${barcode} wasn't found in your uploaded register file.` });
      return;
    }
    const newIdx = matchingIndices[0];
    if (scannedIndices.includes(newIdx)) {
      toast({ title: "Already in scan list", description: `${rows[newIdx].name} is already on the list.` });
      return;
    }
    setScannedIndices(prev => [newIdx, ...prev]);
    toast({ title: "Added", description: rows[newIdx].name });
  }, [rows, scannedIndices, toast]);

  const removeFromScanList = (origIdx: number) => {
    setScannedIndices(prev => prev.filter(i => i !== origIdx));
  };

  const scannedRowsWithIdx = scannedIndices
    .map(i => ({ row: rows[i], origIdx: i }))
    .filter(({ row: r }) => {
      if (!scanSearch) return true;
      const q = scanSearch.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.upc.includes(q);
    });

  const scanIncreased = scannedIndices.filter(i => rows[i].priceDiff !== null && rows[i].priceDiff! > 0).length;
  const scanDecreased = scannedIndices.filter(i => rows[i].priceDiff !== null && rows[i].priceDiff! < 0).length;
  const scanAmbiguous = scannedIndices.filter(i => rows[i].multipleMatches && !rows[i].resolvedByUser).length;

  // ── Export helpers ────────────────────────────────────────────────────────

  const doExport = (sourceRows: ComparisonRow[], customNames: boolean, filePrefix: string) => {
    if (sourceRows.length === 0) return;
    const csv    = buildPtouchCsv(sourceRows, customNames);
    const suffix = customNames ? "_custom_updated" : "_updated";
    downloadCsv(csv, `${filePrefix}${suffix}.csv`);
    toast({ title: "Exported!", description: `Downloaded ${sourceRows.length} products.` });
  };

  const exportChangedOnly = (customNames: boolean, filePrefix: string) => {
    const changed = rows.filter(r => Math.round((r.newPrice - r.registerPrice) * 100) !== 0);
    if (changed.length === 0) {
      toast({ title: "No price changes", description: "All new prices match your register prices." });
      return;
    }
    doExport(changed, customNames, `${filePrefix}_changed`);
  };

  // ── Sub-components ────────────────────────────────────────────────────────

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null :
    sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 inline ml-1" />
      : <ChevronDown className="h-3 w-3 inline ml-1" />;

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

  const ComparisonTable = ({
    rowsWithIdx,
    emptyLabel = "No products match this filter.",
    showRemove = false,
    onRemove,
  }: {
    rowsWithIdx: { row: ComparisonRow; origIdx: number }[];
    emptyLabel?: string;
    showRemove?: boolean;
    onRemove?: (origIdx: number) => void;
  }) => (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <Th label="Product name"  k="name"          className="min-w-[200px]" />
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">UPC</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Liq. Code</th>
              <Th label="Your price"    k="registerPrice" className="text-right" />
              <Th label="MI price"      k="michiganPrice" className="text-right" />
              <Th label="Change"        k="priceDiff" />
              <Th label="New price"     k="newPrice"      className="text-right" />
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name override</th>
              {showRemove && <th className="w-8" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rowsWithIdx.length === 0 && (
              <tr>
                <td colSpan={showRemove ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {rowsWithIdx.map(({ row, origIdx }) => {
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
                  {/* Name */}
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
                          title="Resolved — click to change the match"
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
                  {/* UPC */}
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.upc}</td>
                  {/* Liquor Code */}
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {row.michiganLiquorCode || row.liquorCode || <span className="text-muted-foreground/40">—</span>}
                  </td>
                  {/* Your price */}
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">${row.registerPrice.toFixed(2)}</td>
                  {/* MI price */}
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.michiganPrice !== null
                      ? <span className="font-medium">${row.michiganPrice.toFixed(2)}</span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  {/* Diff */}
                  <td className="px-3 py-2.5">
                    {needsReview
                      ? <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 cursor-pointer" onClick={() => setDisambigRow({ origIdx, row })}>Pick match</Badge>
                      : <DiffBadge diff={row.priceDiff} />
                    }
                  </td>
                  {/* New price */}
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
                  {/* Name override */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 min-w-[160px]">
                      <input
                        type="checkbox"
                        id={`override-${origIdx}`}
                        checked={row.useCustomName}
                        onChange={e => updateRow(origIdx, { useCustomName: e.target.checked })}
                        className="rounded border-border"
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
                  {/* Remove (scan mode only) */}
                  {showRemove && (
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={() => onRemove?.(origIdx)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove from scan list"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ── Cloud status indicator ────────────────────────────────────────────────

  const CloudStatus = () => {
    if (rows.length === 0) return null;
    if (cloudSaving) return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Save className="h-3 w-3 animate-pulse" /> Saving…
      </span>
    );
    if (cloudSaved) return (
      <span className="flex items-center gap-1 text-xs text-green-600">
        <Cloud className="h-3 w-3" /> Saved
      </span>
    );
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <CloudOff className="h-3 w-3" /> Unsaved
      </span>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const fileBase = fileName.replace(/\.csv$/i, "");

  return (
    <div className="min-h-screen bg-background flex flex-col pb-16">

      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/more" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="bg-primary text-primary-foreground p-2 rounded-lg">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">Price Comparison</h1>
                <CloudStatus />
              </div>
              <p className="text-xs text-muted-foreground">Compare your register prices against Michigan's current price book</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setPageMode("csv")}
                data-testid="button-mode-csv"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  pageMode === "csv" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                <FileText className="h-4 w-4" />
                Full List
              </button>
              <button
                onClick={() => setPageMode("scan")}
                data-testid="button-mode-scan"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  pageMode === "scan" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                <Scan className="h-4 w-4" />
                Scan Mode
                {scannedIndices.length > 0 && (
                  <span className="ml-1 bg-primary-foreground text-primary text-xs rounded-full px-1.5 py-0.5 font-bold leading-none">
                    {scannedIndices.length}
                  </span>
                )}
              </button>
            </div>

            {/* Full list export buttons */}
            {pageMode === "csv" && rows.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={() => resetAllToMichigan(allRowsWithIdx)}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Reset all to MI
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportChangedOnly(false, fileBase)} data-testid="button-export-changed">
                  <Download className="h-4 w-4 mr-1" /> Changed only ({totalChanged})
                </Button>
                <Button variant="outline" size="sm" onClick={() => doExport(rows, false, fileBase)}>
                  <Download className="h-4 w-4 mr-1" /> Export all
                </Button>
                <Button size="sm" onClick={() => doExport(rows, true, fileBase)}>
                  <Download className="h-4 w-4 mr-1" /> With Custom Names
                </Button>
              </>
            )}

            {/* Scan mode export buttons */}
            {pageMode === "scan" && scannedIndices.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={() => resetAllToMichigan(scannedRowsWithIdx)} data-testid="button-scan-reset">
                  <RefreshCw className="h-4 w-4 mr-1" /> Reset to MI
                </Button>
                <Button variant="outline" size="sm" onClick={() => doExport(scannedRowsWithIdx.map(x => x.row), false, "shelf_scan")} data-testid="button-scan-export">
                  <Download className="h-4 w-4 mr-1" /> Export P-touch CSV
                </Button>
                <Button size="sm" onClick={() => doExport(scannedRowsWithIdx.map(x => x.row), true, "shelf_scan")} data-testid="button-scan-export-custom">
                  <Download className="h-4 w-4 mr-1" /> With Custom Names
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">

        {/* DB not loaded warning */}
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
            {loading
              ? <RefreshCw className={`text-primary animate-spin ${rows.length > 0 ? "h-5 w-5" : "h-10 w-10"}`} />
              : <Upload className={`text-muted-foreground ${rows.length > 0 ? "h-5 w-5" : "h-10 w-10"}`} />
            }
            {rows.length > 0 ? (
              <span className="text-sm text-muted-foreground">
                {loading ? "Processing…" : <><strong>{fileName}</strong> · {rows.length} products loaded — drop a new CSV to replace</>}
              </span>
            ) : (
              <div>
                <p className="text-base font-medium text-foreground">
                  {loading ? "Processing your CSV…" : "Drop your register P-touch CSV here"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload the file exported from your register — required for both Full List and Scan Mode
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ══════════════ FULL LIST MODE ══════════════ */}
        {pageMode === "csv" && rows.length > 0 && !loading && (
          <>
            {/* Summary strip */}
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

            {/* Ambiguous banner */}
            {totalAmbiguous > 0 && (
              <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-500" />
                <span>
                  <strong>{totalAmbiguous} product{totalAmbiguous > 1 ? "s share" : " shares"} a UPC with multiple Michigan records.</strong>{" "}
                  Click the orange <strong>?</strong> badge on any row to pick the correct match.
                </span>
              </div>
            )}

            {/* Filter + search bar */}
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
                      ? f === "ambiguous" ? "bg-orange-500 text-white" : "bg-primary text-primary-foreground"
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
                  placeholder="Search name, UPC, or liquor code…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-8 w-60 text-sm"
                />
              </div>
            </div>

            {/* Table */}
            <ComparisonTable rowsWithIdx={visible} />

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1 flex-wrap gap-2">
              <span>Showing {visible.length} of {rows.length} products</span>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportChangedOnly(false, fileBase)}>
                  <Download className="h-3 w-3 mr-1" /> Changed only ({totalChanged})
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => doExport(rows, false, fileBase)}>
                  <Download className="h-3 w-3 mr-1" /> Export all
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={() => doExport(rows, true, fileBase)}>
                  <Download className="h-3 w-3 mr-1" /> With Custom Names
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ══════════════ SCAN MODE ══════════════ */}
        {pageMode === "scan" && (
          <div className="space-y-5">
            {rows.length === 0 && !loading && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-4 text-sm text-amber-800">
                <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-amber-500" />
                <div>
                  <p className="font-semibold">No CSV loaded yet</p>
                  <p className="mt-1">Upload your register P-touch CSV above first. Scan mode finds each scanned bottle in your CSV and pulls it onto this list.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-1">
                <BarcodeScanner
                  onScan={handleBarcodeScan}
                  isActive={scannerActive}
                  onToggle={() => setScannerActive(a => !a)}
                />
              </div>

              <div className="lg:col-span-2 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Card>
                    <CardContent className="py-3 px-4 flex items-center gap-2">
                      <Package className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-xl font-bold">{scannedIndices.length}</p>
                        <p className="text-xs text-muted-foreground">Bottles scanned</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="py-3 px-4 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-red-500" />
                      <div>
                        <p className="text-xl font-bold text-red-600">{scanIncreased}</p>
                        <p className="text-xs text-muted-foreground">Price up in MI</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="py-3 px-4 flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-green-500" />
                      <div>
                        <p className="text-xl font-bold text-green-600">{scanDecreased}</p>
                        <p className="text-xs text-muted-foreground">Price down in MI</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {scanAmbiguous > 0 && (
                  <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-500" />
                    <span>
                      <strong>{scanAmbiguous} scanned item{scanAmbiguous > 1 ? "s have" : " has"} multiple Michigan matches.</strong>{" "}
                      Click the <strong>?</strong> badge to resolve.
                    </span>
                  </div>
                )}

                {scannedIndices.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    <Input
                      placeholder="Search scanned items…"
                      value={scanSearch}
                      onChange={e => setScanSearch(e.target.value)}
                      className="h-8 w-52 text-sm"
                    />
                    <Button variant="outline" size="sm" onClick={() => setScannedIndices([])} data-testid="button-scan-clear">
                      <Trash2 className="h-4 w-4 mr-1" /> Clear list
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {scannedIndices.length > 0 && (
              <>
                <ComparisonTable
                  rowsWithIdx={scannedRowsWithIdx}
                  emptyLabel="No scanned items match your search."
                  showRemove
                  onRemove={removeFromScanList}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1 flex-wrap gap-2">
                  <span>{scannedIndices.length} item{scannedIndices.length !== 1 ? "s" : ""} in scan list</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => doExport(scannedRowsWithIdx.map(x => x.row), false, "shelf_scan")}>
                      <Download className="h-3 w-3 mr-1" /> Export P-touch CSV
                    </Button>
                    <Button size="sm" className="h-7 text-xs" onClick={() => doExport(scannedRowsWithIdx.map(x => x.row), true, "shelf_scan")}>
                      <Download className="h-3 w-3 mr-1" /> With Custom Names
                    </Button>
                  </div>
                </div>
              </>
            )}

            {scannedIndices.length === 0 && rows.length > 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
                <Scan className="h-12 w-12 opacity-30" />
                <p className="text-base font-medium">Start scanning bottles</p>
                <p className="text-sm max-w-sm">Scan a bottle's barcode and it will be pulled from your CSV onto this list so you can compare prices and export just those items.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Disambiguation dialog */}
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
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">No price</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
