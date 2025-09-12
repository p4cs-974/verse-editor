import { vProviderMetadata, vUsage } from "@convex-dev/agent";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Extended schema to support billing: users, balances, transactions, topups,
 * bonuses, model_token_prices, usage_logs, idempotency_keys, provider_invoices, settings.
 *
 * Monetary amounts are stored in integer cents (e.g., 199 = $1.99).
 * Model token prices are stored as separate input/output micro-cents per token (integers),
 * where 1 micro-cent = 1e-6 cents.
 */

export default defineSchema({
  // Existing usage tracking
  rawUsage: defineTable({
    userId: v.string(),
    threadId: v.string(),
    agentName: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),

    // stats
    usage: v.object({
      cachedInputTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
    }),
    providerMetadata: v.optional(vProviderMetadata),
    idempotencyKey: v.optional(v.string()),

    // billing period e.g. "2025-09-01"
    billingPeriod: v.string(),
  })
    .index("billingPeriod_userId", ["billingPeriod", "userId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),

  invoices: defineTable({
    userId: v.string(),
    billingPeriod: v.string(),
    // Amount stored as integer micro-cents
    amountMicroCents: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed")
    ),
  }).index("billingPeriod_userId", ["billingPeriod", "userId"]),

  // Documents and images (existing)
  documents: defineTable({
    title: v.string(),
    markdownContent: v.string(),
    cssContent: v.optional(v.string()),
    ownerId: v.string(),
    threadId: v.string(),
  }).index("by_ownerId", ["ownerId"]),

  userImages: defineTable({
    ownerId: v.string(),
    fileUrl: v.string(),
    fileKey: v.string(),
    fileName: v.string(),
    uploadedAt: v.number(),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()), // bytes
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_uploadedAt", ["ownerId", "uploadedAt"]),

  //
  // Billing-specific tables
  //

  // Users table: minimal billing flags kept here (ownerId mapping to Clerk user/system user)
  users: defineTable({
    // application user id (Clerk id or internal id)
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    createdAt: v.number(),
    // Flags to prevent double-award
    receivedSignupCredit: v.boolean(),
    firstPaidTopupApplied: v.boolean(),
    // Optional KYC level
    kycLevel: v.optional(v.number()),
    status: v.optional(v.string()),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_userId", ["userId"]),

  // Single-row-per-user balance (stored in micro-cents)
  balances: defineTable({
    userId: v.string(),
    balanceMicroCents: v.number(), // integer micro-cents
    reservedMicroCents: v.optional(v.number()),
    updatedAt: v.number(),
    // optimistic concurrency/version optional
    version: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  // Immutable transaction ledger (amounts in micro-cents)
  transactions: defineTable({
    userId: v.optional(v.string()),
    type: v.string(), // e.g., signup_credit, topup, bonus, model_charge, fee_revenue, provider_payable
    amountMicroCents: v.number(), // positive for credits, negative for debits for user balances
    providerCostMicroCents: v.optional(v.number()),
    feeMicroCents: v.optional(v.number()),
    referenceId: v.optional(v.string()), // provider_call_id, payment_ref
    idempotencyKey: v.optional(v.string()),
    // metadata can contain arbitrary small scalar values (strings, numbers, booleans, or null).
    // Use a record validator to allow flexible keys (e.g. modelId, inputTokens, paymentProvider, reason).
    metadata: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null())
      )
    ),
    createdAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Top-up records created when initiating/confirming payments (amounts in micro-cents)
  topups: defineTable({
    userId: v.string(),
    amountMicroCents: v.number(),
    bonusMicroCents: v.optional(v.number()),
    paymentProvider: v.string(),
    paymentReference: v.string(),
    status: v.string(), // pending | succeeded | failed | refunded
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Bonuses ledger (amounts in micro-cents)
  bonuses: defineTable({
    userId: v.string(),
    kind: v.string(), // signup | first_topup
    amountMicroCents: v.number(),
    appliedAt: v.number(),
    revokedAt: v.optional(v.number()),
    metadata: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null())
      )
    ),
  }).index("by_userId", ["userId"]),

  // Per-model token price history (supports separate input/output pricing and provider)
  modelTokenPrices: defineTable({
    modelId: v.string(), // provider model identifier (e.g. "gpt-4")
    // Optional provider identifier (e.g. "openai", "anthropic"). Useful when same model
    // name exists across multiple providers.
    provider: v.optional(v.string()),
    // Prices are stored in micro-cents per token (1 micro-cent = 1e-6 cents).
    // Either field may be provided depending on provider billing model.
    priceMicroCentsPerInputToken: v.optional(v.number()), // integer micro-cents
    priceMicroCentsPerOutputToken: v.optional(v.number()), // integer micro-cents
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    adminId: v.optional(v.string()),
    reason: v.optional(v.string()),
  }).index("by_modelId_and_effectiveFrom", ["modelId", "effectiveFrom"]),

  // Detailed per-call usage logs (records input/output token counts and per-type prices)
  usageLogs: defineTable({
    userId: v.string(),
    modelId: v.string(),
    providerCallId: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    // Store the applicable per-token prices used to compute the provider cost for this call.
    priceMicroCentsPerInputToken: v.optional(v.number()),
    priceMicroCentsPerOutputToken: v.optional(v.number()),
    // Precise interim accounting in micro-cents (1 micro-cent = 1e-6 cents).
    providerCostMicroCents: v.optional(v.number()),
    feeMicroCents: v.optional(v.number()),
    totalChargeMicroCents: v.optional(v.number()),
    // Legacy/derived integer-cent fields (kept for backward compatibility; optional)
    providerCostCents: v.optional(v.number()),
    feeCents: v.optional(v.number()),
    totalChargeCents: v.optional(v.number()),
    chargeTransactionId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    status: v.string(), // charged | failed | refunded | pending
    createdAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Idempotency keys table for operations
  idempotencyKeys: defineTable({
    key: v.string(),
    userId: v.optional(v.string()),
    operationType: v.optional(v.string()),
    resultReference: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  // Provider invoices for reconciliation (amount in micro-cents)
  providerInvoices: defineTable({
    provider: v.string(),
    invoiceDate: v.number(),
    amountMicroCents: v.number(),
    metadata: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null())
      )
    ),
    reconciled: v.boolean(),
    createdAt: v.number(),
  }).index("by_provider_and_date", ["provider", "invoiceDate"]),

  // Settings / global configuration (single-row keyed table)
  settings: defineTable({
    key: v.string(),
    value: v.string(),
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  // User-imported fonts (global per user)
  userFonts: defineTable({
    userId: v.string(), // Clerk subject ID
    family: v.string(), // e.g., "Inter", "Roboto"
    importedAt: v.number(), // timestamp
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_family", ["userId", "family"]),
});
