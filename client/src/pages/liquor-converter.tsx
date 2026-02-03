import { useState, useEffect } from "react";
import { ProgressIndicator } from "@/components/progress-indicator";
import { SummaryStats } from "@/components/summary-stats";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, HelpCircle, Book, Scan, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface ProcessingState {
  isProcessing: boolean;
  progress: number;
  currentRow: number;
  totalRows: number;
}

interface ProcessedData {
  success: boolean;
  totalRecords: number;
  uniqueBrands: number;
  uniqueVendors: number;
  avgPrice: number;
  records: any[];
  allRecords?: any[];
  error?: string;
  details?: string;
  source?: string;
  url?: string;
  fetchedAt?: string;
}

export default function LiquorConverter() {
  const [processedData, setProcessedData] = useState<ProcessedData | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>({
    isProcessing: false,
    progress: 0,
    currentRow: 0,
    totalRows: 0,
  });
  const [hasError, setHasError] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(5);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Auto-load data on component mount
  useEffect(() => {
    loadLiquorData();
  }, []);

  // Handle automatic redirect countdown
  useEffect(() => {
    if (shouldRedirect && countdownSeconds > 0) {
      const timer = setTimeout(() => {
        setCountdownSeconds(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (shouldRedirect && countdownSeconds === 0) {
      setLocation('/scanner');
    }
  }, [shouldRedirect, countdownSeconds, setLocation]);

  const loadLiquorData = async () => {
    setProcessingState({
      isProcessing: true,
      progress: 0,
      currentRow: 0,
      totalRows: 0,
    });
    setHasError(false);
    setIsComplete(false);

    try {
      console.log('Fetching liquor data from Michigan state website...');
      
      setProcessingState(prev => ({ ...prev, progress: 25 }));

      const response = await fetch('/api/fetch-liquor-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('Response received:', response.status, response.statusText);
      
      setProcessingState(prev => ({ ...prev, progress: 75 }));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Response error:', errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('Processing result:', result);
      
      setProcessingState(prev => ({ ...prev, progress: 100, isProcessing: false }));

      if (result.success) {
        setProcessedData(result);
        setIsComplete(true);
        setShouldRedirect(true);
        toast({
          title: "Data loaded successfully!",
          description: `${result.totalRecords} records loaded from Michigan state website`,
        });
      } else {
        setHasError(true);
        setProcessedData(result);
        toast({
          variant: "destructive",
          title: "Loading failed",
          description: result.error || "Unknown error occurred",
        });
      }
    } catch (error) {
      console.error('Data loading error:', error);
      setProcessingState(prev => ({ ...prev, isProcessing: false }));
      setHasError(true);
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.log('Error message:', errorMessage);
      
      setProcessedData({
        success: false,
        error: "Failed to load data from website",
        details: errorMessage,
        totalRecords: 0,
        uniqueBrands: 0,
        uniqueVendors: 0,
        avgPrice: 0,
        records: [],
      });
      
      toast({
        variant: "destructive",
        title: "Loading failed", 
        description: `Error: ${errorMessage}. Please try again.`,
      });
    }
  };

  const downloadExcel = async () => {
    if (!processedData?.allRecords && !processedData?.records) return;

    try {
      const response = await fetch('/api/generate-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          records: processedData.allRecords || processedData.records,
          filename: 'michigan_liquor_data.txt',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "michigan_liquor_data.xlsx";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Excel file downloaded!",
        description: "Your converted file has been saved to downloads.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: "Unable to generate Excel file. Please try again.",
      });
    }
  };

  const goToScanner = () => {
    setLocation('/scanner');
  };

  const retryDataLoad = () => {
    setShouldRedirect(false);
    setCountdownSeconds(5);
    loadLiquorData();
  };

  const onExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProcessingState({
      isProcessing: true,
      progress: 0,
      currentRow: 0,
      totalRows: 0,
    });
    setHasError(false);
    setIsComplete(false);

    const formData = new FormData();
    formData.append('file', file);

    try {
      setProcessingState(prev => ({ ...prev, progress: 25 }));
      const response = await fetch('/api/upload-liquor-excel', {
        method: 'POST',
        body: formData,
      });

      setProcessingState(prev => ({ ...prev, progress: 75 }));

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      setProcessingState(prev => ({ ...prev, progress: 100, isProcessing: false }));

      if (result.success) {
        setProcessedData(result);
        setIsComplete(true);
        setShouldRedirect(true);
        toast({
          title: "Excel imported successfully!",
          description: `${result.totalRecords} records loaded from Excel file`,
        });
      }
    } catch (error) {
      console.error('Excel upload error:', error);
      setProcessingState(prev => ({ ...prev, isProcessing: false }));
      setHasError(true);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast({
        variant: "destructive",
        title: "Import failed",
        description: errorMessage,
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-primary text-primary-foreground p-2 rounded-lg">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Liquor Inventory System</h1>
                <p className="text-sm text-muted-foreground">Loading data from Michigan state website</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center space-x-4">
              <Badge variant={isComplete ? "default" : "secondary"}>
                {isComplete ? "Ready to Scan" : "Loading Data"}
              </Badge>
              <div className="text-sm text-muted-foreground">
                {processedData?.totalRecords || 0} records loaded
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Data Loading Section */}
        <div className="mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  {processingState.isProcessing ? (
                    <RefreshCw className="h-8 w-8 text-primary animate-spin" />
                  ) : isComplete ? (
                    <CheckCircle className="h-8 w-8 text-emerald-600" />
                  ) : hasError ? (
                    <AlertCircle className="h-8 w-8 text-destructive" />
                  ) : (
                    <FileText className="h-8 w-8 text-primary" />
                  )}
                </div>
                
                {processingState.isProcessing && (
                  <div>
                    <h2 className="text-xl font-semibold mb-2 text-card-foreground">Loading Liquor Data</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      Downloading latest data from Michigan state website...
                    </p>
                  </div>
                )}
                
                {isComplete && !hasError && (
                  <div>
                    <h2 className="text-xl font-semibold mb-2 text-card-foreground">Data Loaded Successfully!</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      Ready to start scanning barcodes. Redirecting to scanner in {countdownSeconds} seconds...
                    </p>
                    <div className="flex justify-center space-x-4">
                      <Button onClick={goToScanner} data-testid="button-go-scanner">
                        <Scan className="h-4 w-4 mr-2" />
                        Go to Scanner Now
                      </Button>
                      <Button variant="outline" onClick={downloadExcel} data-testid="button-download">
                        <Download className="h-4 w-4 mr-2" />
                        Download Data
                      </Button>
                      <div className="relative">
                        <input
                          type="file"
                          accept=".xlsx,.xls"
                          onChange={onExcelUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          id="excel-upload"
                        />
                        <Button variant="secondary">
                          <Book className="h-4 w-4 mr-2" />
                          Import Excel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                
                {hasError && (
                  <div>
                    <h2 className="text-xl font-semibold mb-2 text-destructive">Loading Failed</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      Unable to load data from the Michigan state website
                    </p>
                    <div className="flex justify-center space-x-4">
                      <Button onClick={retryDataLoad} variant="outline" data-testid="button-retry">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Retry Loading
                      </Button>
                      <div className="relative">
                        <input
                          type="file"
                          accept=".xlsx,.xls"
                          onChange={onExcelUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          id="excel-upload-error"
                        />
                        <Button variant="secondary">
                          <Book className="h-4 w-4 mr-2" />
                          Import Excel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Progress Section */}
        {processingState.isProcessing && (
          <div className="mb-8 fade-in">
            <ProgressIndicator
              progress={processingState.progress}
              currentRow={processingState.currentRow}
              totalRows={processingState.totalRows}
            />
          </div>
        )}

        {/* Error Section */}
        {hasError && processedData && (
          <div className="mb-8 fade-in">
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="pt-6">
                <div className="flex items-center space-x-3">
                  <div className="bg-destructive text-destructive-foreground p-2 rounded-full">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-destructive">Processing Error</h3>
                    <p className="text-destructive/80">{processedData.error || "Unable to parse the file. Please check the format and try again."}</p>
                  </div>
                </div>
                {processedData.details && (
                  <div className="mt-4">
                    <details className="text-sm">
                      <summary className="text-destructive cursor-pointer hover:text-destructive/80">Show technical details</summary>
                      <div className="mt-2 p-3 bg-destructive/5 rounded border text-destructive/70 font-mono text-xs">
                        {processedData.details}
                      </div>
                    </details>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Data Summary */}
        {isComplete && !hasError && processedData && (
          <div className="mb-8 fade-in">
            <SummaryStats data={processedData} />
          </div>
        )}

        {/* Information Section */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-lg font-semibold mb-4 text-card-foreground">About This System</h3>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-card-foreground mb-3">Data Source</h4>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start space-x-2">
                    <FileText className="h-4 w-4 text-primary mt-0.5" />
                    <span>Data is automatically loaded from the Michigan State website</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <FileText className="h-4 w-4 text-primary mt-0.5" />
                    <span>Source: documents.apps.lara.state.mi.us/mlcc/webprbk.txt</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <FileText className="h-4 w-4 text-primary mt-0.5" />
                    <span>Updates automatically with the latest liquor inventory data</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <FileText className="h-4 w-4 text-primary mt-0.5" />
                    <span>No manual file uploads required</span>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-card-foreground mb-3">How to Use</h4>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">1.</span>
                    <span>Data loads automatically when you visit this page</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">2.</span>
                    <span>Once loaded, you'll be redirected to the barcode scanner</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">3.</span>
                    <span>Scan product barcodes to build your inventory list</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-primary">4.</span>
                    <span>Export your scanned inventory to Excel when finished</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="bg-card border-t border-border mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              <span>Liquor Data Parser © 2024</span>
            </div>
            <div className="flex items-center space-x-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">
                <HelpCircle className="h-4 w-4 mr-1 inline" />
                Help
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                <Download className="h-4 w-4 mr-1 inline" />
                Sample File
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                <Book className="h-4 w-4 mr-1 inline" />
                Documentation
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
