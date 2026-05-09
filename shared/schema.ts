import { sql } from "drizzle-orm";
import { pgTable, text, varchar, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Export Replit Auth models (users + http_sessions tables)
export * from "./models/auth";

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

export const insertLiquorRecordSchema = createInsertSchema(liquorRecords).omit({ id: true });
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

// Scanned items
export const scannedItems = pgTable("scanned_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  liquorRecordId: text("liquor_record_id"),
  scannedBarcode: text("scanned_barcode").notNull(),
  scannedAt: text("scanned_at").notNull(),
  quantity: integer("quantity").default(1),
  overridePrice: real("override_price"),
});

export const insertScannedItemSchema = createInsertSchema(scannedItems).omit({ id: true });
export type InsertScannedItem = z.infer<typeof insertScannedItemSchema>;
export type ScannedItem = typeof scannedItems.$inferSelect;

// Scan sessions — now with userId for cross-device sync
export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id"),  // Replit Auth user id; nullable for backward compat
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  itemCount: integer("item_count").default(0),
  isActive: integer("is_active").default(1),
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

// Custom name mappings — now with userId
export const customNameMappings = pgTable("custom_name_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id"),  // nullable for backward compat
  upcCode: text("upc_code").notNull(),
  customName: text("custom_name").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const insertCustomNameMappingSchema = createInsertSchema(customNameMappings).omit({
  id: true, uploadedAt: true,
});
export type InsertCustomNameMapping = z.infer<typeof insertCustomNameMappingSchema>;
export type CustomNameMapping = typeof customNameMappings.$inferSelect;

// Price compare sessions — save CSV comparison state per user for cross-device sync
export const priceCompareSessions = pgTable("price_compare_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  sessionName: text("session_name").notNull().default('Auto-save'),
  fileName: text("file_name").notNull(),
  rowsJson: text("rows_json").notNull(),  // JSON blob of ComparisonRow[]
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPriceCompareSessionSchema = createInsertSchema(priceCompareSessions).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertPriceCompareSession = z.infer<typeof insertPriceCompareSessionSchema>;
export type PriceCompareSession = typeof priceCompareSessions.$inferSelect;

// Price book changes — imported from Michigan Excel price book
export const priceBookChanges = pgTable("price_book_changes", {
  liquorCode: text("liquor_code").primaryKey(),
  newChng: text("new_chng"),  // null=no change, "new"=new product, "1.50"/"-1.50"=price delta
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PriceBookChange = typeof priceBookChanges.$inferSelect;

// Barcode scan result schema
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
