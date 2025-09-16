import { components, internal, api } from "./_generated/api";
import {
  Agent,
  createTool,
  UsageHandler,
  vProviderMetadata,
  vStreamArgs,
} from "@convex-dev/agent";
import { groq } from "@ai-sdk/groq";
import {
  action,
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { z } from "zod";
import { Id } from "./_generated/dataModel";

const DEFAULT_MARKDOWN_INSTRUCTIONS = `You are a Markdown and HTML expert assistant for a markdown editor.
Output only the final content with no explanations.
- Prefer pure Markdown when possible (headings, lists, tables, code fences).
- Use HTML only when Markdown cannot express the requested layout (e.g., two images side by side, multi-column sections, complex tables).
- When using HTML, keep it minimal and semantic (<div>, <section>, <figure>, <img>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <ul>, <ol>, <li>, <blockquote>, <pre>, <code>). Do not emit <script> or <style> or inline event handlers.
- Images must include alt text. Side-by-side example structure:
  <div style="display:flex; gap:12px; align-items:flex-start;">
    <figure style="flex:1"><img src="IMAGE_URL_1" alt="Description 1" /><figcaption>Caption 1</figcaption></figure>
    <figure style="flex:1"><img src="IMAGE_URL_2" alt="Description 2" /><figcaption>Caption 2</figcaption></figure>
  </div>
- If the user asks to insert or transform content, return the exact section ready to paste.
- Never include commentary about what you are doing; just return Markdown/HTML.
- If user sends a vague prompt (i.e. "write something about X"), be concise.
- When using the browser tool and referencing info from it, add links to the websites you got the data from, like this: [Reference #](url)

Whenever you need to include math on the message, follow the Math in Markdown guidelines below.

## Math in Markdown (KaTeX)
- Inline math: use $...$. Example: Inline: $E=mc^2$.
- Block math: use $$...$$ on their own lines or \\[...\\] on separate lines. Example:
  $$
  \\int_a^b f(x)\\,dx
  $$
- Do not wrap math inside code fences; code fences are for code.
- To write a literal dollar sign, escape it as \\$ or wrap it in code: \`$\`.
- Keep block math delimiters alone on their lines (no surrounding text).
- Avoid mixing math delimiters and Markdown emphasis in the same token.`;

const markdownAgent = new Agent(components.agent, {
  name: "markdown-agent",
  languageModel: groq.languageModel("openai/gpt-oss-120b"),
  tools: {
    browser_search: groq.tools.browserSearch({}),
  },
  usageHandler: async (ctx, args) => {
    const {
      userId,
      threadId,
      agentName,
      model,
      provider,
      usage,
      providerMetadata,
    } = args;

    // Skip tracking for anonymous users
    if (!userId) {
      console.debug("Skipping usage tracking for anonymous user");
      return;
    }
    // Defensive: ensure threadId is present
    if (!threadId) {
      console.warn("Skipping usage tracking: missing threadId");
      return;
    }

    // Deterministic, string idempotency key when provider gives one; fallback to a thread-scoped key.
    const idempotencyKey =
      typeof providerMetadata?.requestId === "string"
        ? providerMetadata.requestId
        : `${threadId}:${provider}:${model}:${Date.now()}:${Math.random()}`;

    // 1) Persist raw usage (deduped by idempotencyKey) and capture the inserted rawUsage id.
    let rawUsageId: any = null;
    try {
      rawUsageId = await ctx.runMutation(internal.chat.insertRawUsage, {
        userId,
        threadId,
        agentName,
        model,
        provider,
        usage,
        providerMetadata,
        idempotencyKey,
      });
    } catch (error) {
      console.error("Failed to track usage (insertRawUsage):", error);
    }

    // 2) If token counts are available, schedule a server-side job to finalize billing.
    try {
      const u = usage as any;
      const inputTokens = Number.isFinite(u?.inputTokens)
        ? Number(u.inputTokens)
        : undefined;
      const outputTokens = Number.isFinite(u?.outputTokens)
        ? Number(u.outputTokens)
        : undefined;

      // Only schedule finalization when we have token counts and a persisted rawUsage row.
      if (
        rawUsageId &&
        (inputTokens !== undefined || outputTokens !== undefined)
      ) {
        try {
          await ctx.runMutation(internal.chat.processRawUsage, {
            rawUsageId: rawUsageId as any,
          });
        } catch (schedErr) {
          console.error("Failed to schedule billing finalization:", schedErr);
        }
      } else {
        console.debug(
          "Skipping scheduling finalization (no tokens or no rawUsageId)",
          {
            threadId,
            provider,
            model,
            inputTokens,
            outputTokens,
            rawUsageId,
          }
        );
      }
    } catch (error) {
      console.error("Failed during billing scheduling step:", error);
    }
  },
  instructions: DEFAULT_MARKDOWN_INSTRUCTIONS,
});

export const read_document_markdown_content = createTool<
  { documentId: string },
  string
>({
  description: "Search for the current selected document's markdown content.",
  args: z.object({
    documentId: z
      .string()
      .describe("The id of the document to get the markdown content of."),
  }),
  handler: async (
    ctx: ActionCtx,
    args: { documentId: string }
  ): Promise<string> => {
    const document = await ctx.runQuery(api.documents.getDocument, {
      documentId: args.documentId as Id<"documents">,
    });
    if (!document) throw new Error("Document not found");
    return document.markdownContent;
  },
});

export const edit_document_markdown_content = createTool<
  {
    documentId: string;
    markdownContent: string;
  },
  void
>({
  description: "Edit the markdown content of a document.",
  args: z.object({
    documentId: z.string().describe("The id of the document to edit."),
    markdownContent: z
      .string()
      .describe("New markdown content for the document."),
  }),
  handler: async (
    ctx: ActionCtx,
    args: { documentId: string; markdownContent: string }
  ): Promise<void> => {
    await ctx.runMutation(api.documents.updateDocument, {
      documentId: args.documentId as Id<"documents">,
      markdownContent: args.markdownContent,
    });
  },
});

export const read_document_style = createTool<
  { documentId: string },
  string | undefined
>({
  description: "Read a document's CSS/style content.",
  args: z.object({ documentId: z.string() }),
  handler: async (
    ctx: ActionCtx,
    args: { documentId: string }
  ): Promise<string | undefined> => {
    const document = await ctx.runQuery(api.documents.getDocument, {
      documentId: args.documentId as Id<"documents">,
    });
    if (!document) throw new Error("Document not found");
    return document.cssContent;
  },
});

export const edit_document_style = createTool<
  {
    documentId: string;
    cssContent: string | null;
  },
  void
>({
  description: "Edit a document's CSS/style content.",
  args: z.object({
    documentId: z.string(),
    cssContent: z.union([z.string(), z.null()]),
  }),
  handler: async (
    ctx: ActionCtx,
    args: { documentId: string; cssContent: string | null }
  ): Promise<void> => {
    await ctx.runMutation(api.documents.updateDocument, {
      documentId: args.documentId as Id<"documents">,
      cssContent: args.cssContent,
    });
  },
});

export const read_document_fonts = createTool<
  { documentId: string },
  string[] | undefined
>({
  description: "Read fonts used by a document.",
  args: z.object({ documentId: z.string() }),
  handler: async (
    ctx: ActionCtx,
    args: { documentId: string }
  ): Promise<string[] | undefined> => {
    const document = await ctx.runQuery(api.documents.getDocument, {
      documentId: args.documentId as Id<"documents">,
    });
    if (!document) throw new Error("Document not found");
    const css = document.cssContent ?? "";
    // Extract Google Fonts families from @import lines
    const importRegex =
      /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com\/css2\?([^'"\)]+)['"]\);/gi;
    const families: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(css)) !== null) {
      const query = match[1];
      const params = new URLSearchParams(query);
      for (const [key, value] of params.entries()) {
        if (key === "family") {
          // value like "Inter:wght@400;700" → take family name before colon
          const family = value.split(":")[0];
          if (family && !families.includes(family)) families.push(family);
        }
      }
    }
    return families.length ? families : undefined;
  },
});

export const edit_document_fonts = createTool<
  {
    documentId: string;
    fonts: string[];
  },
  void
>({
  description: "Edit fonts metadata for a document.",
  args: z.object({ documentId: z.string(), fonts: z.array(z.string()) }),
  handler: async (
    ctx: ActionCtx,
    args: { documentId: string; fonts: string[] }
  ): Promise<void> => {
    const document = await ctx.runQuery(api.documents.getDocument, {
      documentId: args.documentId as Id<"documents">,
    });
    if (!document) throw new Error("Document not found");

    const existingCss = document.cssContent ?? "";
    // Remove existing Google Fonts @import lines (css2 and legacy)
    const cleanedCss = existingCss
      .replace(
        /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com\/css2\?family=[^'"\)]+['"]\);\s*/gi,
        ""
      )
      .replace(
        /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com\/[^'"\)]+['"]\);\s*/gi,
        ""
      );

    const imports = (args.fonts || [])
      .filter((f) => f && f.trim().length > 0)
      .map(
        (f) =>
          `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(
            f.trim()
          )}&display=swap');`
      )
      .join("\n");

    const nextCss = imports.length ? `${imports}\n${cleanedCss}` : cleanedCss;

    await ctx.runMutation(api.documents.updateDocument, {
      documentId: args.documentId as Id<"documents">,
      cssContent: nextCss,
    });
  },
});

const DEFAULT_FULL_AGENT_INSTRUCTIONS = `You are the Full Editor Agent for a markdown-based document editor.
Your job is to write and revise the current document's content and styling via the provided tools.

Core rules
- Prefer pure Markdown for content. Use minimal HTML only if Markdown cannot express the layout.
- When you need to update the document or its styles, always use the tools instead of replying with instructions.
- If the user asks for up-to-date facts or references, use the browser_search tool first, then cite sources as Markdown links.

Capabilities
- Read markdown: use read_document_markdown_content with the provided documentId.
- Edit markdown: use edit_document_markdown_content to overwrite the document's markdownContent with the exact new content you compose.
- Read styles: use read_document_style to see current CSS (may be empty).
- Edit styles: use edit_document_style to replace or augment CSS. Keep CSS minimal and scoped to content semantics.
- Manage fonts: use read_document_fonts to detect imported Google Fonts from CSS; use edit_document_fonts to add/remove imports.

Workflow
1) Clarify the user intent in your own mind (do not ask unless ambiguous). Identify if this is a content change, a style change, or both.
2) For content changes:
   - Read the current markdown.
   - Draft the full new markdown; keep prior content only if requested.
   - Write the complete updated markdown via edit_document_markdown_content.
3) For style changes:
   - Read current CSS.
   - Compute the minimal CSS update to achieve the goal.
   - If font changes are needed, update imports with edit_document_fonts. Then update CSS via edit_document_style.
4) For factual content or examples, search with browser_search. Summarize and cite sources with Markdown links.

Formatting guidelines
- Headings: #..###### for structure; lists and tables when appropriate.
- Code: fenced code blocks with language tag. Do not put math in code blocks.
- Math: Inline $...$ and block $$...$$ using KaTeX-compatible syntax.
- Images: Use Markdown images; include alt text. Only use HTML when side-by-side or complex layout is required.

Safety and quality
- Do not include <script> or inline event handlers.
- Be concise when the user is vague; be thorough when the user is specific.
`;

const fullAgent = new Agent(components.agent, {
  name: "full-agent",
  languageModel: groq.languageModel("openai/gpt-oss-120b"),
  instructions: DEFAULT_FULL_AGENT_INSTRUCTIONS,
  tools: {
    read_document_markdown_content,
    edit_document_markdown_content,
    read_document_style,
    edit_document_style,
    read_document_fonts,
    edit_document_fonts,
    browser_search: groq.tools.browserSearch({}),
  },
  callSettings: { maxRetries: 5 },
  usageHandler: async (ctx, args) => {
    const {
      userId,
      threadId,
      agentName,
      model,
      provider,
      usage,
      providerMetadata,
    } = args;

    // Skip tracking for anonymous users
    if (!userId) {
      console.debug("Skipping usage tracking for anonymous user");
      return;
    }
    // Defensive: ensure threadId is present
    if (!threadId) {
      console.warn("Skipping usage tracking: missing threadId");
      return;
    }

    // Deterministic, string idempotency key when provider gives one; fallback to a thread-scoped key.
    const idempotencyKey =
      typeof providerMetadata?.requestId === "string"
        ? providerMetadata.requestId
        : `${threadId}:${provider}:${model}:${Date.now()}:${Math.random()}`;

    // 1) Persist raw usage (deduped by idempotencyKey) and capture the inserted rawUsage id.
    let rawUsageId: any = null;
    try {
      rawUsageId = await ctx.runMutation(internal.chat.insertRawUsage, {
        userId,
        threadId,
        agentName,
        model,
        provider,
        usage,
        providerMetadata,
        idempotencyKey,
      });
    } catch (error) {
      console.error("Failed to track usage (insertRawUsage):", error);
    }

    // 2) If token counts are available, schedule a server-side job to finalize billing.
    try {
      const u = usage as any;
      const inputTokens = Number.isFinite(u?.inputTokens)
        ? Number(u.inputTokens)
        : undefined;
      const outputTokens = Number.isFinite(u?.outputTokens)
        ? Number(u.outputTokens)
        : undefined;

      // Only schedule finalization when we have token counts and a persisted rawUsage row.
      if (
        rawUsageId &&
        (inputTokens !== undefined || outputTokens !== undefined)
      ) {
        try {
          await ctx.runMutation(internal.chat.processRawUsage, {
            rawUsageId: rawUsageId as any,
          });
        } catch (schedErr) {
          console.error("Failed to schedule billing finalization:", schedErr);
        }
      } else {
        console.debug(
          "Skipping scheduling finalization (no tokens or no rawUsageId)",
          {
            threadId,
            provider,
            model,
            inputTokens,
            outputTokens,
            rawUsageId,
          }
        );
      }
    } catch (error) {
      console.error("Failed during billing scheduling step:", error);
    }
  },
});

export const insertRawUsage = internalMutation({
  args: {
    userId: v.string(),
    threadId: v.string(),
    agentName: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    usage: v.object({
      cachedInputTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
    }),
    providerMetadata: v.optional(vProviderMetadata),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.id("rawUsage"),
  handler: async (ctx, args) => {
    // 1) Authorize association (defense-in-depth; internal-only but cheap)
    const meta = await markdownAgent.getThreadMetadata(ctx, {
      threadId: args.threadId,
    });
    if (meta.userId !== args.userId) {
      throw new Error("User/thread mismatch for usage event");
    }

    // Resolve or create a billing user document. We want rawUsage.userId to store the
    // billing users document _id (not the external Clerk id). This ensures downstream
    // processing can operate on the billing doc directly.
    let billingUserId: string;
    const existingBillingUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (existingBillingUser) {
      billingUserId = existingBillingUser._id;
    } else {
      const now = Date.now();
      billingUserId = await ctx.db.insert("users", {
        userId: args.userId,
        email: undefined,
        name: undefined,
        createdAt: now,
        receivedSignupCredit: false,
        firstPaidTopupApplied: false,
        kycLevel: undefined,
        status: "active",
      });
      // Create empty balance row so downstream processing can run safely.
      await ctx.db.insert("balances", {
        userId: billingUserId,
        balanceMicroCents: 0,
        reservedMicroCents: 0,
        updatedAt: now,
        version: 1,
      });
    }

    // 2) Dedupe by idempotencyKey (still valid); existing rows (older format)
    // may already exist with external userId, but idempotencyKey dedupe is global.
    if (args.idempotencyKey) {
      const dup = await ctx.db
        .query("rawUsage")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", args.idempotencyKey!)
        )
        .unique();
      if (dup) return dup._id;
    }

    // 3) Invariants (validate token counts)
    const u = args.usage;
    const fields = [
      "inputTokens",
      "outputTokens",
      "reasoningTokens",
      "cachedInputTokens",
    ] as const;
    for (const k of fields) {
      const v = u[k];
      if (v !== undefined && (v < 0 || !Number.isFinite(v))) {
        throw new Error(`Invalid token count for ${k}`);
      }
    }
    const expectedTotal =
      (u.inputTokens ?? 0) +
      (u.outputTokens ?? 0) +
      (u.reasoningTokens ?? 0) +
      (u.cachedInputTokens ?? 0);
    const totalTokens = Number.isFinite(u.totalTokens)
      ? u.totalTokens
      : expectedTotal;

    // 4) Persist raw usage record using the billing user document id.
    const billingPeriod = getBillingPeriod(Date.now());
    return await ctx.db.insert("rawUsage", {
      userId: billingUserId,
      threadId: args.threadId,
      agentName: args.agentName,
      model: args.model,
      provider: args.provider,
      usage: { ...u, totalTokens },
      providerMetadata: args.providerMetadata,
      idempotencyKey: args.idempotencyKey,
      billingPeriod,
    });
  },
});

/**
 * Compute the billing period start date for a given timestamp.
 *
 * Returns the ISO date (YYYY-MM-DD) representing the first day of the month that contains the provided timestamp.
 *
 * @param at - Unix timestamp in milliseconds
 * @returns The start-of-month date as an ISO date string (e.g., `2025-09-01`)
 */

function getBillingPeriod(at: number) {
  const now = new Date(at);
  const startOfMonthUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  return startOfMonthUtc.toISOString().slice(0, 10); // YYYY-MM-DD
}

export const createMarkdownThread = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    // Require authentication to create a thread
    if (!userId) throw new Error("Not authenticated");

    const { threadId } = await markdownAgent.createThread(ctx, {
      userId: userId,
    });
    return threadId;
  },
});

async function authorizeThreadAccess(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  threadId: string
) {
  const identity = await ctx.auth.getUserIdentity();
  const userId = identity?.subject;

  const threadData = markdownAgent.getThreadMetadata(ctx, {
    threadId: threadId,
  });
  if (!userId) throw new Error("User not authenticated");
  if (!threadId) throw new Error("Thread ID not found.");
  if ((await threadData).userId !== userId)
    throw new Error("Unauthorized access to thread.");
}

export const sendWritingPrompt = action({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const { thread } = await markdownAgent.continueThread(ctx, {
      threadId: args.threadId,
    });

    const result = await thread.streamText(
      { prompt: args.prompt },
      { saveStreamDeltas: { chunking: "word" } }
    );

    // Diagnostic: announce consumeStream start for this run
    console.debug("sendWritingPrompt: about to consumeStream", {
      threadId: args.threadId,
      promptPreview: args.prompt?.slice?.(0, 200) ?? "[no prompt]",
    });

    try {
      await result.consumeStream();

      // Post-consume verification: ensure messages were persisted for this thread.
      try {
        const { page } = await markdownAgent.listMessages(ctx, {
          threadId: args.threadId,
          paginationOpts: { cursor: null, numItems: 5 },
          excludeToolMessages: true,
        });
        console.debug("sendWritingPrompt: after consumeStream listMessages", {
          threadId: args.threadId,
          numMessages: Array.isArray(page) ? page.length : 0,
          sampleIds: Array.isArray(page)
            ? page.slice(0, 3).map((m: any) => m._id)
            : [],
        });
      } catch (listErr) {
        console.error(
          "sendWritingPrompt: listMessages after consumeStream failed",
          {
            threadId: args.threadId,
            error: listErr,
          }
        );
      }

      return;
    } catch (err) {
      console.error("sendWritingPrompt: consumeStream failed", {
        threadId: args.threadId,
        error: err,
      });
      throw err;
    }
  },
});

export const sendFullAgentPrompt = action({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const { thread } = await fullAgent.continueThread(ctx, {
      threadId: args.threadId,
    });

    const result = await thread.streamText(
      { prompt: args.prompt },
      { saveStreamDeltas: { chunking: "word" } }
    );

    // Diagnostic: announce consumeStream start for this run
    console.debug("sendFullAgentPrompt: about to consumeStream", {
      threadId: args.threadId,
      promptPreview: args.prompt?.slice?.(0, 200) ?? "[no prompt]",
    });

    try {
      await result.consumeStream();

      // Post-consume verification: ensure messages were persisted for this thread.
      try {
        const { page } = await fullAgent.listMessages(ctx, {
          threadId: args.threadId,
          paginationOpts: { cursor: null, numItems: 5 },
          excludeToolMessages: true,
        });
        console.debug("sendFullAgentPrompt: after consumeStream listMessages", {
          threadId: args.threadId,
          numMessages: Array.isArray(page) ? page.length : 0,
          sampleIds: Array.isArray(page)
            ? page.slice(0, 3).map((m: any) => m._id)
            : [],
        });
      } catch (listErr) {
        console.error(
          "sendFullAgentPrompt: listMessages after consumeStream failed",
          {
            threadId: args.threadId,
            error: listErr,
          }
        );
      }

      return;
    } catch (err) {
      console.error("sendFullAgentPrompt: consumeStream failed", {
        threadId: args.threadId,
        error: err,
      });
      throw err;
    }
  },
});

export const listFullAgentThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    try {
      await authorizeThreadAccess(ctx, args.threadId);
    } catch (err) {
      throw err;
    }

    const paginated = await fullAgent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
      excludeToolMessages: false,
    });

    const streams = await fullAgent.syncStreams(ctx, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });

    return {
      ...paginated,
      streams,
    };
  },
});

export const streamFullAgent = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const { thread } = await fullAgent.continueThread(ctx, { threadId });

    const result = await thread.streamText(
      { promptMessageId },
      { saveStreamDeltas: true }
    );

    let lastError;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.debug("streamFullAgent: about to consumeStream", {
          promptMessageId,
          threadId,
          attempt,
        });
        await result.consumeStream();

        try {
          const { page } = await fullAgent.listMessages(ctx, {
            threadId,
            paginationOpts: { cursor: null, numItems: 5 },
            excludeToolMessages: false,
          });
          console.debug("streamFullAgent: after consumeStream listMessages", {
            threadId,
            promptMessageId,
            attempt,
            numMessages: Array.isArray(page) ? page.length : 0,
            sampleIds: Array.isArray(page)
              ? page.slice(0, 3).map((m: any) => m._id)
              : [],
          });
        } catch (listErr) {
          console.error(
            "streamFullAgent: listMessages after consumeStream failed",
            {
              threadId,
              promptMessageId,
              attempt,
              error: listErr,
            }
          );
        }
        console.debug("streamFullAgent: consumeStream succeeded", {
          promptMessageId,
          threadId,
          attempt,
        });
        return;
      } catch (error) {
        lastError = error;
        console.error(`FullAgent stream attempt ${attempt} failed:`, error, {
          promptMessageId,
          threadId,
        });
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.error("FullAgent stream failed after all retries:", lastError, {
      promptMessageId,
      threadId,
    });

    try {
      const fallback = await fullAgent.saveMessage(ctx, {
        threadId,
        prompt:
          "Sorry, I encountered an error generating the response. Please try again.",
        skipEmbeddings: true,
      });
      console.debug("streamFullAgent: inserted fallback message", {
        threadId,
        fallbackId: (fallback as any)?.messageId ?? fallback,
      });
    } catch (fallbackError) {
      console.error(
        "FullAgent: Failed to insert fallback message:",
        fallbackError
      );
    }
  },
});

export const streamFullAgentAsynchronously = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);

    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    if (userId) {
      const balanceCheck = await ctx.runQuery(
        api.billing.checkSufficientBalance,
        {
          userId,
          modelId: "openai/gpt-oss-120b",
          estimatedInputTokens: Math.min(prompt.length / 4, 1000),
          estimatedOutputTokens: 2500,
        }
      );

      if (!balanceCheck.hasSufficientBalance) {
        throw new Error(
          `Insufficient balance. You need approximately $${(
            balanceCheck.estimatedCostMicroCents /
            (1_000_000 * 100)
          ).toFixed(4)} but only have $${balanceCheck.balanceInDollars.toFixed(
            4
          )}. Please add funds to your account.`
        );
      }
    }

    const { messageId } = await fullAgent.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });
    await ctx.scheduler.runAfter(0, internal.chat.streamFullAgent, {
      threadId,
      promptMessageId: messageId,
    });
  },
});

// Backward-compatibility alias with the requested spelling
export const stramFullAgentAsynchronously = streamFullAgentAsynchronously;

export const streamMarkdown = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const { thread } = await markdownAgent.continueThread(ctx, { threadId });

    if (process.env.NODE_ENV === "development") {
      console.debug("streamMarkdown: starting streamText", {
        promptMessageId,
        threadId,
      });
    }

    const result = await thread.streamText(
      { promptMessageId },
      { saveStreamDeltas: true }
      // { saveStreamDeltas: { chunking: "word" } }
    );

    let lastError;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.debug("streamMarkdown: about to consumeStream", {
          promptMessageId,
          threadId,
          attempt,
        });

        await result.consumeStream();

        // Post-consume verification: ensure messages were persisted for this thread.
        try {
          const { page } = await markdownAgent.listMessages(ctx, {
            threadId,
            paginationOpts: { cursor: null, numItems: 5 },
            excludeToolMessages: true,
          });
          console.debug("streamMarkdown: after consumeStream listMessages", {
            threadId,
            promptMessageId,
            attempt,
            numMessages: Array.isArray(page) ? page.length : 0,
            sampleIds: Array.isArray(page)
              ? page.slice(0, 3).map((m: any) => m._id)
              : [],
          });
        } catch (listErr) {
          console.error(
            "streamMarkdown: listMessages after consumeStream failed",
            {
              threadId,
              promptMessageId,
              attempt,
              error: listErr,
            }
          );
        }

        console.debug("streamMarkdown: consumeStream succeeded", {
          promptMessageId,
          threadId,
          attempt,
        });
        return; // Success, exit
      } catch (error) {
        lastError = error;
        console.error(`Stream attempt ${attempt} failed:`, error, {
          promptMessageId,
          threadId,
        });
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 100; // 100, 200, 400 ms
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // If all retries failed
    console.error("Stream failed after all retries:", lastError, {
      promptMessageId,
      threadId,
    });

    // Insert fallback message
    try {
      const fallback = await markdownAgent.saveMessage(ctx, {
        threadId,
        prompt:
          "Sorry, I encountered an error generating the response. Please try again.",
        skipEmbeddings: true,
      });
      console.debug("streamMarkdown: inserted fallback message", {
        threadId,
        fallbackId: (fallback as any)?.messageId ?? fallback,
      });
    } catch (fallbackError) {
      console.error("Failed to insert fallback message:", fallbackError);
    }
  },
});

export const listMarkdownThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    try {
      await authorizeThreadAccess(ctx, args.threadId);
    } catch (err) {
      // Propagate the error to the client rather than invoking browser APIs.
      throw err;
    }

    const paginated = await markdownAgent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
      excludeToolMessages: true,
    });

    const streams = await markdownAgent.syncStreams(ctx, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });

    return {
      ...paginated,
      streams,
    };
  },
});

export const streamStoryInternalAction = markdownAgent.asTextAction({
  stream: { chunking: "word" },
});

// This fetches full messages. Streamed messages are not included.
export const listRecentMessages = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    try {
      await authorizeThreadAccess(ctx, threadId);
    } catch (err) {
      // Propagate the error to the client rather than invoking browser APIs.
      throw err;
    }

    const { page: messages } = await markdownAgent.listMessages(ctx, {
      threadId,
      paginationOpts: {
        cursor: null,
        numItems: 10,
      },
    });

    // Return them in ascending order (oldest first)
    return messages.reverse();
  },
});

// This fetches only streaming messages.
export const listStreamingMessages = query({
  args: { threadId: v.string(), streamArgs: vStreamArgs },
  handler: async (ctx, { threadId, streamArgs }) => {
    try {
      await authorizeThreadAccess(ctx, threadId);
    } catch (err) {
      // Propagate the error to the client rather than invoking browser APIs.
      throw err;
    }
    const streams = await markdownAgent.syncStreams(ctx, {
      threadId,
      streamArgs,
    });
    return { streams };
  },
});

// Streaming, where generate the prompt message first, then asynchronously
// generate the stream response.
export const streamMarkdownAsynchronously = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);

    // Check if user has sufficient balance before making the request
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    if (userId) {
      const balanceCheck = await ctx.runQuery(
        api.billing.checkSufficientBalance,
        {
          userId,
          modelId: "openai/gpt-oss-120b", // Match the model used in markdownAgent
          estimatedInputTokens: Math.min(prompt.length / 4, 1000), // Rough estimate: 4 chars per token
          estimatedOutputTokens: 2000, // Conservative estimate for output
        }
      );

      if (!balanceCheck.hasSufficientBalance) {
        throw new Error(
          `Insufficient balance. You need approximately $${(
            balanceCheck.estimatedCostMicroCents /
            (1_000_000 * 100)
          ).toFixed(4)} but only have $${balanceCheck.balanceInDollars.toFixed(
            4
          )}. Please add funds to your account.`
        );
      }
    }

    const { messageId } = await markdownAgent.saveMessage(ctx, {
      threadId,
      prompt,
      // we're in a mutation, so skip embeddings for now. They'll be generated
      // lazily when streaming text.
      skipEmbeddings: true,
    });
    await ctx.scheduler.runAfter(0, internal.chat.streamMarkdown, {
      threadId,
      promptMessageId: messageId,
    });
  },
});

export const processRawUsage = internalMutation({
  args: {
    rawUsageId: v.id("rawUsage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Fetch the rawUsage row
    const raw = await ctx.db.get(args.rawUsageId);
    if (!raw) {
      console.warn("processRawUsage: rawUsage not found", args.rawUsageId);
      return null;
    }

    const u: any = raw.usage ?? {};
    const inputTokens = Number.isFinite(u?.inputTokens)
      ? Number(u.inputTokens)
      : undefined;
    const outputTokens = Number.isFinite(u?.outputTokens)
      ? Number(u.outputTokens)
      : undefined;

    // Nothing to charge if we don't have token counts
    if (inputTokens === undefined && outputTokens === undefined) {
      console.debug("processRawUsage: no token counts, skipping", {
        rawId: args.rawUsageId,
      });
      return null;
    }

    // Resolve billing user document. raw.userId may already be a billing users doc _id
    // (new rows), or it may be an external user id (legacy rows). Handle both.
    let billingUserId: string;
    // Try treating raw.userId as a Convex document id first.
    let userDoc: any = null;
    try {
      userDoc = await ctx.db.get(raw.userId as any);
    } catch (e) {
      userDoc = null;
    }

    if (userDoc && (userDoc as any).receivedSignupCredit !== undefined) {
      // raw.userId was already a billing document id
      billingUserId = raw.userId;
    } else {
      // Fallback: look up by external userId field (e.g. Clerk id)
      const existing = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", raw.userId))
        .unique();

      if (existing) {
        billingUserId = existing._id;
      } else {
        const now = Date.now();
        billingUserId = await ctx.db.insert("users", {
          userId: raw.userId,
          email: undefined,
          name: undefined,
          createdAt: now,
          receivedSignupCredit: false,
          firstPaidTopupApplied: false,
          kycLevel: undefined,
          status: "active",
        });

        // Create empty balance row so finalize can run safely
        await ctx.db.insert("balances", {
          userId: billingUserId,
          balanceMicroCents: 0,
          reservedMicroCents: 0,
          updatedAt: now,
          version: 1,
        });
      }
    }

    // Use idempotency key or fallback to rawUsage id for providerCallId/idempotency
    const providerCallId =
      typeof raw.idempotencyKey === "string"
        ? raw.idempotencyKey
        : args.rawUsageId;
    const idempotencyKey =
      typeof raw.idempotencyKey === "string"
        ? raw.idempotencyKey
        : args.rawUsageId;

    // Call internal billing finalize to compute cost and attempt to deduct balance.
    try {
      await ctx.runMutation(internal.billing.internalFinalizeUsageCharge, {
        userId: billingUserId as any,
        modelId: raw.model,
        providerCallId,
        inputTokens,
        outputTokens,
        idempotencyKey,
      });
    } catch (err) {
      // Don't throw — we don't want to break other processing. Log for investigation.
      console.error("processRawUsage: finalize billing failed", err, {
        rawUsageId: args.rawUsageId,
      });
    }

    return null;
  },
});

// Retroactive processing utilities

export const listRawUsageIdsByPeriod = internalQuery({
  args: {
    userId: v.string(),
    billingPeriod: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.id("rawUsage")),
  handler: async (ctx, args) => {
    // Accept either a billing user document id or an external user id (string).
    // Resolve to the billing document id before querying the composite index.
    let billingUserId: string;
    // Try treating the arg as a Convex document _id first.
    let userDoc: any = null;
    try {
      userDoc = await ctx.db.get(args.userId as any);
    } catch (e) {
      userDoc = null;
    }

    if (userDoc && (userDoc as any).receivedSignupCredit !== undefined) {
      billingUserId = userDoc._id;
    } else {
      // Fallback: look up by external userId field (e.g. Clerk id)
      const found = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId as string))
        .unique();
      if (!found) {
        return [];
      }
      billingUserId = found._id;
    }

    // Query raw usage for a specific billing period and billing-user id using the composite index
    const rows = await ctx.db
      .query("rawUsage")
      .withIndex("billingPeriod_userId", (q) =>
        q.eq("billingPeriod", args.billingPeriod).eq("userId", billingUserId)
      )
      .order("asc")
      .take(args.limit ?? 100);

    return rows.map((r) => r._id);
  },
});

/**
 * Action: retroactively process a user's usage and deduct from balance.
 *
 * - Scans rawUsage for the given billingPeriod and user (defaults to current month)
 * - For each usage row, invokes the internal processor which:
 *   - resolves/creates a billing user doc and balance
 *   - computes price and fees using configured modelTokenPrices
 *   - charges or logs a failed usage when funds are insufficient
 *   - uses idempotency so re-processing the same row is safe
 */
export const retroactivelyChargeUserUsage = action({
  args: {
    userId: v.string(), // external user identifier matching rawUsage.userId
    billingPeriod: v.optional(v.string()), // e.g. "2025-09-01"; defaults to current month
    limit: v.optional(v.number()), // max rows to process in this run
  },
  returns: v.object({
    processed: v.number(),
  }),
  handler: async (ctx, args) => {
    const period = args.billingPeriod ?? getBillingPeriod(Date.now());

    const rawIds = await ctx.runQuery(internal.chat.listRawUsageIdsByPeriod, {
      userId: args.userId,
      billingPeriod: period,
      limit: args.limit ?? 100,
    });

    let processed = 0;
    for (const rawUsageId of rawIds) {
      try {
        // Safe to call repeatedly: processRawUsage and internalFinalizeUsageCharge are idempotent
        await ctx.runMutation(internal.chat.processRawUsage, { rawUsageId });
        processed++;
      } catch (err) {
        console.error("retroactivelyChargeUserUsage: failed to process", {
          rawUsageId,
          error: err,
        });
        // Continue with next row
      }
    }

    return { processed };
  },
});
