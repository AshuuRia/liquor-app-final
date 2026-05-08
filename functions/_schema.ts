import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const liquorRecords = sqliteTable("liquor_records", {
  id: text("id").primaryKey(),
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

export const scannedItems = sqliteTable("scanned_items", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  liquorRecordId: text("liquor_record_id"),
  scannedBarcode: text("scanned_barcode").notNull(),
  scannedAt: text("scanned_at").notNull(),
  quantity: integer("quantity").default(1),
  overridePrice: real("override_price"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  itemCount: integer("item_count").default(0),
  isActive: integer("is_active").default(1),
});

export const customNameMappings = sqliteTable("custom_name_mappings", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  upcCode: text("upc_code").notNull(),
  customName: text("custom_name").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
});

export const priceCompareSessions = sqliteTable("price_compare_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  rowsJson: text("rows_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
