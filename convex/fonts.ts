import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import fontsGoogleCatalog from "./fonts-google-catalog.json";

/**
 * List imported fonts for the user (global).
 */
export const listUserFonts = query({
  args: { userId: v.string() },
  returns: v.array(v.string()), // array of family names
  handler: async (ctx, args) => {
    const fonts = await ctx.db
      .query("userFonts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
    return fonts.map((font) => font.family);
  },
});

/**
 * Add a font to the user's imported list (deduplicated).
 */
export const addUserFont = mutation({
  args: {
    userId: v.string(),
    family: v.string(),
  },
  returns: v.id("userFonts"),
  handler: async (ctx, args) => {
    // Check for existing to avoid duplicates
    const existing = await ctx.db
      .query("userFonts")
      .withIndex("by_userId_and_family", (q) =>
        q.eq("userId", args.userId).eq("family", args.family)
      )
      .unique();
    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("userFonts", {
      userId: args.userId,
      family: args.family,
      importedAt: Date.now(),
    });
  },
});

/**
 * Search Google Fonts API for fonts matching the query (top by popularity).
 */
export const searchGoogleFonts = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      family: v.string(),
      category: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    console.log("searchGoogleFonts called with args:", {
      query: args.query,
      limit: args.limit,
    });

    // Use imported Google Fonts catalog
    const popularFonts: Array<{ family: string; category: string }> =
      fontsGoogleCatalog;

    // Improved filtering: split query into words, match if any word is in family (case-insensitive)
    const queryWords = args.query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const filtered = popularFonts.filter((font) => {
      const lowerFamily = font.family.toLowerCase();
      return queryWords.some((word) => lowerFamily.includes(word));
    });

    // Sort alphabetically
    filtered.sort((a, b) => a.family.localeCompare(b.family));

    const limit = args.limit ?? 5;
    const results = filtered.slice(0, limit);
    console.log(
      `Filtered ${filtered.length} fonts for query '${args.query}', returning ${results.length}:`,
      results.map((f) => f.family)
    );

    return results;
  },
});
