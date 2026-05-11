import { useState } from "react";
import { useLocation } from "wouter";
import {
  TrendingUp, RefreshCw, Upload, ChevronRight,
  Database, Tag, Info, ArrowUpDown
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

interface DbStatus {
  totalRecords: number;
  uniqueBrands: number;
  uniqueVendors: number;
  avgPrice: number;
}

interface PriceChangeStatus {
  totalChanges: number;
  newProducts: number;
  priceChanges: number;
}

function MenuRow({ icon: Icon, label, sublabel, onPress, iconColor = "text-blue-500", iconBg = "bg-blue-50 dark:bg-blue-900/30" }: {
  icon: any; label: string; sublabel?: string; onPress: () => void;
  iconColor?: string; iconBg?: string;
}) {
  return (
    <button
      onClick={onPress}
      className="w-full flex items-center gap-3 px-4 py-3.5 bg-white dark:bg-zinc-900 active:bg-zinc-50 dark:active:bg-zinc-800 transition-colors"
    >
      <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div className="flex-1 text-left min-w-0">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</div>
        {sublabel && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{sublabel}</div>}
      </div>
      <ChevronRight className="h-4 w-4 text-zinc-300 flex-shrink-0" />
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 pt-5 pb-1.5">
      <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">{title}</p>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-zinc-100 dark:bg-zinc-800 ml-16" />;
}

export default function MorePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [refreshing, setRefreshing]           = useState(false);
  const [refreshingChanges, setRefreshingChanges] = useState(false);
  const [dbStatus, setDbStatus]               = useState<DbStatus | null>(null);
  const [priceChangeStatus, setPriceChangeStatus] = useState<PriceChangeStatus | null>(null);
  const [showUpload, setShowUpload]           = useState(false);
  const [uploading, setUploading]             = useState(false);
  const [dragOver, setDragOver]               = useState(false);

  const refreshData = async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/fetch-liquor-data", { method: "POST" });
      const d = await r.json();
      if (d.success) {
        setDbStatus({ totalRecords: d.totalRecords, uniqueBrands: d.uniqueBrands, uniqueVendors: d.uniqueVendors, avgPrice: d.avgPrice });
        if (d.priceChanges?.success) {
          setPriceChangeStatus({ totalChanges: d.priceChanges.totalChanges, newProducts: d.priceChanges.newProducts, priceChanges: d.priceChanges.priceChanges });
          toast({
            title: "Database refreshed",
            description: `${d.totalRecords.toLocaleString()} records · ${d.priceChanges.newProducts} new · ${d.priceChanges.priceChanges} price changes`,
          });
        } else {
          toast({ title: "Database refreshed", description: `${d.totalRecords.toLocaleString()} records loaded` });
        }
      } else {
        toast({ variant: "destructive", title: "Refresh failed", description: d.error || "Unknown error" });
      }
    } catch {
      toast({ variant: "destructive", title: "Refresh failed", description: "Could not reach Michigan state website" });
    } finally { setRefreshing(false); }
  };

  const refreshPriceChanges = async () => {
    setRefreshingChanges(true);
    try {
      const r = await fetch("/api/fetch-price-changes", { method: "POST" });
      const d = await r.json();
      if (d.success) {
        setPriceChangeStatus({ totalChanges: d.totalChanges, newProducts: d.newProducts, priceChanges: d.priceChanges });
        toast({
          title: "Price changes loaded",
          description: `${d.newProducts} new products, ${d.priceChanges} price changes`,
        });
      } else {
        toast({ variant: "destructive", title: "Failed to load price changes", description: d.error || d.details || "Unknown error" });
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load price changes", description: "Could not reach Michigan state website" });
    } finally { setRefreshingChanges(false); }
  };

  const handleMappingFile = async (file: File) => {
    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());
      const mappings: { upcCode: string; customName: string }[] = [];
      for (const line of lines.slice(1)) {
        const parts = line.split(",");
        if (parts.length >= 2) {
          mappings.push({ upcCode: parts[0].trim().replace(/^=["']?|["']$/g,""), customName: parts[1].trim() });
        }
      }
      if (!mappings.length) { toast({ variant: "destructive", title: "No mappings found" }); return; }
      const r = await apiRequest("POST", "/api/custom-names", { mappings });
      const d = await r.json();
      if (d.success) toast({ title: "Custom names uploaded", description: `${mappings.length} mappings saved` });
      else toast({ variant: "destructive", title: "Upload failed" });
    } catch {
      toast({ variant: "destructive", title: "Failed to process file" });
    } finally { setUploading(false); setShowUpload(false); }
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-950 min-h-full pb-8"
         style={{ paddingTop: "env(safe-area-inset-top)" }}>

      <div className="px-4 pt-4 pb-3 bg-white dark:bg-zinc-900">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">More</h1>
      </div>

      {/* Database status card */}
      <div className="mx-4 mt-4 bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Database className="h-4 w-4 text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Michigan Database</span>
        </div>
        {dbStatus ? (
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Records", dbStatus.totalRecords.toLocaleString()],
              ["Brands", dbStatus.uniqueBrands.toLocaleString()],
              ["Vendors", dbStatus.uniqueVendors.toLocaleString()],
              ["Avg Price", `$${dbStatus.avgPrice.toFixed(2)}`],
            ].map(([l, v]) => (
              <div key={l} className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3">
                <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{v}</div>
                <div className="text-xs text-zinc-500">{l}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Info className="h-4 w-4" />
            <span>Tap "Refresh" to load data from michigan.gov LARA</span>
          </div>
        )}
        <Button
          onClick={refreshData}
          disabled={refreshing}
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          data-testid="button-refresh-data"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing… (this takes ~30s)" : "Refresh from Michigan State"}
        </Button>
      </div>

      {/* Price changes card */}
      <div className="mx-4 mt-3 bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <ArrowUpDown className="h-4 w-4 text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Price Change Tracking</span>
        </div>
        {priceChangeStatus ? (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{priceChangeStatus.totalChanges.toLocaleString()}</div>
              <div className="text-xs text-zinc-500">Total</div>
            </div>
            <div className="bg-teal-50 dark:bg-teal-900/20 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-teal-700 dark:text-teal-300">{priceChangeStatus.newProducts}</div>
              <div className="text-xs text-teal-600 dark:text-teal-400">New</div>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-orange-700 dark:text-orange-300">{priceChangeStatus.priceChanges}</div>
              <div className="text-xs text-orange-600 dark:text-orange-400">Changed</div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 mb-3">
            Load price change data from the Michigan Excel price book. Scan or search results will show if a product is new or has a price change.
          </p>
        )}
        <Button
          onClick={refreshPriceChanges}
          disabled={refreshingChanges}
          variant="outline"
          size="sm"
          className="w-full"
          data-testid="button-refresh-price-changes"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshingChanges ? "animate-spin" : ""}`} />
          {refreshingChanges ? "Loading…" : "Load Price Changes"}
        </Button>
      </div>

      {/* Tools */}
      <SectionHeader title="Tools" />
      <div className="mx-4 bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden shadow-sm">
        <MenuRow
          icon={TrendingUp}
          label="Price Compare"
          sublabel="Upload register CSV, compare vs Michigan prices"
          iconColor="text-green-600"
          iconBg="bg-green-50 dark:bg-green-900/30"
          onPress={() => setLocation("/more/price-compare")}
        />
        <Divider />
        <MenuRow
          icon={Tag}
          label="Custom Name Mappings"
          sublabel="Upload UPC → custom name CSV for labels"
          iconColor="text-purple-600"
          iconBg="bg-purple-50 dark:bg-purple-900/30"
          onPress={() => setShowUpload(v => !v)}
        />
      </div>

      {/* Custom name upload panel */}
      {showUpload && (
        <div className="mx-4 mt-2 bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-zinc-500 mb-3">Upload a CSV with columns: <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">upcCode,customName</code></p>
          <label
            data-testid="upload-custom-names"
            className={`flex flex-col items-center justify-center w-full h-24 rounded-xl border-2 border-dashed cursor-pointer transition-colors
              ${dragOver ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20" : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800"}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleMappingFile(f); }}
          >
            <Upload className="h-6 w-6 text-zinc-400 mb-1" />
            <span className="text-xs text-zinc-500">{uploading ? "Uploading…" : "Tap or drop CSV file"}</span>
            <input type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleMappingFile(f); }} disabled={uploading} />
          </label>
        </div>
      )}

      {/* About */}
      <SectionHeader title="About" />
      <div className="mx-4 bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-4 py-3.5">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-0.5">Liquor Inventory System</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Automatically loads the Michigan LARA price book. Scan barcodes for quick lookup or to build label sessions.
            Data sourced from michigan.gov.
          </p>
        </div>
      </div>
    </div>
  );
}
