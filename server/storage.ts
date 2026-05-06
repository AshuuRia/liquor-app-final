import {
  type User, type InsertUser,
  type LiquorRecord, type InsertLiquorRecord,
  type ScannedItem, type InsertScannedItem,
  type Session, type InsertSession,
  type CustomNameMapping, type InsertCustomNameMapping,
  scannedItems, sessions, customNameMappings, users,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
const { Pool } = pg;
import { eq, sql, or } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Liquor record methods (always in-memory — re-fetched from Michigan on startup)
  createLiquorRecord(record: InsertLiquorRecord): Promise<LiquorRecord>;
  bulkCreateLiquorRecords(records: InsertLiquorRecord[]): Promise<void>;
  getLiquorRecords(): Promise<LiquorRecord[]>;
  clearLiquorRecords(): Promise<void>;
  findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined>;
  findAllLiquorByBarcode(barcode: string): Promise<LiquorRecord[]>;
  findAllLiquorByCode(code: string): Promise<LiquorRecord[]>;
  getLiquorRecordCount(): Promise<number>;

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeUpc(upc: string | null | undefined): string {
  if (!upc) return '';
  return upc.replace(/^0+/, '') || '0';
}

// ── DatabaseStorage ──────────────────────────────────────────────────────────
// Liquor records stay in memory (they're always cleared & re-fetched on startup).
// Sessions, scanned items, and custom name mappings go to the database so they
// survive server restarts / sleep cycles.

export class DatabaseStorage implements IStorage {
  private db: ReturnType<typeof drizzle>;

  // In-memory liquor store
  private liquorMap = new Map<string, LiquorRecord>();
  private users = new Map<string, User>();

  constructor() {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    this.db = drizzle(pool);
  }

  // ── Users ──────────────────────────────────────────────────────────────────
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

  // ── Liquor records (in-memory) ─────────────────────────────────────────────
  async createLiquorRecord(record: InsertLiquorRecord): Promise<LiquorRecord> {
    const id = randomUUID();
    const r: LiquorRecord = {
      id, ...record,
      adaNumber: record.adaNumber ?? null,
      adaName: record.adaName ?? null,
      vendorName: record.vendorName ?? null,
      proof: record.proof ?? null,
      bottleSize: record.bottleSize ?? null,
      packSize: record.packSize ?? null,
      onPremisePrice: record.onPremisePrice ?? null,
      offPremisePrice: record.offPremisePrice ?? null,
      shelfPrice: record.shelfPrice ?? null,
      upcCode1: record.upcCode1 ?? null,
      upcCode2: record.upcCode2 ?? null,
      effectiveDate: record.effectiveDate ?? null,
    };
    this.liquorMap.set(id, r);
    return r;
  }

  async bulkCreateLiquorRecords(records: InsertLiquorRecord[]): Promise<void> {
    for (const r of records) await this.createLiquorRecord(r);
  }

  async getLiquorRecords(): Promise<LiquorRecord[]> {
    return Array.from(this.liquorMap.values());
  }

  async clearLiquorRecords(): Promise<void> {
    this.liquorMap.clear();
  }

  async findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined> {
    return (await this.findAllLiquorByBarcode(barcode))[0];
  }

  async findAllLiquorByBarcode(barcode: string): Promise<LiquorRecord[]> {
    const norm = normalizeUpc(barcode);
    return Array.from(this.liquorMap.values()).filter(r => {
      if (r.upcCode1 === barcode || r.upcCode2 === barcode) return true;
      return normalizeUpc(r.upcCode1) === norm || normalizeUpc(r.upcCode2) === norm;
    });
  }

  async findAllLiquorByCode(code: string): Promise<LiquorRecord[]> {
    const norm = normalizeUpc(code);
    if (!norm || norm === '0') return [];
    return Array.from(this.liquorMap.values()).filter(r =>
      normalizeUpc(r.liquorCode) === norm
    );
  }

  async getLiquorRecordCount(): Promise<number> {
    return this.liquorMap.size;
  }

  // ── Scanned items (database) ───────────────────────────────────────────────
  async addScannedItem(insertItem: InsertScannedItem): Promise<ScannedItem> {
    const id = randomUUID();
    const result = await this.db.insert(scannedItems).values({ ...insertItem, id }).returning();
    return result[0];
  }

  async getScannedItems(sessionId: string): Promise<ScannedItem[]> {
    return this.db.select().from(scannedItems).where(eq(scannedItems.sessionId, sessionId));
  }

  async clearScannedItems(sessionId: string): Promise<void> {
    await this.db.delete(scannedItems).where(eq(scannedItems.sessionId, sessionId));
  }

  async deleteScannedItem(itemId: string): Promise<boolean> {
    const r = await this.db.delete(scannedItems).where(eq(scannedItems.id, itemId)).returning();
    return r.length > 0;
  }

  async updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean> {
    // Price override is stored by swapping to a modified in-memory liquor record id.
    // Retrieve the scanned item first to find its current liquor record.
    const rows = await this.db.select().from(scannedItems).where(eq(scannedItems.id, itemId)).limit(1);
    if (!rows[0] || !rows[0].liquorRecordId) return false;

    const liquorRecord = this.liquorMap.get(rows[0].liquorRecordId);
    if (!liquorRecord) return false;

    // Clone the record in memory with the new price and point the scanned item at it
    const newId = randomUUID();
    this.liquorMap.set(newId, { ...liquorRecord, id: newId, shelfPrice: newPrice });
    await this.db.update(scannedItems).set({ liquorRecordId: newId }).where(eq(scannedItems.id, itemId));
    return true;
  }

  // ── Sessions (database) ────────────────────────────────────────────────────
  async createSession(insertSession: InsertSession): Promise<Session> {
    const id = randomUUID();
    // Deactivate all others, then insert new active session
    await this.db.update(sessions).set({ isActive: 0 });
    const result = await this.db.insert(sessions).values({
      id,
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
    const id = randomUUID();
    const r = await this.db.insert(customNameMappings).values({ ...insertMapping, id }).returning();
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
  private liquorRecords = new Map<string, LiquorRecord>();
  private scannedItems = new Map<string, ScannedItem>();
  private sessions = new Map<string, Session>();
  private customNameMappings = new Map<string, CustomNameMapping>();
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
    this.liquorRecords.set(id, record);
    return record;
  }

  async bulkCreateLiquorRecords(records: InsertLiquorRecord[]): Promise<void> {
    for (const r of records) await this.createLiquorRecord(r);
  }

  async getLiquorRecords(): Promise<LiquorRecord[]> { return Array.from(this.liquorRecords.values()); }
  async clearLiquorRecords(): Promise<void> { this.liquorRecords.clear(); }

  async findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined> {
    return (await this.findAllLiquorByBarcode(barcode))[0];
  }

  async findAllLiquorByBarcode(barcode: string): Promise<LiquorRecord[]> {
    const norm = normalizeUpc(barcode);
    return Array.from(this.liquorRecords.values()).filter(r => {
      if (r.upcCode1 === barcode || r.upcCode2 === barcode) return true;
      return normalizeUpc(r.upcCode1) === norm || normalizeUpc(r.upcCode2) === norm;
    });
  }

  async findAllLiquorByCode(code: string): Promise<LiquorRecord[]> {
    const norm = normalizeUpc(code);
    if (!norm || norm === '0') return [];
    return Array.from(this.liquorRecords.values()).filter(r => normalizeUpc(r.liquorCode) === norm);
  }

  async getLiquorRecordCount(): Promise<number> { return this.liquorRecords.size; }

  async addScannedItem(insertItem: InsertScannedItem): Promise<ScannedItem> {
    const id = randomUUID();
    const item: ScannedItem = {
      id,
      sessionId: insertItem.sessionId,
      liquorRecordId: insertItem.liquorRecordId ?? null,
      scannedBarcode: insertItem.scannedBarcode,
      scannedAt: insertItem.scannedAt,
      quantity: insertItem.quantity ?? 1,
    };
    this.scannedItems.set(id, item);
    return item;
  }

  async getScannedItems(sessionId: string): Promise<ScannedItem[]> {
    return Array.from(this.scannedItems.values()).filter(i => i.sessionId === sessionId);
  }

  async clearScannedItems(sessionId: string): Promise<void> {
    for (const [id, item] of this.scannedItems)
      if (item.sessionId === sessionId) this.scannedItems.delete(id);
  }

  async deleteScannedItem(itemId: string): Promise<boolean> { return this.scannedItems.delete(itemId); }

  async updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean> {
    const item = this.scannedItems.get(itemId);
    if (!item) return false;
    const rec = item.liquorRecordId ? this.liquorRecords.get(item.liquorRecordId) : null;
    if (!rec) return false;
    const newId = randomUUID();
    this.liquorRecords.set(newId, { ...rec, id: newId, shelfPrice: newPrice });
    this.scannedItems.set(itemId, { ...item, liquorRecordId: newId });
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
    this.sessions.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> { return this.sessions.get(sessionId); }

  async getSessions(): Promise<Session[]> {
    return Array.from(this.sessions.values()).sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async updateSessionItemCount(sessionId: string, count: number): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) { s.itemCount = count; s.updatedAt = new Date(); }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const deleted = this.sessions.delete(sessionId);
    if (deleted && this.activeSessionId === sessionId) this.activeSessionId = null;
    await this.clearScannedItems(sessionId);
    return deleted;
  }

  async getActiveSession(): Promise<Session | undefined> {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  async setActiveSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) this.activeSessionId = sessionId;
  }

  async addCustomNameMapping(insertMapping: InsertCustomNameMapping): Promise<CustomNameMapping> {
    const id = randomUUID();
    const mapping: CustomNameMapping = {
      id, upcCode: insertMapping.upcCode,
      customName: insertMapping.customName, uploadedAt: new Date(),
    };
    this.customNameMappings.set(id, mapping);
    return mapping;
  }

  async getCustomNameMappings(): Promise<CustomNameMapping[]> {
    return Array.from(this.customNameMappings.values());
  }

  async clearCustomNameMappings(): Promise<void> { this.customNameMappings.clear(); }

  async getCustomNameByUpc(upcCode: string): Promise<string | undefined> {
    const norm = normalizeUpc(upcCode);
    for (const m of this.customNameMappings.values())
      if (m.upcCode === upcCode || normalizeUpc(m.upcCode) === norm) return m.customName;
    return undefined;
  }
}

// Use DatabaseStorage when DATABASE_URL is set, otherwise fall back to memory
export const storage: IStorage = process.env.DATABASE_URL
  ? new DatabaseStorage()
  : new MemStorage();
