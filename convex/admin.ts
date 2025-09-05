import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

/**
 * Admin functions for managing billing system
 *
 * These functions allow administrators to:
 * - Set and update model token prices
 * - View billing analytics and reconciliation data
 * - Manage provider invoices
 * - Handle refunds and adjustments
 */

/**
 * Admin mutation: Set or update token price for a model
 */
export const setModelTokenPrice = mutation({
  args: {
    modelId: v.string(),
    // Optional provider identifier (e.g. "openai", "anthropic") to scope the price.
    provider: v.optional(v.string()),
    // Backwards compatible: callers may supply a single priceMicroCentsPerToken.
    priceMicroCentsPerToken: v.optional(v.number()),
    // Prefer explicit per-type pricing when available.
    priceMicroCentsPerInputToken: v.optional(v.number()),
    priceMicroCentsPerOutputToken: v.optional(v.number()),
    effectiveFrom: v.optional(v.number()),
    adminId: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    priceId: v.string(),
    effectiveFrom: v.number(),
    provider: v.optional(v.string()),
    priceMicroCentsPerInputToken: v.optional(v.number()),
    priceMicroCentsPerOutputToken: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const effectiveFrom = args.effectiveFrom ?? now;

    // End the current price (if any) by setting effectiveTo
    // Prefer matching by both modelId and provider when provider supplied.
    const query = ctx.db
      .query("modelTokenPrices")
      .withIndex("by_modelId_and_effectiveFrom", (q) =>
        q.eq("modelId", args.modelId)
      );
    const currentPrice = await query.order("desc").first();

    if (currentPrice && !currentPrice.effectiveTo) {
      await ctx.db.patch(currentPrice._id, {
        effectiveTo: effectiveFrom - 1, // End just before new price starts
      });
    }

    // Determine per-token prices (support legacy single-field callers)
    const inputPrice =
      args.priceMicroCentsPerInputToken ??
      args.priceMicroCentsPerToken ??
      undefined;
    const outputPrice =
      args.priceMicroCentsPerOutputToken ??
      args.priceMicroCentsPerToken ??
      inputPrice;

    // Insert new price record (store explicit per-type prices and optional provider)
    const priceId = await ctx.db.insert("modelTokenPrices", {
      modelId: args.modelId,
      provider: args.provider,
      priceMicroCentsPerInputToken: inputPrice,
      priceMicroCentsPerOutputToken: outputPrice,
      effectiveFrom,
      effectiveTo: undefined,
      adminId: args.adminId,
      reason: args.reason,
    });

    return {
      priceId,
      effectiveFrom,
      provider: args.provider,
      priceMicroCentsPerInputToken: inputPrice,
      priceMicroCentsPerOutputToken: outputPrice,
    };
  },
});

/**
 * Query: Get current and historical prices for a model
 */
export const getModelPriceHistory = query({
  args: {
    modelId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      priceMicroCentsPerInputToken: v.optional(v.number()),
      priceMicroCentsPerOutputToken: v.optional(v.number()),
      effectiveFrom: v.number(),
      effectiveTo: v.optional(v.number()),
      adminId: v.optional(v.string()),
      reason: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const prices = await ctx.db
      .query("modelTokenPrices")
      .withIndex("by_modelId_and_effectiveFrom", (q) =>
        q.eq("modelId", args.modelId)
      )
      .order("desc")
      .take(args.limit ?? 20);

    return prices.map((p) => ({
      _id: p._id,
      priceMicroCentsPerInputToken: p.priceMicroCentsPerInputToken,
      priceMicroCentsPerOutputToken: p.priceMicroCentsPerOutputToken,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
      adminId: p.adminId,
      reason: p.reason,
    }));
  },
});

/**
 * Query: Get current active price for a model
 */
export const getCurrentModelPrice = query({
  args: { modelId: v.string() },
  returns: v.union(
    v.object({
      _id: v.string(),
      priceMicroCentsPerInputToken: v.optional(v.number()),
      priceMicroCentsPerOutputToken: v.optional(v.number()),
      effectiveFrom: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const price = await ctx.db
      .query("modelTokenPrices")
      .withIndex("by_modelId_and_effectiveFrom", (q) =>
        q.eq("modelId", args.modelId)
      )
      .filter((q) =>
        q.and(
          q.lte(q.field("effectiveFrom"), now),
          q.or(
            q.eq(q.field("effectiveTo"), undefined),
            q.gte(q.field("effectiveTo"), now)
          )
        )
      )
      .order("desc")
      .first();

    if (!price) return null;

    return {
      _id: price._id,
      priceMicroCentsPerInputToken: price.priceMicroCentsPerInputToken,
      priceMicroCentsPerOutputToken: price.priceMicroCentsPerOutputToken,
      effectiveFrom: price.effectiveFrom,
    };
  },
});

/**
 * Query: Get billing analytics for a date range
 */
export const getBillingAnalytics = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.object({
    totalProviderCostCents: v.number(),
    totalFeesCollectedCents: v.number(),
    totalTopupsCents: v.number(),
    totalBonusesAwarded: v.number(),
    uniqueUsers: v.number(),
    totalUsageCalls: v.number(),
    failedCallsDueToInsufficientFunds: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get all transactions in the date range
    const transactions = await ctx.db
      .query("transactions")
      .filter((q) =>
        q.and(
          q.gte(q.field("createdAt"), args.startDate),
          q.lte(q.field("createdAt"), args.endDate)
        )
      )
      .collect();

    // Get usage logs in the date range
    const usageLogs = await ctx.db
      .query("usageLogs")
      .filter((q) =>
        q.and(
          q.gte(q.field("createdAt"), args.startDate),
          q.lte(q.field("createdAt"), args.endDate)
        )
      )
      .collect();

    let totalProviderCostCents = 0;
    let totalFeesCollectedCents = 0;
    let totalTopupsCents = 0;
    let totalBonusesAwarded = 0;
    const uniqueUsers = new Set<string>();

    for (const tx of transactions) {
      if (tx.userId) {
        uniqueUsers.add(tx.userId);
      }

      switch (tx.type) {
        case "model_charge":
          totalProviderCostCents += Math.abs(tx.providerCostCents || 0);
          totalFeesCollectedCents += Math.abs(tx.feeCents || 0);
          break;
        case "topup":
          totalTopupsCents += tx.amountCents;
          break;
        case "bonus":
          totalBonusesAwarded += tx.amountCents;
          break;
      }
    }

    const totalUsageCalls = usageLogs.length;
    const failedCallsDueToInsufficientFunds = usageLogs.filter(
      (log) => log.status === "failed"
    ).length;

    return {
      totalProviderCostCents,
      totalFeesCollectedCents,
      totalTopupsCents,
      totalBonusesAwarded,
      uniqueUsers: uniqueUsers.size,
      totalUsageCalls,
      failedCallsDueToInsufficientFunds,
    };
  },
});

/**
 * Query: Get reconciliation data - compare recorded costs with provider invoices
 */
export const getReconciliationData = query({
  args: {
    provider: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.object({
    recordedProviderCostCents: v.number(),
    invoicedAmountCents: v.number(),
    varianceCents: v.number(),
    reconciled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Sum up provider costs from transactions
    const providerTransactions = await ctx.db
      .query("transactions")
      .filter((q) =>
        q.and(
          q.eq(q.field("type"), "provider_payable_accrual"),
          q.gte(q.field("createdAt"), args.startDate),
          q.lte(q.field("createdAt"), args.endDate)
        )
      )
      .collect();

    const recordedProviderCostCents = providerTransactions.reduce(
      (sum, tx) => sum + tx.amountCents,
      0
    );

    // Sum up provider invoices
    const invoiceFilter = args.provider
      ? (q: any) =>
          q.and(
            q.eq(q.field("provider"), args.provider),
            q.gte(q.field("invoiceDate"), args.startDate),
            q.lte(q.field("invoiceDate"), args.endDate)
          )
      : (q: any) =>
          q.and(
            q.gte(q.field("invoiceDate"), args.startDate),
            q.lte(q.field("invoiceDate"), args.endDate)
          );

    const invoices = await ctx.db
      .query("providerInvoices")
      .filter(invoiceFilter)
      .collect();

    const invoicedAmountCents = invoices.reduce(
      (sum, inv) => sum + inv.amountCents,
      0
    );

    const varianceCents = Math.abs(
      recordedProviderCostCents - invoicedAmountCents
    );
    const reconciled = varianceCents < 100; // Consider reconciled if variance < $1

    return {
      recordedProviderCostCents,
      invoicedAmountCents,
      varianceCents,
      reconciled,
    };
  },
});

/**
 * Admin mutation: Record a provider invoice for reconciliation
 */
export const recordProviderInvoice = mutation({
  args: {
    provider: v.string(),
    invoiceDate: v.number(),
    amountCents: v.number(),
    metadata: v.optional(v.object({})),
  },
  returns: v.object({
    invoiceId: v.string(),
  }),
  handler: async (ctx, args) => {
    const invoiceId = await ctx.db.insert("providerInvoices", {
      provider: args.provider,
      invoiceDate: args.invoiceDate,
      amountCents: args.amountCents,
      metadata: args.metadata || {},
      reconciled: false,
      createdAt: Date.now(),
    });

    return { invoiceId };
  },
});

/**
 * Admin mutation: Apply manual balance adjustment
 */
export const applyBalanceAdjustment = mutation({
  args: {
    userId: v.id("users"),
    amountCents: v.number(),
    reason: v.string(),
    adminId: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({
    transactionId: v.string(),
    newBalanceCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Idempotency check
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("idempotencyKeys")
        .withIndex("by_key", (q) => q.eq("key", args.idempotencyKey!))
        .unique();
      if (existing) {
        const balance = await ctx.db
          .query("balances")
          .withIndex("by_userId", (q) => q.eq("userId", args.userId))
          .unique();
        return {
          transactionId: existing.resultReference || "",
          newBalanceCents: balance?.balanceCents || 0,
        };
      }
    }

    // Get current balance
    const balanceRow = await ctx.db
      .query("balances")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const currentBalance = balanceRow?.balanceCents || 0;
    const newBalance = currentBalance + args.amountCents;

    // Insert transaction
    const transactionId = await ctx.db.insert("transactions", {
      userId: args.userId,
      type: "admin_adjust",
      amountCents: args.amountCents,
      providerCostCents: undefined,
      feeCents: undefined,
      referenceId: undefined,
      idempotencyKey: args.idempotencyKey,
      metadata: { reason: args.reason, adminId: args.adminId },
      createdAt: now,
    });

    // Update balance
    if (balanceRow) {
      await ctx.db.patch(balanceRow._id, {
        balanceCents: newBalance,
        updatedAt: now,
        version: (balanceRow.version || 0) + 1,
      });
    } else {
      await ctx.db.insert("balances", {
        userId: args.userId,
        balanceCents: newBalance,
        reservedCents: 0,
        updatedAt: now,
        version: 1,
      });
    }

    // Store idempotency mapping
    if (args.idempotencyKey) {
      await ctx.db.insert("idempotencyKeys", {
        key: args.idempotencyKey,
        userId: args.userId,
        operationType: "admin_adjust",
        resultReference: transactionId,
        createdAt: now,
      });
    }

    return {
      transactionId,
      newBalanceCents: newBalance,
    };
  },
});

/**
 * Query: Get list of users with low balances (below threshold)
 */
export const getUsersWithLowBalances = query({
  args: {
    thresholdCents: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      balanceCents: v.number(),
      lastTopupDate: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const balances = await ctx.db
      .query("balances")
      .filter((q) => q.lt(q.field("balanceCents"), args.thresholdCents))
      .take(args.limit || 100);

    const result = [];
    for (const balance of balances) {
      // Get last topup date
      const lastTopup = await ctx.db
        .query("topups")
        .withIndex("by_userId", (q) => q.eq("userId", balance.userId))
        .order("desc")
        .first();

      result.push({
        userId: balance.userId,
        balanceCents: balance.balanceCents,
        lastTopupDate: lastTopup?.createdAt,
      });
    }

    return result;
  },
});
