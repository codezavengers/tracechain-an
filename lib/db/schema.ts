import { pgTable, text, integer, boolean, doublePrecision, jsonb } from "drizzle-orm/pg-core"

// Practical persistent schema for TRACECHAIN investigations. Complex existing
// objects (full case, multi-engine result, per-record payloads) are stored as
// JSONB so persistence never requires refactoring the engine/blockchain layer.
// Timestamps are ISO-8601 text to match the rest of the application exactly.

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  role: text("role"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const investigations = pgTable("investigations", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  title: text("title").notNull(),
  reportedWallet: text("reported_wallet").notNull(),
  chain: text("chain").notNull(),
  complaintRef: text("complaint_ref"),
  status: text("status").notNull(),
  riskScore: integer("risk_score").notNull().default(0),
  riskBand: text("risk_band").notNull().default("LOW"),
  priorityScore: integer("priority_score").notNull().default(0),
  investigator: text("investigator"),
  caseData: jsonb("case_data").notNull(),
  resultData: jsonb("result_data"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const complaints = pgTable("complaints", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  reference: text("reference"),
  text: text("text"),
  createdAt: text("created_at").notNull(),
})

export const wallets = pgTable("wallets", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  address: text("address").notNull(),
  chain: text("chain").notNull(),
  kind: text("kind"),
  role: text("role"),
  createdAt: text("created_at").notNull(),
})

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  hash: text("hash"),
  chain: text("chain"),
  fromAddress: text("from_address"),
  toAddress: text("to_address"),
  amount: doublePrecision("amount"),
  asset: text("asset"),
  usdValue: doublePrecision("usd_value"),
  data: jsonb("data"),
  createdAt: text("created_at").notNull(),
})

export const alerts = pgTable("alerts", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  walletAddress: text("wallet_address"),
  chain: text("chain"),
  severity: text("severity"),
  type: text("type"),
  message: text("message"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  createdAt: text("created_at").notNull(),
})

export const evidence = pgTable("evidence", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  type: text("type"),
  title: text("title"),
  contentHash: text("content_hash"),
  filename: text("filename"),
  prevHash: text("prev_hash"),
  summary: text("summary"),
  provenance: text("provenance"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
})

export const vaspAttributions = pgTable("vasp_attributions", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  address: text("address"),
  category: text("category"),
  vaspName: text("vasp_name"),
  confidence: doublePrecision("confidence"),
  data: jsonb("data"),
  createdAt: text("created_at").notNull(),
})

export const riskAssessments = pgTable("risk_assessments", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  score: integer("score"),
  band: text("band"),
  data: jsonb("data"),
  createdAt: text("created_at").notNull(),
})

export const investigationEvents = pgTable("investigation_events", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  actor: text("actor"),
  action: text("action").notNull(),
  detail: text("detail"),
  metadata: jsonb("metadata"),
  createdAt: text("created_at").notNull(),
})

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id").notNull(),
  generatedBy: text("generated_by"),
  data: jsonb("data"),
  createdAt: text("created_at").notNull(),
})
