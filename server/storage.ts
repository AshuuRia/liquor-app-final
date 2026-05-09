import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, or, sql, ilike, and, desc, inArray } from 'drizzle-orm';
import {
  type LiquorRecord, type InsertLiquorRecord,
  type ScannedItem, type InsertScannedItem,
  type Session, type InsertSession,
  type CustomNameMapping, type InsertCustomNameMapping,
  type PriceCompareSession, type InsertPriceCompareSession,
  liquorRecords, scannedItems, sessions, customNameMappings, priceCompareSessions, priceBookChanges,
} from "@shared/schema";
import { randomUUID } from "crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeUpc(upc: string | null | undefined): string {
  if (!upc) return '';
  return upc.replace(/^0+/, '') || '0';
}

// ── Storage interface ─────────────────────────────────────────────────────────

export interface IStorage {
  // Liquor record methods
  createLiquorRecord(record: InsertLiquorRecord): Promise<LiquorRecord>;
  bulkCreateLiquorRecords(records: InsertLiquorRecord[]): Promise<void>;
  getLiquorRecords(): Promise<LiquorRecord[]>;
  getLiquorRecordById(id: string): Promise<LiquorRecord | undefined>;
  clearLiquorRecords(): Promise<void>;
  findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined>;
  findAllLiquorByBarcode(barcode: string): Promise<LiquorRecord[]>;
  findAllLiquorByCode(code: string): Promise<LiquorRecord[]>;
  getLiquorRecordCount(): Promise<number>;
  searchLiquorRecords(query: string, limit?: number): Promise<{ results: LiquorRecord[], totalFound: number }>;

  // Scanned items (persisted)
  addScannedItem(item: InsertScannedItem): Promise<ScannedItem>;
  getScannedItems(sessionId: string): Promise<ScannedItem[]>;
  clearScannedItems(sessionId: string): Promise<void>;
  deleteScannedItem(itemId: string): Promise<boolean>;
  updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean>;

  // Scan sessions (persisted, user-scoped)
  createSession(session: InsertSession, userId?: string): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  getSessions(userId?: string): Promise<Session[]>;
  updateSessionItemCount(sessionId: string, count: number): Promise<void>;
  deleteSession(sessionId: string): Promise<boolean>;
  getActiveSession(userId?: string): Promise<Session | undefined>;
  setActiveSession(sessionId: string): Promise<void>;

  // Custom name mappings (persisted, user-scoped)
  addCustomNameMapping(mapping: InsertCustomNameMapping, userId?: string): Promise<CustomNameMapping>;
  getCustomNameMappings(userId?: string): Promise<CustomNameMapping[]>;
  clearCustomNameMappings(userId?: string): Promise<void>;
  getCustomNameByUpc(upcCode: string, userId?: string): Promise<string | undefined>;

  // Price compare sessions (persisted, user-scoped)
  savePriceCompareSession(userId: string, sessionId: string | null, sessionName: string, fileName: string, rowsJson: string): Promise<PriceCompareSession>;
  listPriceCompareSessions(userId: string): Promise<Pick<PriceCompareSession, 'id' | 'sessionName' | 'fileName' | 'updatedAt'>[]>;
  getPriceCompareSession(userId: string, sessionId: string): Promise<PriceCompareSession | undefined>;
  deletePriceCompareSession(sessionId: string): Promise<boolean>;

  // Price book changes (from Michigan Excel price book)
  getPriceChange(liquorCode: string): Promise<string | null>;
  getPriceChangeBatch(liquorCodes: string[]): Promise<Map<string, string | null>>;
  bulkUpsertPriceChanges(changes: Array<{ liquorCode: string; newChng: string | null }>): Promise<void>;
  clearPriceBookChanges(): Promise<void>;
}

// ── DatabaseStorage ───────────────────────────────────────────────────────────

export class DatabaseStorage implements IStorage {
  private db: ReturnType<typeof drizzle>;

  constructor(databaseUrl: string) {
    const client = postgres(databaseUrl, { max: 10 });
    this.db = drizzle(client);
  }

  // ── Liquor records ─────────────────────────────────────────────────────────

  async createLiquorRecord(record: InsertLiquorRecord): Promise<LiquorRecord> {
    const result = await this.db.insert(liquorRecords).values(record).returning();
    return result[0];
  }

  async bulkCreateLiquorRecords(records: InsertLiquorRecord[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < records.length; i += CHUNK) {
      await this.db.insert(liquorRecords).values(records.slice(i, i + CHUNK));
    }
  }

  async getLiquorRecords(): Promise<LiquorRecord[]> {
    return this.db.select().from(liquorRecords);
  }

  async getLiquorRecordById(id: string): Promise<LiquorRecord | undefined> {
    const r = await this.db.select().from(liquorRecords).where(eq(liquorRecords.id, id)).limit(1);
    return r[0];
  }

  async clearLiquorRecords(): Promise<void> {
    await this.db.delete(liquorRecords);
  }

  async findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined> {
    return (await this.findAllLiquorByBarcode(barcode))[0];
  }

  async findAllLiquorByBarcode(barcode: string): Promise<LiquorRecord[]> {
    const norm = normalizeUpc(barcode);
    return this.db.select().from(liquorRecords).where(
      or(
        eq(liquorRecords.upcCode1, barcode),
        eq(liquorRecords.upcCode2, barcode),
        sql`ltrim(${liquorRecords.upcCode1}, '0') = ${norm}`,
        sql`ltrim(${liquorRecords.upcCode2}, '0') = ${norm}`,
      )
    );
  }

  async findAllLiquorByCode(code: string): Promise<LiquorRecord[]> {
    const norm = normalizeUpc(code);
    if (!norm || norm === '0') return [];
    return this.db.select().from(liquorRecords).where(
      sql`ltrim(${liquorRecords.liquorCode}, '0') = ${norm}`
    );
  }

  async getLiquorRecordCount(): Promise<number> {
    const r = await this.db.select({ count: sql<number>`count(*)` }).from(liquorRecords);
    return Number(r[0]?.count ?? 0);
  }

  async searchLiquorRecords(query: string, limit = 10): Promise<{ results: LiquorRecord[], totalFound: number }> {
    if (query.length < 2) return { results: [], totalFound: 0 };
    const q = `%${query}%`;
    const norm = normalizeUpc(query);
    const results = await this.db.select().from(liquorRecords).where(
      or(
        ilike(liquorRecords.liquorCode, q),
        ilike(liquorRecords.brandName, q),
        ilike(liquorRecords.upcCode1, q),
        ilike(liquorRecords.upcCode2, q),
        ilike(liquorRecords.vendorName, q),
        norm ? sql`ltrim(${liquorRecords.upcCode1}, '0') = ${norm}` : sql`false`,
        norm ? sql`ltrim(${liquorRecords.upcCode2}, '0') = ${norm}` : sql`false`,
      )
    ).limit(limit);
    return { results, totalFound: results.length };
  }

  // ── Scanned items ──────────────────────────────────────────────────────────

  async addScannedItem(insertItem: InsertScannedItem): Promise<ScannedItem> {
    const result = await this.db.insert(scannedItems).values(insertItem).returning();
    return result[0];
  }

  async getScannedItems(sessionId: string): Promise<ScannedItem[]> {
    const result = await this.db.select().from(scannedItems).where(eq(scannedItems.sessionId, sessionId));
    return result ?? [];
  }

  async clearScannedItems(sessionId: string): Promise<void> {
    await this.db.delete(scannedItems).where(eq(scannedItems.sessionId, sessionId));
  }

  async deleteScannedItem(itemId: string): Promise<boolean> {
    const r = await this.db.delete(scannedItems).where(eq(scannedItems.id, itemId)).returning();
    return r.length > 0;
  }

  async updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean> {
    const r = await this.db.update(scannedItems)
      .set({ overridePrice: newPrice })
      .where(eq(scannedItems.id, itemId))
      .returning();
    return r.length > 0;
  }

  // ── Scan sessions ──────────────────────────────────────────────────────────

  async createSession(insertSession: InsertSession, userId?: string): Promise<Session> {
    // Deactivate existing sessions for this user
    if (userId) {
      await this.db.update(sessions).set({ isActive: 0 }).where(eq(sessions.userId, userId));
    } else {
      await this.db.update(sessions).set({ isActive: 0 });
    }
    const result = await this.db.insert(sessions).values({
      name: insertSession.name,
      userId: userId ?? null,
      itemCount: insertSession.itemCount ?? 0,
      isActive: 1,
    }).returning();
    return result[0];
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const r = await this.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return r[0];
  }

  async getSessions(userId?: string): Promise<Session[]> {
    if (userId) {
      return this.db.select().from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.updatedAt));
    }
    return this.db.select().from(sessions).orderBy(desc(sessions.updatedAt));
  }

  async updateSessionItemCount(sessionId: string, count: number): Promise<void> {
    await this.db.update(sessions)
      .set({ itemCount: count, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.clearScannedItems(sessionId);
    const r = await this.db.delete(sessions).where(eq(sessions.id, sessionId)).returning();
    return r.length > 0;
  }

  async getActiveSession(userId?: string): Promise<Session | undefined> {
    const conditions = userId
      ? and(eq(sessions.isActive, 1), eq(sessions.userId, userId))
      : eq(sessions.isActive, 1);
    const r = await this.db.select().from(sessions)
      .where(conditions)
      .orderBy(desc(sessions.updatedAt))
      .limit(1);
    return r[0];
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session?.userId) {
      await this.db.update(sessions).set({ isActive: 0 }).where(eq(sessions.userId, session.userId));
    } else {
      await this.db.update(sessions).set({ isActive: 0 });
    }
    await this.db.update(sessions)
      .set({ isActive: 1, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  // ── Custom name mappings ───────────────────────────────────────────────────

  async addCustomNameMapping(insertMapping: InsertCustomNameMapping, userId?: string): Promise<CustomNameMapping> {
    const r = await this.db.insert(customNameMappings).values({
      ...insertMapping,
      userId: userId ?? null,
    }).returning();
    return r[0];
  }

  async getCustomNameMappings(userId?: string): Promise<CustomNameMapping[]> {
    if (userId) {
      return this.db.select().from(customNameMappings).where(eq(customNameMappings.userId, userId));
    }
    return this.db.select().from(customNameMappings);
  }

  async clearCustomNameMappings(userId?: string): Promise<void> {
    if (userId) {
      await this.db.delete(customNameMappings).where(eq(customNameMappings.userId, userId));
    } else {
      await this.db.delete(customNameMappings);
    }
  }

  async getCustomNameByUpc(upcCode: string, userId?: string): Promise<string | undefined> {
    const norm = normalizeUpc(upcCode);
    const conditions = userId
      ? and(
          eq(customNameMappings.userId, userId),
          or(
            eq(customNameMappings.upcCode, upcCode),
            sql`ltrim(${customNameMappings.upcCode}, '0') = ${norm}`,
          )
        )
      : or(
          eq(customNameMappings.upcCode, upcCode),
          sql`ltrim(${customNameMappings.upcCode}, '0') = ${norm}`,
        );
    const all = await this.db.select().from(customNameMappings).where(conditions);
    return all[0]?.customName;
  }

  // ── Price compare sessions ─────────────────────────────────────────────────

  async savePriceCompareSession(userId: string, sessionId: string | null, sessionName: string, fileName: string, rowsJson: string): Promise<PriceCompareSession> {
    if (sessionId) {
      const r = await this.db.update(priceCompareSessions)
        .set({ sessionName, fileName, rowsJson, updatedAt: new Date() })
        .where(and(eq(priceCompareSessions.id, sessionId), eq(priceCompareSessions.userId, userId)))
        .returning();
      if (r.length) return r[0];
    }
    const r = await this.db.insert(priceCompareSessions)
      .values({ userId, sessionName, fileName, rowsJson })
      .returning();
    return r[0];
  }

  async listPriceCompareSessions(userId: string): Promise<Pick<PriceCompareSession, 'id' | 'sessionName' | 'fileName' | 'updatedAt'>[]> {
    return await this.db.select({
      id: priceCompareSessions.id,
      sessionName: priceCompareSessions.sessionName,
      fileName: priceCompareSessions.fileName,
      updatedAt: priceCompareSessions.updatedAt,
    })
      .from(priceCompareSessions)
      .where(eq(priceCompareSessions.userId, userId))
      .orderBy(desc(priceCompareSessions.updatedAt));
  }

  async getPriceCompareSession(userId: string, sessionId: string): Promise<PriceCompareSession | undefined> {
    const r = await this.db.select().from(priceCompareSessions)
      .where(and(eq(priceCompareSessions.id, sessionId), eq(priceCompareSessions.userId, userId)))
      .limit(1);
    return r[0];
  }

  async deletePriceCompareSession(sessionId: string): Promise<boolean> {
    const r = await this.db.delete(priceCompareSessions)
      .where(eq(priceCompareSessions.id, sessionId))
      .returning();
    return r.length > 0;
  }

  // ── Price book changes ─────────────────────────────────────────────────────

  async getPriceChange(liquorCode: string): Promise<string | null> {
    const r = await this.db.select().from(priceBookChanges)
      .where(eq(priceBookChanges.liquorCode, liquorCode)).limit(1);
    return r[0]?.newChng ?? null;
  }

  async getPriceChangeBatch(liquorCodes: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (!liquorCodes.length) return map;
    const rows = await this.db.select().from(priceBookChanges)
      .where(inArray(priceBookChanges.liquorCode, liquorCodes));
    for (const row of rows) map.set(row.liquorCode, row.newChng ?? null);
    return map;
  }

  async bulkUpsertPriceChanges(changes: Array<{ liquorCode: string; newChng: string | null }>): Promise<void> {
    const CHUNK = 200;
    for (let i = 0; i < changes.length; i += CHUNK) {
      const chunk = changes.slice(i, i + CHUNK);
      await this.db.insert(priceBookChanges)
        .values(chunk.map(c => ({ liquorCode: c.liquorCode, newChng: c.newChng })))
        .onConflictDoUpdate({
          target: priceBookChanges.liquorCode,
          set: { newChng: sql`excluded.new_chng`, updatedAt: sql`now()` },
        });
    }
  }

  async clearPriceBookChanges(): Promise<void> {
    await this.db.delete(priceBookChanges);
  }
}

// ── MemStorage (fallback) ─────────────────────────────────────────────────────

export class MemStorage implements IStorage {
  private liquorRecordsMap = new Map<string, LiquorRecord>();
  private scannedItemsMap = new Map<string, ScannedItem>();
  private sessionsMap = new Map<string, Session>();
  private customNameMappingsMap = new Map<string, CustomNameMapping>();
  private priceCompareMap = new Map<string, PriceCompareSession>();
  private activeSessionId: string | null = null;

  async createLiquorRecord(insertRecord: InsertLiquorRecord): Promise<LiquorRecord> {
    const id = randomUUID();
    const record: LiquorRecord = {
      id, ...insertRecord,
      adaNumber: insertRecord.adaNumber ?? null,
      adaName: insertRecord.adaName ?? null,
      vendorName: insertRecord.vendorName ?? null,
      proof: insertRecord.proof ?? null,
      bottleSize: insertRecord.bottleSize ?? null,
      packSize: insertRecord.packSize ?? null,
      onPremisePrice: insertRecord.onPremisePrice ?? null,
      offPremisePrice: insertRecord.offPremisePrice ?? null,
      shelfPrice: insertRecord.shelfPrice ?? null,
      upcCode1: insertRecord.upcCode1 ?? null,
      upcCode2: insertRecord.upcCode2 ?? null,
      effectiveDate: insertRecord.effectiveDate ?? null,
    };
    this.liquorRecordsMap.set(id, record);
    return record;
  }

  async bulkCreateLiquorRecords(records: InsertLiquorRecord[]): Promise<void> {
    for (const r of records) await this.createLiquorRecord(r);
  }

  async getLiquorRecords(): Promise<LiquorRecord[]> { return Array.from(this.liquorRecordsMap.values()); }
  async getLiquorRecordById(id: string): Promise<LiquorRecord | undefined> { return this.liquorRecordsMap.get(id); }
  async clearLiquorRecords(): Promise<void> { this.liquorRecordsMap.clear(); }

  async findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined> {
    return (await this.findAllLiquorByBarcode(barcode))[0];
  }

  async findAllLiquorByBarcode(barcode: string): Promise<LiquorRecord[]> {
    const norm = normalizeUpc(barcode);
    return Array.from(this.liquorRecordsMap.values()).filter(r => {
      if (r.upcCode1 === barcode || r.upcCode2 === barcode) return true;
      return normalizeUpc(r.upcCode1) === norm || normalizeUpc(r.upcCode2) === norm;
    });
  }

  async findAllLiquorByCode(code: string): Promise<LiquorRecord[]> {
    const norm = normalizeUpc(code);
    if (!norm || norm === '0') return [];
    return Array.from(this.liquorRecordsMap.values()).filter(r => normalizeUpc(r.liquorCode) === norm);
  }

  async getLiquorRecordCount(): Promise<number> { return this.liquorRecordsMap.size; }

  async searchLiquorRecords(query: string, limit = 10): Promise<{ results: LiquorRecord[], totalFound: number }> {
    const q = query.toLowerCase().trim();
    const norm = normalizeUpc(q);
    const all = Array.from(this.liquorRecordsMap.values()).filter(r => {
      if (r.liquorCode?.toLowerCase().includes(q)) return true;
      if (r.brandName?.toLowerCase().includes(q)) return true;
      if (r.upcCode1?.includes(q) || normalizeUpc(r.upcCode1) === norm) return true;
      if (r.upcCode2?.includes(q) || normalizeUpc(r.upcCode2) === norm) return true;
      if (r.vendorName?.toLowerCase().includes(q)) return true;
      return false;
    });
    return { results: all.slice(0, limit), totalFound: all.length };
  }

  async addScannedItem(insertItem: InsertScannedItem): Promise<ScannedItem> {
    const id = randomUUID();
    const item: ScannedItem = {
      id, sessionId: insertItem.sessionId,
      liquorRecordId: insertItem.liquorRecordId ?? null,
      scannedBarcode: insertItem.scannedBarcode,
      scannedAt: insertItem.scannedAt,
      quantity: insertItem.quantity ?? 1,
      overridePrice: insertItem.overridePrice ?? null,
    };
    this.scannedItemsMap.set(id, item);
    return item;
  }

  async getScannedItems(sessionId: string): Promise<ScannedItem[]> {
    return Array.from(this.scannedItemsMap.values()).filter(i => i.sessionId === sessionId);
  }

  async clearScannedItems(sessionId: string): Promise<void> {
    for (const [id, item] of Array.from(this.scannedItemsMap.entries()))
      if (item.sessionId === sessionId) this.scannedItemsMap.delete(id);
  }

  async deleteScannedItem(itemId: string): Promise<boolean> { return this.scannedItemsMap.delete(itemId); }

  async updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean> {
    const item = this.scannedItemsMap.get(itemId);
    if (!item) return false;
    this.scannedItemsMap.set(itemId, { ...item, overridePrice: newPrice });
    return true;
  }

  async createSession(insertSession: InsertSession, userId?: string): Promise<Session> {
    const id = randomUUID();
    const session: Session = {
      id, name: insertSession.name,
      userId: userId ?? null,
      createdAt: new Date(), updatedAt: new Date(),
      itemCount: insertSession.itemCount ?? 0,
      isActive: 1,
    };
    this.sessionsMap.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> { return this.sessionsMap.get(sessionId); }

  async getSessions(userId?: string): Promise<Session[]> {
    const all = Array.from(this.sessionsMap.values());
    const filtered = userId ? all.filter(s => s.userId === userId) : all;
    return filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async updateSessionItemCount(sessionId: string, count: number): Promise<void> {
    const s = this.sessionsMap.get(sessionId);
    if (s) { s.itemCount = count; s.updatedAt = new Date(); }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const deleted = this.sessionsMap.delete(sessionId);
    if (deleted && this.activeSessionId === sessionId) this.activeSessionId = null;
    await this.clearScannedItems(sessionId);
    return deleted;
  }

  async getActiveSession(userId?: string): Promise<Session | undefined> {
    if (!this.activeSessionId) return undefined;
    const s = this.sessionsMap.get(this.activeSessionId);
    if (userId && s?.userId !== userId) return undefined;
    return s;
  }

  async setActiveSession(sessionId: string): Promise<void> {
    if (this.sessionsMap.has(sessionId)) this.activeSessionId = sessionId;
  }

  async addCustomNameMapping(insertMapping: InsertCustomNameMapping, userId?: string): Promise<CustomNameMapping> {
    const id = randomUUID();
    const mapping: CustomNameMapping = {
      id, upcCode: insertMapping.upcCode,
      userId: userId ?? null,
      customName: insertMapping.customName, uploadedAt: new Date(),
    };
    this.customNameMappingsMap.set(id, mapping);
    return mapping;
  }

  async getCustomNameMappings(userId?: string): Promise<CustomNameMapping[]> {
    const all = Array.from(this.customNameMappingsMap.values());
    return userId ? all.filter(m => m.userId === userId) : all;
  }

  async clearCustomNameMappings(userId?: string): Promise<void> {
    if (userId) {
      for (const [id, m] of Array.from(this.customNameMappingsMap.entries()))
        if (m.userId === userId) this.customNameMappingsMap.delete(id);
    } else {
      this.customNameMappingsMap.clear();
    }
  }

  async getCustomNameByUpc(upcCode: string, userId?: string): Promise<string | undefined> {
    const norm = normalizeUpc(upcCode);
    const all = await this.getCustomNameMappings(userId);
    for (const m of all)
      if (m.upcCode === upcCode || normalizeUpc(m.upcCode) === norm) return m.customName;
    return undefined;
  }

  async savePriceCompareSession(userId: string, sessionId: string | null, sessionName: string, fileName: string, rowsJson: string): Promise<PriceCompareSession> {
    if (sessionId) {
      const existing = this.priceCompareMap.get(sessionId);
      if (existing && existing.userId === userId) {
        const updated = { ...existing, sessionName, fileName, rowsJson, updatedAt: new Date() };
        this.priceCompareMap.set(sessionId, updated);
        return updated;
      }
    }
    const id = randomUUID();
    const s: PriceCompareSession = { id, userId, sessionName, fileName, rowsJson, createdAt: new Date(), updatedAt: new Date() };
    this.priceCompareMap.set(id, s);
    return s;
  }

  async listPriceCompareSessions(userId: string): Promise<Pick<PriceCompareSession, 'id' | 'sessionName' | 'fileName' | 'updatedAt'>[]> {
    return Array.from(this.priceCompareMap.values())
      .filter(s => s.userId === userId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(({ id, sessionName, fileName, updatedAt }) => ({ id, sessionName, fileName, updatedAt }));
  }

  async getPriceCompareSession(userId: string, sessionId: string): Promise<PriceCompareSession | undefined> {
    const s = this.priceCompareMap.get(sessionId);
    return s?.userId === userId ? s : undefined;
  }

  async deletePriceCompareSession(sessionId: string): Promise<boolean> {
    return this.priceCompareMap.delete(sessionId);
  }

  // ── Price book changes ─────────────────────────────────────────────────────

  private priceChangesMap = new Map<string, string | null>();

  async getPriceChange(liquorCode: string): Promise<string | null> {
    return this.priceChangesMap.has(liquorCode) ? (this.priceChangesMap.get(liquorCode) ?? null) : null;
  }

  async getPriceChangeBatch(liquorCodes: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    for (const code of liquorCodes) {
      if (this.priceChangesMap.has(code)) map.set(code, this.priceChangesMap.get(code) ?? null);
    }
    return map;
  }

  async bulkUpsertPriceChanges(changes: Array<{ liquorCode: string; newChng: string | null }>): Promise<void> {
    for (const c of changes) this.priceChangesMap.set(c.liquorCode, c.newChng);
  }

  async clearPriceBookChanges(): Promise<void> {
    this.priceChangesMap.clear();
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────
export const storage: IStorage = process.env.DATABASE_URL
  ? new DatabaseStorage(process.env.DATABASE_URL)
  : new MemStorage();
