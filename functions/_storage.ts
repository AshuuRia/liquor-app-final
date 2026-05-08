import { drizzle } from 'drizzle-orm/d1';
import { eq, or, sql, like } from 'drizzle-orm';
import * as schema from './_schema';

function normalizeUpc(upc: string | null | undefined): string {
  if (!upc) return '';
  return upc.replace(/^0+/, '') || '0';
}

export class D1Storage {
  private db: ReturnType<typeof drizzle>;

  constructor(d1: any) {
    this.db = drizzle(d1, { schema });
  }

  // ── Liquor records ────────────────────────────────────────────────────────

  async bulkCreateLiquorRecords(records: any[]): Promise<void> {
    const CHUNK = 50;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      await this.db.batch(
        chunk.map((r: any) =>
          this.db.insert(schema.liquorRecords).values({
            id: crypto.randomUUID(),
            liquorCode: r.liquorCode || '',
            brandName: r.brandName || '',
            adaNumber: r.adaNumber || null,
            adaName: r.adaName || null,
            vendorName: r.vendorName || null,
            proof: r.proof || null,
            bottleSize: r.bottleSize || null,
            packSize: r.packSize || null,
            onPremisePrice: r.onPremisePrice ?? null,
            offPremisePrice: r.offPremisePrice ?? null,
            shelfPrice: r.shelfPrice ?? null,
            upcCode1: r.upcCode1 || null,
            upcCode2: r.upcCode2 || null,
            effectiveDate: r.effectiveDate || null,
          })
        ) as any
      );
    }
  }

  async clearLiquorRecords(): Promise<void> {
    await this.db.delete(schema.liquorRecords);
  }

  async getLiquorRecordById(id: string): Promise<any | undefined> {
    const r = await this.db.select().from(schema.liquorRecords)
      .where(eq(schema.liquorRecords.id, id)).limit(1);
    return r[0];
  }

  async findLiquorByBarcode(barcode: string): Promise<any | undefined> {
    return (await this.findAllLiquorByBarcode(barcode))[0];
  }

  async findAllLiquorByBarcode(barcode: string): Promise<any[]> {
    const norm = normalizeUpc(barcode);
    return this.db.select().from(schema.liquorRecords).where(
      or(
        eq(schema.liquorRecords.upcCode1, barcode),
        eq(schema.liquorRecords.upcCode2, barcode),
        sql`ltrim(${schema.liquorRecords.upcCode1}, '0') = ${norm}`,
        sql`ltrim(${schema.liquorRecords.upcCode2}, '0') = ${norm}`,
      )
    );
  }

  async findAllLiquorByCode(code: string): Promise<any[]> {
    const norm = normalizeUpc(code);
    if (!norm || norm === '0') return [];
    return this.db.select().from(schema.liquorRecords).where(
      sql`ltrim(${schema.liquorRecords.liquorCode}, '0') = ${norm}`
    );
  }

  async getLiquorRecordCount(): Promise<number> {
    const r = await this.db.select({ count: sql<number>`count(*)` })
      .from(schema.liquorRecords);
    return Number(r[0]?.count ?? 0);
  }

  async searchLiquorRecords(query: string, limit = 10): Promise<{ results: any[], totalFound: number }> {
    if (query.length < 2) return { results: [], totalFound: 0 };
    const q = `%${query}%`;
    const norm = normalizeUpc(query);
    const results = await this.db.select().from(schema.liquorRecords).where(
      or(
        like(schema.liquorRecords.liquorCode, q),
        like(schema.liquorRecords.brandName, q),
        like(schema.liquorRecords.upcCode1, q),
        like(schema.liquorRecords.upcCode2, q),
        like(schema.liquorRecords.vendorName, q),
        norm ? sql`ltrim(${schema.liquorRecords.upcCode1}, '0') = ${norm}` : sql`0`,
        norm ? sql`ltrim(${schema.liquorRecords.upcCode2}, '0') = ${norm}` : sql`0`,
      )
    ).limit(limit);
    return { results, totalFound: results.length };
  }

  // ── Scanned items ─────────────────────────────────────────────────────────

  async addScannedItem(item: any): Promise<any> {
    const id = crypto.randomUUID();
    await this.db.insert(schema.scannedItems).values({
      id,
      sessionId: item.sessionId,
      liquorRecordId: item.liquorRecordId ?? null,
      scannedBarcode: item.scannedBarcode,
      scannedAt: item.scannedAt,
      quantity: item.quantity ?? 1,
      overridePrice: item.overridePrice ?? null,
    });
    return { id, ...item, overridePrice: item.overridePrice ?? null };
  }

  async getScannedItems(sessionId: string): Promise<any[]> {
    return this.db.select().from(schema.scannedItems)
      .where(eq(schema.scannedItems.sessionId, sessionId));
  }

  async clearScannedItems(sessionId: string): Promise<void> {
    await this.db.delete(schema.scannedItems)
      .where(eq(schema.scannedItems.sessionId, sessionId));
  }

  async deleteScannedItem(itemId: string): Promise<boolean> {
    const existing = await this.db.select({ id: schema.scannedItems.id })
      .from(schema.scannedItems).where(eq(schema.scannedItems.id, itemId)).limit(1);
    if (!existing.length) return false;
    await this.db.delete(schema.scannedItems).where(eq(schema.scannedItems.id, itemId));
    return true;
  }

  async updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean> {
    const existing = await this.db.select({ id: schema.scannedItems.id })
      .from(schema.scannedItems).where(eq(schema.scannedItems.id, itemId)).limit(1);
    if (!existing.length) return false;
    await this.db.update(schema.scannedItems)
      .set({ overridePrice: newPrice })
      .where(eq(schema.scannedItems.id, itemId));
    return true;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async createSession(name: string): Promise<any> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db.update(schema.sessions).set({ isActive: 0 });
    await this.db.insert(schema.sessions).values({
      id, name, itemCount: 0, isActive: 1, createdAt: now, updatedAt: now,
    });
    return { id, name, itemCount: 0, isActive: 1, createdAt: now, updatedAt: now };
  }

  async getSession(sessionId: string): Promise<any | undefined> {
    const r = await this.db.select().from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId)).limit(1);
    return r[0];
  }

  async getSessions(): Promise<any[]> {
    return this.db.select().from(schema.sessions)
      .orderBy(sql`${schema.sessions.updatedAt} desc`);
  }

  async updateSessionItemCount(sessionId: string, count: number): Promise<void> {
    await this.db.update(schema.sessions)
      .set({ itemCount: count, updatedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.clearScannedItems(sessionId);
    const existing = await this.db.select({ id: schema.sessions.id })
      .from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!existing.length) return false;
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    return true;
  }

  async getActiveSession(): Promise<any | undefined> {
    const r = await this.db.select().from(schema.sessions)
      .where(eq(schema.sessions.isActive, 1))
      .orderBy(sql`${schema.sessions.updatedAt} desc`)
      .limit(1);
    return r[0];
  }

  async setActiveSession(sessionId: string): Promise<void> {
    await this.db.update(schema.sessions).set({ isActive: 0 });
    await this.db.update(schema.sessions)
      .set({ isActive: 1, updatedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));
  }

  // ── Custom name mappings ──────────────────────────────────────────────────

  async addCustomNameMapping(upcCode: string, customName: string): Promise<any> {
    const id = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();
    await this.db.insert(schema.customNameMappings)
      .values({ id, upcCode, customName, uploadedAt });
    return { id, upcCode, customName, uploadedAt };
  }

  async getCustomNameMappings(): Promise<any[]> {
    return this.db.select().from(schema.customNameMappings);
  }

  async clearCustomNameMappings(): Promise<void> {
    await this.db.delete(schema.customNameMappings);
  }

  async getCustomNameByUpc(upcCode: string): Promise<string | undefined> {
    const norm = normalizeUpc(upcCode);
    const all = await this.db.select().from(schema.customNameMappings).where(
      or(
        eq(schema.customNameMappings.upcCode, upcCode),
        sql`ltrim(${schema.customNameMappings.upcCode}, '0') = ${norm}`,
      )
    );
    return all[0]?.customName;
  }
}
