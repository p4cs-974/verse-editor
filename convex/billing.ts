import { mutation, internalMutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

import { QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

/**
 * Billing-related Convex functions (updated to micro-cents)
 *
 * Notes:
 * - Monetary amounts are stored in integer micro-cents throughout the DB and internal APIs.
 *   1 micro-cent = 1e-6 cents. (1 cent = 1_000_000 micro-cents)
 * - Model token prices are stored in micro-cents per token.
 * - Users are charged providerCost + 14% (fee = 14% of provider cost).
 */

const MICRO_CENTS_PER_CENT = 1_000_000;
const SIGNUP_CREDIT_MICROCENTS = 200 * MICRO_CENTS_PER_CENT;
const FIRST_TOPUP_BONUS_PCT = 5;
const FIRST_TOPUP_BONUS_CAP_MICROCENTS = 500 * MICRO_CENTS_PER_CENT;
const FEE_BPS = 1400; // 14%

function computePercentRoundedMicro(
  amountMicroCents: number,
  percent: number
): number {
  // half-up rounding at percent divisor
  return Math.floor((amountMicroCents * percent + 50) / 100);
}

function computeFeeMicroCents(
  providerCostMicroCents: number,
  feeBps: number
): number {
  // half-up rounding for /10000 at micro-cent precision
  return Math.floor((providerCostMicroCents * feeBps + 5_000) / 10_000);
}

function microToCentsRounded(micro: number): number {
  return Math.floor((micro + 500_000) / 1_000_000);
}

function centsToMicro(cents: number): number {
  return cents * MICRO_CENTS_PER_CENT;
}

/**
 * Helper to look up a user document and billing ID from either a Convex document ID
 * or an external user ID (e.g. Clerk subject).
 *
 * @returns An object with the user document and its billing ID, or null if not found
 */
async function lookupUserDoc(
  ctx: QueryCtx,
  userId: string | Id<"users">
): Promise<{ userDoc: Doc<"users">; billingUserId: Id<"users"> } | null> {
  // First try direct lookup if it looks like a Convex ID
  if (
    typeof userId === "string" &&
    userId.startsWith("j") &&
    userId.length > 20
  ) {
    try {
      const doc = await ctx.db.get(userId as Id<"users">);
      if (doc?.receivedSignupCredit !== undefined) {
        return { userDoc: doc, billingUserId: doc._id };
      }
    } catch {
      // Not a valid Convex ID or document not found, fall through to userId lookup
    }
  }

  // Try looking up by external userId
  const found = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId as string))
    .unique();

  if (!found) return null;
  return { userDoc: found, billingUserId: found._id };
}

export const createUserWithSignupCredit = mutation({
  args: {
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({
    userId: v.string(),
    initialBalanceMicroCents: v.number(),
  }),
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("idempotencyKeys")
        .withIndex("by_key", (q) => q.eq("key", args.idempotencyKey!))
        .unique();
      if (existing && existing.resultReference) {
        return {
          userId: existing.resultReference,
          initialBalanceMicroCents: SIGNUP_CREDIT_MICROCENTS,
        };
      }
    }

    const identity = await ctx.auth.getUserIdentity();
    const clerkId = identity?.subject;
    if (!clerkId) throw new Error("Not authenticated");

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      userId: clerkId,
      email: args.email,
      name: args.name,
      createdAt: now,
      receivedSignupCredit: true,
      firstPaidTopupApplied: false,
      kycLevel: undefined,
      status: "active",
    });

    await ctx.db.insert("balances", {
      userId,
      balanceMicroCents: SIGNUP_CREDIT_MICROCENTS,
      reservedMicroCents: 0,
      updatedAt: now,
      version: 1,
    });

    await ctx.db.insert("transactions", {
      userId,
      type: "signup_credit",
      amountMicroCents: SIGNUP_CREDIT_MICROCENTS,
      providerCostMicroCents: undefined,
      feeMicroCents: undefined,
      referenceId: undefined,
      idempotencyKey: args.idempotencyKey,
      metadata: {},
      createdAt: now,
    });

    if (args.idempotencyKey) {
      await ctx.db.insert("idempotencyKeys", {
        key: args.idempotencyKey,
        userId,
        operationType: "signup",
        resultReference: userId,
        createdAt: now,
      });
    }

    return { userId, initialBalanceMicroCents: SIGNUP_CREDIT_MICROCENTS };
  },
});

export const ensureBillingUserExists = mutation({
  args: {
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const clerkId = identity?.subject;
    if (!clerkId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", clerkId))
      .unique();
    if (existing) return existing._id;

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      userId: clerkId,
      email: args.email,
      name: args.name,
      createdAt: now,
      receivedSignupCredit: false,
      firstPaidTopupApplied: false,
      kycLevel: undefined,
      status: "active",
    });

    await ctx.db.insert("balances", {
      userId,
      balanceMicroCents: 0,
      reservedMicroCents: 0,
      updatedAt: now,
      version: 1,
    });

    return userId;
  },
});

// Internal helper used by webhooks (unauthenticated) to resolve a Clerk user id
// to a billing users._id. If a billing user row doesn't exist, create it.
// This function intentionally does NOT require authentication because Stripe
// webhooks are unauthenticated; the webhook must be able to resolve or create
// a billing user from the Clerk id included in session metadata.
export const resolveOrCreateBillingUserByClerkId = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Try to find existing billing row by the Clerk subject stored in userId.
    const existing = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.clerkId))
      .unique();
    if (existing) return existing._id;

    // Not found — create a new users row and initial balance.
    const now = Date.now();
    const billingUserId = await ctx.db.insert("users", {
      userId: args.clerkId,
      email: args.email,
      name: args.name,
      createdAt: now,
      receivedSignupCredit: false,
      firstPaidTopupApplied: false,
      kycLevel: undefined,
      status: "active",
    });

    await ctx.db.insert("balances", {
      userId: billingUserId,
      balanceMicroCents: 0,
      reservedMicroCents: 0,
      updatedAt: now,
      version: 1,
    });

    return billingUserId;
  },
});

export const internalApplyTopup = internalMutation({
  args: {
    userId: v.id("users"),
    amountMicroCents: v.number(),
    paymentProvider: v.string(),
    paymentReference: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({
    topupId: v.string(),
    amountMicroCents: v.number(),
    bonusMicroCents: v.number(),
    newBalanceMicroCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    if (args.idempotencyKey) {
      const existingKey = await ctx.db
        .query("idempotencyKeys")
        .withIndex("by_key", (q) => q.eq("key", args.idempotencyKey!))
        .unique();
      if (existingKey && existingKey.resultReference) {
        try {
          const topupId = existingKey.resultReference as Id<"topups">;
          const topup = await ctx.db.get(topupId);
          if (topup) {
            const balance = await ctx.db
              .query("balances")
              .withIndex("by_userId", (q) => q.eq("userId", args.userId))
              .unique();
            return {
              topupId,
              amountMicroCents: topup.amountMicroCents,
              bonusMicroCents: topup.bonusMicroCents ?? 0,
              newBalanceMicroCents: balance?.balanceMicroCents ?? 0,
            };
          }
        } catch (e) {
          console.log("Could not retrieve cached topup result, continuing:", e);
        }
      }
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const topupId = await ctx.db.insert("topups", {
      userId: args.userId,
      amountMicroCents: args.amountMicroCents,
      bonusMicroCents: 0,
      paymentProvider: args.paymentProvider,
      paymentReference: args.paymentReference,
      status: "succeeded",
      idempotencyKey: args.idempotencyKey,
      createdAt: now,
    });

    const balanceRow = await ctx.db
      .query("balances")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!balanceRow) {
      await ctx.db.insert("balances", {
        userId: args.userId,
        balanceMicroCents: 0,
        reservedMicroCents: 0,
        updatedAt: now,
        version: 1,
      });
    }

    let bonusMicroCents = 0;
    if (args.amountMicroCents > 0 && !user.firstPaidTopupApplied) {
      const computed = computePercentRoundedMicro(
        args.amountMicroCents,
        FIRST_TOPUP_BONUS_PCT
      );
      bonusMicroCents = Math.min(computed, FIRST_TOPUP_BONUS_CAP_MICROCENTS);

      await ctx.db.insert("transactions", {
        userId: args.userId,
        type: "bonus",
        amountMicroCents: bonusMicroCents,
        providerCostMicroCents: undefined,
        feeMicroCents: undefined,
        referenceId: topupId,
        idempotencyKey: undefined,
        metadata: { reason: "first_topup" },
        createdAt: now,
      });

      await ctx.db.patch(args.userId, { firstPaidTopupApplied: true });
    }

    await ctx.db.insert("transactions", {
      userId: args.userId,
      type: "topup",
      amountMicroCents: args.amountMicroCents,
      providerCostMicroCents: undefined,
      feeMicroCents: undefined,
      referenceId: args.paymentReference,
      idempotencyKey: args.idempotencyKey,
      metadata: { paymentProvider: args.paymentProvider },
      createdAt: now,
    });

    const balanceBefore = balanceRow?.balanceMicroCents ?? 0;
    const newBalanceMicroCents =
      balanceBefore + args.amountMicroCents + bonusMicroCents;

    if (balanceRow) {
      await ctx.db.patch(balanceRow._id, {
        balanceMicroCents: newBalanceMicroCents,
        updatedAt: now,
        version: (balanceRow.version ?? 0) + 1,
      });
    } else {
      await ctx.db.insert("balances", {
        userId: args.userId,
        balanceMicroCents: newBalanceMicroCents,
        reservedMicroCents: 0,
        updatedAt: now,
        version: 1,
      });
    }

    await ctx.db.patch(topupId, { bonusMicroCents });

    if (args.idempotencyKey) {
      await ctx.db.insert("idempotencyKeys", {
        key: args.idempotencyKey,
        userId: args.userId,
        operationType: "topup",
        resultReference: topupId,
        createdAt: now,
      });
    }

    return {
      topupId,
      amountMicroCents: args.amountMicroCents,
      bonusMicroCents,
      newBalanceMicroCents,
    };
  },
});

export const internalFinalizeUsageCharge = internalMutation({
  args: {
    userId: v.id("users"),
    modelId: v.string(),
    providerCallId: v.string(),
    tokensUsed: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({
    charged: v.boolean(),
    providerCostMicroCents: v.number(),
    feeMicroCents: v.number(),
    totalChargeMicroCents: v.number(),
    newBalanceMicroCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    if (args.idempotencyKey) {
      const existingKey = await ctx.db
        .query("idempotencyKeys")
        .withIndex("by_key", (q) => q.eq("key", args.idempotencyKey!))
        .unique();
      if (existingKey && existingKey.resultReference) {
        try {
          const usageLogId = existingKey.resultReference as Id<"usageLogs">;
          const usage = await ctx.db.get(usageLogId);
          if (usage) {
            const providerCostMicroCents =
              usage.providerCostMicroCents ??
              (usage.providerCostCents !== undefined
                ? centsToMicro(usage.providerCostCents)
                : 0);
            const feeMicroCents =
              usage.feeMicroCents ??
              (usage.feeCents !== undefined ? centsToMicro(usage.feeCents) : 0);
            const totalChargeMicroCents =
              usage.totalChargeMicroCents ??
              (usage.totalChargeCents !== undefined
                ? centsToMicro(usage.totalChargeCents)
                : providerCostMicroCents + feeMicroCents);

            const balanceRow = await ctx.db
              .query("balances")
              .withIndex("by_userId", (q) => q.eq("userId", args.userId))
              .unique();

            return {
              charged: usage.status === "charged",
              providerCostMicroCents,
              feeMicroCents,
              totalChargeMicroCents,
              newBalanceMicroCents: balanceRow?.balanceMicroCents ?? 0,
            };
          }
        } catch (e) {
          console.log("Could not retrieve cached usage result, continuing:", e);
        }
      }
    }

    const priceRow = await ctx.db
      .query("modelTokenPrices")
      .withIndex("by_modelId_and_effectiveFrom", (q) =>
        q.eq("modelId", args.modelId)
      )
      .order("desc")
      .first();

    if (!priceRow) {
      throw new Error(
        `No price configuration found for model ${args.modelId}. Please configure model pricing before use.`
      );
    }

    const inputPriceMicro =
      priceRow.priceMicroCentsPerInputToken ??
      (priceRow as any).priceMicroCentsPerToken;
    if (inputPriceMicro === undefined) {
      throw new Error(
        `Invalid price configuration for model ${args.modelId}: missing input token price`
      );
    }

    const outputPriceMicro =
      priceRow?.priceMicroCentsPerOutputToken ??
      (priceRow ? (priceRow as any).priceMicroCentsPerToken : undefined) ??
      inputPriceMicro;

    const inputTokens = args.inputTokens ?? args.tokensUsed ?? 0;
    const outputTokens = args.outputTokens ?? 0;

    const providerCostMicroCents =
      inputTokens * inputPriceMicro +
      outputTokens * (outputPriceMicro ?? inputPriceMicro);

    const feeMicroCents = computeFeeMicroCents(providerCostMicroCents, FEE_BPS);
    const totalChargeMicroCents = providerCostMicroCents + feeMicroCents;

    // Check if user has sufficient balance
    const balanceRow = await ctx.db
      .query("balances")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const currentBalanceMicroCents = balanceRow?.balanceMicroCents ?? 0;

    if (currentBalanceMicroCents < totalChargeMicroCents) {
      // Insufficient funds - record failed usage log
      const failedLogId = await ctx.db.insert("usageLogs", {
        userId: args.userId,
        modelId: args.modelId,
        providerCallId: args.providerCallId,
        inputTokens,
        outputTokens,
        priceMicroCentsPerInputToken: inputPriceMicro,
        priceMicroCentsPerOutputToken: outputPriceMicro ?? inputPriceMicro,
        providerCostMicroCents,
        feeMicroCents,
        totalChargeMicroCents,
        providerCostCents: microToCentsRounded(providerCostMicroCents),
        feeCents: microToCentsRounded(feeMicroCents),
        totalChargeCents: microToCentsRounded(totalChargeMicroCents),
        chargeTransactionId: undefined,
        idempotencyKey: args.idempotencyKey,
        status: "failed",
        createdAt: now,
      });

      if (args.idempotencyKey) {
        await ctx.db.insert("idempotencyKeys", {
          key: args.idempotencyKey,
          userId: args.userId,
          operationType: "model_call",
          resultReference: failedLogId,
          createdAt: now,
        });
      }

      return {
        charged: false,
        providerCostMicroCents,
        feeMicroCents,
        totalChargeMicroCents,
        newBalanceMicroCents: currentBalanceMicroCents,
      };
    }

    // Deduct balance and record successful charge
    const newBalanceMicroCents =
      currentBalanceMicroCents - totalChargeMicroCents;

    if (balanceRow) {
      await ctx.db.patch(balanceRow._id, {
        balanceMicroCents: newBalanceMicroCents,
        updatedAt: now,
        version: (balanceRow.version ?? 0) + 1,
      });
    } else {
      await ctx.db.insert("balances", {
        userId: args.userId,
        balanceMicroCents: newBalanceMicroCents,
        reservedMicroCents: 0,
        updatedAt: now,
        version: 1,
      });
    }

    // Insert transaction for user charge (negative micro-cents)
    const txId = await ctx.db.insert("transactions", {
      userId: args.userId,
      type: "model_charge",
      amountMicroCents: -totalChargeMicroCents,
      providerCostMicroCents: -providerCostMicroCents,
      feeMicroCents: -feeMicroCents,
      referenceId: args.providerCallId,
      idempotencyKey: args.idempotencyKey,
      metadata: {
        modelId: args.modelId,
        inputTokens,
        outputTokens,
        tokensUsed: inputTokens + outputTokens,
      },
      createdAt: now,
    });

    // Insert accrual for provider payable (micro-cents)
    await ctx.db.insert("transactions", {
      userId: undefined,
      type: "provider_payable_accrual",
      amountMicroCents: providerCostMicroCents,
      providerCostMicroCents: undefined,
      feeMicroCents: undefined,
      referenceId: args.providerCallId,
      idempotencyKey: undefined,
      metadata: { modelId: args.modelId },
      createdAt: now,
    });

    // Insert revenue for fee (micro-cents)
    await ctx.db.insert("transactions", {
      userId: undefined,
      type: "fee_revenue",
      amountMicroCents: feeMicroCents,
      providerCostMicroCents: undefined,
      feeMicroCents: undefined,
      referenceId: args.providerCallId,
      idempotencyKey: undefined,
      metadata: { modelId: args.modelId },
      createdAt: now,
    });

    // Record successful usage log
    const chargedLogId = await ctx.db.insert("usageLogs", {
      userId: args.userId,
      modelId: args.modelId,
      providerCallId: args.providerCallId,
      inputTokens,
      outputTokens,
      priceMicroCentsPerInputToken: inputPriceMicro,
      priceMicroCentsPerOutputToken: outputPriceMicro ?? inputPriceMicro,
      providerCostMicroCents,
      feeMicroCents,
      totalChargeMicroCents,
      providerCostCents: microToCentsRounded(providerCostMicroCents),
      feeCents: microToCentsRounded(feeMicroCents),
      totalChargeCents: microToCentsRounded(totalChargeMicroCents),
      chargeTransactionId: txId,
      idempotencyKey: args.idempotencyKey,
      status: "charged",
      createdAt: now,
    });

    if (args.idempotencyKey) {
      await ctx.db.insert("idempotencyKeys", {
        key: args.idempotencyKey,
        userId: args.userId,
        operationType: "model_call",
        resultReference: chargedLogId,
        createdAt: now,
      });
    }

    return {
      charged: true,
      providerCostMicroCents,
      feeMicroCents,
      totalChargeMicroCents,
      newBalanceMicroCents,
    };
  },
});

export const getUserBalance = query({
  args: { userId: v.union(v.id("users"), v.string()) },
  returns: v.object({
    balanceMicroCents: v.number(),
    reservedMicroCents: v.number(),
    receivedSignupCredit: v.boolean(),
    firstPaidTopupApplied: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await lookupUserDoc(ctx, args.userId);
    if (!result) throw new Error("User not found");
    const { userDoc, billingUserId } = result;

    const balance = await ctx.db
      .query("balances")
      .withIndex("by_userId", (q) => q.eq("userId", billingUserId))
      .unique();

    return {
      balanceMicroCents: balance?.balanceMicroCents ?? 0,
      reservedMicroCents: balance?.reservedMicroCents ?? 0,
      receivedSignupCredit: Boolean(userDoc.receivedSignupCredit),
      firstPaidTopupApplied: Boolean(userDoc.firstPaidTopupApplied),
    };
  },
});

export const webhookApplyTopup = mutation({
  args: {
    userId: v.string(),
    amountMicroCents: v.number(),
    paymentProvider: v.string(),
    paymentReference: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({
    topupId: v.string(),
    amountMicroCents: v.number(),
    bonusMicroCents: v.number(),
    newBalanceMicroCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = args.userId as Id<"users">;
    const now = Date.now();

    if (args.idempotencyKey) {
      const existingKey = await ctx.db
        .query("idempotencyKeys")
        .withIndex("by_key", (q) => q.eq("key", args.idempotencyKey!))
        .unique();
      if (existingKey && existingKey.resultReference) {
        try {
          const topupId = existingKey.resultReference as Id<"topups">;
          const topup = await ctx.db.get(topupId);
          if (topup) {
            const balance = await ctx.db
              .query("balances")
              .withIndex("by_userId", (q) => q.eq("userId", userId))
              .unique();
            return {
              topupId,
              amountMicroCents: topup.amountMicroCents,
              bonusMicroCents: topup.bonusMicroCents ?? 0,
              newBalanceMicroCents: balance?.balanceMicroCents ?? 0,
            };
          }
        } catch (e) {
          console.log("Could not retrieve cached topup result, continuing:", e);
        }
      }
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    const topupId = await ctx.db.insert("topups", {
      userId,
      amountMicroCents: args.amountMicroCents,
      bonusMicroCents: 0,
      paymentProvider: args.paymentProvider,
      paymentReference: args.paymentReference,
      status: "succeeded",
      idempotencyKey: args.idempotencyKey,
      createdAt: now,
    });

    const balanceRow = await ctx.db
      .query("balances")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    let bonusMicroCents = 0;
    if (args.amountMicroCents > 0 && !user.firstPaidTopupApplied) {
      const computed = computePercentRoundedMicro(
        args.amountMicroCents,
        FIRST_TOPUP_BONUS_PCT
      );
      bonusMicroCents = Math.min(computed, FIRST_TOPUP_BONUS_CAP_MICROCENTS);

      await ctx.db.insert("transactions", {
        userId,
        type: "bonus",
        amountMicroCents: bonusMicroCents,
        providerCostMicroCents: undefined,
        feeMicroCents: undefined,
        referenceId: topupId,
        idempotencyKey: undefined,
        metadata: { reason: "first_topup" },
        createdAt: now,
      });

      await ctx.db.patch(userId, { firstPaidTopupApplied: true });
    }

    await ctx.db.insert("transactions", {
      userId,
      type: "topup",
      amountMicroCents: args.amountMicroCents,
      providerCostMicroCents: undefined,
      feeMicroCents: undefined,
      referenceId: args.paymentReference,
      idempotencyKey: args.idempotencyKey,
      metadata: { paymentProvider: args.paymentProvider },
      createdAt: now,
    });

    const balanceBefore = balanceRow?.balanceMicroCents ?? 0;
    const newBalanceMicroCents =
      balanceBefore + args.amountMicroCents + bonusMicroCents;

    if (balanceRow) {
      await ctx.db.patch(balanceRow._id, {
        balanceMicroCents: newBalanceMicroCents,
        updatedAt: now,
        version: (balanceRow.version ?? 0) + 1,
      });
    } else {
      await ctx.db.insert("balances", {
        userId,
        balanceMicroCents: newBalanceMicroCents,
        reservedMicroCents: 0,
        updatedAt: now,
        version: 1,
      });
    }

    await ctx.db.patch(topupId, { bonusMicroCents });

    if (args.idempotencyKey) {
      await ctx.db.insert("idempotencyKeys", {
        key: args.idempotencyKey,
        userId,
        operationType: "topup",
        resultReference: topupId,
        createdAt: now,
      });
    }

    return {
      topupId,
      amountMicroCents: args.amountMicroCents,
      bonusMicroCents,
      newBalanceMicroCents,
    };
  },
});

export const webhookFinalizeUsageCharge = mutation({
  args: {
    userId: v.string(),
    modelId: v.string(),
    providerCallId: v.string(),
    tokensUsed: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({
    charged: v.boolean(),
    providerCostMicroCents: v.number(),
    feeMicroCents: v.number(),
    totalChargeMicroCents: v.number(),
    newBalanceMicroCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = args.userId as Id<"users">;
    const now = Date.now();

    if (args.idempotencyKey) {
      const existingKey = await ctx.db
        .query("idempotencyKeys")
        .withIndex("by_key", (q) => q.eq("key", args.idempotencyKey!))
        .unique();
      if (existingKey && existingKey.resultReference) {
        try {
          const usageLogId = existingKey.resultReference as Id<"usageLogs">;
          const usage = await ctx.db.get(usageLogId);
          if (usage) {
            const providerCostMicroCents =
              usage.providerCostMicroCents ??
              (usage.providerCostCents !== undefined
                ? centsToMicro(usage.providerCostCents)
                : 0);
            const feeMicroCents =
              usage.feeMicroCents ??
              (usage.feeCents !== undefined ? centsToMicro(usage.feeCents) : 0);
            const totalChargeMicroCents =
              usage.totalChargeMicroCents ??
              (usage.totalChargeCents !== undefined
                ? centsToMicro(usage.totalChargeCents)
                : providerCostMicroCents + feeMicroCents);

            const balanceRow = await ctx.db
              .query("balances")
              .withIndex("by_userId", (q) => q.eq("userId", userId))
              .unique();

            return {
              charged: usage.status === "charged",
              providerCostMicroCents,
              feeMicroCents,
              totalChargeMicroCents,
              newBalanceMicroCents: balanceRow?.balanceMicroCents ?? 0,
            };
          }
        } catch (e) {
          console.log("Could not retrieve cached usage result, continuing:", e);
        }
      }
    }

    const priceRow = await ctx.db
      .query("modelTokenPrices")
      .withIndex("by_modelId_and_effectiveFrom", (q) =>
        q.eq("modelId", args.modelId)
      )
      .order("desc")
      .first();

    if (!priceRow) {
      throw new Error(
        `No price configuration found for model ${args.modelId}. Please configure model pricing before use.`
      );
    }

    const inputPriceMicro =
      priceRow.priceMicroCentsPerInputToken ??
      (priceRow as any).priceMicroCentsPerToken;
    if (inputPriceMicro === undefined) {
      throw new Error(
        `Invalid price configuration for model ${args.modelId}: missing input token price`
      );
    }

    const outputPriceMicro =
      priceRow.priceMicroCentsPerOutputToken ??
      (priceRow as any).priceMicroCentsPerToken ??
      inputPriceMicro;
    const inputTokens = args.inputTokens ?? args.tokensUsed ?? 0;
    const outputTokens = args.outputTokens ?? 0;

    const providerCostMicroCents =
      inputTokens * inputPriceMicro + outputTokens * outputPriceMicro;
    const feeMicroCents = computeFeeMicroCents(providerCostMicroCents, FEE_BPS);
    const totalChargeMicroCents = providerCostMicroCents + feeMicroCents;

    const balanceRow = await ctx.db
      .query("balances")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const currentBalanceMicroCents = balanceRow?.balanceMicroCents ?? 0;
    if (currentBalanceMicroCents < totalChargeMicroCents) {
      const pendingLogId = await ctx.db.insert("usageLogs", {
        userId,
        modelId: args.modelId,
        providerCallId: args.providerCallId,
        inputTokens,
        outputTokens,
        priceMicroCentsPerInputToken: inputPriceMicro,
        priceMicroCentsPerOutputToken: outputPriceMicro,
        providerCostMicroCents,
        feeMicroCents,
        totalChargeMicroCents,
        chargeTransactionId: undefined,
        idempotencyKey: args.idempotencyKey,
        status: "failed",
        createdAt: now,
      });

      if (args.idempotencyKey) {
        await ctx.db.insert("idempotencyKeys", {
          key: args.idempotencyKey,
          userId,
          operationType: "model_call",
          resultReference: pendingLogId,
          createdAt: now,
        });
      }

      return {
        charged: false,
        providerCostMicroCents,
        feeMicroCents,
        totalChargeMicroCents,
        newBalanceMicroCents: currentBalanceMicroCents,
      };
    }

    const newBalanceMicroCents =
      currentBalanceMicroCents - totalChargeMicroCents;

    if (balanceRow) {
      await ctx.db.patch(balanceRow._id, {
        balanceMicroCents: newBalanceMicroCents,
        updatedAt: now,
        version: (balanceRow.version ?? 0) + 1,
      });
    } else {
      await ctx.db.insert("balances", {
        userId,
        balanceMicroCents: newBalanceMicroCents,
        reservedMicroCents: 0,
        updatedAt: now,
        version: 1,
      });
    }

    const txId = await ctx.db.insert("transactions", {
      userId,
      type: "model_charge",
      amountMicroCents: -totalChargeMicroCents,
      providerCostMicroCents: -providerCostMicroCents,
      feeMicroCents: -feeMicroCents,
      referenceId: args.providerCallId,
      idempotencyKey: args.idempotencyKey,
      metadata: {
        modelId: args.modelId,
        inputTokens,
        outputTokens,
        tokensUsed: inputTokens + outputTokens,
      },
      createdAt: now,
    });

    await ctx.db.insert("transactions", {
      userId: undefined,
      type: "provider_payable_accrual",
      amountMicroCents: providerCostMicroCents,
      providerCostMicroCents: undefined,
      feeMicroCents: undefined,
      referenceId: args.providerCallId,
      idempotencyKey: undefined,
      metadata: { modelId: args.modelId },
      createdAt: now,
    });

    await ctx.db.insert("transactions", {
      userId: undefined,
      type: "fee_revenue",
      amountMicroCents: feeMicroCents,
      providerCostMicroCents: undefined,
      feeMicroCents: undefined,
      referenceId: args.providerCallId,
      idempotencyKey: undefined,
      metadata: { modelId: args.modelId },
      createdAt: now,
    });

    return {
      charged: true,
      providerCostMicroCents,
      feeMicroCents,
      totalChargeMicroCents,
      newBalanceMicroCents,
    };
  },
});

export const getUserTransactions = query({
  args: {
    userId: v.union(v.id("users"), v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      type: v.string(),
      amountMicroCents: v.number(),
      createdAt: v.number(),
      referenceId: v.optional(v.string()),
      metadata: v.optional(v.object({})),
    })
  ),
  handler: async (ctx, args) => {
    const result = await lookupUserDoc(ctx, args.userId);
    if (!result) return [];
    const { billingUserId } = result;

    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_userId", (q) => q.eq("userId", billingUserId))
      .order("desc")
      .take(args.limit ?? 50);

    return transactions.map((tx) => ({
      _id: tx._id,
      type: tx.type,
      amountMicroCents: tx.amountMicroCents,
      createdAt: tx.createdAt,
      referenceId: tx.referenceId,
      metadata: tx.metadata,
    }));
  },
});

/**
 * Check if user has sufficient balance for an estimated request cost
 */
export const checkSufficientBalance = query({
  args: {
    userId: v.union(v.id("users"), v.string()),
    modelId: v.string(),
    estimatedInputTokens: v.optional(v.number()),
    estimatedOutputTokens: v.optional(v.number()),
  },
  returns: v.object({
    hasSufficientBalance: v.boolean(),
    currentBalanceMicroCents: v.number(),
    estimatedCostMicroCents: v.number(),
    balanceInDollars: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get user's current balance
    let userDoc: any = null;
    let billingUserId: string;

    try {
      userDoc = await ctx.db.get(args.userId as any);
    } catch {
      userDoc = null;
    }

    if (userDoc && (userDoc as any).receivedSignupCredit !== undefined) {
      billingUserId = userDoc._id;
    } else {
      const found = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId as string))
        .unique();
      if (!found) {
        return {
          hasSufficientBalance: false,
          currentBalanceMicroCents: 0,
          estimatedCostMicroCents: 0,
          balanceInDollars: 0,
        };
      }
      billingUserId = found._id;
    }

    const balance = await ctx.db
      .query("balances")
      .withIndex("by_userId", (q) => q.eq("userId", billingUserId))
      .unique();

    const currentBalanceMicroCents = balance?.balanceMicroCents ?? 0;

    // Get model pricing
    const priceRow = await ctx.db
      .query("modelTokenPrices")
      .withIndex("by_modelId_and_effectiveFrom", (q) =>
        q.eq("modelId", args.modelId)
      )
      .order("desc")
      .first();

    // Use default pricing if not configured (same as in internalFinalizeUsageCharge)
    const inputPriceMicro =
      priceRow?.priceMicroCentsPerInputToken ??
      (priceRow ? (priceRow as any).priceMicroCentsPerToken : undefined);

    if (inputPriceMicro === undefined) {
      throw new Error(`No price configured for model ${args.modelId}`);
    }

    const outputPriceMicro =
      priceRow?.priceMicroCentsPerOutputToken ??
      (priceRow ? (priceRow as any).priceMicroCentsPerToken : undefined) ??
      inputPriceMicro;
    inputPriceMicro;

    // Estimate tokens (use conservative estimates if not provided)
    const inputTokens = args.estimatedInputTokens ?? 1000; // Conservative estimate
    const outputTokens = args.estimatedOutputTokens ?? 2000; // Conservative estimate

    // Calculate estimated cost
    const providerCostMicroCents =
      inputTokens * inputPriceMicro + outputTokens * outputPriceMicro;
    const feeMicroCents = computeFeeMicroCents(providerCostMicroCents, FEE_BPS);
    const estimatedCostMicroCents = providerCostMicroCents + feeMicroCents;

    // Convert balance to dollars (1,000,000 microcents = $0.01)
    const balanceInDollars =
      currentBalanceMicroCents / (MICRO_CENTS_PER_CENT * 100);

    return {
      hasSufficientBalance: currentBalanceMicroCents >= estimatedCostMicroCents,
      currentBalanceMicroCents,
      estimatedCostMicroCents,
      balanceInDollars,
    };
  },
});

/**
 * Get current user balance in a format suitable for UI display
 */
export const getUserBalanceForDisplay = query({
  args: {},
  returns: v.object({
    balanceMicroCents: v.number(),
    balanceInDollars: v.number(),
    receivedSignupCredit: v.boolean(),
    firstPaidTopupApplied: v.boolean(),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const clerkId = identity?.subject;

    if (!clerkId) {
      return {
        balanceMicroCents: 0,
        balanceInDollars: 0,
        receivedSignupCredit: false,
        firstPaidTopupApplied: false,
      };
    }

    // Get user document and balance directly
    const result = await lookupUserDoc(ctx, clerkId);
    if (!result) {
      return {
        balanceMicroCents: 0,
        balanceInDollars: 0,
        receivedSignupCredit: false,
        firstPaidTopupApplied: false,
      };
    }
    const { userDoc, billingUserId } = result;

    const balance = await ctx.db
      .query("balances")
      .withIndex("by_userId", (q) => q.eq("userId", billingUserId))
      .unique();

    const balanceMicroCents = balance?.balanceMicroCents ?? 0;
    const balanceInDollars = balanceMicroCents / (MICRO_CENTS_PER_CENT * 100);

    return {
      balanceMicroCents,
      balanceInDollars,
      receivedSignupCredit: Boolean(userDoc.receivedSignupCredit),
      firstPaidTopupApplied: Boolean(userDoc.firstPaidTopupApplied),
    };
  },
});

/* testAddBalance removed — production builds should not expose test helper mutations */

/**
 * Create a Stripe checkout session with user metadata
 */
export const createCheckoutSession = action({
  args: {
    amountCents: v.number(),
  },
  returns: v.object({
    sessionUrl: v.string(),
    sessionId: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const clerkId = identity?.subject;
    const userEmail = identity?.email || undefined;
    const userName = identity?.name || undefined;

    if (!clerkId) {
      throw new Error("Not authenticated");
    }

    // Ensure billing user exists using mutation (actions can't access db directly)
    const billingUserId: string = await ctx.runMutation(
      api.billing.ensureBillingUserExists,
      {
        email: userEmail,
        name: userName,
      }
    );

    // Use pre-configured Stripe payment links from env vars
    // In production, consider creating dynamic sessions/links via Stripe API or MCP
    const linkMap: Record<number, string> = {
      500: process.env.STRIPE_LINK_5 || "",
      1000: process.env.STRIPE_LINK_10 || "",
      2500: process.env.STRIPE_LINK_25 || "",
      5000: process.env.STRIPE_LINK_50 || "",
    };

    const sessionUrl: string = linkMap[args.amountCents];
    if (!sessionUrl) {
      throw new Error(
        `Stripe payment link not configured for amount: ${
          args.amountCents / 100
        } cents. ` +
          `Please set the STRIPE_LINK_${args.amountCents} environment variable.`
      );
    }

    const sessionId: string = `session_${billingUserId}_${Date.now()}`;

    // Note: For payment links, client_reference_id and metadata are set when creating the link.
    // If using dynamic links, include billingUserId in metadata for webhook processing.
    const sessionData = {
      sessionUrl,
      sessionId,
    };

    return sessionData;
  },
});
