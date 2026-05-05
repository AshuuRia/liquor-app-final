import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { fileProcessingResult } from "@shared/schema";
import multer from "multer";
import * as XLSX from "xlsx";

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1,
    fieldSize: 50 * 1024 * 1024 // 50MB field size limit
  },
  fileFilter: (req, file, cb) => {
    console.log('File filter check:', file.originalname, file.mimetype);
    cb(null, true); // Accept all files
  }
});

// Generate HTML for Brother QL printer labels
function generateLabelHTML(items: any[]) {
  const labelCSS = `
    <style>
      @page {
        size: 2.4in 1.2in;
        margin: 0;
      }
      
      @media print {
        body { 
          margin: 0; 
          padding: 0; 
          font-family: Arial, sans-serif; 
        }
        
        .label {
          width: 2.4in;
          height: 1.2in;
          padding: 0.05in;
          border: 1px solid #000;
          box-sizing: border-box;
          page-break-after: always;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        
        .label:last-child {
          page-break-after: avoid;
        }
        
        .label-header {
          font-weight: bold;
          font-size: 11px;
          text-align: center;
          line-height: 1.1;
          margin-bottom: 0.02in;
        }
        
        .label-body {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        
        .barcode-section {
          flex: 1;
          display: flex;
          align-items: center;
        }
        
        .barcode {
          font-family: 'Libre Barcode 128', monospace;
          font-size: 20px;
          letter-spacing: 0;
          line-height: 1;
          writing-mode: horizontal-tb;
        }
        
        .price-section {
          font-weight: bold;
          font-size: 16px;
          text-align: right;
          margin-left: 0.1in;
        }
        
        .label-footer {
          position: absolute;
          bottom: 0.05in;
          right: 0.05in;
          font-size: 8px;
          font-weight: bold;
        }
        
        /* Hide everything except labels when printing */
        .no-print { display: none !important; }
      }
      
      /* Screen styles for preview */
      @media screen {
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          background: #f0f0f0;
        }
        
        .print-instructions {
          background: #e3f2fd;
          border: 1px solid #1976d2;
          border-radius: 4px;
          padding: 15px;
          margin-bottom: 20px;
        }
        
        .label {
          width: 240px;
          height: 120px;
          padding: 5px;
          border: 2px solid #000;
          box-sizing: border-box;
          margin: 10px;
          display: inline-flex;
          flex-direction: column;
          position: relative;
          background: white;
        }
        
        .label-header {
          font-weight: bold;
          font-size: 11px;
          text-align: center;
          line-height: 1.1;
          margin-bottom: 2px;
        }
        
        .label-body {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        
        .barcode-section {
          flex: 1;
          display: flex;
          align-items: center;
        }
        
        .barcode {
          font-family: monospace;
          font-size: 8px;
          letter-spacing: 1px;
          line-height: 1;
          background: repeating-linear-gradient(90deg, #000 0px, #000 1px, #fff 1px, #fff 2px);
          color: transparent;
          padding: 5px 0;
        }
        
        .price-section {
          font-weight: bold;
          font-size: 16px;
          text-align: right;
          margin-left: 10px;
        }
        
        .label-footer {
          position: absolute;
          bottom: 5px;
          right: 5px;
          font-size: 8px;
          font-weight: bold;
        }
      }
    </style>
  `;

  const labelElements = items.map((item: any) => {
    const product = item.product;
    const brandWithSize = `${product.brandName} ${product.bottleSize}`;
    const price = typeof product.shelfPrice === 'number' ? `$${product.shelfPrice.toFixed(2)}` : product.shelfPrice;
    const barcode = item.scannedBarcode || product.upcCode1 || '';
    
    return `
      <div class="label">
        <div class="label-header">
          ${brandWithSize}
        </div>
        <div class="label-body">
          <div class="barcode-section">
            <div class="barcode">${barcode}</div>
          </div>
          <div class="price-section">
            ${price}
          </div>
        </div>
        <div class="label-footer">
          ${product.liquorCode}
        </div>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Liquor Shelf Labels</title>
      ${labelCSS}
      <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
    </head>
    <body>
      <div class="print-instructions no-print">
        <h3>🏷️ Brother QL-820NWB Label Printing Instructions</h3>
        <ol>
          <li>Load 2.4" x 1.2" continuous length labels in your Brother QL-820NWB</li>
          <li>In your browser, go to <strong>File → Print</strong> (or Ctrl+P)</li>
          <li>Select your Brother QL-820NWB printer</li>
          <li>Choose <strong>More settings → Paper size → 2.4" x 1.2"</strong></li>
          <li>Set <strong>Margins to None</strong> and <strong>Scale to 100%</strong></li>
          <li>Click Print - labels will auto-cut between each item</li>
        </ol>
        <p><strong>Total labels to print: ${items.length}</strong></p>
      </div>
      
      ${labelElements}
    </body>
    </html>
  `;
}

// TSV column indices for the Michigan LARA Price Book format
// Columns: Liquor Code, Brand Name, ADA Number, ADA Name, Vendor Name,
//          Liquor Type, Proof, Bottle Size, Case Size, Packs per Case,
//          Product Category, On Premise Price, Off Premise Price, Shelf price,
//          GTIN/UPC, Effective Date, Effective Date with Liq Code
function parsePrice(value: string): number {
  const num = parseFloat(value.replace(/[$,]/g, '').trim());
  return isNaN(num) ? 0 : num;
}

function parseTsvLine(line: string) {
  const cols = line.split('\t');

  return {
    liquorCode:      (cols[0]  || "").trim(),
    brandName:       (cols[1]  || "").trim(),
    adaNumber:       (cols[2]  || "").trim(),
    adaName:         (cols[3]  || "").trim(),
    vendorName:      (cols[4]  || "").trim(),
    proof:           (cols[6]  || "").trim(),
    bottleSize:      (cols[7]  || "").trim(),
    packSize:        (cols[8]  || "").trim(),
    onPremisePrice:  parsePrice(cols[11] || ""),
    offPremisePrice: parsePrice(cols[12] || ""),
    shelfPrice:      parsePrice(cols[13] || ""),
    upcCode1:        (cols[14] || "").trim(),
    upcCode2:        "",
    effectiveDate:   (cols[15] || "").trim(),
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Process liquor data file
  app.post("/api/process-file", upload.single('file'), async (req, res) => {
    console.log('Processing file upload request...');
    
    try {
      if (!req.file) {
        console.log('No file uploaded in request');
        return res.status(400).json({ success: false, error: "No file uploaded" });
      }

      console.log('File received:', req.file.originalname, 'Size:', req.file.size, 'bytes');

      const fileContent = req.file.buffer.toString('utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      console.log('File parsed, total lines:', lines.length);
      
      const records = [];
      const brands = new Set();
      const vendors = new Set();
      const prices: number[] = [];

      for (const line of lines) {
        if (line.trim()) {
          const record = parseTsvLine(line);
          if (!record.liquorCode) continue;
          records.push(record);
          
          if (record.brandName) brands.add(record.brandName);
          if (record.vendorName) vendors.add(record.vendorName);
          
          // Collect prices for average calculation
          if (typeof record.shelfPrice === 'number') {
            prices.push(record.shelfPrice);
          }
        }
      }

      const avgPrice = prices.length > 0 
        ? prices.reduce((sum, price) => sum + price, 0) / prices.length 
        : 0;

      // Clear existing records and save new ones to storage
      await storage.clearLiquorRecords();
      console.log('Cleared existing liquor records');
      
      for (const record of records) {
        await storage.createLiquorRecord(record);
      }
      console.log(`Saved ${records.length} liquor records to storage`);

      const result = {
        success: true,
        totalRecords: records.length,
        uniqueBrands: brands.size,
        uniqueVendors: vendors.size,
        avgPrice: Number(avgPrice.toFixed(2)),
        records: records.slice(0, 100), // Return first 100 for preview
        allRecords: records, // Include all records for download
      };

      res.json(result);
    } catch (error) {
      console.error("File processing error:", error);
      
      // Check if response was already sent
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: "Failed to process file",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });

  // Process file content directly (alternative to file upload)
  app.post("/api/process-file-content", async (req, res) => {
    console.log('Processing file content request...');
    
    try {
      const { content, filename } = req.body;
      
      if (!content) {
        console.log('No content provided in request');
        return res.status(400).json({ success: false, error: "No file content provided" });
      }

      console.log('Content received for file:', filename, 'Length:', content.length);

      const allLines = content.split('\n').filter((line: string) => line.trim());
      // Skip header row
      const lines = allLines[0]?.toLowerCase().includes('liquor code') ? allLines.slice(1) : allLines;
      console.log('File parsed, total lines:', lines.length);
      
      const records = [];
      const brands = new Set();
      const vendors = new Set();
      const prices: number[] = [];

      for (const line of lines) {
        if (line.trim()) {
          const record = parseTsvLine(line);
          if (!record.liquorCode) continue;
          records.push(record);
          
          if (record.brandName) brands.add(record.brandName);
          if (record.vendorName) vendors.add(record.vendorName);
          
          // Collect prices for average calculation
          if (typeof record.shelfPrice === 'number') {
            prices.push(record.shelfPrice);
          }
        }
      }

      const avgPrice = prices.length > 0 
        ? prices.reduce((sum, price) => sum + price, 0) / prices.length 
        : 0;

      // Clear existing records and save new ones to storage
      await storage.clearLiquorRecords();
      console.log('Cleared existing liquor records');
      
      for (const record of records) {
        await storage.createLiquorRecord(record);
      }
      console.log(`Saved ${records.length} liquor records to storage`);

      const result = {
        success: true,
        totalRecords: records.length,
        uniqueBrands: brands.size,
        uniqueVendors: vendors.size,
        avgPrice: Number(avgPrice.toFixed(2)),
        records: records.slice(0, 100), // Return first 100 for preview
        allRecords: records, // Include all records for download
      };

      console.log('Processing complete:', result.totalRecords, 'records processed');
      res.json(result);
    } catch (error) {
      console.error("File content processing error:", error);
      
      // Check if response was already sent
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: "Failed to process file content",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });

  // Convert a camera-decoded barcode back to what's printed on the bottle.
  // Cameras often decode UPC-A (12 digits) as EAN-13 (13 digits, leading 0 added),
  // or GTIN-14 (14 digits, two leading zeros). Strip the extra prefix so the stored
  // value matches what the user physically sees on the label.
  function toBottleBarcode(barcode: string): string {
    if (/^\d+$/.test(barcode)) {
      if (barcode.length === 14 && barcode.startsWith('00')) return barcode.slice(2);
      if (barcode.length === 13 && barcode.startsWith('0'))  return barcode.slice(1);
    }
    return barcode;
  }

  // Scan barcode and lookup product
  app.post("/api/scan-barcode", async (req, res) => {
    console.log('Processing barcode scan request...');
    
    try {
      const { barcode, sessionId } = req.body;
      
      if (!barcode) {
        return res.status(400).json({ 
          success: false, 
          error: "No barcode provided" 
        });
      }

      console.log('Looking up barcode:', barcode);

      // Get all records for debugging
      const allRecords = await storage.getLiquorRecords();
      console.log('Total records in storage:', allRecords.length);
      
      // Don't process test barcodes that are just checking status
      if (barcode === 'test-check-only') {
        return res.json({
          success: false,
          barcode,
          error: "Status check only",
          totalRecords: allRecords.length
        });
      }
      
      // Find ALL matching liquor records for this barcode
      const matchedProducts = await storage.findAllLiquorByBarcode(barcode);

      if (matchedProducts.length === 0) {
        console.log('No product found for barcode:', barcode);
        return res.json({
          success: false,
          barcode,
          error: "Product not found in database",
        });
      }

      // Multiple matches — return them all so the client can show a picker
      if (matchedProducts.length > 1) {
        console.log(`${matchedProducts.length} products share barcode ${barcode} — returning for user selection`);
        return res.json({
          success: true,
          requiresSelection: true,
          barcode,
          matchedProducts,
        });
      }

      // Exactly one match — add immediately as before
      const matchedProduct = matchedProducts[0];
      if (sessionId) {
        await storage.addScannedItem({
          sessionId,
          liquorRecordId: matchedProduct.id,
          scannedBarcode: toBottleBarcode(barcode),
          scannedAt: new Date().toISOString(),
          quantity: 1,
        });
      }

      console.log('Product found:', matchedProduct.brandName);
      res.json({
        success: true,
        requiresSelection: false,
        barcode,
        matchedProduct,
      });
    } catch (error) {
      console.error("Barcode scan error:", error);
      
      res.status(500).json({
        success: false,
        error: "Failed to process barcode scan",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get scanned items for a session
  app.get("/api/scanned-items/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      console.log('Getting scanned items for session:', sessionId);

      const scannedItems = await storage.getScannedItems(sessionId);
      
      // Get full product details for each scanned item
      const itemsWithDetails = await Promise.all(
        scannedItems.map(async (item) => {
          // Use barcode to find product instead of liquorRecordId to handle data reloads
          const product = await storage.findLiquorByBarcode(item.scannedBarcode);
          return {
            ...item,
            product: product || null,
          };
        })
      );

      res.json({
        success: true,
        sessionId,
        items: itemsWithDetails,
        totalCount: itemsWithDetails.length,
      });
    } catch (error) {
      console.error("Get scanned items error:", error);
      
      res.status(500).json({
        success: false,
        error: "Failed to get scanned items",
      });
    }
  });

  // Delete individual scanned item
  app.delete("/api/scanned-items/:sessionId/:itemId", async (req, res) => {
    try {
      const { itemId } = req.params;
      console.log('Deleting scanned item:', itemId);

      const deleted = await storage.deleteScannedItem(itemId);
      
      if (deleted) {
        res.json({
          success: true,
          message: "Item deleted",
        });
      } else {
        res.status(404).json({
          success: false,
          error: "Item not found",
        });
      }
    } catch (error) {
      console.error("Delete item error:", error);
      
      res.status(500).json({
        success: false,
        error: "Failed to delete item",
      });
    }
  });

  // Clear scanned items for a session
  app.delete("/api/scanned-items/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      console.log('Clearing scanned items for session:', sessionId);

      await storage.clearScannedItems(sessionId);
      
      res.json({
        success: true,
        message: "Scanned items cleared",
      });
    } catch (error) {
      console.error("Clear scanned items error:", error);
      
      res.status(500).json({
        success: false,
        error: "Failed to clear scanned items",
      });
    }
  });

  // Update scanned item price
  app.patch("/api/update-item-price", async (req, res) => {
    try {
      const { sessionId, itemId, newPrice } = req.body;
      
      if (!sessionId || !itemId || newPrice === undefined) {
        return res.status(400).json({
          success: false,
          error: "Session ID, item ID, and new price are required",
        });
      }

      const updated = await storage.updateScannedItemPrice(itemId, newPrice);
      
      if (updated) {
        res.json({
          success: true,
          message: "Item price updated",
        });
      } else {
        res.status(404).json({
          success: false,
          error: "Item not found",
        });
      }
    } catch (error) {
      console.error("Update item price error:", error);
      
      res.status(500).json({
        success: false,
        error: "Failed to update item price",
      });
    }
  });

  // Upload custom name mapping file
  app.post("/api/upload-custom-names", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log('Processing custom name mapping file:', {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });

      // Clear existing mappings first
      await storage.clearCustomNameMappings();

      let worksheetData: any[][] = [];

      if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
        // Parse CSV file
        const content = req.file.buffer.toString('utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          const columns = line.split(',').map(col => col.trim().replace(/["']/g, ''));
          if (columns.length >= 2) {
            worksheetData.push(columns);
          }
        }
      } else if (req.file.mimetype.includes('sheet') || req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls')) {
        // Parse Excel file
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        worksheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      } else {
        return res.status(400).json({ error: "Unsupported file format. Please upload CSV or Excel files." });
      }

      let mappingsAdded = 0;
      let skippedRows = 0;
      
      if (worksheetData.length === 0) {
        return res.status(400).json({ error: "File appears to be empty" });
      }
      
      // Auto-detect column indices for UPC and Name
      let upcColumnIndex = -1;
      let nameColumnIndex = -1;
      let startRow = 0;
      
      // Check if first row contains headers
      const firstRow = worksheetData[0];
      const hasHeaders = firstRow.some(cell => {
        const cellStr = String(cell || '').toLowerCase();
        return cellStr.includes('upc') || cellStr.includes('name') || cellStr.includes('description') || cellStr.includes('brand');
      });
      
      if (hasHeaders) {
        startRow = 1;
        
        // Find UPC column
        for (let i = 0; i < firstRow.length; i++) {
          const header = String(firstRow[i] || '').toLowerCase().trim();
          if (header.includes('upc') || header.includes('barcode') || header.includes('code')) {
            upcColumnIndex = i;
            break;
          }
        }
        
        // Find Name column
        for (let i = 0; i < firstRow.length; i++) {
          const header = String(firstRow[i] || '').toLowerCase().trim();
          if (header.includes('name') || header.includes('description') || header.includes('brand') || header.includes('product')) {
            nameColumnIndex = i;
            break;
          }
        }
        
        console.log('Column detection:', {
          headers: firstRow,
          upcColumn: firstRow[upcColumnIndex] || 'not found',
          nameColumn: firstRow[nameColumnIndex] || 'not found',
          upcIndex: upcColumnIndex,
          nameIndex: nameColumnIndex
        });
      }
      
      // Fallback to first two columns if headers not found or detection failed
      if (upcColumnIndex === -1 || nameColumnIndex === -1) {
        console.log('Using fallback: first two columns');
        upcColumnIndex = 0;
        nameColumnIndex = 1;
        startRow = hasHeaders ? 1 : 0;
      }

      for (let i = startRow; i < worksheetData.length; i++) {
        const row = worksheetData[i];
        if (row && row.length > Math.max(upcColumnIndex, nameColumnIndex)) {
          const upcCode = String(row[upcColumnIndex] || '').trim();
          const customName = String(row[nameColumnIndex] || '').trim();
          
          if (upcCode && customName) {
            await storage.addCustomNameMapping({
              upcCode,
              customName
            });
            mappingsAdded++;
          } else {
            skippedRows++;
          }
        } else {
          skippedRows++;
        }
      }

      console.log('Custom name mapping upload complete:', {
        mappingsAdded,
        skippedRows,
        totalRows: worksheetData.length,
        sampleMappings: mappingsAdded > 0 ? `${String(worksheetData[startRow]?.[upcColumnIndex] || '').trim()} -> ${String(worksheetData[startRow]?.[nameColumnIndex] || '').trim()}` : 'none'
      });

      res.json({
        success: true,
        mappingsUploaded: mappingsAdded,
        skippedRows,
        totalRows: worksheetData.length
      });

    } catch (error) {
      console.error('Error processing custom name mapping file:', error);
      res.status(500).json({ 
        error: "Failed to process file",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Clear custom name mappings
  app.delete("/api/clear-custom-names", async (req, res) => {
    try {
      await storage.clearCustomNameMappings();
      console.log('All custom name mappings cleared');
      res.json({ success: true, message: "Custom name mappings cleared" });
    } catch (error) {
      console.error('Error clearing custom name mappings:', error);
      res.status(500).json({ 
        error: "Failed to clear custom name mappings",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get custom name mappings count
  app.get("/api/custom-names", async (req, res) => {
    try {
      const mappings = await storage.getCustomNameMappings();
      res.json({ 
        success: true, 
        count: mappings.length,
        mappings: mappings 
      });
    } catch (error) {
      console.error('Error fetching custom name mappings:', error);
      res.status(500).json({ 
        error: "Failed to fetch custom name mappings",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Generate Excel file
  app.post("/api/generate-excel", async (req, res) => {
    try {
      const { records, filename } = req.body;
      
      console.log('Excel generation request:', {
        recordsCount: records?.length,
        filename,
        sampleRecord: records?.[0]
      });
      
      if (!records || !Array.isArray(records)) {
        console.error('Invalid records data for Excel generation');
        return res.status(400).json({ error: "Invalid records data" });
      }

      if (records.length === 0) {
        console.error('Empty records array for Excel generation');
        return res.status(400).json({ error: "No data to export" });
      }

      console.log('Processing', records.length, 'records for Excel export');

      // Check if this is scanned items data (has different format)
      const isScannedItemsData = records[0] && records[0]["ADA Number"] !== undefined;
      
      let worksheetData;
      
      if (isScannedItemsData) {
        // Handle scanned items format
        console.log('Generating Excel for scanned items');
        worksheetData = [
          [
            "LIQUOR CODE", "BRAND NAME", "ADA NUMBER", "ADA NAME", "VENDOR NAME", "PROOF", "BOTTLE SIZE", 
            "PACK SIZE", "ON PREMISE", "OFF PREMISE", "SHELF PRICE", 
            "UPC CODE 1", "UPC CODE 2", "EFFECTIVE DATE"
          ],
          ...records.map(record => [
            record["Liquor Code"],
            record["Brand Name"],
            record["ADA Number"],
            record["ADA Name"],
            record["Vendor Name"],
            record["Proof"],
            record["Bottle Size"],
            record["Pack Size"],
            record["On Premise"],
            record["Off Premise"],
            record["Shelf Price"],
            record["UPC Code 1"],
            record["UPC Code 2"],
            record["Effective Date"],
          ])
        ];
      } else {
        // Handle original liquor data format
        console.log('Generating Excel for liquor data');
        worksheetData = [
          [
            "LIQUOR CODE", "BRAND NAME", "ADA NUMBER", "ADA NAME", "VENDOR NAME",
            "PROOF", "BOTTLE SIZE", "PACK SIZE", "ON PREMISE PRICE", "OFF PREMISE PRICE",
            "SHELF PRICE", "UPC CODE 1", "UPC CODE 2", "EFFECTIVE DATE"
          ],
          ...records.map(record => [
            record.liquorCode,
            record.brandName,
            record.adaNumber,
            record.adaName,
            record.vendorName,
            record.proof,
            record.bottleSize,
            record.packSize,
            record.onPremisePrice,
            record.offPremisePrice,
            record.shelfPrice,
            record.upcCode1,
            record.upcCode2,
            record.effectiveDate,
          ])
        ];
      }

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
      
      // Add worksheet to workbook
      const sheetName = isScannedItemsData ? "Scanned Items" : "Liquor Data";
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      
      // Generate Excel buffer
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      console.log('Excel buffer created, size:', excelBuffer.length, 'bytes');
      
      // Set headers for file download
      const outputFilename = filename || 
        (isScannedItemsData ? "scanned_liquor.xlsx" : "liquor_data.xlsx");
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
      res.setHeader('Content-Length', excelBuffer.length);
      
      res.send(excelBuffer);
    } catch (error) {
      console.error("Excel generation error:", error);
      res.status(500).json({ 
        error: "Failed to generate Excel file",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Fetch liquor data directly from Michigan state website
  app.post("/api/fetch-liquor-data", async (req, res) => {
    console.log('Fetching liquor data from Michigan state website...');
    
    try {
      const url = 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/Price-Book/May-2-2026-Price-Book-TXT.txt?rev=0c6b278ff50242b7917b090cc9f6bbc2&hash=CDD79D3A69C5876AEA62FF8E0756ADEA';
      console.log('Downloading from:', url);
      
      // Fetch the data from the website with a browser User-Agent to avoid blocks
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const fileContent = await response.text();
      console.log('Downloaded content, length:', fileContent.length);
      
      const allLines = fileContent.split('\n').filter((line: string) => line.trim());
      // Skip header row (TSV format has a header)
      const lines = allLines[0]?.toLowerCase().includes('liquor code') ? allLines.slice(1) : allLines;
      console.log('File parsed, data lines:', lines.length);
      
      const records = [];
      const brands = new Set();
      const vendors = new Set();
      const prices: number[] = [];

      for (const line of lines) {
        if (line.trim()) {
          const record = parseTsvLine(line);
          if (!record.liquorCode) continue;
          records.push(record);
          
          if (record.brandName) brands.add(record.brandName);
          if (record.vendorName) vendors.add(record.vendorName);
          
          // Collect prices for average calculation
          if (typeof record.shelfPrice === 'number') {
            prices.push(record.shelfPrice);
          }
        }
      }

      const avgPrice = prices.length > 0 
        ? prices.reduce((sum, price) => sum + price, 0) / prices.length 
        : 0;

      // Clear existing records and save new ones to storage
      await storage.clearLiquorRecords();
      console.log('Cleared existing liquor records');
      
      for (const record of records) {
        await storage.createLiquorRecord(record);
      }
      console.log(`Saved ${records.length} liquor records to storage`);

      const result = {
        success: true,
        totalRecords: records.length,
        uniqueBrands: brands.size,
        uniqueVendors: vendors.size,
        avgPrice: Number(avgPrice.toFixed(2)),
        records: records.slice(0, 100), // Return first 100 for preview
        allRecords: records, // Include all records for download
        source: 'Michigan State Website',
        url: url,
        fetchedAt: new Date().toISOString(),
      };

      console.log('Data fetch and processing complete:', result.totalRecords, 'records processed');
      res.json(result);
    } catch (error) {
      console.error("Data fetch error:", error);
      
      // Check if response was already sent
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: "Failed to fetch liquor data from website",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });

  // Add item directly (for manual search selections)
  app.post("/api/add-item", async (req, res) => {
    try {
      const { liquorRecordId, sessionId, scannedBarcode } = req.body;
      console.log('Adding item directly:', { liquorRecordId, sessionId, scannedBarcode });

      if (!liquorRecordId || !sessionId) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields",
        });
      }

      // Get the liquor record
      const allRecords = await storage.getLiquorRecords();
      const liquorRecord = allRecords.find(r => r.id === liquorRecordId);
      
      if (!liquorRecord) {
        return res.status(404).json({
          success: false,
          error: "Liquor record not found",
        });
      }

      // Add to scanned items
      await storage.addScannedItem({
        sessionId,
        liquorRecordId: liquorRecord.id,
        scannedBarcode: scannedBarcode ? toBottleBarcode(scannedBarcode) : (liquorRecord.upcCode1 ? toBottleBarcode(liquorRecord.upcCode1) : 'manual-search'),
        scannedAt: new Date().toISOString(),
        quantity: 1,
      });

      res.json({
        success: true,
        message: "Item added successfully",
        liquorRecord,
      });
    } catch (error) {
      console.error("Add item error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to add item",
      });
    }
  });

  // Search endpoint for liquor lookup by code, UPC, or name
  app.get("/api/search-liquor", async (req, res) => {
    try {
      const { query } = req.query;
      
      if (!query || typeof query !== 'string' || query.length < 2) {
        return res.json({
          success: true,
          results: [],
          message: "Query too short"
        });
      }

      console.log('Searching liquor records for:', query);
      
      const allRecords = await storage.getLiquorRecords();
      const searchTerm = query.toLowerCase().trim();
      
      // Helper function to normalize UPC codes by removing leading zeros
      const normalizeUpc = (upc: string | null): string => {
        if (!upc) return '';
        return upc.replace(/^0+/, '') || '0';
      };
      
      const normalizedSearchTerm = normalizeUpc(searchTerm);
      
      const results = allRecords.filter(record => {
        // Search by liquor code
        if (record.liquorCode?.toLowerCase().includes(searchTerm)) return true;
        
        // Search by brand name
        if (record.brandName?.toLowerCase().includes(searchTerm)) return true;
        
        // Search by UPC codes (exact and normalized)
        const normalizedUpc1 = normalizeUpc(record.upcCode1);
        const normalizedUpc2 = normalizeUpc(record.upcCode2);
        
        if (record.upcCode1?.includes(searchTerm) || 
            record.upcCode2?.includes(searchTerm) ||
            normalizedUpc1.includes(normalizedSearchTerm) ||
            normalizedUpc2.includes(normalizedSearchTerm)) {
          return true;
        }
        
        // Search by vendor name
        if (record.vendorName?.toLowerCase().includes(searchTerm)) return true;
        
        return false;
      });

      // Limit results to first 10 for dropdown
      const limitedResults = results.slice(0, 10);
      
      console.log(`Found ${results.length} results, returning first ${limitedResults.length}`);
      
      res.json({
        success: true,
        results: limitedResults,
        totalFound: results.length
      });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to search liquor records"
      });
    }
  });

  // Generate printable labels for Brother QL printer
  app.post("/api/generate-labels", async (req, res) => {
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: "Session ID is required",
        });
      }

      // Get scanned items with product details
      const scannedItems = await storage.getScannedItems(sessionId);
      const liquorRecords = await storage.getLiquorRecords();
      
      const itemsWithDetails = scannedItems
        .map(item => {
          const product = liquorRecords.find(r => r.id === item.liquorRecordId);
          return product ? {
            ...item,
            product
          } : null;
        })
        .filter(item => item !== null);

      if (itemsWithDetails.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No items to print",
        });
      }

      // Generate HTML for Brother QL printer labels (2.4" x 1.2")
      const labelHtml = generateLabelHTML(itemsWithDetails);
      
      res.setHeader('Content-Type', 'text/html');
      res.send(labelHtml);
    } catch (error) {
      console.error("Generate labels error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate labels",
      });
    }
  });

  // Session management routes
  
  // Get all sessions  
  app.get("/api/sessions", async (req, res) => {
    try {
      const sessions = await storage.getSessions();
      res.json({ success: true, sessions });
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get sessions",
      });
    }
  });

  // Create a new session
  app.post("/api/sessions", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({
          success: false,
          error: "Session name is required",
        });
      }

      const session = await storage.createSession({ 
        name,
        itemCount: 0,
        isActive: 1 
      });
      
      res.json({ success: true, session });
    } catch (error) {
      console.error("Create session error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create session",
      });
    }
  });

  // Get active session
  app.get("/api/sessions/active", async (req, res) => {
    try {
      const activeSession = await storage.getActiveSession();
      res.json({ success: true, session: activeSession });
    } catch (error) {
      console.error("Get active session error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get active session",
      });
    }
  });

  // Set active session
  app.post("/api/sessions/:sessionId/activate", async (req, res) => {
    try {
      const { sessionId } = req.params;
      await storage.setActiveSession(sessionId);
      const session = await storage.getSession(sessionId);
      res.json({ success: true, session });
    } catch (error) {
      console.error("Set active session error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to set active session",
      });
    }
  });

  // Delete a session
  app.delete("/api/sessions/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const deleted = await storage.deleteSession(sessionId);
      if (deleted) {
        res.json({ success: true, message: "Session deleted" });
      } else {
        res.status(404).json({
          success: false,
          error: "Session not found",
        });
      }
    } catch (error) {
      console.error("Delete session error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete session",
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
