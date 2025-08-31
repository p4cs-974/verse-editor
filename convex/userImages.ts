import { mutation, query } from "./_generated/server";
import { action, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
/**
 * Record an uploaded user image for the authenticated Clerk user.
 * Uses the Clerk subject from ctx.auth as ownerId (consistent with documents.ts).
 */

export const addUserImage = mutation({
  args: {
    fileUrl: v.string(),
    fileKey: v.string(),
    fileName: v.string(),
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
      fileKey: args.fileKey,
      fileName: args.fileName,
      uploadedAt: args.uploadedAt,
      contentType: args.contentType,
      size: args.size,
    });
  },
});

// Find the caller's images matching the given URLs (internal)
export const findOwnedByUrls = internalQuery({
  args: {
    ownerId: v.string(),
    fileUrls: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id("userImages"),
      fileUrl: v.string(),
      fileKey: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    if (args.fileUrls.length === 0) return [];
    const set = new Set(args.fileUrls);
    const rows = await ctx.db
      .query("userImages")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return rows
      .filter((r) => set.has(r.fileUrl))
      .map((r) => ({ _id: r._id, fileUrl: r.fileUrl, fileKey: r.fileKey }));
  },
});

// Delete by URLs for the given owner (internal)
export const deleteOwnedByUrls = internalMutation({
  args: {
    ownerId: v.string(),
    fileUrls: v.array(v.string()),
  },
  returns: v.number(), // number of docs deleted
  handler: async (ctx, args) => {
    if (args.fileUrls.length === 0) return 0;
    const set = new Set(args.fileUrls);
    const rows = await ctx.db
      .query("userImages")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    let deleted = 0;
    for (const r of rows) {
      if (set.has(r.fileUrl)) {
        await ctx.db.delete(r._id);
        deleted++;
      }
    }
    return deleted;
  },
});

/**
 * List images for the authenticated owner (Clerk user).
 * Returns minimal fields for client syncing
 */
export const listForOwner = query({
  args: {},
  returns: v.array(
    v.object({
      fileUrl: v.string(),
      fileName: v.string(),
      uploadedAt: v.number(),
      fileKey: v.string(),
    })
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const ownerId = identity?.subject;
    if (!ownerId) return [];

    const rows = await ctx.db
      .query("userImages")
      .withIndex("by_ownerId_and_uploadedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(500);

    return rows.map((r) => ({
      fileUrl: r.fileUrl,
      fileName: r.fileName,
      uploadedAt: r.uploadedAt,
      fileKey: r.fileKey,
    }));
  },
});
