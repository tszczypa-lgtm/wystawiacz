import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  plan: text("plan", { enum: ["trial", "starter", "pro", "paused"] }).notNull().default("trial"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  role: text("role", { enum: ["owner", "manager", "pricing"] }).notNull().default("manager"),
  passwordHash: text("password_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  provider: text("provider", { enum: ["stripe", "przelewy24", "manual"] }).notNull().default("stripe"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  status: text("status", { enum: ["trialing", "active", "past_due", "canceled", "manual"] }).notNull().default("trialing"),
  currentPeriodEnd: text("current_period_end"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const allegroConnections = sqliteTable("allegro_connections", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  accountName: text("account_name").notNull().default(""),
  sellerId: text("seller_id"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: text("token_expires_at"),
  scopes: text("scopes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const listingSessions = sqliteTable("listing_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "pricing", "ready", "published"] }).notNull().default("draft"),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const vehicleModels = sqliteTable("vehicle_models", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  manufacturer: text("manufacturer").notNull(),
  shortName: text("short_name").notNull(),
  fullDescription: text("full_description").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const listings = sqliteTable("listings", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => listingSessions.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  title: text("title").notNull(),
  enteredPartNumber: text("entered_part_number").notNull().default(""),
  originalCatalogNumber: text("original_catalog_number").notNull().default(""),
  categoryId: text("category_id").notNull().default(""),
  categoryPath: text("category_path").notNull().default(""),
  manufacturer: text("manufacturer").notNull().default(""),
  description: text("description").notNull().default(""),
  requiredParametersJson: text("required_parameters_json").notNull().default("{}"),
  priceCents: integer("price_cents"),
  stock: integer("stock").notNull().default(1),
  shippingRateId: text("shipping_rate_id").notNull().default(""),
  returnPolicyId: text("return_policy_id").notNull().default(""),
  impliedWarrantyId: text("implied_warranty_id").notNull().default(""),
  warrantyId: text("warranty_id").notNull().default(""),
  status: text("status", { enum: ["draft", "needs_price", "ready", "publishing", "published", "error"] }).notNull().default("draft"),
  allegroOfferId: text("allegro_offer_id"),
  publishError: text("publish_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const listingImages = sqliteTable("listing_images", {
  id: text("id").primaryKey(),
  listingId: text("listing_id").notNull().references(() => listings.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull().default("image/jpeg"),
  sortOrder: integer("sort_order").notNull().default(0),
  isMain: integer("is_main", { mode: "boolean" }).notNull().default(false),
  allegroUrl: text("allegro_url"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
