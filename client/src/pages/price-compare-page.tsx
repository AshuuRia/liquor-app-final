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
  Cloud, CloudOff, Save, FolderOpen, Plus, Clock,
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

interface SessionMeta {
  id: string;
  sessionName: string;
  fileName: string;
  updatedAt: string | Date;
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

function fmtDate(d: string | Date): string {
  try {
    return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return String(d); }
}

// ── Local (localStorage) save/load ────────────────────────────────────────────

const LOCAL_KEY     = "price_compare_session";
const SESSION_ID_KEY = "price_compare_session_id";
const SESSION_NAME_KEY = "price_compare_session_name";

function saveLocalSession(fileName: string, rows: ComparisonRow[]): void {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ fileName, rows })); } catch { /* storage full */ }
}
function loadLocalSession(): { fileName: string; rows: ComparisonRow[] } | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fileName: string; rows: ComparisonRow[] };
    return parsed.rows?.length ? parsed : null;
  } catch { return null; }
}
function clearLocalSession(): void {
  try { localStorage.removeItem(LOCAL_KEY); localStorage.removeItem(SESSION_ID_KEY); } catch { /* ignore */ }
}
function loadStoredSessionId(): string | null {
  try { return localStorage.getItem(SESSION_ID_KEY); } catch { return null; }
}
function saveStoredSessionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(SESSION_ID_KEY, id);
    else localStorage.removeItem(SESSION_ID_KEY);
  } catch { /* ignore */ }
}
function loadStoredSessionName(): string {
  try { return localStorage.getItem(SESSION_NAME_KEY) || ''; } catch { return ''; }
}
function saveStoredSessionName(name: string): void {
  try { localStorage.setItem(SESSION_NAME_KEY, name); } catch { /* ignore */ }
}

// ── Cloud helpers ─────────────────────────────────────────────────────────────

async function listCloudSessions(): Promise<SessionMeta[]> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch("/api/price-compare/sessions", { credentials: "include", headers: authHeaders });
    if (!res.ok) return [];
    const data = await res.json();
    return data.sessions || [];
  } catch { return []; }
}

async function loadCloudSession(sessionId: string): Promise<{ fileName: string; rows: ComparisonRow[] } | null> {
  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`/api/price-compare/session/${sessionId}`, { credentials: "include", headers: authHeaders });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.session?.rowsJson) return null;
    const rows = JSON.parse(data.session.rowsJson) as ComparisonRow[];
    return { fileName: data.session.fileName, rows };
  } catch { return null; }
}

async function saveCloudSession(
  sessionId: string | null,
  sessionName: string,
  fileName: string,
  rows: ComparisonRow[]
): Promise<string | null> {
  // Strip allMatches before saving — those can be large and are re-fetched from the DB
  const slimRows = rows.map(({ allMatches: _dropped, ...r }) => r);
  const authHeaders = await getAuthHeaders();
  const res = await fetch("/api/price-compare/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    credentials: "include",
    body: JSON.stringify({ sessionId, sessionName, fileName, rowsJson: JSON.stringify(slimRows) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}${text ? `: ${text}` : ""}`);
  }
  const data = await res.json();
  return data.session?.id || null;
}

async function deleteCloudSession(id: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  await fetch(`/api/price-compare/session/${id}`, {
    method: "DELETE",
    headers: authHeaders,
    credentials: "include",
  });
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

  // Multi-session state
  const [currentSessionId, setCurrentSessionId]     = useState<string | null>(null);
  const [currentSessionName, setCurrentSessionName] = useState("");
  const [sessionsOpen, setSessionsOpen]             = useState(false);
  const [cloudSessions, setCloudSessions]           = useState<SessionMeta[]>([]);
  const [sessionsLoading, setSessionsLoading]       = useState(false);

  // Refs so unmount cleanup reads latest values synchronously
  const rowsRef          = useRef<ComparisonRow[]>([]);
  const fileNameRef      = useRef<string>("");
  const sessionIdRef     = useRef<string | null>(null);
  const sessionNameRef   = useRef<string>("");
  useEffect(() => { rowsRef.current        = rows;             }, [rows]);
  useEffect(() => { fileNameRef.current    = fileName;         }, [fileName]);
  useEffect(() => { sessionIdRef.current   = currentSessionId; }, [currentSessionId]);
  useEffect(() => { sessionNameRef.current = currentSessionName; }, [currentSessionName]);

  // Persist sessionId / sessionName to localStorage when they change
  useEffect(() => { saveStoredSessionId(currentSessionId); }, [currentSessionId]);
  useEffect(() => { saveStoredSessionName(currentSessionName); }, [currentSessionName]);

  // ── Auto-save on rows/fileName change ────────────────────────────────────
  useEffect(() => {
    if (!fileName || rows.length === 0) return;
    saveLocalSession(fileName, rows);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setCloudSaved(false);
    const snap = {
      sessionId: sessionIdRef.current,
      sessionName: sessionNameRef.current || fileName,
      fileName,
      rows,
    };
    saveTimerRef.current = setTimeout(async () => {
      setCloudSaving(true);
      try {
        const newId = await saveCloudSession(snap.sessionId, snap.sessionName, snap.fileName, snap.rows);
        if (newId && !snap.sessionId) setCurrentSessionId(newId);
        setCloudSaved(true);
      } catch (e: any) {
        setCloudSaved(false);
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

  // ── Load on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const local = loadLocalSession();
    if (local?.rows.length) {
      setRows(local.rows);
      setFileName(local.fileName);
    }

    const storedId   = loadStoredSessionId();
    const storedName = loadStoredSessionName();
    if (storedId) {
      setCurrentSessionId(storedId);
      if (storedName) setCurrentSessionName(storedName);
    }

    const tryCloud = async () => {
      if (storedId) {
        const session = await loadCloudSession(storedId);
        if (cancelled) return;
        if (session?.rows.length) {
          setRows(session.rows);
          setFileName(session.fileName);
          setCloudSaved(true);
          if (!local?.rows.length) {
            toast({ title: "Session restored", description: `${session.rows.length} products loaded.` });
          }
          return;
        }
      }
      // No stored id or failed — load most recent from server
      const sessions = await listCloudSessions();
      if (cancelled || !sessions.length) return;
      const most = sessions[0];
      const session = await loadCloudSession(most.id);
      if (cancelled || !session?.rows.length) return;
      setRows(session.rows);
      setFileName(session.fileName);
      setCurrentSessionId(most.id);
      setCurrentSessionName(most.sessionName);
      setCloudSaved(true);
      if (!local?.rows.length) {
        toast({ title: "Session restored", description: `${session.rows.length} products from "${most.sessionName}".` });
      }
    };

    tryCloud();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Flush on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const fn = fileNameRef.current;
      const rs = rowsRef.current;
      if (fn && rs.length > 0) {
        saveLocalSession(fn, rs);
        saveCloudSession(sessionIdRef.current, sessionNameRef.current || fn, fn, rs).catch(() => {});
      }
    };
  }, []);
  
// Auto-load Michigan price changes once per session
useEffect(() => {
  const KEY = "priceChangesLoadedAt";
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 6 * 60 * 60 * 1000) return; // throttle: 6h
  sessionStorage.setItem(KEY, String(Date.now()));
  fetch("/api/fetch-price-changes", { method: "POST" })
    .then(r => r.json())
    .then(d => { if (!d?.success) console.warn("Auto price-change load failed:", d?.details || d?.error); })
    .catch(err => console.warn("Auto price-change load error:", err));
}, []);

  // ── Sessions dialog helpers ───────────────────────────────────────────────
  const openSessions = async () => {
    setSessionsOpen(true);
    setSessionsLoading(true);
    try {
      const sessions = await listCloudSessions();
      setCloudSessions(sessions);
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleLoadSession = async (meta: SessionMeta) => {
    const session = await loadCloudSession(meta.id);
    if (!session) {
      toast({ variant: "destructive", title: "Could not load session" });
      return;
    }
    setRows(session.rows);
    setFileName(session.fileName);
    setCurrentSessionId(meta.id);
    setCurrentSessionName(meta.sessionName);
    setScannedIndices([]);
    setFilter("all");
    setSessionsOpen(false);
    saveLocalSession(session.fileName, session.rows);
    setCloudSaved(true);
    toast({ title: `Loaded "${meta.sessionName}"`, description: `${session.rows.length} products restored.` });
  };

  const handleDeleteSession = async (id: string) => {
    await deleteCloudSession(id);
    setCloudSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) {
      setCurrentSessionId(null);
      setCurrentSessionName("");
      clearLocalSession();
    }
    toast({ title: "Session deleted" });
  };

  const handleNewSession = () => {
    setRows([]);
    setFileName("");
    setCurrentSessionId(null);
    setCurrentSessionName("");
    clearLocalSession();
    setCloudSaved(false);
    setScannedIndices([]);
    setFilter("all");
    setSessionsOpen(false);
    toast({ title: "Ready for new session", description: "Upload a CSV to start." });
  };

  // ── File handling ─────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ variant: "destructive", title: "Wrong file type", description: "Please upload a CSV file." });
      return;
    }
    const newName = file.name.replace(/\.csv$/i, '');
    setFileName(file.name);
    setCurrentSessionId(null);  // new upload = new session
    setCurrentSessionName(newName);
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
        toast({ variant: "destructive", title: "Michigan database not loaded", description: "Go to More → Refresh Data first." });
        return;
      }

      setDbEmpty(false);
      const hydrated: ComparisonRow[] = data.rows.map((r: any) => ({
        ...r, resolvedByUser: false, newPrice: r.registerPrice, useCustomName: false, customName: r.name,
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
        description: `${hydrated.length} products · ${changed} price changes · ${notFound} not found${codeMatched ? ` · ${codeMatched} by liquor code` : ""}${ambiguous ? ` · ${ambiguous} need review` : ""}`,
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
    setRows(prev => prev.map((r, i) => idxSet.has(i) ? { ...r, newPrice: r.michiganPrice ?? r.registerPrice } : r));
    toast({ title: "Prices reset", description: "New prices set to Michigan price." });
  };
  const applyMatch = (origIdx: number, match: LiquorRecord) => {
    const row = rows[origIdx];
    const michiganPrice = match.shelfPrice ?? null;
    const priceDiff = michiganPrice !== null ? Math.round((michiganPrice - row.registerPrice) * 100) / 100 : null;
    updateRow(origIdx, {
      matched: true, resolvedByUser: true, michiganPrice, priceDiff,
      michiganName: `${match.brandName} ${match.bottleSize}`,
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
      .filter(({ r }) => { const ru = normalizeBarcode(r.upc); return ru === norm || ru === barcode; })
      .map(({ i }) => i);

    if (matchingIndices.length === 0) {
      toast({ variant: "destructive", title: "Not in your CSV", description: `UPC ${barcode} wasn't found in your register file.` });
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

  const removeFromScanList = (origIdx: number) => setScannedIndices(prev => prev.filter(i => i !== origIdx));

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
    if (changed.length === 0) { toast({ title: "No price changes" }); return; }
    doExport(changed, customNames, `${filePrefix}_changed`);
  };

  // ── Sub-components ────────────────────────────────────────────────────────
  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null :
    sortDir === "asc" ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />;

  const Th = ({ label, k, className = "" }: { label: string; k: SortKey; className?: string }) => (
    <th onClick={() => toggleSort(k)}
      className={`px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap ${className}`}>
      {label}<SortIcon k={k} />
    </th>
  );

  const DiffBadge = ({ diff }: { diff: number | null }) => {
    if (diff === null) return <Badge variant="outline" className="text-xs">No match</Badge>;
    if (diff === 0)    return <Badge variant="secondary" className="text-xs">No change</Badge>;
    if (diff > 0) return (
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
              <tr><td colSpan={showRemove ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">{emptyLabel}</td></tr>
            )}
            {rowsWithIdx.map(({ row, origIdx }) => {
              const needsReview = row.multipleMatches && !row.resolvedByUser;
              const rowBg = needsReview ? "bg-orange-50/60" : !row.matched ? "bg-amber-50/40" : "";
              return (
                <tr key={origIdx} className={`hover:bg-muted/30 transition-colors ${rowBg}`}>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground leading-tight">{row.name}</span>
                      {row.michiganName && row.michiganName !== row.name && (
                        <span className="text-xs text-muted-foreground leading-tight mt-0.5">MI: {row.michiganName}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.upc}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.michiganLiquorCode || row.liquorCode || "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">${row.registerPrice.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.michiganPrice !== null ? `$${row.michiganPrice.toFixed(2)}` : "—"}
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
                        type="text" inputMode="decimal"
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
                        <button title="Reset to MI price" onClick={() => updateRow(origIdx, { newPrice: row.michiganPrice! })}
                          className="text-muted-foreground hover:text-primary transition-colors ml-0.5">
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 min-w-[160px]">
                      <input type="checkbox" id={`override-${origIdx}`} checked={row.useCustomName}
                        onChange={e => updateRow(origIdx, { useCustomName: e.target.checked })} className="rounded border-border" />
                      {row.useCustomName ? (
                        <input type="text" value={row.customName}
                          onChange={e => updateRow(origIdx, { customName: e.target.value })}
                          className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Custom name…" />
                      ) : (
                        <label htmlFor={`override-${origIdx}`} className="text-xs text-muted-foreground cursor-pointer">Use custom name</label>
                      )}
                    </div>
                  </td>
                  {showRemove && (
                    <td className="px-2 py-2.5 text-right">
                      <button onClick={() => onRemove?.(origIdx)} className="text-muted-foreground hover:text-destructive transition-colors" title="Remove">
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
    if (cloudSaving) return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Save className="h-3 w-3 animate-pulse" /> Saving…</span>;
    if (cloudSaved)  return <span className="flex items-center gap-1 text-xs text-green-600"><Cloud className="h-3 w-3" /> Saved</span>;
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><CloudOff className="h-3 w-3" /> Unsaved</span>;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const fileBase = fileName.replace(/\.csv$/i, "");

  return (
    <div className="min-h-screen bg-background flex flex-col pb-16">

      {/* ── Header ── */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">

        {/* Row 1: title + sessions button */}
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/more" className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="bg-primary text-primary-foreground p-1.5 rounded-lg flex-shrink-0">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-foreground leading-tight">Price Comparison</h1>
                <CloudStatus />
              </div>
              {currentSessionName && (
                <p className="text-xs text-muted-foreground truncate max-w-[200px]">{currentSessionName}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={openSessions} className="flex items-center gap-1.5" data-testid="button-sessions">
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Sessions</span>
            </Button>
          </div>
        </div>

        {/* Row 2: scrollable mode + action buttons */}
        <div className="overflow-x-auto border-t border-border/50">
          <div className="flex items-center gap-2 px-4 sm:px-6 py-2 min-w-max">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button onClick={() => setPageMode("csv")} data-testid="button-mode-csv"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${pageMode === "csv" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}>
                <FileText className="h-4 w-4" />Full List
              </button>
              <button onClick={() => setPageMode("scan")} data-testid="button-mode-scan"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${pageMode === "scan" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}>
                <Scan className="h-4 w-4" />Scan Mode
                {scannedIndices.length > 0 && (
                  <span className="ml-1 bg-primary-foreground text-primary text-xs rounded-full px-1.5 py-0.5 font-bold leading-none">{scannedIndices.length}</span>
                )}
              </button>
            </div>

            {/* Full list actions */}
            {pageMode === "csv" && rows.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={() => resetAllToMichigan(allRowsWithIdx)}>
                  <RefreshCw className="h-4 w-4 mr-1" />Reset all
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportChangedOnly(false, fileBase)} data-testid="button-export-changed">
                  <Download className="h-4 w-4 mr-1" />Changed ({totalChanged})
                </Button>
                <Button variant="outline" size="sm" onClick={() => doExport(rows, false, fileBase)}>
                  <Download className="h-4 w-4 mr-1" />Export all
                </Button>
                <Button size="sm" onClick={() => doExport(rows, true, fileBase)}>
                  <Download className="h-4 w-4 mr-1" />Custom names
                </Button>
              </>
            )}

            {/* Scan mode actions */}
            {pageMode === "scan" && scannedIndices.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={() => resetAllToMichigan(scannedRowsWithIdx)} data-testid="button-scan-reset">
                  <RefreshCw className="h-4 w-4 mr-1" />Reset to MI
                </Button>
                <Button variant="outline" size="sm" onClick={() => doExport(scannedRowsWithIdx.map(x => x.row), false, "shelf_scan")} data-testid="button-scan-export">
                  <Download className="h-4 w-4 mr-1" />Export P-touch
                </Button>
                <Button size="sm" onClick={() => doExport(scannedRowsWithIdx.map(x => x.row), true, "shelf_scan")} data-testid="button-scan-export-custom">
                  <Download className="h-4 w-4 mr-1" />Custom names
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
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Michigan price book not loaded</p>
              <p className="mt-0.5">Go to <strong>More → Refresh Data</strong> to load 13,899 Michigan liquor records, then come back and upload your CSV.</p>
            </div>
          </div>
        )}

        {/* ── CSV Mode ── */}
        {pageMode === "csv" && (
          <div className="space-y-5">
            {rows.length === 0 ? (
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
              >
                <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-base font-medium text-foreground">Drop your register CSV here</p>
                <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                {loading && <p className="text-sm text-primary mt-3">Processing…</p>}
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                    <Package className="h-4 w-4" />
                    <span><strong>{rows.length}</strong> products</span>
                    <span>·</span>
                    <span className="text-foreground font-medium truncate max-w-[180px]">{fileName}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="flex-shrink-0">
                    <Upload className="h-4 w-4 mr-1" />New CSV
                  </Button>
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { label: "Increased", count: totalIncreased, icon: <TrendingUp className="h-4 w-4 text-red-500" />, color: "text-red-600", active: filter === "increased", f: "increased" as Filter },
                    { label: "Decreased", count: totalDecreased, icon: <TrendingDown className="h-4 w-4 text-green-500" />, color: "text-green-600", active: filter === "decreased", f: "decreased" as Filter },
                    { label: "Same",      count: totalSame,      icon: <CheckCircle className="h-4 w-4 text-blue-500" />,   color: "text-blue-600",  active: filter === "same",      f: "same" as Filter },
                    { label: "Not found", count: totalNotFound,  icon: <AlertCircle className="h-4 w-4 text-amber-500" />, color: "text-amber-600", active: filter === "notfound",  f: "notfound" as Filter },
                    { label: "Ambiguous", count: totalAmbiguous, icon: <HelpCircle className="h-4 w-4 text-orange-500" />, color: "text-orange-600", active: filter === "ambiguous", f: "ambiguous" as Filter },
                  ].map(({ label, count, icon, color, active, f }) => (
                    <Card key={f} onClick={() => setFilter(active ? "all" : f)}
                      className={`cursor-pointer transition-all select-none ${active ? "ring-2 ring-primary" : "hover:shadow-sm"}`}>
                      <CardContent className="py-3 px-4 flex items-center gap-2">
                        {icon}
                        <div>
                          <p className={`text-xl font-bold ${color}`}>{count}</p>
                          <p className="text-xs text-muted-foreground">{label}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {totalAmbiguous > 0 && (
                  <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-500" />
                    <span><strong>{totalAmbiguous} product{totalAmbiguous > 1 ? "s have" : " has"} multiple Michigan matches.</strong> Click the <strong>Pick match</strong> badge in the table to resolve.</span>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Input placeholder="Search by name, UPC, or code…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 w-64 text-sm" />
                  {filter !== "all" && (
                    <Button variant="ghost" size="sm" onClick={() => setFilter("all")} className="h-8 text-xs text-muted-foreground">
                      Clear filter
                    </Button>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground self-center">{visible.length} of {rows.length}</span>
                </div>

                <ComparisonTable rowsWithIdx={visible} />
              </>
            )}
          </div>
        )}

        {/* ── Scan Mode ── */}
        {pageMode === "scan" && (
          <div className="space-y-5">
            <BarcodeScanner onScan={handleBarcodeScan} isActive={scannerActive} onToggle={() => setScannerActive(p => !p)} />

            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <Card className="flex-1 min-w-[100px]">
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xl font-bold">{scannedIndices.length}</p>
                      <p className="text-xs text-muted-foreground">Scanned</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="flex-1 min-w-[100px]">
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-red-500" />
                    <div>
                      <p className="text-xl font-bold text-red-600">{scanIncreased}</p>
                      <p className="text-xs text-muted-foreground">Price up</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="flex-1 min-w-[100px]">
                  <CardContent className="py-3 px-4 flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-xl font-bold text-green-600">{scanDecreased}</p>
                      <p className="text-xs text-muted-foreground">Price down</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {scanAmbiguous > 0 && (
                <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-500" />
                  <span><strong>{scanAmbiguous} scanned item{scanAmbiguous > 1 ? "s have" : " has"} multiple Michigan matches.</strong> Click the <strong>?</strong> badge to resolve.</span>
                </div>
              )}

              {scannedIndices.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  <Input placeholder="Search scanned items…" value={scanSearch} onChange={e => setScanSearch(e.target.value)} className="h-8 w-52 text-sm" />
                  <Button variant="outline" size="sm" onClick={() => setScannedIndices([])} data-testid="button-scan-clear">
                    <Trash2 className="h-4 w-4 mr-1" />Clear list
                  </Button>
                </div>
              )}
            </div>

            {scannedIndices.length > 0 && (
              <>
                <ComparisonTable rowsWithIdx={scannedRowsWithIdx} emptyLabel="No scanned items match your search." showRemove onRemove={removeFromScanList} />
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1 flex-wrap gap-2">
                  <span>{scannedIndices.length} item{scannedIndices.length !== 1 ? "s" : ""} in scan list</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => doExport(scannedRowsWithIdx.map(x => x.row), false, "shelf_scan")}>
                      <Download className="h-3 w-3 mr-1" />Export P-touch CSV
                    </Button>
                    <Button size="sm" className="h-7 text-xs" onClick={() => doExport(scannedRowsWithIdx.map(x => x.row), true, "shelf_scan")}>
                      <Download className="h-3 w-3 mr-1" />With Custom Names
                    </Button>
                  </div>
                </div>
              </>
            )}

            {scannedIndices.length === 0 && rows.length > 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
                <Scan className="h-12 w-12 opacity-30" />
                <p className="text-base font-medium">Start scanning bottles</p>
                <p className="text-sm max-w-sm">Scan a bottle's barcode and it will be pulled from your CSV onto this list.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Sessions Dialog ── */}
      <Dialog open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DialogContent className="max-w-md w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Saved Sessions
            </DialogTitle>
            <DialogDescription>
              Load a previous comparison or start a new one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Button variant="outline" className="w-full flex items-center gap-2" onClick={handleNewSession} data-testid="button-new-session">
              <Plus className="h-4 w-4" />
              Start new session
            </Button>

            {sessionsLoading && (
              <div className="flex items-center justify-center py-6">
                <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!sessionsLoading && cloudSessions.length === 0 && (
              <p className="text-sm text-center text-muted-foreground py-4">No saved sessions yet.</p>
            )}

            {!sessionsLoading && cloudSessions.length > 0 && (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {cloudSessions.map(s => (
                  <div key={s.id}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${s.id === currentSessionId ? "border-primary bg-primary/5" : "border-border"}`}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">{s.sessionName}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.fileName}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />{fmtDate(s.updatedAt)}
                        {s.id === currentSessionId && <span className="ml-1 text-primary font-medium">· active</span>}
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handleLoadSession(s)}>
                        Load
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteSession(s.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Disambiguation Dialog ── */}
      <Dialog open={!!disambigRow} onOpenChange={open => { if (!open) setDisambigRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-orange-500" />
              Multiple Michigan records for this UPC
            </DialogTitle>
            <DialogDescription>
              UPC <span className="font-mono">{disambigRow?.row.upc}</span> matches{" "}
              {disambigRow?.row.allMatches?.length ?? 0} products. Pick the one that matches <strong>{disambigRow?.row.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {disambigRow?.row.allMatches?.map((match, i) => {
              const miPrice = match.shelfPrice ?? null;
              const diff    = miPrice !== null ? Math.round((miPrice - disambigRow.row.registerPrice) * 100) / 100 : null;
              const isCurr  = disambigRow.row.resolvedByUser && disambigRow.row.michiganName === `${match.brandName} ${match.bottleSize}`;
              return (
                <button key={i} onClick={() => applyMatch(disambigRow.origIdx, match)}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${isCurr ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground leading-tight">{match.brandName}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {match.bottleSize}
                        {match.liquorCode && <span className="ml-2 font-mono text-xs">#{match.liquorCode}</span>}
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
                      ) : <p className="text-sm text-muted-foreground">No price</p>}
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
