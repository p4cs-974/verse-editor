import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Record an uploaded user image for the authenticated Clerk user.
 * Uses the Clerk subject from ctx.auth as ownerId (consistent with documents.ts).
 */
export const addUserImage = mutation({
  args: {
    fileUrl: v.string(),
    uploadedAt: v.number(), // ms since epoch
    contentType: v.optional(v.string()),
    size: v.optional(v.number()), // bytes
  },
  returns: v.id("userImages"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const ownerId = identity?.subject;
    if (!ownerId) throw new Error("Not authenticated");

    // Use a loose insert to tolerate out-of-date generated types during dev.
    return await (ctx.db as any).insert("userImages", {
      ownerId,
      fileUrl: args.fileUrl,
      uploadedAt: args.uploadedAt,
      contentType: args.contentType,
      size: args.size,
    });
  },
});
