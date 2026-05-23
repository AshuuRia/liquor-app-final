import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

interface DataPreviewProps {
  data: {
    totalRecords: number;
    records: any[];
  };
  onDownload: () => void;
}

export function DataPreview({ data, onDownload }: DataPreviewProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const recordsPerPage = 5;
  const totalPages = Math.ceil(data.records.length / recordsPerPage);
  
  const currentRecords = data.records.slice(
    currentPage * recordsPerPage,
    (currentPage + 1) * recordsPerPage
  );

  const formatPrice = (price: number | string) => {
    if (typeof price === 'number') {
      return `$${price.toFixed(2)}`;
    }
    return price || "";
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-card-foreground">Data Preview</h3>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-muted-foreground" data-testid="text-record-count">
              {data.totalRecords} records found
            </span>
            <Button onClick={onDownload} data-testid="button-download-excel">
              <Download className="h-4 w-4 mr-2" />
              Download Excel
            </Button>
          </div>
        </div>

        {/* Data Table */}
        <div className="table-container border border-border rounded-md">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Liquor Code</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Brand Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">ADA Number</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">ADA Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Vendor Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Proof</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Bottle Size</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Pack Size</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">On Premise</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Off Premise</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Shelf Price</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">UPC Code 1</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">UPC Code 2</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Effective Date</th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {currentRecords.map((record, index) => (
                  <tr 
                    key={index} 
                    className="hover:bg-accent/50 transition-colors"
                    data-testid={`row-record-${currentPage * recordsPerPage + index}`}
                  >
                    <td className="px-4 py-3 text-sm text-card-foreground font-mono">{record.liquorCode}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground">{record.brandName}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground">{record.adaNumber}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground">{record.adaName}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground">{record.vendorName}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground">{record.proof}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground">{record.bottleSize}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground">{record.packSize}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground font-mono">{formatPrice(record.onPremisePrice)}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground font-mono">{formatPrice(record.offPremisePrice)}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground font-mono">{formatPrice(record.shelfPrice)}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground font-mono">{record.upcCode1}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground font-mono">{record.upcCode2}</td>
                    <td className="px-4 py-3 text-sm text-card-foreground">{record.effectiveDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table Footer */}
        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span data-testid="text-pagination-info">
            Showing {currentPage * recordsPerPage + 1} to {Math.min((currentPage + 1) * recordsPerPage, data.records.length)} of {data.totalRecords} records
          </span>
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
              disabled={currentPage === 0}
              data-testid="button-previous-page"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
              disabled={currentPage >= totalPages - 1}
              data-testid="button-next-page"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
