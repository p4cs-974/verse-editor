import { components, internal } from "./_generated/api";
import {
  Agent,
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
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

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
- When using the browser tool and referencing info from it, add links to the websites you got the data from, like this: [Reference #](url)`;

// export const usageHandler: UsageHandler = async (ctx, args) => {
//   if (!args.userId) {
//     console.debug("Not tracking anonymous usage");
//   }

//   // const completionTokens = args.usage.outputTokens;
//   // args.usage.completionTokens = completionTokens;

//   await ctx.runMutation(internal.chat.insertRawUsage, {
//     userId: args.userId,
//     agentName: args.agentName,
//     model: args.model,
//     provider: args.provider,
//     usage: args.usage,
//     providerMetadata: args.providerMetadata,
//   });
// };

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

    try {
      await ctx.runMutation(internal.chat.insertRawUsage, {
        userId,
        threadId,
        agentName,
        model,
        provider,
        usage,
        providerMetadata,
        idempotencyKey:
          providerMetadata?.requestId ??
          `${threadId}:${provider}:${model}:${usage.totalTokens}`,
      });
    } catch (error) {
      // Log error but don't fail the main operation
      console.error("Failed to track usage:", error);
    }
  },
  instructions: DEFAULT_MARKDOWN_INSTRUCTIONS,
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
      inputTokens: v.number(),
      outputTokens: v.number(),
      reasoningTokens: v.optional(v.number()),
      totalTokens: v.number(),
    }),
    providerMetadata: v.optional(vProviderMetadata),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1) Authorize association (defense-in-depth; internal-only but cheap)
    const meta = await markdownAgent.getThreadMetadata(ctx, {
      threadId: args.threadId,
    });
    if (meta.userId !== args.userId) {
      throw new Error("User/thread mismatch for usage event");
    }

    // 2) Dedupe
    if (args.idempotencyKey) {
      const dup = await ctx.db
        .query("rawUsage")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", args.idempotencyKey!)
        )
        .unique();
      if (dup) return dup._id;
    }

    // 3) Invariants
    const u = args.usage;
    const fields = ["inputTokens", "outputTokens", "reasoningTokens", "cachedInputTokens"] as const;
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
    const totalTokens =
      Number.isFinite(u.totalTokens) && u.totalTokens >= expectedTotal
        ? u.totalTokens
        : expectedTotal;

    // 4) Persist
    const billingPeriod = getBillingPeriod(Date.now());
    return await ctx.db.insert("rawUsage", {
      ...args,
      usage: { ...u, totalTokens },
      billingPeriod,
    });
  },
});
function getBillingPeriod(at: number) {
  const now = new Date(at);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth());
  return startOfMonth.toISOString().split("T")[0];
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

    await result.consumeStream();
  },
});

export const streamMarkdown = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const { thread } = await markdownAgent.continueThread(ctx, { threadId });

    const result = await thread.streamText(
      { promptMessageId },
      { saveStreamDeltas: true }
      // { saveStreamDeltas: { chunking: "word" } }
    );

    await result.consumeStream();
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
