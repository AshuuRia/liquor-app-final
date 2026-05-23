import { useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CloudUpload, FileText, X, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  selectedFile: File | null;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  onProcess: () => void;
  isProcessing: boolean;
}

export function FileUpload({
  selectedFile,
  onFileSelect,
  onFileRemove,
  onProcess,
  isProcessing,
}: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add("dragover");
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove("dragover");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type === "text/plain") {
      onFileSelect(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="text-xl font-semibold mb-4 text-card-foreground">Upload Liquor Data File</h2>
        
        {/* File Upload Zone */}
        <div
          className={cn(
            "file-drop-zone border-2 border-dashed border-border rounded-lg p-8 text-center bg-muted/30 cursor-pointer mb-4",
            "hover:border-primary hover:bg-accent transition-all duration-200"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="file-drop-zone"
        >
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <CloudUpload className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-lg font-medium text-foreground">Drop your liquor data file here</p>
              <p className="text-sm text-muted-foreground">or click to browse</p>
            </div>
            <div className="text-xs text-muted-foreground">
              Supports: .txt files with fixed-width format
            </div>
          </div>
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={handleFileInputChange}
          data-testid="input-file"
        />

        {/* File Info Display */}
        {selectedFile && (
          <div className="bg-accent border border-border rounded-md p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <FileText className="h-5 w-5 text-accent-foreground" />
                <div>
                  <p className="font-medium text-accent-foreground" data-testid="text-filename">
                    {selectedFile.name}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="text-filesize">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </div>
              <button
                onClick={onFileRemove}
                className="text-destructive hover:text-destructive/80 transition-colors"
                data-testid="button-remove-file"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        {/* Process Button */}
        <Button
          onClick={onProcess}
          disabled={!selectedFile || isProcessing}
          className="w-full"
          data-testid="button-process-file"
        >
          <Settings className="h-4 w-4 mr-2" />
          {isProcessing ? "Processing..." : "Process File"}
        </Button>
        
        {/* Alternative Upload Button */}
        {selectedFile && (
          <Button
            onClick={async () => {
              if (!selectedFile) return;
              
              console.log('Trying original upload method...');
              const formData = new FormData();
              formData.append('file', selectedFile);
              
              try {
                const response = await fetch('/api/process-file', {
                  method: 'POST',
                  body: formData,
                });
                
                if (response.ok) {
                  const result = await response.json();
                  console.log('Upload successful:', result);
                  window.location.reload(); // Reload to trigger processing
                } else {
                  console.error('Upload failed:', response.status);
                }
              } catch (error) {
                console.error('Upload error:', error);
              }
            }}
            variant="outline"
            className="w-full mt-2"
            data-testid="button-upload-alternative"
          >
            <CloudUpload className="h-4 w-4 mr-2" />
            Try Alternative Upload
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
