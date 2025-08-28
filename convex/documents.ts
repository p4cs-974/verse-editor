import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Create a document owned by the authenticated Clerk user.
 * Returns the new document id.
 *
 * Note: cast ctx.auth to any to avoid TS mismatches in generated types.
 */
export const createDocument = mutation({
  args: {
    title: v.string(),
    markdownContent: v.string(),
    cssContent: v.optional(v.string()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    // Debug: log auth object to help diagnose missing authentication on the server.
    // This log will appear in the Convex function runtime logs / local dev console.
    try {
      // Some runtimes may not allow console.dir; use JSON as a safe fallback.
      // eslint-disable-next-line no-console
      console.debug(
        "createDocument ctx.auth:",
        JSON.stringify(ctx.auth ?? null)
      );
    } catch {
      // ignore logging errors
    }

    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    if (!userId) throw new Error("Not authenticated");

    return await ctx.db.insert("documents", {
      title: args.title,
      markdownContent: args.markdownContent,
      // Convex schema uses an optional string (undefined). Avoid inserting null.
      cssContent:
        typeof args.cssContent === "undefined" ? undefined : args.cssContent,
      ownerId: userId,
    });
  },
});

/**
 * List documents for the authenticated user.
 */
export const listDocumentsForUser = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      _creationTime: v.number(),
      title: v.string(),
      markdownContent: v.string(),
      cssContent: v.optional(v.string()),
      ownerId: v.string(),
    })
  ),
  handler: async (ctx, _args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    if (!userId) {
      // Not authenticated — return an empty list so clients can render safely
      return [];
    }

    // Use a generic query/filter through `any` to avoid type errors when codegen
    // hasn't been run yet (index names/types may be missing in generated types).
    return await (ctx.db as any)
      .query("documents")
      .filter((q: any) => q.eq(q.field("ownerId"), userId))
      .order("desc")
      .take(50);
  },
});

/**
 * Get a single document by id (only owner can read).
 * Returns null when not found.
 */
export const getDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documents"),
      _creationTime: v.number(),
      title: v.string(),
      markdownContent: v.string(),
      cssContent: v.optional(v.string()),
      ownerId: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    if (!userId || doc.ownerId !== userId) {
      // hide document if not owner
      return null;
    }
    return doc;
  },
});

/**
 * Update a document. Only the owner may update.
 * Any provided fields will be patched onto the document.
 */
export const updateDocument = mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    markdownContent: v.optional(v.string()),
    cssContent: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    if (!userId || doc.ownerId !== userId) {
      throw new Error("Not authorized to update this document");
    }

    const patch: Record<string, any> = {};
    if (typeof args.title !== "undefined") patch.title = args.title;
    if (typeof args.markdownContent !== "undefined")
      patch.markdownContent = args.markdownContent;
    if (typeof args.cssContent !== "undefined")
      patch.cssContent = args.cssContent;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.documentId, patch);
    }
    return null;
  },
});

/**
 * Delete a document. Only the owner may delete.
 */
export const deleteDocument = mutation({
  args: { documentId: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    if (!userId || doc.ownerId !== userId) {
      throw new Error("Not authorized to delete this document");
    }
    await ctx.db.delete(args.documentId);
    return null;
  },
});
