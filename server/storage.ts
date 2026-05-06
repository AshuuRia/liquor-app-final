import { type User, type InsertUser, type LiquorRecord, type InsertLiquorRecord, type ScannedItem, type InsertScannedItem, type Session, type InsertSession, type CustomNameMapping, type InsertCustomNameMapping } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Liquor record methods
  createLiquorRecord(record: InsertLiquorRecord): Promise<LiquorRecord>;
  getLiquorRecords(): Promise<LiquorRecord[]>;
  clearLiquorRecords(): Promise<void>;
  findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined>;
  findAllLiquorByBarcode(barcode: string): Promise<LiquorRecord[]>;
  findAllLiquorByCode(code: string): Promise<LiquorRecord[]>;
  getLiquorRecordCount(): Promise<number>;
  
  // Scanned items methods
  addScannedItem(item: InsertScannedItem): Promise<ScannedItem>;
  getScannedItems(sessionId: string): Promise<ScannedItem[]>;
  clearScannedItems(sessionId: string): Promise<void>;
  deleteScannedItem(itemId: string): Promise<boolean>;
  updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean>;
  
  // Session methods
  createSession(session: InsertSession): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  getSessions(): Promise<Session[]>;
  updateSessionItemCount(sessionId: string, count: number): Promise<void>;
  deleteSession(sessionId: string): Promise<boolean>;
  getActiveSession(): Promise<Session | undefined>;
  setActiveSession(sessionId: string): Promise<void>;
  
  // Custom name mapping methods
  addCustomNameMapping(mapping: InsertCustomNameMapping): Promise<CustomNameMapping>;
  getCustomNameMappings(): Promise<CustomNameMapping[]>;
  clearCustomNameMappings(): Promise<void>;
  getCustomNameByUpc(upcCode: string): Promise<string | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private liquorRecords: Map<string, LiquorRecord>;
  private scannedItems: Map<string, ScannedItem>;
  private sessions: Map<string, Session>;
  private customNameMappings: Map<string, CustomNameMapping>;
  private activeSessionId: string | null;

  constructor() {
    this.users = new Map();
    this.liquorRecords = new Map();
    this.scannedItems = new Map();
    this.sessions = new Map();
    this.customNameMappings = new Map();
    this.activeSessionId = null;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
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
      id,
      ...insertRecord,
      adaNumber: insertRecord.adaNumber || null,
      adaName: insertRecord.adaName || null,
      vendorName: insertRecord.vendorName || null,
      proof: insertRecord.proof || null,
      bottleSize: insertRecord.bottleSize || null,
      packSize: insertRecord.packSize || null,
      onPremisePrice: insertRecord.onPremisePrice || null,
      offPremisePrice: insertRecord.offPremisePrice || null,
      shelfPrice: insertRecord.shelfPrice || null,
      upcCode1: insertRecord.upcCode1 || null,
      upcCode2: insertRecord.upcCode2 || null,
      effectiveDate: insertRecord.effectiveDate || null,
    };
    this.liquorRecords.set(id, record);
    return record;
  }

  async getLiquorRecords(): Promise<LiquorRecord[]> {
    return Array.from(this.liquorRecords.values());
  }

  async clearLiquorRecords(): Promise<void> {
    this.liquorRecords.clear();
  }

  async findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined> {
    const results = await this.findAllLiquorByBarcode(barcode);
    return results[0];
  }

  async findAllLiquorByBarcode(barcode: string): Promise<LiquorRecord[]> {
    const normalizeUpc = (upc: string | null): string => {
      if (!upc) return '';
      return upc.replace(/^0+/, '') || '0';
    };

    const normalizedBarcode = normalizeUpc(barcode);

    return Array.from(this.liquorRecords.values()).filter((record) => {
      const normalizedUpc1 = normalizeUpc(record.upcCode1);
      const normalizedUpc2 = normalizeUpc(record.upcCode2);

      if (record.upcCode1 === barcode || record.upcCode2 === barcode) return true;
      return normalizedUpc1 === normalizedBarcode || normalizedUpc2 === normalizedBarcode;
    });
  }

  async findAllLiquorByCode(code: string): Promise<LiquorRecord[]> {
    const normalizeCode = (c: string | null): string => {
      if (!c) return '';
      return c.replace(/^0+/, '') || '0';
    };
    const normalized = normalizeCode(code);
    if (!normalized || normalized === '0') return [];
    return Array.from(this.liquorRecords.values()).filter(record =>
      normalizeCode(record.liquorCode) === normalized
    );
  }

  async getLiquorRecordCount(): Promise<number> {
    return this.liquorRecords.size;
  }

  async addScannedItem(insertItem: InsertScannedItem): Promise<ScannedItem> {
    const id = randomUUID();
    const item: ScannedItem = {
      id,
      sessionId: insertItem.sessionId,
      liquorRecordId: insertItem.liquorRecordId || null,
      scannedBarcode: insertItem.scannedBarcode,
      scannedAt: insertItem.scannedAt,
      quantity: insertItem.quantity || 1,
    };
    this.scannedItems.set(id, item);
    return item;
  }

  async getScannedItems(sessionId: string): Promise<ScannedItem[]> {
    return Array.from(this.scannedItems.values()).filter(
      (item) => item.sessionId === sessionId
    );
  }

  async clearScannedItems(sessionId: string): Promise<void> {
    const itemsToDelete = Array.from(this.scannedItems.entries())
      .filter(([_, item]) => item.sessionId === sessionId)
      .map(([id, _]) => id);
    
    itemsToDelete.forEach(id => this.scannedItems.delete(id));
  }

  async deleteScannedItem(itemId: string): Promise<boolean> {
    return this.scannedItems.delete(itemId);
  }

  async updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean> {
    const item = this.scannedItems.get(itemId);
    if (!item) return false;
    
    // Update the price by modifying the liquor record for this specific scanned item
    // Note: This creates a copy of the liquor record with updated price for this session
    const liquorRecord = item.liquorRecordId ? this.liquorRecords.get(item.liquorRecordId) : null;
    if (liquorRecord) {
      // Create a new temporary record with updated price
      const updatedRecord: LiquorRecord = {
        ...liquorRecord,
        shelfPrice: newPrice
      };
      // Store it as a new record and update the scanned item reference
      const newRecordId = randomUUID();
      this.liquorRecords.set(newRecordId, updatedRecord);
      
      // Update the scanned item to reference the new record
      const updatedItem: ScannedItem = {
        ...item,
        liquorRecordId: newRecordId
      };
      this.scannedItems.set(itemId, updatedItem);
      return true;
    }
    return false;
  }

  // Session methods
  async createSession(insertSession: InsertSession): Promise<Session> {
    const id = randomUUID();
    const session: Session = {
      id,
      name: insertSession.name,
      createdAt: new Date(),
      updatedAt: new Date(),
      itemCount: insertSession.itemCount || 0,
      isActive: insertSession.isActive || 1,
    };
    this.sessions.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    return this.sessions.get(sessionId);
  }

  async getSessions(): Promise<Session[]> {
    return Array.from(this.sessions.values()).sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async updateSessionItemCount(sessionId: string, count: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.itemCount = count;
      session.updatedAt = new Date();
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const deleted = this.sessions.delete(sessionId);
    if (deleted && this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    // Also clear scanned items for this session
    await this.clearScannedItems(sessionId);
    return deleted;
  }

  async getActiveSession(): Promise<Session | undefined> {
    if (this.activeSessionId) {
      return this.sessions.get(this.activeSessionId);
    }
    return undefined;
  }

  async setActiveSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.activeSessionId = sessionId;
    }
  }

  // Custom name mapping methods
  async addCustomNameMapping(insertMapping: InsertCustomNameMapping): Promise<CustomNameMapping> {
    const id = randomUUID();
    const mapping: CustomNameMapping = {
      id,
      upcCode: insertMapping.upcCode,
      customName: insertMapping.customName,
      uploadedAt: new Date(),
    };
    this.customNameMappings.set(id, mapping);
    return mapping;
  }

  async getCustomNameMappings(): Promise<CustomNameMapping[]> {
    return Array.from(this.customNameMappings.values());
  }

  async clearCustomNameMappings(): Promise<void> {
    this.customNameMappings.clear();
  }

  async getCustomNameByUpc(upcCode: string): Promise<string | undefined> {
    // Helper function to normalize UPC codes by removing leading zeros
    const normalizeUpc = (upc: string): string => {
      return upc.replace(/^0+/, '') || '0';
    };

    const normalizedInputUpc = normalizeUpc(upcCode);
    
    for (const mapping of Array.from(this.customNameMappings.values())) {
      const normalizedMappingUpc = normalizeUpc(mapping.upcCode);
      
      // Try exact match first, then normalized match
      if (mapping.upcCode === upcCode || normalizedMappingUpc === normalizedInputUpc) {
        return mapping.customName;
      }
    }
    
    return undefined;
  }
}

// Import database storage when needed
class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async createUser(user: InsertUser): Promise<User> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async createLiquorRecord(record: InsertLiquorRecord): Promise<LiquorRecord> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async getLiquorRecords(): Promise<LiquorRecord[]> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async clearLiquorRecords(): Promise<void> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async findLiquorByBarcode(barcode: string): Promise<LiquorRecord | undefined> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async addScannedItem(item: InsertScannedItem): Promise<ScannedItem> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async getScannedItems(sessionId: string): Promise<ScannedItem[]> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async clearScannedItems(sessionId: string): Promise<void> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async deleteScannedItem(itemId: string): Promise<boolean> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async updateScannedItemPrice(itemId: string, newPrice: number): Promise<boolean> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async createSession(session: InsertSession): Promise<Session> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async getSession(sessionId: string): Promise<Session | undefined> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async getSessions(): Promise<Session[]> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async updateSessionItemCount(sessionId: string, count: number): Promise<void> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async deleteSession(sessionId: string): Promise<boolean> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async getActiveSession(): Promise<Session | undefined> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async setActiveSession(sessionId: string): Promise<void> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async addCustomNameMapping(mapping: InsertCustomNameMapping): Promise<CustomNameMapping> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async getCustomNameMappings(): Promise<CustomNameMapping[]> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async clearCustomNameMappings(): Promise<void> {
    throw new Error("Not implemented - using memory storage for now");
  }
  
  async getCustomNameByUpc(upcCode: string): Promise<string | undefined> {
    throw new Error("Not implemented - using memory storage for now");
  }
}

export const storage = new MemStorage();
