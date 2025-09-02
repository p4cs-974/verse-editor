import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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
