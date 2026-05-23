import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface ProgressIndicatorProps {
  progress: number;
  currentRow: number;
  totalRows: number;
}

export function ProgressIndicator({ progress, currentRow, totalRows }: ProgressIndicatorProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-lg font-semibold mb-4 text-card-foreground">Processing File</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Parsing data...</span>
            <span className="font-medium" data-testid="text-progress-percentage">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="w-full" data-testid="progress-bar" />
          <div className="text-xs text-muted-foreground" data-testid="text-progress-details">
            Processing file content...
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
