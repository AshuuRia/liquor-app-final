import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as XLSX from "xlsx";
import { isAuthenticated, fetchClerkUser } from "./clerkAuth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fieldSize: 50 * 1024 * 1024 },
  fileFilter: (_req, _file, cb) => cb(null, true),
});

// ── Label HTML generator ───────────────────────────────────────────────────────

function generateLabelHTML(items: any[]) {
  const labelCSS = `
    <style>
      @page { size: 2.4in 1.2in; margin: 0; }
      @media print {
        body { margin:0; padding:0; font-family:Arial,sans-serif; }
        .label { width:2.4in; height:1.2in; padding:0.05in; border:1px solid #000; box-sizing:border-box; page-break-after:always; display:flex; flex-direction:column; position:relative; }
        .label:last-child { page-break-after:avoid; }
        .label-header { font-weight:bold; font-size:11px; text-align:center; line-height:1.1; margin-bottom:0.02in; }
        .label-body { flex:1; display:flex; align-items:center; justify-content:space-between; }
        .barcode-section { flex:1; display:flex; align-items:center; }
        .barcode { font-family:'Libre Barcode 128',monospace; font-size:20px; letter-spacing:0; line-height:1; writing-mode:horizontal-tb; }
        .price-section { font-weight:bold; font-size:16px; text-align:right; margin-left:0.1in; }
        .label-footer { position:absolute; bottom:0.05in; right:0.05in; font-size:8px; font-weight:bold; }
        .no-print { display:none !important; }
      }
      @media screen {
        body { font-family:Arial,sans-serif; padding:20px; background:#f0f0f0; }
        .print-instructions { background:#e3f2fd; border:1px solid #1976d2; border-radius:4px; padding:15px; margin-bottom:20px; }
        .label { width:240px; height:120px; padding:5px; border:2px solid #000; box-sizing:border-box; margin:10px; display:inline-flex; flex-direction:column; position:relative; background:white; }
        .label-header { font-weight:bold; font-size:11px; text-align:center; line-height:1.1; margin-bottom:2px; }
        .label-body { flex:1; display:flex; align-items:center; justify-content:space-between; }
        .barcode-section { flex:1; display:flex; align-items:center; }
        .barcode { font-family:monospace; font-size:8px; letter-spacing:1px; line-height:1; background:repeating-linear-gradient(90deg,#000 0px,#000 1px,#fff 1px,#fff 2px); color:transparent; padding:5px 0; }
        .price-section { font-weight:bold; font-size:16px; text-align:right; margin-left:10px; }
        .label-footer { position:absolute; bottom:5px; right:5px; font-size:8px; font-weight:bold; }
      }
    </style>`;

  const labelElements = items.map((item: any) => {
    const product = item.product;
    const brandWithSize = `${product.brandName} ${product.bottleSize}`;
    const price = typeof product.shelfPrice === 'number' ? `$${product.shelfPrice.toFixed(2)}` : product.shelfPrice;
    const barcode = item.scannedBarcode || product.upcCode1 || '';
    return `<div class="label">
      <div class="label-header">${brandWithSize}</div>
      <div class="label-body">
        <div class="barcode-section"><div class="barcode">${barcode}</div></div>
        <div class="price-section">${price}</div>
      </div>
      <div class="label-footer">${product.liquorCode}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Liquor Shelf Labels</title>${labelCSS}
    <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
    </head><body>
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
    ${labelElements}</body></html>`;
}

// ── TSV parser ─────────────────────────────────────────────────────────────────

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

function toBottleBarcode(barcode: string): string {
  if (/^\d+$/.test(barcode)) {
    if (barcode.length === 14 && barcode.startsWith('00')) return barcode.slice(2);
    if (barcode.length === 13 && barcode.startsWith('0'))  return barcode.slice(1);
  }
  return barcode;
}

// ── CSV parser for compare-prices ─────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// ── getUserId helper ───────────────────────────────────────────────────────────

function getUserId(req: any): string {
  return req.clerkUserId as string;
}

// ── Route registration ─────────────────────────────────────────────────────────

export async function registerRoutes(app: Express): Promise<Server> {

  // ── Config — tells the frontend to use Clerk ──────────────────────────────────
  app.get("/api/config", (_req, res) => {
    res.json({ clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || null });
  });

  // ── Auth user — fetches profile from Clerk API ────────────────────────────────
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const user = await fetchClerkUser(req.clerkUserId);
      res.json(user);
    } catch {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ── Michigan data import (no auth required — anyone can refresh the shared DB) ──

  app.post("/api/process-file", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
      const fileContent = req.file.buffer.toString('utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      const records = [];
      const brands = new Set<string>();
      const vendors = new Set<string>();
      const prices: number[] = [];
      for (const line of lines) {
        const record = parseTsvLine(line);
        if (!record.liquorCode) continue;
        records.push(record);
        if (record.brandName) brands.add(record.brandName);
        if (record.vendorName) vendors.add(record.vendorName);
        if (typeof record.shelfPrice === 'number') prices.push(record.shelfPrice);
      }
      const avgPrice = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
      await storage.clearLiquorRecords();
      await storage.bulkCreateLiquorRecords(records);
      res.json({ success: true, totalRecords: records.length, uniqueBrands: brands.size, uniqueVendors: vendors.size, avgPrice: Number(avgPrice.toFixed(2)), records: records.slice(0, 100) });
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ success: false, error: "Failed to process file" });
    }
  });

  app.post("/api/fetch-liquor-data", async (req, res) => {
    console.log('Fetching liquor data from Michigan state website...');
    try {
      const michiganUrl = 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/Price-Book/May-2-2026-Price-Book-TXT.txt?rev=0c6b278ff50242b7917b090cc9f6bbc2&hash=CDD79D3A69C5876AEA62FF8E0756ADEA';
      console.log('Downloading from:', michiganUrl);
      const response = await fetch(michiganUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
      const fileContent = await response.text();
      console.log('Downloaded content, length:', fileContent.length);
      const allLines = fileContent.split('\n').filter((line: string) => line.trim());
      const lines = allLines[0]?.toLowerCase().includes('liquor code') ? allLines.slice(1) : allLines;
      console.log('File parsed, data lines:', lines.length);
      const records = [];
      const brands = new Set<string>();
      const vendors = new Set<string>();
      const prices: number[] = [];
      for (const line of lines) {
        const record = parseTsvLine(line);
        if (!record.liquorCode) continue;
        records.push(record);
        if (record.brandName) brands.add(record.brandName);
        if (record.vendorName) vendors.add(record.vendorName);
        if (typeof record.shelfPrice === 'number') prices.push(record.shelfPrice);
      }
      const avgPrice = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;
      await storage.clearLiquorRecords();
      console.log('Cleared existing liquor records');
      await storage.bulkCreateLiquorRecords(records);
      console.log(`Saved ${records.length} liquor records to storage`);
      console.log('Data fetch and processing complete:', records.length, 'records processed');
      res.json({ success: true, totalRecords: records.length, uniqueBrands: brands.size, uniqueVendors: vendors.size, avgPrice: Number(avgPrice.toFixed(2)) });
    } catch (error) {
      console.error("Data fetch error:", error);
      if (!res.headersSent) res.status(500).json({ success: false, error: "Failed to fetch liquor data", details: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // ── Public read endpoints (no auth required) ──────────────────────────────────

  app.get("/api/search-liquor", async (req, res) => {
    try {
      const { query } = req.query;
      if (!query || typeof query !== 'string' || query.length < 2) return res.json({ success: true, results: [], message: "Query too short" });
      const { results, totalFound } = await storage.searchLiquorRecords(query.trim(), 10);
      res.json({ success: true, results, totalFound });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to search liquor records" });
    }
  });

  // ── Barcode scan ──────────────────────────────────────────────────────────────

  app.post("/api/scan-barcode", isAuthenticated, async (req: any, res) => {
    try {
      const { barcode, sessionId } = req.body;
      if (!barcode) return res.status(400).json({ success: false, error: "No barcode provided" });

      const allRecords = await storage.getLiquorRecords();
      if (barcode === 'test-check-only') {
        return res.json({ success: false, barcode, error: "Status check only", totalRecords: allRecords.length });
      }

      const matchedProducts = await storage.findAllLiquorByBarcode(barcode);
      if (matchedProducts.length === 0) return res.json({ success: false, barcode, error: "Product not found in database" });

      if (matchedProducts.length > 1) {
        return res.json({ success: true, requiresSelection: true, barcode, matchedProducts });
      }

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
      res.json({ success: true, requiresSelection: false, barcode, matchedProduct });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to process barcode scan" });
    }
  });

  // ── Scanned items ─────────────────────────────────────────────────────────────

  app.get("/api/scanned-items/:sessionId", isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId } = req.params;
      const scannedItems = await storage.getScannedItems(sessionId);
      const itemsWithDetails = await Promise.all(
        scannedItems.map(async (item) => {
          const product = await storage.findLiquorByBarcode(item.scannedBarcode);
          return {
            ...item,
            product: product ? {
              ...product,
              shelfPrice: (item.overridePrice !== null && item.overridePrice !== undefined)
                ? item.overridePrice
                : product.shelfPrice,
            } : null,
          };
        })
      );
      res.json({ success: true, sessionId, items: itemsWithDetails, totalCount: itemsWithDetails.length });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to get scanned items" });
    }
  });

  app.delete("/api/scanned-items/:sessionId/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      const { itemId } = req.params;
      const deleted = await storage.deleteScannedItem(itemId);
      if (deleted) {
        res.json({ success: true, message: "Item deleted" });
      } else {
        res.status(404).json({ success: false, error: "Item not found" });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to delete item" });
    }
  });

  app.delete("/api/scanned-items/:sessionId", isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId } = req.params;
      await storage.clearScannedItems(sessionId);
      res.json({ success: true, message: "Scanned items cleared" });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to clear scanned items" });
    }
  });

  app.patch("/api/update-item-price", isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId, itemId, newPrice } = req.body;
      if (!sessionId || !itemId || newPrice === undefined) {
        return res.status(400).json({ success: false, error: "Session ID, item ID, and new price are required" });
      }
      const updated = await storage.updateScannedItemPrice(itemId, newPrice);
      if (updated) {
        res.json({ success: true, message: "Item price updated" });
      } else {
        res.status(404).json({ success: false, error: "Item not found" });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to update item price" });
    }
  });

  // ── Custom name mappings ──────────────────────────────────────────────────────

  app.post("/api/upload-custom-names", isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const userId = getUserId(req);
      await storage.clearCustomNameMappings(userId);

      let worksheetData: any[][] = [];
      if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
        const content = req.file.buffer.toString('utf-8');
        const lines = content.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          const cols = line.split(',').map((c: string) => c.trim().replace(/["']/g, ''));
          if (cols.length >= 2) worksheetData.push(cols);
        }
      } else if (req.file.mimetype.includes('sheet') || req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls')) {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const ws = workbook.Sheets[workbook.SheetNames[0]];
        worksheetData = XLSX.utils.sheet_to_json(ws, { header: 1 });
      } else {
        return res.status(400).json({ error: "Unsupported file format. Please upload CSV or Excel files." });
      }

      if (worksheetData.length === 0) return res.status(400).json({ error: "File appears to be empty" });

      let upcColumnIndex = -1;
      let nameColumnIndex = -1;
      let startRow = 0;
      const firstRow = worksheetData[0];
      const hasHeaders = firstRow.some((cell: any) => {
        const s = String(cell || '').toLowerCase();
        return s.includes('upc') || s.includes('name') || s.includes('description') || s.includes('brand');
      });

      if (hasHeaders) {
        startRow = 1;
        for (let i = 0; i < firstRow.length; i++) {
          const h = String(firstRow[i] || '').toLowerCase().trim();
          if (h.includes('upc') || h.includes('barcode') || h.includes('code')) { upcColumnIndex = i; break; }
        }
        for (let i = 0; i < firstRow.length; i++) {
          const h = String(firstRow[i] || '').toLowerCase().trim();
          if (h.includes('name') || h.includes('description') || h.includes('brand')) { nameColumnIndex = i; break; }
        }
      }
      if (upcColumnIndex === -1) upcColumnIndex = 0;
      if (nameColumnIndex === -1) nameColumnIndex = 1;

      let mappingsAdded = 0;
      let skippedRows = 0;
      for (let i = startRow; i < worksheetData.length; i++) {
        const row = worksheetData[i];
        const upcCode = String(row[upcColumnIndex] || '').trim().replace(/[="]/g, '');
        const customName = String(row[nameColumnIndex] || '').trim();
        if (!upcCode || !customName) { skippedRows++; continue; }
        await storage.addCustomNameMapping({ upcCode, customName }, userId);
        mappingsAdded++;
      }
      res.json({ success: true, mappingsAdded, skippedRows, message: `Added ${mappingsAdded} custom name mappings` });
    } catch (error) {
      console.error("Upload custom names error:", error);
      res.status(500).json({ error: "Failed to process file" });
    }
  });

  // ── Custom name mappings (JSON) — used by more-page inline CSV parser ─────────
  app.post("/api/custom-names", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { mappings } = req.body as { mappings: { upcCode: string; customName: string }[] };
      if (!Array.isArray(mappings) || mappings.length === 0) {
        return res.status(400).json({ success: false, error: "mappings array is required" });
      }
      await storage.clearCustomNameMappings(userId);
      for (const { upcCode, customName } of mappings) {
        if (upcCode && customName) {
          await storage.addCustomNameMapping({ upcCode, customName }, userId);
        }
      }
      res.json({ success: true, mappingsAdded: mappings.length });
    } catch (error) {
      console.error("Custom names error:", error);
      res.status(500).json({ success: false, error: "Failed to save custom name mappings" });
    }
  });

  app.get("/api/custom-name-mappings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const mappings = await storage.getCustomNameMappings(userId);
      res.json({ success: true, mappings });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to get custom name mappings" });
    }
  });

  app.get("/api/custom-names", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const mappings = await storage.getCustomNameMappings(userId);
      res.json({ success: true, count: mappings.length, mappings });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to get custom name mappings" });
    }
  });

  app.delete("/api/clear-custom-names", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      await storage.clearCustomNameMappings(userId);
      res.json({ success: true, message: "Custom name mappings cleared" });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to clear custom name mappings" });
    }
  });

  app.post("/api/generate-excel", isAuthenticated, async (req: any, res) => {
    try {
      const { records, filename } = req.body;
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ success: false, error: "No records provided" });
      }
      const ws = XLSX.utils.json_to_sheet(records);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scanned Items");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename || "export.xlsx"}"`);
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to generate Excel file" });
    }
  });

  // ── Add item directly ─────────────────────────────────────────────────────────

  app.post("/api/add-item", isAuthenticated, async (req: any, res) => {
    try {
      const { liquorRecordId, sessionId, scannedBarcode } = req.body;
      if (!liquorRecordId || !sessionId) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
      }
      const allRecords = await storage.getLiquorRecords();
      const liquorRecord = allRecords.find(r => r.id === liquorRecordId);
      if (!liquorRecord) return res.status(404).json({ success: false, error: "Liquor record not found" });
      await storage.addScannedItem({
        sessionId,
        liquorRecordId: liquorRecord.id,
        scannedBarcode: scannedBarcode ? toBottleBarcode(scannedBarcode) : (liquorRecord.upcCode1 ? toBottleBarcode(liquorRecord.upcCode1) : 'manual-search'),
        scannedAt: new Date().toISOString(),
        quantity: 1,
      });
      res.json({ success: true, message: "Item added successfully", liquorRecord });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to add item" });
    }
  });

  // ── Label generation ──────────────────────────────────────────────────────────

  app.post("/api/generate-labels", isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ success: false, error: "Session ID is required" });
      const scannedItems = await storage.getScannedItems(sessionId);
      const liquorRecords = await storage.getLiquorRecords();
      const itemsWithDetails = scannedItems
        .map(item => {
          const product = liquorRecords.find(r => r.id === item.liquorRecordId);
          return product ? { ...item, product } : null;
        })
        .filter(item => item !== null);
      if (itemsWithDetails.length === 0) return res.status(400).json({ success: false, error: "No items to print" });
      const labelHtml = generateLabelHTML(itemsWithDetails);
      res.setHeader('Content-Type', 'text/html');
      res.send(labelHtml);
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to generate labels" });
    }
  });

  // ── Session management ────────────────────────────────────────────────────────

  app.get("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const sessions = await storage.getSessions(userId);
      res.json({ success: true, sessions });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to get sessions" });
    }
  });

  app.post("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: "Session name is required" });
      const session = await storage.createSession({ name, itemCount: 0, isActive: 1 }, userId);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to create session" });
    }
  });

  app.get("/api/sessions/active", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const activeSession = await storage.getActiveSession(userId);
      res.json({ success: true, session: activeSession });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to get active session" });
    }
  });

  app.post("/api/sessions/:sessionId/activate", isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId } = req.params;
      await storage.setActiveSession(sessionId);
      const session = await storage.getSession(sessionId);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to set active session" });
    }
  });

  app.delete("/api/sessions/:sessionId", isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId } = req.params;
      const deleted = await storage.deleteSession(sessionId);
      if (deleted) {
        res.json({ success: true, message: "Session deleted" });
      } else {
        res.status(404).json({ success: false, error: "Session not found" });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to delete session" });
    }
  });

  // ── Price comparison ──────────────────────────────────────────────────────────

  app.post("/api/compare-prices", isAuthenticated, async (req: any, res) => {
    try {
      const { csvText } = req.body;
      if (!csvText) return res.status(400).json({ success: false, error: "No CSV text provided" });

      const dbCount = await storage.getLiquorRecordCount();
      if (dbCount === 0) return res.json({ success: true, rows: [], totalRows: 0, dbEmpty: true });

      const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
      if (lines.length < 2) return res.status(400).json({ success: false, error: "CSV appears empty" });

      const header = parseCsvLine(lines[0]).map((h: string) => h.toLowerCase().trim());
      const col = (name: string) => header.indexOf(name);
      const upcIdx   = col('upc');
      const nameIdx  = col('name');
      const priceIdx = col('price');
      const centsIdx = col('cents');
      const deptIdx  = col('department');
      const sizeIdx  = col('size');

      if (upcIdx === -1 || nameIdx === -1) {
        return res.status(400).json({ success: false, error: "CSV missing required Upc or Name columns. Make sure you're uploading a P-touch CSV export." });
      }

      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length < 2) continue;
        const stripExcel = (v: string) => v.replace(/[="]/g, '').trim();
        const rawUpc   = stripExcel((fields[upcIdx]  || '').trim());
        const rawName  = (fields[nameIdx] || '').trim();
        const rawPrice = priceIdx >= 0 ? (fields[priceIdx] || '').trim() : '';
        const rawCents = centsIdx >= 0 ? (fields[centsIdx] || '').trim() : '';
        const dept     = deptIdx >= 0  ? (fields[deptIdx]  || '').trim() : 'Liquor';
        const sizeCode = stripExcel(sizeIdx >= 0 ? (fields[sizeIdx] || '').trim() : '');
        if (!rawUpc && !rawName) continue;
        let registerPrice = 0;
        if (rawCents) registerPrice = parseInt(rawCents, 10) / 100;
        else if (rawPrice) registerPrice = parseFloat(rawPrice.replace(/[^0-9.]/g, '')) || 0;

        let matches = await storage.findAllLiquorByBarcode(rawUpc);
        let matchedBy: 'upc' | 'code' | null = matches.length > 0 ? 'upc' : null;
        if (matches.length === 0 && sizeCode) {
          matches = await storage.findAllLiquorByCode(sizeCode);
          if (matches.length > 0) matchedBy = 'code';
        }

        const match = matches[0] || null;
        const michiganPrice = match?.shelfPrice ?? null;
        const priceDiff = michiganPrice !== null ? Math.round((michiganPrice - registerPrice) * 100) / 100 : null;

        rows.push({
          upc: rawUpc,
          name: rawName,
          registerPrice,
          department: dept,
          liquorCode: sizeCode,
          matched: !!match,
          matchedBy,
          multipleMatches: matches.length > 1,
          allMatches: matches.length > 1 ? matches : undefined,
          michiganPrice,
          michiganName: match ? `${match.brandName} ${match.bottleSize}` : null,
          michiganBottleSize: match?.bottleSize ?? null,
          michiganLiquorCode: match?.liquorCode ?? null,
          priceDiff,
        });
      }
      res.json({ success: true, rows, totalRows: rows.length });
    } catch (err) {
      console.error("compare-prices error:", err);
      res.status(500).json({ success: false, error: "Failed to compare prices" });
    }
  });

  // ── Price compare sessions (cloud save/load) ──────────────────────────────────

  app.get("/api/price-compare/session", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const session = await storage.getPriceCompareSession(userId);
      res.json({ success: true, session: session || null });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to load session" });
    }
  });

  app.post("/api/price-compare/session", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { fileName, rowsJson } = req.body;
      if (!fileName || !rowsJson) return res.status(400).json({ success: false, error: "fileName and rowsJson are required" });
      const session = await storage.savePriceCompareSession(userId, fileName, rowsJson);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to save session" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
