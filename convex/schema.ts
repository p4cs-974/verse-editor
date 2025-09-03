import { vProviderMetadata, vUsage } from "@convex-dev/agent";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rawUsage: defineTable({
    userId: v.string(),
    threadId: v.string(),
    agentName: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),

    // stats
    usage: v.object({
      cachedInputTokens: v.optional(v.number()),
      inputTokens: v.number(),
      outputTokens: v.number(),
      reasoningTokens: v.optional(v.number()),
      totalTokens: v.number(),
    }),
    providerMetadata: v.optional(vProviderMetadata),

    // In this case, we're setting it to the first day of the current month,
    // using UTC time for the month boundaries.
    // You could alternatively store it as a timestamp number.
    // You can then fetch all the usage at the end of the billing period
    // and calculate the total cost.
    billingPeriod: v.string(), // When the usage period ended
  }).index("billingPeriod_userId", ["billingPeriod", "userId"]),

  invoices: defineTable({
    userId: v.string(),
    billingPeriod: v.string(),
    amount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed")
    ),
  }).index("billingPeriod_userId", ["billingPeriod", "userId"]),

  // Documents owned by Clerk users (ownerId is the Clerk user id as a string)
  documents: defineTable({
    title: v.string(),
    markdownContent: v.string(),
    cssContent: v.optional(v.string()),
    ownerId: v.string(),
    threadId: v.string(),
  }).index("by_ownerId", ["ownerId"]),

  // Images uploaded by Clerk users via UploadThing (ownerId is the Clerk user id as a string)
  userImages: defineTable({
    // Clerk user id
    ownerId: v.string(),
    // Public file URL returned by UploadThing
    fileUrl: v.string(),
    // UploadThing file key (for deletion/management)
    fileKey: v.string(),
    // File name without extension
    fileName: v.string(),
    // Client-provided upload timestamp (ms since epoch)
    uploadedAt: v.number(),
    // Optional helpful metadata
    contentType: v.optional(v.string()),
    size: v.optional(v.number()), // bytes
  })
    .index("by_ownerId", ["ownerId"]) // list images for a user
    .index("by_ownerId_and_uploadedAt", ["ownerId", "uploadedAt"]), // paginate/sort per user by upload time
});
