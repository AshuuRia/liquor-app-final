import { useState, useEffect } from "react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { ScannedItemsList, CustomNameMappingUpload } from "@/components/scanned-items-list";
import { LiquorSearch } from "@/components/liquor-search";
import { SessionSidebar } from "@/components/session-sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileText, Scan, AlertCircle, AlertTriangle, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { LiquorRecord, Session } from "@shared/schema";

export default function BarcodeScannerPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [hasLiquorData, setHasLiquorData] = useState(false);
  const [scanStats, setScanStats] = useState({
    totalScans: 0,
    matchedProducts: 0,
    lastScanTime: null as string | null,
  });
  // Disambiguation dialog state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBarcode, setPickerBarcode] = useState<string>("");
  const [pickerChoices, setPickerChoices] = useState<LiquorRecord[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get active session on load
  const { data: activeSessionData } = useQuery({
    queryKey: ['/api/sessions/active'],
  });

  const activeSession = (activeSessionData as any)?.session;

  useEffect(() => {
    // Check if liquor data has been loaded
    checkLiquorData();
    
    // If there's an active session, use it
    if (activeSession) {
      setSessionId(activeSession.id);
    } else {
      // Create a default session if none exists
      createDefaultSession();
    }
  }, [activeSession]);

  const createDefaultSession = async () => {
    try {
      const now = new Date();
      const defaultName = `Scan Session ${now.toLocaleDateString()}`;
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ name: defaultName }),
      });
      
      const result = await response.json();
      if (result.success) {
        setSessionId(result.session.id);
        queryClient.invalidateQueries({ queryKey: ['/api/sessions'] });
      }
    } catch (error) {
      console.error('Failed to create default session:', error);
    }
  };

  const checkLiquorData = async () => {
    try {
      // Check if we have liquor records by doing a test scan
      const authHeaders = await getAuthHeaders();
      const scanResponse = await fetch('/api/scan-barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ barcode: 'test-check-only', sessionId: null })
      });
      
      const scanResult = await scanResponse.json();
      // The scan request will show debug info about total records
      setHasLiquorData(true); // Assume data exists for now
    } catch (error) {
      setHasLiquorData(false);
    }
  };

  const handleSearchSelect = async (liquor: LiquorRecord) => {
    console.log('Manual search selected:', liquor.brandName);
    
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/add-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          liquorRecordId: liquor.id,
          sessionId: sessionId || 'default',
          scannedBarcode: liquor.upcCode1 || 'manual-search',
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        setScanStats(prev => ({
          totalScans: prev.totalScans + 1,
          matchedProducts: prev.matchedProducts + 1,
          lastScanTime: new Date().toLocaleTimeString(),
        }));

        toast({
          title: "Product added!",
          description: `${liquor.brandName} - ${liquor.bottleSize}`,
        });

        // Refresh the scanned items list
        setRefreshTrigger(prev => prev + 1);
      } else {
        throw new Error(result.error || 'Failed to add item');
      }
    } catch (error) {
      console.error('Search select error:', error);
      toast({
        title: "Error",
        description: "Failed to add product to list",
        variant: "destructive",
      });
    }
  };

  // Called after user picks one product from the disambiguation dialog
  const confirmPickerSelection = async (product: LiquorRecord) => {
    setPickerLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/add-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          liquorRecordId: product.id,
          sessionId: sessionId || 'default',
          scannedBarcode: pickerBarcode,
        }),
      });
      const result = await response.json();
      if (result.success) {
        setScanStats(prev => ({
          totalScans: prev.totalScans + 1,
          matchedProducts: prev.matchedProducts + 1,
          lastScanTime: new Date().toLocaleTimeString(),
        }));
        toast({
          title: "Product added!",
          description: `${product.brandName} - ${product.bottleSize} ($${product.shelfPrice})`,
        });
        setRefreshTrigger(prev => prev + 1);
      } else {
        throw new Error(result.error || 'Failed to add item');
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to add product." });
    } finally {
      setPickerLoading(false);
      setPickerOpen(false);
      setPickerChoices([]);
    }
  };

  const handleScan = async (rawBarcode: string) => {
    // Cameras often decode UPC-A (12 digits) as EAN-13 (13 digits, extra leading 0)
    // or GTIN-14 (14 digits, two leading zeros). Strip back to what's on the bottle.
    const barcode = (() => {
      if (/^\d+$/.test(rawBarcode)) {
        if (rawBarcode.length === 14 && rawBarcode.startsWith('00')) return rawBarcode.slice(2);
        if (rawBarcode.length === 13 && rawBarcode.startsWith('0'))  return rawBarcode.slice(1);
      }
      return rawBarcode;
    })();
    console.log('Scanned barcode — raw:', rawBarcode, '→ normalized:', barcode);
    
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/scan-barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ barcode, sessionId }),
      });

      const result = await response.json();

      // Multiple products share this barcode — show picker before adding anything
      if (result.success && result.requiresSelection) {
        setPickerBarcode(barcode);
        setPickerChoices(result.matchedProducts);
        setPickerOpen(true);
        setScanStats(prev => ({
          ...prev,
          totalScans: prev.totalScans + 1,
          lastScanTime: new Date().toLocaleTimeString(),
        }));
        return;
      }

      setScanStats(prev => ({
        totalScans: prev.totalScans + 1,
        matchedProducts: prev.matchedProducts + (result.success ? 1 : 0),
        lastScanTime: new Date().toLocaleTimeString(),
      }));

      if (result.success && result.matchedProduct) {
        toast({
          title: "Product found!",
          description: `${result.matchedProduct.brandName} - ${result.matchedProduct.bottleSize}`,
        });
        setRefreshTrigger(prev => prev + 1);
      } else {
        // Play error beep for unrecognised barcode
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
          oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.2);
        } catch { /* audio not critical */ }

        toast({
          variant: "destructive",
          title: "Product not found",
          description: `No match found for barcode: ${barcode}`,
        });
      }
    } catch (error) {
      console.error('Scan processing error:', error);
      toast({
        variant: "destructive",
        title: "Scan failed",
        description: "Failed to process barcode. Please try again.",
      });
    }
  };

  const toggleScanner = () => {
    setIsScannerActive(!isScannerActive);
  };

  return (
    <div className="min-h-screen bg-background">

      {/* ── Duplicate barcode picker dialog ── */}
      <Dialog open={pickerOpen} onOpenChange={(open) => { if (!open && !pickerLoading) setPickerOpen(false); }}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Multiple products found
            </DialogTitle>
            <DialogDescription>
              This barcode matches {pickerChoices.length} products in the database. Tap the one you're holding to add the correct item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {pickerChoices.map((product) => (
              <button
                key={product.id}
                disabled={pickerLoading}
                onClick={() => confirmPickerSelection(product)}
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent hover:border-primary transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-sm text-foreground">{product.brandName}</div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{product.bottleSize}</span>
                  {product.proof && <span>{product.proof} proof</span>}
                  <span className="ml-auto font-semibold text-foreground">
                    ${typeof product.shelfPrice === 'number' ? product.shelfPrice.toFixed(2) : product.shelfPrice}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Code: {product.liquorCode} · {product.vendorName}
                </div>
              </button>
            ))}
          </div>
          <Button variant="outline" className="w-full mt-2" disabled={pickerLoading} onClick={() => setPickerOpen(false)}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-primary text-primary-foreground p-2 rounded-lg">
                <Scan className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Liquor Inventory Scanner</h1>
                <p className="text-sm text-muted-foreground">Scan barcodes to build your inventory list</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <SessionSidebar 
                onSessionChange={(newSessionId) => {
                  setSessionId(newSessionId);
                  setRefreshTrigger(prev => prev + 1);
                }}
                currentSessionId={sessionId}
              />
              <a
                href="/price-compare"
                className="bg-secondary text-secondary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-secondary/90 transition-colors"
              >
                <TrendingUp className="h-4 w-4 mr-2 inline" />
                Price Compare
              </a>
              <a 
                href="/" 
                className="bg-secondary text-secondary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-secondary/90 transition-colors"
                data-testid="link-upload"
              >
                <FileText className="h-4 w-4 mr-2 inline" />
                Upload Data
              </a>
              <Badge variant={hasLiquorData ? "default" : "destructive"}>
                {hasLiquorData ? "Database Loaded" : "No Data"}
              </Badge>
              {scanStats.lastScanTime && (
                <div className="text-sm text-muted-foreground">
                  Last scan: {scanStats.lastScanTime}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Warning if no liquor data */}
        {!hasLiquorData && (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No liquor database found. Please upload your liquor data file first on the{" "}
              <a href="/" className="text-primary hover:underline">main page</a> before scanning.
            </AlertDescription>
          </Alert>
        )}

        {/* Scan Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center space-x-3">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <Scan className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-card-foreground" data-testid="text-total-scans">
                    {scanStats.totalScans}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Scans</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center space-x-3">
                <div className="bg-emerald-500/10 p-2 rounded-lg">
                  <FileText className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-card-foreground" data-testid="text-matched-products">
                    {scanStats.matchedProducts}
                  </p>
                  <p className="text-sm text-muted-foreground">Products Found</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center space-x-3">
                <div className="bg-amber-500/10 p-2 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-card-foreground" data-testid="text-not-found">
                    {scanStats.totalScans - scanStats.matchedProducts}
                  </p>
                  <p className="text-sm text-muted-foreground">Not Found</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Manual Search
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col space-y-2">
              <p className="text-sm text-muted-foreground mb-4">
                Can't scan a barcode? Search for liquor products by name, code, or UPC and add them to your list.
              </p>
              <LiquorSearch 
                onSelect={handleSearchSelect}
                placeholder="Search by name, code, or UPC..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Scanner and Results Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Scanner Section */}
          <div>
            <BarcodeScanner
              onScan={handleScan}
              isActive={isScannerActive}
              onToggle={toggleScanner}
            />
          </div>

          {/* Scanned Items Section */}
          <div>
            {sessionId && (
              <ScannedItemsList
                sessionId={sessionId}
                refreshTrigger={refreshTrigger}
              />
            )}
            <CustomNameMappingUpload />
          </div>
        </div>

        {/* Instructions */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>How to Use the Scanner</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-card-foreground mb-3">Getting Started</h4>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">1.</span>
                    <span>Make sure your liquor database is loaded (upload file on main page)</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">2.</span>
                    <span>Click "Start Scanner" to activate your camera</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">3.</span>
                    <span>Point camera at barcodes to scan liquor products</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">4.</span>
                    <span>View scanned items in the list on the right</span>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-card-foreground mb-3">Export Your Results</h4>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">•</span>
                    <span>All scanned items are automatically saved to your session</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">•</span>
                    <span>Click "Export Excel" to download your inventory list</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">•</span>
                    <span>Excel includes: ADA info, vendor, pricing, UPC codes, and dates</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">•</span>
                    <span>Use "Clear All" to start a new scanning session</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}