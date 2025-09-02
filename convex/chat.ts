import { components, internal } from "./_generated/api";
import { Agent, vStreamArgs } from "@convex-dev/agent";
import { groq } from "@ai-sdk/groq";
import {
  action,
  ActionCtx,
  internalAction,
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

const markdownAgent = new Agent(components.agent, {
  name: "markdown-agent",
  languageModel: groq.languageModel("openai/gpt-oss-120b"),
  tools: {
    browser_search: groq.tools.browserSearch({}),
  },

  instructions: DEFAULT_MARKDOWN_INSTRUCTIONS,
});

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
