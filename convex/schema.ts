import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Documents owned by Clerk users (ownerId is the Clerk user id as a string)
  documents: defineTable({
    title: v.string(),
    markdownContent: v.string(),
    cssContent: v.optional(v.string()),
    ownerId: v.string(),
  }).index("by_ownerId", ["ownerId"]),
});
