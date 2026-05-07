import { Hono } from 'hono';
import { DatabaseStorage } from '../../server/storage';
import { parseTsvLine, toBottleBarcode, generateLabelHTML, normalizeUpc } from '../../server/utils';
import * as XLSX from 'xlsx';

type Env = {
  Bindings: {
    DATABASE_URL: string;
  };
};

const app = new Hono<Env>().basePath('/api');

function getStorage(url: string) {
  return new DatabaseStorage(url);
}

// ── Michigan data helpers ─────────────────────────────────────────────────────

async function processTsvContent(content: string, storage: DatabaseStorage) {
  const allLines = content.split('\n').filter((l: string) => l.trim());
  const lines = allLines[0]?.toLowerCase().includes('liquor code') ? allLines.slice(1) : allLines;

  const records = [];
  const brands = new Set<string>();
  const vendors = new Set<string>();
  const prices: number[] = [];

  for (const line of lines) {
    if (line.trim()) {
      const record = parseTsvLine(line);
      if (!record.liquorCode) continue;
      records.push(record);
      if (record.brandName) brands.add(record.brandName);
      if (record.vendorName) vendors.add(record.vendorName);
      if (typeof record.shelfPrice === 'number') prices.push(record.shelfPrice);
    }
  }

  const avgPrice = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;

  await storage.clearLiquorRecords();
  await storage.bulkCreateLiquorRecords(records);

  return {
    success: true,
    totalRecords: records.length,
    uniqueBrands: brands.size,
    uniqueVendors: vendors.size,
    avgPrice: Number(avgPrice.toFixed(2)),
    records: records.slice(0, 100),
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Process file upload (TSV/text)
app.post('/process-file', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json({ success: false, error: 'No file uploaded' }, 400);

    const text = await file.text();
    const result = await processTsvContent(text, storage);
    return c.json(result);
  } catch (err) {
    return c.json({ success: false, error: 'Failed to process file', details: String(err) }, 500);
  }
});

// Process file content directly (JSON body)
app.post('/process-file-content', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { content } = await c.req.json<{ content: string; filename?: string }>();
    if (!content) return c.json({ success: false, error: 'No file content provided' }, 400);
    const result = await processTsvContent(content, storage);
    return c.json(result);
  } catch (err) {
    return c.json({ success: false, error: 'Failed to process file content', details: String(err) }, 500);
  }
});

// Scan barcode
app.post('/scan-barcode', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { barcode, sessionId } = await c.req.json<{ barcode: string; sessionId?: string }>();
    if (!barcode) return c.json({ success: false, error: 'No barcode provided' }, 400);

    if (barcode === 'test-check-only') {
      const count = await storage.getLiquorRecordCount();
      return c.json({ success: false, barcode, error: 'Status check only', totalRecords: count });
    }

    const matchedProducts = await storage.findAllLiquorByBarcode(barcode);

    if (matchedProducts.length === 0) {
      return c.json({ success: false, barcode, error: 'Product not found in database' });
    }

    if (matchedProducts.length > 1) {
      return c.json({ success: true, requiresSelection: true, barcode, matchedProducts });
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

    return c.json({ success: true, requiresSelection: false, barcode, matchedProduct });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to process barcode scan', details: String(err) }, 500);
  }
});

// Get scanned items
app.get('/scanned-items/:sessionId', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { sessionId } = c.req.param();
    const items = await storage.getScannedItems(sessionId);

    const itemsWithDetails = await Promise.all(
      items.map(async (item) => {
        const product = await storage.findLiquorByBarcode(item.scannedBarcode);
        return {
          ...item,
          product: product ? {
            ...product,
            shelfPrice: item.overridePrice !== null && item.overridePrice !== undefined
              ? item.overridePrice
              : product.shelfPrice,
          } : null,
        };
      })
    );

    return c.json({ success: true, sessionId, items: itemsWithDetails, totalCount: itemsWithDetails.length });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to get scanned items' }, 500);
  }
});

// Delete individual item
app.delete('/scanned-items/:sessionId/:itemId', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { itemId } = c.req.param();
    const deleted = await storage.deleteScannedItem(itemId);
    if (deleted) return c.json({ success: true, message: 'Item deleted' });
    return c.json({ success: false, error: 'Item not found' }, 404);
  } catch (err) {
    return c.json({ success: false, error: 'Failed to delete item' }, 500);
  }
});

// Clear all scanned items for session
app.delete('/scanned-items/:sessionId', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { sessionId } = c.req.param();
    await storage.clearScannedItems(sessionId);
    return c.json({ success: true, message: 'Scanned items cleared' });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to clear scanned items' }, 500);
  }
});

// Update item price
app.patch('/update-item-price', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { sessionId, itemId, newPrice } = await c.req.json<{ sessionId: string; itemId: string; newPrice: number }>();
    if (!sessionId || !itemId || newPrice === undefined) {
      return c.json({ success: false, error: 'Session ID, item ID, and new price are required' }, 400);
    }
    const updated = await storage.updateScannedItemPrice(itemId, newPrice);
    if (updated) return c.json({ success: true, message: 'Item price updated' });
    return c.json({ success: false, error: 'Item not found' }, 404);
  } catch (err) {
    return c.json({ success: false, error: 'Failed to update item price' }, 500);
  }
});

// Upload custom name mapping file
app.post('/upload-custom-names', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json({ error: 'No file uploaded' }, 400);

    await storage.clearCustomNameMappings();

    let worksheetData: any[][] = [];
    const filename = file.name || '';

    if (filename.endsWith('.csv') || file.type === 'text/csv') {
      const content = await file.text();
      const lines = content.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const columns = line.split(',').map(col => col.trim().replace(/["']/g, ''));
        if (columns.length >= 2) worksheetData.push(columns);
      }
    } else {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const workbook = XLSX.read(uint8, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      worksheetData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
    }

    if (worksheetData.length === 0) return c.json({ error: 'File appears to be empty' }, 400);

    const firstRow = worksheetData[0];
    const hasHeaders = firstRow.some((cell: any) => {
      const s = String(cell || '').toLowerCase();
      return s.includes('upc') || s.includes('name') || s.includes('description') || s.includes('brand');
    });

    let upcIdx = -1, nameIdx = -1, startRow = 0;

    if (hasHeaders) {
      startRow = 1;
      for (let i = 0; i < firstRow.length; i++) {
        const h = String(firstRow[i] || '').toLowerCase().trim();
        if (upcIdx === -1 && (h.includes('upc') || h.includes('barcode') || h.includes('code'))) upcIdx = i;
        if (nameIdx === -1 && (h.includes('name') || h.includes('description') || h.includes('brand') || h.includes('product'))) nameIdx = i;
      }
    }

    if (upcIdx === -1 || nameIdx === -1) { upcIdx = 0; nameIdx = 1; startRow = hasHeaders ? 1 : 0; }

    let mappingsAdded = 0, skippedRows = 0;
    for (let i = startRow; i < worksheetData.length; i++) {
      const row = worksheetData[i];
      if (row && row.length > Math.max(upcIdx, nameIdx)) {
        const upcCode = String(row[upcIdx] || '').trim();
        const customName = String(row[nameIdx] || '').trim();
        if (upcCode && customName) { await storage.addCustomNameMapping({ upcCode, customName }); mappingsAdded++; }
        else skippedRows++;
      } else skippedRows++;
    }

    return c.json({ success: true, mappingsUploaded: mappingsAdded, skippedRows, totalRows: worksheetData.length });
  } catch (err) {
    return c.json({ error: 'Failed to process file', details: String(err) }, 500);
  }
});

// Clear custom name mappings
app.delete('/clear-custom-names', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    await storage.clearCustomNameMappings();
    return c.json({ success: true, message: 'Custom name mappings cleared' });
  } catch (err) {
    return c.json({ error: 'Failed to clear custom name mappings', details: String(err) }, 500);
  }
});

// Get custom name mappings
app.get('/custom-names', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const mappings = await storage.getCustomNameMappings();
    return c.json({ success: true, count: mappings.length, mappings });
  } catch (err) {
    return c.json({ error: 'Failed to fetch custom name mappings', details: String(err) }, 500);
  }
});

// Generate Excel file
app.post('/generate-excel', async (c) => {
  try {
    const { records, filename } = await c.req.json<{ records: any[]; filename?: string }>();
    if (!records || !Array.isArray(records) || records.length === 0) {
      return c.json({ error: 'Invalid or empty records data' }, 400);
    }

    const isScannedItemsData = records[0] && records[0]["ADA Number"] !== undefined;

    let worksheetData: any[][];
    if (isScannedItemsData) {
      worksheetData = [
        ["LIQUOR CODE","BRAND NAME","ADA NUMBER","ADA NAME","VENDOR NAME","PROOF","BOTTLE SIZE","PACK SIZE","ON PREMISE","OFF PREMISE","SHELF PRICE","UPC CODE 1","UPC CODE 2","EFFECTIVE DATE"],
        ...records.map(r => [r["Liquor Code"],r["Brand Name"],r["ADA Number"],r["ADA Name"],r["Vendor Name"],r["Proof"],r["Bottle Size"],r["Pack Size"],r["On Premise"],r["Off Premise"],r["Shelf Price"],r["UPC Code 1"],r["UPC Code 2"],r["Effective Date"]]),
      ];
    } else {
      worksheetData = [
        ["LIQUOR CODE","BRAND NAME","ADA NUMBER","ADA NAME","VENDOR NAME","PROOF","BOTTLE SIZE","PACK SIZE","ON PREMISE PRICE","OFF PREMISE PRICE","SHELF PRICE","UPC CODE 1","UPC CODE 2","EFFECTIVE DATE"],
        ...records.map(r => [r.liquorCode,r.brandName,r.adaNumber,r.adaName,r.vendorName,r.proof,r.bottleSize,r.packSize,r.onPremisePrice,r.offPremisePrice,r.shelfPrice,r.upcCode1,r.upcCode2,r.effectiveDate]),
      ];
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, isScannedItemsData ? 'Scanned Items' : 'Liquor Data');
    const excelBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    const outputFilename = filename || (isScannedItemsData ? 'scanned_liquor.xlsx' : 'liquor_data.xlsx');

    return new Response(new Uint8Array(excelBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${outputFilename}"`,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to generate Excel file', details: String(err) }, 500);
  }
});

// Fetch liquor data from Michigan state website
app.post('/fetch-liquor-data', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const url = 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/Price-Book/May-2-2026-Price-Book-TXT.txt?rev=0c6b278ff50242b7917b090cc9f6bbc2&hash=CDD79D3A69C5876AEA62FF8E0756ADEA';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const fileContent = await response.text();
    const result = await processTsvContent(fileContent, storage);
    return c.json({ ...result, source: 'Michigan State Website', url, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to fetch liquor data from website', details: String(err) }, 500);
  }
});

// Add item manually
app.post('/add-item', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { liquorRecordId, sessionId, scannedBarcode } = await c.req.json<{ liquorRecordId: string; sessionId: string; scannedBarcode?: string }>();
    if (!liquorRecordId || !sessionId) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const liquorRecord = await storage.getLiquorRecordById(liquorRecordId);
    if (!liquorRecord) return c.json({ success: false, error: 'Liquor record not found' }, 404);

    await storage.addScannedItem({
      sessionId,
      liquorRecordId: liquorRecord.id,
      scannedBarcode: scannedBarcode
        ? toBottleBarcode(scannedBarcode)
        : (liquorRecord.upcCode1 ? toBottleBarcode(liquorRecord.upcCode1) : 'manual-search'),
      scannedAt: new Date().toISOString(),
      quantity: 1,
    });

    return c.json({ success: true, message: 'Item added successfully', liquorRecord });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to add item' }, 500);
  }
});

// Search liquor records
app.get('/search-liquor', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const query = c.req.query('query') || '';
    if (query.length < 2) return c.json({ success: true, results: [], message: 'Query too short' });

    const { results, totalFound } = await storage.searchLiquorRecords(query, 10);
    return c.json({ success: true, results, totalFound });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to search liquor records' }, 500);
  }
});

// Generate printable labels
app.post('/generate-labels', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { sessionId } = await c.req.json<{ sessionId: string }>();
    if (!sessionId) return c.json({ success: false, error: 'Session ID is required' }, 400);

    const items = await storage.getScannedItems(sessionId);
    const itemsWithDetails = (await Promise.all(
      items.map(async (item) => {
        const product = await storage.getLiquorRecordById(item.liquorRecordId || '');
        if (!product) return null;
        return {
          ...item,
          product: {
            ...product,
            shelfPrice: item.overridePrice !== null && item.overridePrice !== undefined
              ? item.overridePrice
              : product.shelfPrice,
          },
        };
      })
    )).filter(Boolean);

    if (itemsWithDetails.length === 0) {
      return c.json({ success: false, error: 'No items to print' }, 400);
    }

    const labelHtml = generateLabelHTML(itemsWithDetails);
    return c.html(labelHtml);
  } catch (err) {
    return c.json({ success: false, error: 'Failed to generate labels' }, 500);
  }
});

// ── Session routes ────────────────────────────────────────────────────────────

app.get('/sessions/active', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const session = await storage.getActiveSession();
    return c.json({ success: true, session });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to get active session' }, 500);
  }
});

app.get('/sessions', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const s = await storage.getSessions();
    return c.json({ success: true, sessions: s });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to get sessions' }, 500);
  }
});

app.post('/sessions', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { name } = await c.req.json<{ name: string }>();
    if (!name) return c.json({ success: false, error: 'Session name is required' }, 400);
    const session = await storage.createSession({ name, itemCount: 0, isActive: 1 });
    return c.json({ success: true, session });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to create session' }, 500);
  }
});

app.post('/sessions/:sessionId/activate', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { sessionId } = c.req.param();
    await storage.setActiveSession(sessionId);
    const session = await storage.getSession(sessionId);
    return c.json({ success: true, session });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to set active session' }, 500);
  }
});

app.delete('/sessions/:sessionId', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { sessionId } = c.req.param();
    const deleted = await storage.deleteSession(sessionId);
    if (deleted) return c.json({ success: true, message: 'Session deleted' });
    return c.json({ success: false, error: 'Session not found' }, 404);
  } catch (err) {
    return c.json({ success: false, error: 'Failed to delete session' }, 500);
  }
});

// ── Price comparison ──────────────────────────────────────────────────────────

app.post('/compare-prices', async (c) => {
  const storage = getStorage(c.env.DATABASE_URL);
  try {
    const { csvText } = await c.req.json<{ csvText: string }>();
    if (!csvText) return c.json({ success: false, error: 'No CSV text provided' }, 400);

    const dbCount = await storage.getLiquorRecordCount();
    if (dbCount === 0) return c.json({ success: true, rows: [], totalRows: 0, dbEmpty: true });

    function parseCsvLine(line: string): string[] {
      const fields: string[] = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
        else if (ch === ',' && !inQ) { fields.push(cur); cur = ''; }
        else cur += ch;
      }
      fields.push(cur);
      return fields;
    }

    const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) return c.json({ success: false, error: 'CSV appears empty' }, 400);

    const header = parseCsvLine(lines[0]).map((h: string) => h.toLowerCase().trim());
    const col = (name: string) => header.indexOf(name);
    const upcIdx = col('upc'), nameIdx = col('name'), priceIdx = col('price'),
          centsIdx = col('cents'), deptIdx = col('department'), sizeIdx = col('size');

    if (upcIdx === -1 || nameIdx === -1) {
      return c.json({ success: false, error: 'CSV missing required Upc or Name columns.' }, 400);
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      if (fields.length < 2) continue;

      const stripExcel = (v: string) => v.replace(/[="]/g, '').trim();
      const rawUpc  = stripExcel((fields[upcIdx]  || '').trim());
      const rawName = (fields[nameIdx] || '').trim();
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
        upc: rawUpc, name: rawName, registerPrice, department: dept, liquorCode: sizeCode,
        matched: !!match, matchedBy,
        multipleMatches: matches.length > 1,
        allMatches: matches.length > 1 ? matches : undefined,
        michiganPrice, michiganName: match ? `${match.brandName} ${match.bottleSize}` : null,
        michiganBottleSize: match?.bottleSize ?? null,
        michiganLiquorCode: match?.liquorCode ?? null,
        michiganRecord: match ?? null,
        priceDiff,
      });
    }

    return c.json({ success: true, rows, totalRows: rows.length });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to compare prices' }, 500);
  }
});

export const onRequest = app.fetch;
