"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { UTApi } from "uploadthing/server";

/**
 * Delete one or more user images by their public URLs.
 * - Verifies the caller is authenticated.
 * - Confirms ownership in Convex.
 * - Deletes the corresponding UploadThing files by key.
 * - Removes the rows from the `userImages` table.
 */
export const deleteUserImages = action({
  args: { fileUrls: v.array(v.string()) },
  returns: v.object({
    requested: v.number(),
    matched: v.number(),
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const ownerId = identity?.subject;
    if (!ownerId) {
      throw new Error("Not authenticated");
    }

    // Find matching rows (ownership check inside internal query)
    const matches: Array<{ _id: string; fileUrl: string; fileKey: string }> =
      await ctx.runQuery(internal.userImages.findOwnedByUrls, {
        ownerId,
        fileUrls: args.fileUrls,
      });

    // Delete files from UploadThing by their keys
    const keys: string[] = matches.map((m) => m.fileKey);
    if (keys.length > 0) {
      const utapi = new UTApi();
      try {
        await utapi.deleteFiles(keys);
      } catch (e) {
        console.warn("UTApi.deleteFiles failed", e);
      }
    }

    // Remove DB rows for these URLs
    const deleted: number = await ctx.runMutation(
      internal.userImages.deleteOwnedByUrls,
      {
        ownerId,
        fileUrls: args.fileUrls,
      }
    );

    return {
      requested: args.fileUrls.length,
      matched: matches.length,
      deleted,
    };
  },
});
