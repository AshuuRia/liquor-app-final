import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, or, sql, ilike } from 'drizzle-orm';
import {
  type User, type InsertUser,
  type LiquorRecord, type InsertLiquorRecord,
  type ScannedItem, type InsertScannedItem,
  type Session, type InsertSession,
  type CustomNameMapping, type InsertCustomNameMapping,
  liquorRecords, scannedItems, sessions, customNameMappings, users,
} from "@shared/schema";
import { randomUUID } from "crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeUpc(upc: string | null | undefined): string {
  if (!upc) return '';
  return upc.replace(/^0+/, '') || '0';
}

// ── Storage interface ─────────────────────────────────────────────────────────

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

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

  // Scanned items methods (persisted)
  addScannedItem(item: InsertScannedItem): Promise<ScannedItem>;
  getScannedItems(sessionId: string): Promise<ScannedItem[]>;
  clearScannedItems(sessionId: string): Promise<void>;
  deleteScannedItem(itemId: string): Promise<boolean>;
  updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean>;

  // Session methods (persisted)
  createSession(session: InsertSession): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  getSessions(): Promise<Session[]>;
  updateSessionItemCount(sessionId: string, count: number): Promise<void>;
  deleteSession(sessionId: string): Promise<boolean>;
  getActiveSession(): Promise<Session | undefined>;
  setActiveSession(sessionId: string): Promise<void>;

  // Custom name mapping methods (persisted)
  addCustomNameMapping(mapping: InsertCustomNameMapping): Promise<CustomNameMapping>;
  getCustomNameMappings(): Promise<CustomNameMapping[]>;
  clearCustomNameMappings(): Promise<void>;
  getCustomNameByUpc(upcCode: string): Promise<string | undefined>;
}

// ── DatabaseStorage ───────────────────────────────────────────────────────────
// Uses the standard postgres.js driver — works with Replit's PostgreSQL.

export class DatabaseStorage implements IStorage {
  private db: ReturnType<typeof drizzle>;
  private users = new Map<string, User>();

  constructor(databaseUrl: string) {
    const client = postgres(databaseUrl, { max: 10 });
    this.db = drizzle(client);
  }

  // ── Users (in-memory, not persisted — unused in practice) ─────────────────
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }
  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.username === username);
  }
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // ── Liquor records (database) ──────────────────────────────────────────────

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

  // ── Scanned items (database) ───────────────────────────────────────────────

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

  // ── Sessions (database) ────────────────────────────────────────────────────

  async createSession(insertSession: InsertSession): Promise<Session> {
    await this.db.update(sessions).set({ isActive: 0 });
    const result = await this.db.insert(sessions).values({
      name: insertSession.name,
      itemCount: insertSession.itemCount ?? 0,
      isActive: 1,
    }).returning();
    return result[0];
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const r = await this.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return r[0];
  }

  async getSessions(): Promise<Session[]> {
    return this.db.select().from(sessions).orderBy(sql`${sessions.updatedAt} desc`);
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

  async getActiveSession(): Promise<Session | undefined> {
    const r = await this.db.select().from(sessions)
      .where(eq(sessions.isActive, 1))
      .orderBy(sql`${sessions.updatedAt} desc`)
      .limit(1);
    return r[0];
  }

  async setActiveSession(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ isActive: 0 });
    await this.db.update(sessions)
      .set({ isActive: 1, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  // ── Custom name mappings (database) ────────────────────────────────────────

  async addCustomNameMapping(insertMapping: InsertCustomNameMapping): Promise<CustomNameMapping> {
    const r = await this.db.insert(customNameMappings).values(insertMapping).returning();
    return r[0];
  }

  async getCustomNameMappings(): Promise<CustomNameMapping[]> {
    return this.db.select().from(customNameMappings);
  }

  async clearCustomNameMappings(): Promise<void> {
    await this.db.delete(customNameMappings);
  }

  async getCustomNameByUpc(upcCode: string): Promise<string | undefined> {
    const norm = normalizeUpc(upcCode);
    const all = await this.db.select().from(customNameMappings).where(
      or(
        eq(customNameMappings.upcCode, upcCode),
        sql`ltrim(${customNameMappings.upcCode}, '0') = ${norm}`,
      )
    );
    return all[0]?.customName;
  }
}

// ── MemStorage (fallback — no DATABASE_URL) ───────────────────────────────────

export class MemStorage implements IStorage {
  private users = new Map<string, User>();
  private liquorRecordsMap = new Map<string, LiquorRecord>();
  private scannedItemsMap = new Map<string, ScannedItem>();
  private sessionsMap = new Map<string, Session>();
  private customNameMappingsMap = new Map<string, CustomNameMapping>();
  private activeSessionId: string | null = null;

  async getUser(id: string): Promise<User | undefined> { return this.users.get(id); }
  async getUserByUsername(u: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(x => x.username === u);
  }
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

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
      id,
      sessionId: insertItem.sessionId,
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
    for (const [id, item] of this.scannedItemsMap)
      if (item.sessionId === sessionId) this.scannedItemsMap.delete(id);
  }

  async deleteScannedItem(itemId: string): Promise<boolean> { return this.scannedItemsMap.delete(itemId); }

  async updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean> {
    const item = this.scannedItemsMap.get(itemId);
    if (!item) return false;
    this.scannedItemsMap.set(itemId, { ...item, overridePrice: newPrice });
    return true;
  }

  async createSession(insertSession: InsertSession): Promise<Session> {
    const id = randomUUID();
    const session: Session = {
      id, name: insertSession.name,
      createdAt: new Date(), updatedAt: new Date(),
      itemCount: insertSession.itemCount ?? 0,
      isActive: insertSession.isActive ?? 1,
    };
    this.sessionsMap.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> { return this.sessionsMap.get(sessionId); }

  async getSessions(): Promise<Session[]> {
    return Array.from(this.sessionsMap.values()).sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
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

  async getActiveSession(): Promise<Session | undefined> {
    return this.activeSessionId ? this.sessionsMap.get(this.activeSessionId) : undefined;
  }

  async setActiveSession(sessionId: string): Promise<void> {
    if (this.sessionsMap.has(sessionId)) this.activeSessionId = sessionId;
  }

  async addCustomNameMapping(insertMapping: InsertCustomNameMapping): Promise<CustomNameMapping> {
    const id = randomUUID();
    const mapping: CustomNameMapping = {
      id, upcCode: insertMapping.upcCode,
      customName: insertMapping.customName, uploadedAt: new Date(),
    };
    this.customNameMappingsMap.set(id, mapping);
    return mapping;
  }

  async getCustomNameMappings(): Promise<CustomNameMapping[]> {
    return Array.from(this.customNameMappingsMap.values());
  }

  async clearCustomNameMappings(): Promise<void> { this.customNameMappingsMap.clear(); }

  async getCustomNameByUpc(upcCode: string): Promise<string | undefined> {
    const norm = normalizeUpc(upcCode);
    for (const m of this.customNameMappingsMap.values())
      if (m.upcCode === upcCode || normalizeUpc(m.upcCode) === norm) return m.customName;
    return undefined;
  }
}

// ── Singleton for the Express server ──────────────────────────────────────────
export const storage: IStorage = process.env.DATABASE_URL
  ? new DatabaseStorage(process.env.DATABASE_URL)
  : new MemStorage();
