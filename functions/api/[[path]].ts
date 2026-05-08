import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { D1Storage } from '../_storage';
import { parseTsvLine, toBottleBarcode, generateLabelHTML } from '../../server/utils';
import * as XLSX from 'xlsx';

type Env = {
  Bindings: {
    DB: any;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    userId: string;
  };
};

const app = new Hono<Env>().basePath('/api');

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

const db = (c: any) => new D1Storage(c.env.DB);

// ── Clerk JWT verification (no SDK needed — uses Web Crypto + Clerk REST API) ─

let _jwksCache: any[] = [];
let _jwksCacheExpiry = 0;

function b64url(s: string): string {
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

async function getJwks(secretKey: string): Promise<any[]> {
  if (_jwksCache.length && Date.now() < _jwksCacheExpiry) return _jwksCache;
  const res = await fetch('https://api.clerk.com/v1/jwks', {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  const { keys } = await res.json() as { keys: any[] };
  _jwksCache = keys;
  _jwksCacheExpiry = Date.now() + 60 * 60 * 1000;
  return _jwksCache;
}

async function verifyClerkToken(token: string, secretKey: string): Promise<string | null> {
  try {
    const [hb64, pb64, sb64] = token.split('.');
    if (!hb64 || !pb64 || !sb64) return null;

    const header = JSON.parse(atob(b64url(hb64)));
    const keys = await getJwks(secretKey);
    const jwk = keys.find((k: any) => k.kid === header.kid);
    if (!jwk) return null;

    const pubKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );

    const sigData = new TextEncoder().encode(`${hb64}.${pb64}`);
    const sig = Uint8Array.from(atob(b64url(sb64)), (c: string) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pubKey, sig, sigData);
    if (!valid) return null;

    const payload = JSON.parse(atob(b64url(pb64)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ── Auth middleware ────────────────────────────────────────────────────────────

const requireAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const userId = await verifyClerkToken(authHeader.slice(7), c.env.CLERK_SECRET_KEY);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userId', userId);
  await next();
};

// ── Public config (no auth required) ─────────────────────────────────────────

app.get('/config', (c) => {
  return c.json({ clerkPublishableKey: c.env.CLERK_PUBLISHABLE_KEY || null });
});

// ── Auth endpoints ────────────────────────────────────────────────────────────

app.get('/auth/user', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return c.json(null, 401);
  const userId = await verifyClerkToken(authHeader.slice(7), c.env.CLERK_SECRET_KEY);
  if (!userId) return c.json(null, 401);

  try {
    const userRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${c.env.CLERK_SECRET_KEY}` },
    });
    if (userRes.ok) {
      const u = await userRes.json() as any;
      return c.json({
        id: u.id,
        email: u.email_addresses?.[0]?.email_address ?? null,
        firstName: u.first_name ?? null,
        lastName: u.last_name ?? null,
        profileImageUrl: u.image_url ?? null,
      });
    }
  } catch {}
  return c.json({ id: userId });
});

// ── Michigan data helpers ─────────────────────────────────────────────────────

async function processTsvContent(content: string, storage: D1Storage) {
  const allLines = content.split('\n').filter((l: string) => l.trim());
  const lines = allLines[0]?.toLowerCase().includes('liquor code') ? allLines.slice(1) : allLines;

  const records: any[] = [];
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

// ── Public routes (no auth required) ─────────────────────────────────────────

app.post('/process-file', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json({ success: false, error: 'No file uploaded' }, 400);
    const text = await file.text();
    return c.json(await processTsvContent(text, db(c)));
  } catch (err) {
    return c.json({ success: false, error: 'Failed to process file', details: String(err) }, 500);
  }
});

app.post('/process-file-content', async (c) => {
  try {
    const { content } = await c.req.json<{ content: string }>();
    if (!content) return c.json({ success: false, error: 'No content provided' }, 400);
    return c.json(await processTsvContent(content, db(c)));
  } catch (err) {
    return c.json({ success: false, error: 'Failed to process file content', details: String(err) }, 500);
  }
});

app.post('/fetch-liquor-data', async (c) => {
  try {
    const url = 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/Price-Book/May-2-2026-Price-Book-TXT.txt?rev=0c6b278ff50242b7917b090cc9f6bbc2&hash=CDD79D3A69C5876AEA62FF8E0756ADEA';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await processTsvContent(await response.text(), db(c));
    return c.json({ ...result, source: 'Michigan State Website', url, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to fetch liquor data', details: String(err) }, 500);
  }
});

app.get('/search-liquor', async (c) => {
  try {
    const query = c.req.query('query') || '';
    if (query.length < 2) return c.json({ success: true, results: [], message: 'Query too short' });
    const { results, totalFound } = await db(c).searchLiquorRecords(query, 10);
    return c.json({ success: true, results, totalFound });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to search' }, 500);
  }
});

app.post('/generate-excel', async (c) => {
  try {
    const { records, filename } = await c.req.json<{ records: any[]; filename?: string }>();
    if (!records?.length) return c.json({ error: 'No data to export' }, 400);

    const isScanned = records[0]?.["ADA Number"] !== undefined;
    let data: any[][];
    if (isScanned) {
      data = [
        ["LIQUOR CODE","BRAND NAME","ADA NUMBER","ADA NAME","VENDOR NAME","PROOF","BOTTLE SIZE","PACK SIZE","ON PREMISE","OFF PREMISE","SHELF PRICE","UPC CODE 1","UPC CODE 2","EFFECTIVE DATE"],
        ...records.map(r => [r["Liquor Code"],r["Brand Name"],r["ADA Number"],r["ADA Name"],r["Vendor Name"],r["Proof"],r["Bottle Size"],r["Pack Size"],r["On Premise"],r["Off Premise"],r["Shelf Price"],r["UPC Code 1"],r["UPC Code 2"],r["Effective Date"]]),
      ];
    } else {
      data = [
        ["LIQUOR CODE","BRAND NAME","ADA NUMBER","ADA NAME","VENDOR NAME","PROOF","BOTTLE SIZE","PACK SIZE","ON PREMISE PRICE","OFF PREMISE PRICE","SHELF PRICE","UPC CODE 1","UPC CODE 2","EFFECTIVE DATE"],
        ...records.map(r => [r.liquorCode,r.brandName,r.adaNumber,r.adaName,r.vendorName,r.proof,r.bottleSize,r.packSize,r.onPremisePrice,r.offPremisePrice,r.shelfPrice,r.upcCode1,r.upcCode2,r.effectiveDate]),
      ];
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), isScanned ? 'Scanned Items' : 'Liquor Data');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const outName = filename || (isScanned ? 'scanned_liquor.xlsx' : 'liquor_data.xlsx');

    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${outName}"`,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to generate Excel', details: String(err) }, 500);
  }
});

// ── Scan routes (auth required) ───────────────────────────────────────────────

app.post('/scan-barcode', requireAuth, async (c) => {
  try {
    const { barcode, sessionId } = await c.req.json<{ barcode: string; sessionId?: string }>();
    if (!barcode) return c.json({ success: false, error: 'No barcode provided' }, 400);
    const storage = db(c);

    if (barcode === 'test-check-only') {
      return c.json({ success: false, barcode, error: 'Status check only', totalRecords: await storage.getLiquorRecordCount() });
    }

    const matchedProducts = await storage.findAllLiquorByBarcode(barcode);
    if (!matchedProducts.length) return c.json({ success: false, barcode, error: 'Product not found in database' });
    if (matchedProducts.length > 1) return c.json({ success: true, requiresSelection: true, barcode, matchedProducts });

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
    return c.json({ success: false, error: 'Failed to scan barcode', details: String(err) }, 500);
  }
});

app.get('/scanned-items/:sessionId', requireAuth, async (c) => {
  try {
    const { sessionId } = c.req.param();
    const storage = db(c);
    const items = await storage.getScannedItems(sessionId);
    const itemsWithDetails = await Promise.all(
      items.map(async (item: any) => {
        const product = await storage.findLiquorByBarcode(item.scannedBarcode);
        return {
          ...item,
          product: product ? {
            ...product,
            shelfPrice: item.overridePrice !== null && item.overridePrice !== undefined
              ? item.overridePrice : product.shelfPrice,
          } : null,
        };
      })
    );
    return c.json({ success: true, sessionId, items: itemsWithDetails, totalCount: itemsWithDetails.length });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to get scanned items' }, 500);
  }
});

app.delete('/scanned-items/:sessionId/:itemId', requireAuth, async (c) => {
  try {
    const { itemId } = c.req.param();
    const deleted = await db(c).deleteScannedItem(itemId);
    return deleted ? c.json({ success: true }) : c.json({ success: false, error: 'Item not found' }, 404);
  } catch (err) {
    return c.json({ success: false, error: 'Failed to delete item' }, 500);
  }
});

app.delete('/scanned-items/:sessionId', requireAuth, async (c) => {
  try {
    await db(c).clearScannedItems(c.req.param('sessionId'));
    return c.json({ success: true, message: 'Scanned items cleared' });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to clear items' }, 500);
  }
});

app.patch('/update-item-price', requireAuth, async (c) => {
  try {
    const { sessionId, itemId, newPrice } = await c.req.json<{ sessionId: string; itemId: string; newPrice: number }>();
    if (!sessionId || !itemId || newPrice === undefined) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }
    const updated = await db(c).updateScannedItemPrice(itemId, newPrice);
    return updated ? c.json({ success: true }) : c.json({ success: false, error: 'Item not found' }, 404);
  } catch (err) {
    return c.json({ success: false, error: 'Failed to update price' }, 500);
  }
});

app.post('/add-item', requireAuth, async (c) => {
  try {
    const { liquorRecordId, sessionId, scannedBarcode } = await c.req.json<{ liquorRecordId: string; sessionId: string; scannedBarcode?: string }>();
    if (!liquorRecordId || !sessionId) return c.json({ success: false, error: 'Missing required fields' }, 400);
    const storage = db(c);
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
    return c.json({ success: true, liquorRecord });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to add item' }, 500);
  }
});

app.post('/generate-labels', requireAuth, async (c) => {
  try {
    const { sessionId } = await c.req.json<{ sessionId: string }>();
    if (!sessionId) return c.json({ success: false, error: 'Session ID required' }, 400);
    const storage = db(c);
    const items = await storage.getScannedItems(sessionId);
    const itemsWithDetails = (await Promise.all(
      items.map(async (item: any) => {
        const product = await storage.getLiquorRecordById(item.liquorRecordId || '');
        if (!product) return null;
        return { ...item, product: { ...product, shelfPrice: item.overridePrice ?? product.shelfPrice } };
      })
    )).filter(Boolean);
    if (!itemsWithDetails.length) return c.json({ success: false, error: 'No items to print' }, 400);
    return c.html(generateLabelHTML(itemsWithDetails));
  } catch (err) {
    return c.json({ success: false, error: 'Failed to generate labels' }, 500);
  }
});

// ── Sessions (auth required, user-scoped) ─────────────────────────────────────

app.get('/sessions/active', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    return c.json({ success: true, session: await db(c).getActiveSession(userId) });
  } catch (err) { return c.json({ success: false, error: 'Failed' }, 500); }
});

app.get('/sessions', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    return c.json({ success: true, sessions: await db(c).getSessions(userId) });
  } catch (err) { return c.json({ success: false, error: 'Failed' }, 500); }
});

app.post('/sessions', requireAuth, async (c) => {
  try {
    const { name } = await c.req.json<{ name: string }>();
    if (!name) return c.json({ success: false, error: 'Name required' }, 400);
    const userId = c.get('userId');
    return c.json({ success: true, session: await db(c).createSession(name, userId) });
  } catch (err) { return c.json({ success: false, error: 'Failed' }, 500); }
});

app.post('/sessions/:sessionId/activate', requireAuth, async (c) => {
  try {
    const { sessionId } = c.req.param();
    const userId = c.get('userId');
    await db(c).setActiveSession(sessionId, userId);
    return c.json({ success: true, session: await db(c).getSession(sessionId) });
  } catch (err) { return c.json({ success: false, error: 'Failed' }, 500); }
});

app.delete('/sessions/:sessionId', requireAuth, async (c) => {
  try {
    const deleted = await db(c).deleteSession(c.req.param('sessionId'));
    return deleted ? c.json({ success: true }) : c.json({ success: false, error: 'Not found' }, 404);
  } catch (err) { return c.json({ success: false, error: 'Failed' }, 500); }
});

// ── Custom name mappings (auth required, user-scoped) ─────────────────────────

app.post('/upload-custom-names', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const storage = db(c);
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json({ error: 'No file uploaded' }, 400);

    await storage.clearCustomNameMappings(userId);

    let worksheetData: any[][] = [];
    const filename = file.name || '';

    if (filename.endsWith('.csv') || file.type === 'text/csv') {
      const lines = (await file.text()).split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        const cols = line.split(',').map((c: string) => c.trim().replace(/["']/g, ''));
        if (cols.length >= 2) worksheetData.push(cols);
      }
    } else {
      const uint8 = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(uint8, { type: 'array' });
      worksheetData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
    }

    if (!worksheetData.length) return c.json({ error: 'File appears to be empty' }, 400);

    const firstRow = worksheetData[0];
    const hasHeaders = firstRow.some((cell: any) => {
      const s = String(cell || '').toLowerCase();
      return s.includes('upc') || s.includes('name') || s.includes('description') || s.includes('brand');
    });

    let upcIdx = -1, nameIdx = -1, startRow = hasHeaders ? 1 : 0;
    if (hasHeaders) {
      for (let i = 0; i < firstRow.length; i++) {
        const h = String(firstRow[i] || '').toLowerCase().trim();
        if (upcIdx === -1 && (h.includes('upc') || h.includes('barcode') || h.includes('code'))) upcIdx = i;
        if (nameIdx === -1 && (h.includes('name') || h.includes('description') || h.includes('brand') || h.includes('product'))) nameIdx = i;
      }
    }
    if (upcIdx === -1 || nameIdx === -1) { upcIdx = 0; nameIdx = 1; }

    let mappingsAdded = 0, skippedRows = 0;
    for (let i = startRow; i < worksheetData.length; i++) {
      const row = worksheetData[i];
      if (row && row.length > Math.max(upcIdx, nameIdx)) {
        const upc = String(row[upcIdx] || '').trim();
        const name = String(row[nameIdx] || '').trim();
        if (upc && name) { await storage.addCustomNameMapping(upc, name, userId); mappingsAdded++; }
        else skippedRows++;
      } else skippedRows++;
    }

    return c.json({ success: true, mappingsUploaded: mappingsAdded, skippedRows, totalRows: worksheetData.length });
  } catch (err) {
    return c.json({ error: 'Failed to process file', details: String(err) }, 500);
  }
});

app.delete('/clear-custom-names', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    await db(c).clearCustomNameMappings(userId);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to clear mappings' }, 500);
  }
});

app.get('/custom-names', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const mappings = await db(c).getCustomNameMappings(userId);
    return c.json({ success: true, count: mappings.length, mappings });
  } catch (err) {
    return c.json({ error: 'Failed to fetch mappings' }, 500);
  }
});

// ── Price comparison (auth required) ─────────────────────────────────────────

app.post('/compare-prices', requireAuth, async (c) => {
  try {
    const { csvText } = await c.req.json<{ csvText: string }>();
    if (!csvText) return c.json({ success: false, error: 'No CSV provided' }, 400);
    const storage = db(c);

    const dbCount = await storage.getLiquorRecordCount();
    if (!dbCount) return c.json({ success: true, rows: [], totalRows: 0, dbEmpty: true });

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
    if (lines.length < 2) return c.json({ success: false, error: 'CSV too short' }, 400);

    const header = parseCsvLine(lines[0]).map((h: string) => h.toLowerCase().trim());
    const col = (n: string) => header.indexOf(n);
    const upcIdx = col('upc'), nameIdx = col('name'), priceIdx = col('price'),
          centsIdx = col('cents'), deptIdx = col('department'), sizeIdx = col('size');

    if (upcIdx === -1 || nameIdx === -1) {
      return c.json({ success: false, error: 'CSV missing Upc or Name columns' }, 400);
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      if (fields.length < 2) continue;
      const strip = (v: string) => v.replace(/[="]/g, '').trim();
      const rawUpc = strip((fields[upcIdx] || '').trim());
      const rawName = (fields[nameIdx] || '').trim();
      const rawPrice = priceIdx >= 0 ? (fields[priceIdx] || '').trim() : '';
      const rawCents = centsIdx >= 0 ? (fields[centsIdx] || '').trim() : '';
      const dept = deptIdx >= 0 ? (fields[deptIdx] || '').trim() : 'Liquor';
      const sizeCode = strip(sizeIdx >= 0 ? (fields[sizeIdx] || '').trim() : '');
      if (!rawUpc && !rawName) continue;

      let registerPrice = 0;
      if (rawCents) registerPrice = parseInt(rawCents, 10) / 100;
      else if (rawPrice) registerPrice = parseFloat(rawPrice.replace(/[^0-9.]/g, '')) || 0;

      let matches = await storage.findAllLiquorByBarcode(rawUpc);
      let matchedBy: 'upc' | 'code' | null = matches.length ? 'upc' : null;
      if (!matches.length && sizeCode) {
        matches = await storage.findAllLiquorByCode(sizeCode);
        if (matches.length) matchedBy = 'code';
      }

      const match = matches[0] || null;
      const michiganPrice = match?.shelfPrice ?? null;
      const priceDiff = michiganPrice !== null ? Math.round((michiganPrice - registerPrice) * 100) / 100 : null;

      rows.push({
        upc: rawUpc, name: rawName, registerPrice, department: dept, liquorCode: sizeCode,
        matched: !!match, matchedBy, multipleMatches: matches.length > 1,
        allMatches: matches.length > 1 ? matches : undefined,
        michiganPrice, michiganName: match ? `${match.brandName} ${match.bottleSize}` : null,
        michiganBottleSize: match?.bottleSize ?? null,
        michiganLiquorCode: match?.liquorCode ?? null,
        michiganRecord: match ?? null, priceDiff,
      });
    }

    return c.json({ success: true, rows, totalRows: rows.length });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to compare prices' }, 500);
  }
});

app.get('/price-compare/session', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const session = await db(c).loadPriceCompareSession(userId);
    return c.json({ success: true, session });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to load session' }, 500);
  }
});

app.post('/price-compare/session', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const { fileName, rows } = await c.req.json<{ fileName: string; rows: any[] }>();
    if (!fileName || !rows) return c.json({ success: false, error: 'Missing fields' }, 400);
    await db(c).savePriceCompareSession(userId, fileName, JSON.stringify(rows));
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: 'Failed to save session' }, 500);
  }
});

export const onRequest = (context: any) => app.fetch(context.request, context.env, context);
