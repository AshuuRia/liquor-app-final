import { sql } from "drizzle-orm";
import { pgTable, text, varchar, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Liquor record schema based on fixed-width format
export const liquorRecords = pgTable("liquor_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  liquorCode: text("liquor_code").notNull(),
  brandName: text("brand_name").notNull(),
  adaNumber: text("ada_number"),
  adaName: text("ada_name"),
  vendorName: text("vendor_name"),
  proof: text("proof"),
  bottleSize: text("bottle_size"),
  packSize: text("pack_size"),
  onPremisePrice: real("on_premise_price"),
  offPremisePrice: real("off_premise_price"),
  shelfPrice: real("shelf_price"),
  upcCode1: text("upc_code_1"),
  upcCode2: text("upc_code_2"),
  effectiveDate: text("effective_date"),
});

export const insertLiquorRecordSchema = createInsertSchema(liquorRecords).omit({
  id: true,
});

export type InsertLiquorRecord = z.infer<typeof insertLiquorRecordSchema>;
export type LiquorRecord = typeof liquorRecords.$inferSelect;

// File processing result schema
export const fileProcessingResult = z.object({
  success: z.boolean(),
  totalRecords: z.number(),
  uniqueBrands: z.number(),
  uniqueVendors: z.number(),
  avgPrice: z.number(),
  records: z.array(z.object({
    liquorCode: z.string(),
    brandName: z.string(),
    adaNumber: z.string(),
    adaName: z.string(),
    vendorName: z.string(),
    proof: z.string(),
    bottleSize: z.string(),
    packSize: z.string(),
    onPremisePrice: z.union([z.number(), z.string()]),
    offPremisePrice: z.union([z.number(), z.string()]),
    shelfPrice: z.union([z.number(), z.string()]),
    upcCode1: z.string(),
    upcCode2: z.string(),
    effectiveDate: z.string(),
  })),
  error: z.string().optional(),
});

export type FileProcessingResult = z.infer<typeof fileProcessingResult>;

// Scanned items schema for barcode scanning workflow
export const scannedItems = pgTable("scanned_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(), // To group scans by session
  liquorRecordId: text("liquor_record_id"), // Reference to original liquor record
  scannedBarcode: text("scanned_barcode").notNull(),
  scannedAt: text("scanned_at").notNull(),
  quantity: integer("quantity").default(1),
  overridePrice: real("override_price"), // user-set price override
});

export const insertScannedItemSchema = createInsertSchema(scannedItems).omit({
  id: true,
});

export type InsertScannedItem = z.infer<typeof insertScannedItemSchema>;
export type ScannedItem = typeof scannedItems.$inferSelect;

// Schema for barcode scan result
export const barcodeScanResult = z.object({
  success: z.boolean(),
  barcode: z.string(),
  matchedProduct: z.object({
    liquorCode: z.string(),
    brandName: z.string(),
    adaNumber: z.string(),
    adaName: z.string(),
    vendorName: z.string(),
    proof: z.string(),
    bottleSize: z.string(),
    packSize: z.string(),
    onPremisePrice: z.union([z.number(), z.string()]),
    offPremisePrice: z.union([z.number(), z.string()]),
    shelfPrice: z.union([z.number(), z.string()]),
    upcCode1: z.string(),
    upcCode2: z.string(),
    effectiveDate: z.string(),
  }).optional(),
  error: z.string().optional(),
});

export type BarcodeScanResult = z.infer<typeof barcodeScanResult>;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Sessions table for managing scan sessions
export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  itemCount: integer("item_count").default(0),
  isActive: integer("is_active").default(1), // 1 for active, 0 for archived
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

// Custom name mappings table for P-touch CSV overrides
export const customNameMappings = pgTable("custom_name_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  upcCode: text("upc_code").notNull(),
  customName: text("custom_name").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const insertCustomNameMappingSchema = createInsertSchema(customNameMappings).omit({
  id: true,
  uploadedAt: true,
});

export type InsertCustomNameMapping = z.infer<typeof insertCustomNameMappingSchema>;
export type CustomNameMapping = typeof customNameMappings.$inferSelect;
