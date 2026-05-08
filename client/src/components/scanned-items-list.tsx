import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Download, Trash2, Package, FileText, Edit3, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";

interface ScannedItem {
  id: string;
  sessionId: string;
  scannedBarcode: string;
  scannedAt: string;
  quantity: number;
  product?: {
    liquorCode: string;
    brandName: string;
    adaNumber: string;
    adaName: string;
    vendorName: string;
    proof: string;
    bottleSize: string;
    packSize: string;
    onPremisePrice: number | string;
    offPremisePrice: number | string;
    shelfPrice: number | string;
    upcCode1: string;
    upcCode2: string;
    effectiveDate: string;
  } | null;
}

interface ScannedItemsListProps {
  sessionId: string;
  refreshTrigger: number;
}

export function ScannedItemsList({ sessionId, refreshTrigger }: ScannedItemsListProps) {
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [originalPrices, setOriginalPrices] = useState<Map<string, number>>(new Map());
  const { toast } = useToast();

  useEffect(() => {
    if (sessionId) {
      fetchScannedItems();
    }
  }, [sessionId, refreshTrigger]);

  const fetchScannedItems = async () => {
    try {
      setIsLoading(true);
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/scanned-items/${sessionId}`, { headers: authHeaders });
      
      if (response.ok) {
        const result = await response.json();
        setScannedItems(result.items || []);
      } else {
        console.error('Failed to fetch scanned items');
      }
    } catch (error) {
      console.error('Error fetching scanned items:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteScannedItem = async (itemId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/scanned-items/${sessionId}/${itemId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      if (response.ok) {
        // Remove the item from local state
        setScannedItems(prevItems => prevItems.filter(item => item.id !== itemId));
        toast({
          title: "Item deleted",
          description: "Product removed from your list",
        });
      } else {
        throw new Error('Failed to delete item');
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: "Failed to delete item. Please try again.",
      });
    }
  };

  const clearScannedItems = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/scanned-items/${sessionId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      if (response.ok) {
        setScannedItems([]);
        toast({
          title: "Items cleared",
          description: "All scanned items have been removed.",
        });
      } else {
        throw new Error('Failed to clear items');
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Clear failed",
        description: "Failed to clear scanned items. Please try again.",
      });
    }
  };

  const startEditingPrice = (item: ScannedItem) => {
    setEditingItemId(item.id);
    const currentPrice = item.product?.shelfPrice;
    const priceValue = typeof currentPrice === 'number' ? currentPrice.toFixed(2) : parseFloat(currentPrice || '0').toFixed(2);
    setEditPrice(priceValue);
    
    // Store original price if not already stored
    if (!originalPrices.has(item.id) && item.product?.shelfPrice) {
      const originalPrice = typeof item.product.shelfPrice === 'number' ? item.product.shelfPrice : parseFloat(item.product.shelfPrice || '0');
      setOriginalPrices(prev => new Map(prev).set(item.id, originalPrice));
    }
  };

  const cancelEditPrice = () => {
    setEditingItemId(null);
    setEditPrice("");
  };

  const saveEditedPrice = async () => {
    if (!editingItemId || !editPrice) return;

    const newPrice = parseFloat(editPrice);
    if (isNaN(newPrice) || newPrice < 0) {
      toast({
        variant: "destructive",
        title: "Invalid price",
        description: "Please enter a valid price.",
      });
      return;
    }

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/update-item-price`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          sessionId,
          itemId: editingItemId,
          newPrice,
        }),
      });

      if (response.ok) {
        // Update the local state
        setScannedItems(prevItems =>
          prevItems.map(item =>
            item.id === editingItemId
              ? {
                  ...item,
                  product: item.product ? {
                    ...item.product,
                    shelfPrice: newPrice
                  } : null
                }
              : item
          )
        );

        toast({
          title: "Price updated",
          description: `Price updated to $${newPrice.toFixed(2)}`,
        });

        cancelEditPrice();
      } else {
        throw new Error('Failed to update price');
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: "Failed to update price. Please try again.",
      });
    }
  };


  const exportForPTouch = async () => {
    if (scannedItems.length === 0) {
      toast({
        variant: "destructive",
        title: "No items to export",
        description: "Please scan some items first.",
      });
      return;
    }

    try {
      console.log('Exporting for P-touch Editor:', scannedItems.length);
      
      // Format data exactly like the provided CSV format
      const ptouchData = scannedItems
        .filter(item => item.product)
        .map(item => {
          const price = typeof item.product!.shelfPrice === 'number' ? item.product!.shelfPrice : parseFloat(item.product!.shelfPrice);
          const cents = Math.round(price * 100);
          const formattedPrice = `$${price.toFixed(2)}`;
          const bottleSize = item.product!.bottleSize.replace(/\s+/g, ''); // Remove all spaces from bottle size
          const combinedName = `${item.product!.brandName} ${bottleSize}`;
          
          return {
            "Upc": `"${item.scannedBarcode}"`,
            "Department": "Liquor",
            "qty": "1",
            "cents": cents.toString(),
            "incltaxes": "n",
            "inclfees": "n",
            "Name": `"${combinedName}"`,
            "Price": formattedPrice,
            "size": `"${item.product!.liquorCode.replace(/^0+/, '') || '0'}"`,
            "ebt": "",
            "byweight": "n",
            "Fee Multiplier": "1",
            "cost_qty": "1",
            "cost_cents": "0",
            "variable_price": "n",
            "addstock": "",
            "setstock": `"=""0"""`,
            "pack_name": "",
            "pack_qty": "",
            "pack_upc": "",
            "unit_upc": "",
            "unit_count": "",
            "is_oneclick": "n",
            "oc_color": "",
            "oc_border_color": "",
            "oc_text_color": "",
            "oc_fixedpos": "",
            "oc_page": "",
            "oc_key": "",
            "oc_relpos": ""
          };
        });

      console.log('P-touch data prepared:', ptouchData.length, 'rows');

      // Convert to CSV format
      if (ptouchData.length === 0) {
        toast({
          variant: "destructive",
          title: "No valid items",
          description: "No items with product information found.",
        });
        return;
      }

      const csvHeaders = Object.keys(ptouchData[0]).join(',');
      const csvRows = ptouchData.map(row => 
        Object.values(row).join(',')
      );
      const csvContent = [csvHeaders, ...csvRows].join('\n');

      // Create and download CSV file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ptouch_labels_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "P-touch CSV ready!",
        description: `${ptouchData.length} items exported in POS format for P-touch Editor.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: "Failed to generate P-touch CSV. Please try again.",
      });
    }
  };

  const exportForPTouchWithCustomNames = async () => {
    if (scannedItems.length === 0) {
      toast({
        variant: "destructive",
        title: "No items to export",
        description: "Please scan some items first.",
      });
      return;
    }

    try {
      console.log('Exporting P-touch with custom names:', scannedItems.length);
      
      // Get custom name mappings first
      const authHeaders = await getAuthHeaders();
      const mappingsResponse = await fetch('/api/custom-names', { headers: authHeaders });
      let customMappings: Record<string, string> = {};
      
      if (mappingsResponse.ok) {
        const mappingsResult = await mappingsResponse.json();
        // Create a lookup map from UPC to custom name
        for (const mapping of mappingsResult.mappings || []) {
          // Clean up UPC code from Excel formatting (remove = prefix and quotes)
          let cleanUpc = mapping.upcCode.replace(/^=["']?|["']$/g, '');
          
          // Store multiple variations for matching
          customMappings[mapping.upcCode] = mapping.customName; // Original
          customMappings[cleanUpc] = mapping.customName; // Clean version
          
          // Normalized versions (remove leading zeros)
          const normalizedOriginal = mapping.upcCode.replace(/^0+/, '') || '0';
          const normalizedClean = cleanUpc.replace(/^0+/, '') || '0';
          customMappings[normalizedOriginal] = mapping.customName;
          customMappings[normalizedClean] = mapping.customName;
          
          // Padded versions (add leading zeros to match 14-digit format)
          const paddedClean = cleanUpc.padStart(14, '0');
          customMappings[paddedClean] = mapping.customName;
        }
      }
      
      // Format data exactly like the original P-touch format but with custom names
      const ptouchData = scannedItems
        .filter(item => item.product)
        .map(item => {
          const price = typeof item.product!.shelfPrice === 'number' ? item.product!.shelfPrice : parseFloat(item.product!.shelfPrice);
          const cents = Math.round(price * 100);
          const formattedPrice = `$${price.toFixed(2)}`;
          const bottleSize = item.product!.bottleSize.replace(/\s+/g, ''); // Remove all spaces from bottle size
          
          // Try to find custom name by matching UPC codes with multiple variations
          let customName = null;
          
          // Helper function to try multiple UPC variations
          const tryFindCustomName = (upc: string): string | null => {
            if (customMappings[upc]) return customMappings[upc];
            
            // Try without leading zeros
            const normalized = upc.replace(/^0+/, '') || '0';
            if (customMappings[normalized]) return customMappings[normalized];
            
            // Try with leading zeros (14-digit format)
            const padded = upc.padStart(14, '0');
            if (customMappings[padded]) return customMappings[padded];
            
            return null;
          };
          
          // Check scanned barcode first
          if (item.scannedBarcode) {
            customName = tryFindCustomName(item.scannedBarcode);
          }
          
          // Check product UPC codes if no match found
          if (!customName && item.product!.upcCode1) {
            customName = tryFindCustomName(item.product!.upcCode1);
          }
          
          if (!customName && item.product!.upcCode2) {
            customName = tryFindCustomName(item.product!.upcCode2);
          }
          
          // Use custom name if found, otherwise use original brand name + size
          let finalName;
          if (customName) {
            // Custom name found - use it as-is (no size combined)
            finalName = customName;
          } else {
            // No custom name - combine brand name with bottle size
            finalName = `${item.product!.brandName} ${bottleSize}`;
          }
          
          return {
            "Upc": `"${item.scannedBarcode}"`,
            "Department": "Liquor 2",
            "qty": "1",
            "cents": cents.toString(),
            "incltaxes": "n",
            "inclfees": "n",
            "Name": `"${finalName}"`,
            "Price": formattedPrice,
            "size": `"${item.product!.liquorCode.replace(/^0+/, '') || '0'}"`,
            "ebt": "",
            "byweight": "n",
            "Fee Multiplier": "1",
            "cost_qty": "1",
            "cost_cents": "0",
            "variable_price": "n",
            "addstock": "",
            "setstock": `"=""0"""`,
            "pack_name": "",
            "pack_qty": "",
            "pack_upc": "",
            "unit_upc": "",
            "unit_count": "",
            "is_oneclick": "n",
            "oc_color": "",
            "oc_border_color": "",
            "oc_text_color": "",
            "oc_fixedpos": "",
            "oc_page": "",
            "oc_key": "",
            "oc_relpos": "",
            "CustomOverride": !!customName
          };
        });

      console.log('P-touch custom data prepared:', ptouchData.length, 'rows');
      const customCount = ptouchData.filter(item => item.CustomOverride).length;
      console.log('Items with custom names:', customCount);

      // Convert to CSV format (exclude the CustomOverride field from output)
      if (ptouchData.length === 0) {
        toast({
          variant: "destructive",
          title: "No valid items",
          description: "No items with product information found.",
        });
        return;
      }

      // Remove the CustomOverride field for CSV output
      const csvData = ptouchData.map(item => {
        const { CustomOverride, ...csvItem } = item;
        return csvItem;
      });

      const csvHeaders = Object.keys(csvData[0]).join(',');
      const csvRows = csvData.map(row => 
        Object.values(row).join(',')
      );
      const csvContent = [csvHeaders, ...csvRows].join('\n');
      

      // Create and download CSV file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ptouch_custom_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "P-touch CSV with custom names ready!",
        description: `${ptouchData.length} items exported (${customCount} custom names used) in POS format for P-touch Editor.`,
      });
    } catch (error) {
      console.error('P-touch custom export error:', error);
      toast({
        variant: "destructive",
        title: "Export failed",
        description: "Failed to generate P-touch CSV with custom names. Please try again.",
      });
    }
  };

  const downloadExcel = async () => {
    if (scannedItems.length === 0) {
      toast({
        variant: "destructive",
        title: "No items to export",
        description: "Please scan some items first.",
      });
      return;
    }

    try {
      console.log('Exporting scanned items:', scannedItems.length);
      console.log('Items with products:', scannedItems.filter(item => item.product).length);
      
      // Format data for Excel export with only the columns you specified
      const excelData = scannedItems
        .filter(item => item.product)
        .map(item => {
          console.log('Processing item for export:', item.product?.brandName);
          return {
            "Liquor Code": item.product!.liquorCode,
            "Brand Name": item.product!.brandName,
            "ADA Number": item.product!.adaNumber,
            "ADA Name": item.product!.adaName,
            "Vendor Name": item.product!.vendorName,
            "Proof": item.product!.proof,
            "Bottle Size": item.product!.bottleSize,
            "Pack Size": item.product!.packSize,
            "On Premise": item.product!.onPremisePrice,
            "Off Premise": item.product!.offPremisePrice,
            "Shelf Price": item.product!.shelfPrice,
            "UPC Code 1": item.scannedBarcode, // Use the actual scanned barcode
            "UPC Code 2": item.product!.upcCode2,
            "Effective Date": item.product!.effectiveDate,
          };
        });

      console.log('Excel data prepared:', excelData.length, 'rows');

      const authHeaders2 = await getAuthHeaders();
      const response = await fetch('/api/generate-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders2 },
        body: JSON.stringify({
          records: excelData,
          filename: `scanned_liquor_${new Date().toISOString().split('T')[0]}.xlsx`,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scanned_liquor_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Excel exported!",
        description: `${scannedItems.length} scanned items exported successfully.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: "Failed to generate Excel file. Please try again.",
      });
    }
  };

  const formatPrice = (price: number | string) => {
    if (typeof price === 'number') {
      return `$${price.toFixed(2)}`;
    }
    return price || "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>Scanned Items ({scannedItems.length})</span>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              onClick={exportForPTouch}
              disabled={scannedItems.length === 0}
              size="sm"
              variant="default"
              data-testid="button-export-ptouch"
            >
              <FileText className="h-4 w-4 mr-2" />
              P-touch CSV
            </Button>
            <Button
              onClick={exportForPTouchWithCustomNames}
              disabled={scannedItems.length === 0}
              size="sm"
              variant="outline"
              data-testid="button-export-ptouch-custom"
            >
              <FileText className="h-4 w-4 mr-2" />
              P-touch CSV (Custom Names)
            </Button>
            <Button
              onClick={downloadExcel}
              disabled={scannedItems.length === 0}
              size="sm"
              variant="outline"
              data-testid="button-export-scanned"
            >
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
            <Button
              onClick={clearScannedItems}
              variant="outline"
              size="sm"
              disabled={scannedItems.length === 0}
              data-testid="button-clear-scanned"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading scanned items...</p>
          </div>
        ) : scannedItems.length === 0 ? (
          <div className="text-center py-8">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No items scanned yet</p>
            <p className="text-sm text-muted-foreground">Start scanning barcodes to build your list</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {scannedItems.map((item, index) => (
              <div
                key={item.id}
                className="border border-border rounded-lg p-4 bg-card overflow-hidden"
                data-testid={`scanned-item-${index}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {item.product ? (
                      <>
                        <h4 className="font-semibold text-card-foreground">
                          {item.product.brandName}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Liquor Code:</span> {item.product.liquorCode}
                          </div>
                          <div>
                            <span className="text-muted-foreground">ADA:</span> {item.product.adaNumber}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Size:</span> {item.product.bottleSize}
                          </div>
                          <div className="truncate">
                            <span className="text-muted-foreground">Vendor:</span> 
                            <span className="ml-1" title={item.product.vendorName}>{item.product.vendorName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Price:</span>
                            {editingItemId === item.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editPrice}
                                  onChange={(e) => setEditPrice(e.target.value)}
                                  className="w-20 h-6 text-xs"
                                  data-testid={`input-price-${index}`}
                                />
                                <Button
                                  onClick={saveEditedPrice}
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-xs"
                                  data-testid={`button-save-price-${index}`}
                                >
                                  Save
                                </Button>
                                <Button
                                  onClick={cancelEditPrice}
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-xs"
                                  data-testid={`button-cancel-price-${index}`}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="flex flex-col">
                                  <span>{formatPrice(item.product.shelfPrice)}</span>
                                  {originalPrices.has(item.id) && (
                                    <span className="text-xs text-muted-foreground line-through">
                                      Original: {formatPrice(originalPrices.get(item.id)!)}
                                    </span>
                                  )}
                                </div>
                                <Button
                                  onClick={() => startEditingPrice(item)}
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  data-testid={`button-edit-price-${index}`}
                                >
                                  <Edit3 className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Proof:</span> {item.product.proof}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <h4 className="font-semibold text-destructive">
                          Product Not Found
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          Barcode: {item.scannedBarcode}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col items-end space-y-2 flex-shrink-0">
                    <Button
                      onClick={() => deleteScannedItem(item.id)}
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      data-testid={`button-delete-item-${index}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                    <Badge variant="secondary">
                      {new Date(item.scannedAt).toLocaleTimeString()}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.scannedBarcode}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Custom Name Mapping Upload Component
export function CustomNameMappingUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [mappingCount, setMappingCount] = useState<number>(0);
  const { toast } = useToast();

  // Load existing mapping count on mount
  useEffect(() => {
    loadMappingCount();
  }, []);

  const loadMappingCount = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/custom-names', { headers: authHeaders });
      if (response.ok) {
        const result = await response.json();
        setMappingCount(result.count || 0);
      }
    } catch (error) {
      console.error('Failed to load mapping count:', error);
    }
  };

  const uploadCustomNameMapping = async () => {
    if (!mappingFile) return;

    try {
      setIsUploading(true);

      const formData = new FormData();
      formData.append('file', mappingFile);

      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/upload-custom-names', {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        setMappingCount(result.mappingsAdded || result.mappingsUploaded || 0);
        toast({
          title: "Custom names uploaded successfully",
          description: `${result.mappingsAdded || result.mappingsUploaded || 0} name mappings added`,
        });
        setMappingFile(null);
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed", 
        description: error instanceof Error ? error.message : "Failed to upload custom names",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const clearCustomNames = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/clear-custom-names', {
        method: 'DELETE',
        headers: authHeaders,
      });

      if (response.ok) {
        setMappingCount(0);
        toast({
          title: "Custom names cleared",
          description: "All custom name mappings have been removed",
        });
      } else {
        throw new Error('Failed to clear custom names');
      }
    } catch (error) {
      console.error('Clear error:', error);
      toast({
        title: "Clear failed",
        description: "Failed to clear custom names",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Custom Name Overrides</span>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              onClick={clearCustomNames}
              disabled={mappingCount === 0}
              size="sm"
              variant="outline"
              data-testid="button-clear-custom-names"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All ({mappingCount})
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p>Upload a CSV or Excel file with custom product names. The file should have two columns:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong>UPC Code:</strong> The barcode/UPC of the product</li>
              <li><strong>Custom Name:</strong> Your preferred name for the product</li>
            </ul>
            <p className="mt-2">
              These custom names will be used in the P-touch CSV export when UPC codes match.
            </p>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setMappingFile(e.target.files?.[0] || null)}
                disabled={isUploading}
                data-testid="input-custom-names-file"
              />
            </div>
            <Button
              onClick={uploadCustomNameMapping}
              disabled={!mappingFile || isUploading}
              data-testid="button-upload-custom-names"
            >
              {isUploading ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </div>

          {mappingCount > 0 && (
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-sm">
                <strong>{mappingCount}</strong> custom name mappings loaded. 
                Use the "P-touch CSV (Custom Names)" button to export with your custom names.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}