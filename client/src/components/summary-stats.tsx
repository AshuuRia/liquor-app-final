import { Card, CardContent } from "@/components/ui/card";
import { FileText, Package, Building, DollarSign } from "lucide-react";

interface SummaryStatsProps {
  data: {
    totalRecords: number;
    uniqueBrands: number;
    uniqueVendors: number;
    avgPrice: number;
  };
}

export function SummaryStats({ data }: SummaryStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center space-x-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-card-foreground" data-testid="text-total-records">
                {data.totalRecords.toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">Total Records</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center space-x-3">
            <div className="bg-accent/10 p-2 rounded-lg">
              <Package className="h-5 w-5 text-accent-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold text-card-foreground" data-testid="text-unique-brands">
                {data.uniqueBrands.toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">Unique Brands</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center space-x-3">
            <div className="bg-secondary/10 p-2 rounded-lg">
              <Building className="h-5 w-5 text-secondary-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold text-card-foreground" data-testid="text-unique-vendors">
                {data.uniqueVendors.toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">Vendors</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center space-x-3">
            <div className="bg-emerald-500/10 p-2 rounded-lg">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-card-foreground" data-testid="text-avg-price">
                ${data.avgPrice.toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">Avg. Price</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
