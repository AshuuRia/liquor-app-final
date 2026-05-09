import { useState, useRef, useEffect } from "react";
import { Search, X, Package, ChevronRight, TrendingUp, TrendingDown, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { LiquorRecord } from "@shared/schema";

type LiquorRecordWithChange = LiquorRecord & { priceChange?: string | null };

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

function DetailSheet({ record, onClose }: { record: LiquorRecordWithChange; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full bg-white dark:bg-zinc-900 rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </div>
        <div className="px-5 pb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight">{record.brandName}</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{record.vendorName}</p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center"
            >
              <X className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
            </button>
          </div>

          {/* Price change badge */}
          {record.priceChange && (
            <div className="mb-4">
              <PriceChangeBadge change={record.priceChange} />
            </div>
          )}

          <div className="flex gap-3 mb-5">
            <div className="flex-1 bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{fmt(record.shelfPrice)}</div>
              <div className="text-xs text-blue-500 dark:text-blue-300 mt-0.5">Shelf Price</div>
            </div>
            <div className="flex-1 bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-center">
              <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{fmt(record.offPremisePrice)}</div>
              <div className="text-xs text-zinc-500 mt-0.5">Off-Premise</div>
            </div>
            <div className="flex-1 bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-center">
              <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{fmt(record.onPremisePrice)}</div>
              <div className="text-xs text-zinc-500 mt-0.5">On-Premise</div>
            </div>
          </div>

          <div className="space-y-2.5">
            {[
              ["Bottle Size", record.bottleSize],
              ["Proof", record.proof ? `${record.proof}°` : null],
              ["Liquor Code", record.liquorCode],
              ["ADA Number", record.adaNumber],
              ["ADA Name", record.adaName],
              ["Pack Size", record.packSize],
              ["UPC 1", record.upcCode1 !== "00000000000000" ? record.upcCode1 : null],
              ["UPC 2", record.upcCode2 !== "00000000000000" ? record.upcCode2 : null],
              ["Effective Date", record.effectiveDate],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label as string} className="flex items-center justify-between py-2 border-b border-zinc-100 dark:border-zinc-800">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 text-right max-w-[60%]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<LiquorRecordWithChange[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<LiquorRecordWithChange | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setTotal(0); return; }
    clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search-liquor?query=${encodeURIComponent(query)}`);
        const d = await r.json();
        setResults(d.results || []);
        setTotal(d.totalFound || 0);
      } catch { /* ignore */ } finally { setLoading(false); }
    }, 280);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-zinc-950"
         style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "4rem" }}>

      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 px-4 pt-4 pb-3 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-3">Search</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Name, UPC, or liquor code…"
            className="pl-9 pr-9 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 border-0 text-base"
            data-testid="input-search"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              data-testid="button-clear-search"
            >
              <X className="h-4 w-4 text-zinc-400" />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && query.length >= 2 && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <Package className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mb-3" />
            <p className="text-zinc-500 font-medium">No results found</p>
            <p className="text-zinc-400 text-sm mt-1">Try a different name, UPC, or code</p>
          </div>
        )}

        {!loading && query.length < 2 && (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <Search className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mb-3" />
            <p className="text-zinc-500 font-medium">Search the database</p>
            <p className="text-zinc-400 text-sm mt-1">13,899+ Michigan liquor products</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <>
            <div className="px-4 py-2.5">
              <p className="text-xs text-zinc-400">
                {total > results.length
                  ? `Showing ${results.length} of ${total.toLocaleString()} results`
                  : `${total.toLocaleString()} result${total !== 1 ? "s" : ""}`}
              </p>
            </div>
            <div className="px-4 space-y-1.5 pb-4">
              {results.map((item, i) => (
                <button
                  key={item.id}
                  data-testid={`search-result-${i}`}
                  onClick={() => setSelected(item)}
                  className="w-full bg-white dark:bg-zinc-900 rounded-xl px-4 py-3.5 text-left flex items-center gap-3 shadow-sm active:bg-zinc-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">{item.brandName}</span>
                      {item.priceChange && <PriceChangeBadge change={item.priceChange} />}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-zinc-500">{item.bottleSize}</span>
                      {item.proof && <span className="text-xs text-zinc-400">{item.proof}°</span>}
                      <span className="text-xs text-zinc-400">· {item.liquorCode}</span>
                    </div>
                    {item.upcCode1 && item.upcCode1 !== "00000000000000" && (
                      <div className="text-xs text-zinc-400 mt-0.5">UPC: {item.upcCode1}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{fmt(item.shelfPrice)}</span>
                    <ChevronRight className="h-4 w-4 text-zinc-300" />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && <DetailSheet record={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
