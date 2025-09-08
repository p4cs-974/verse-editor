import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import React, { useState, useRef, useEffect } from "react";
import { Textarea } from "./textarea";
import { Button } from "./button";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import {
  optimisticallySendMessage,
  toUIMessages,
  UIMessage,
  useSmoothText,
  useThreadMessages,
} from "@convex-dev/agent/react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "./pagination";
import { File } from "lucide-react";
import { BalanceDisplay } from "./balance-display";
import { AddBalanceButton } from "./add-balance-button";

// Simple per-page in-memory cache for thread results. Bounded to avoid unbounded growth.
// This cache is intentionally simple; it persists to localStorage to survive reloads.
// For heavy usage or larger payloads consider using IndexedDB/localForage instead.
const THREAD_MESSAGES_CACHE: Map<string, any[]> = new Map();
const CACHE_MAX_ENTRIES = 50;
const CACHE_STORAGE_KEY = "assistant_thread_cache_v1";

// Load persisted cache from localStorage (safe-guarded for SSR).
(function loadCacheFromStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, any[]>;
    if (!parsed || typeof parsed !== "object") return;
    // Respect insertion order from parsed object keys (may not be LRU).
    const entries = Object.entries(parsed);
    for (const [k, v] of entries.slice(0, CACHE_MAX_ENTRIES)) {
      THREAD_MESSAGES_CACHE.set(k, v);
    }
  } catch (e) {
    // ignore persistence errors
    // eslint-disable-next-line no-console
    console.debug("Assistant cache load error", e);
  }
})();

function persistCacheToStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const obj: Record<string, any[]> = {};
    THREAD_MESSAGES_CACHE.forEach((v, k) => {
      obj[k] = v;
    });
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    // ignore persistence errors
    // eslint-disable-next-line no-console
    console.debug("Assistant cache persist error", e);
  }
}

function cacheSet(threadId: string, results: any[]) {
  if (!results || results.length === 0) return;
  if (THREAD_MESSAGES_CACHE.size >= CACHE_MAX_ENTRIES) {
    // evict the oldest entry (Map preserves insertion order)
    const firstIter = THREAD_MESSAGES_CACHE.keys().next();
    if (!firstIter.done && firstIter.value !== undefined) {
      THREAD_MESSAGES_CACHE.delete(firstIter.value);
    }
  }
  THREAD_MESSAGES_CACHE.set(threadId, results);
  persistCacheToStorage();
}

function cacheGet(threadId: string): any[] | undefined {
  return THREAD_MESSAGES_CACHE.get(threadId);
}

function cacheDelete(threadId: string) {
  const existed = THREAD_MESSAGES_CACHE.delete(threadId);
  if (existed) persistCacheToStorage();
}
interface PopoverContentProps {
  threadId: string;
}

function Message({ message }: { message: UIMessage }) {
  // visibleText animates incoming text; default to the final text when not streaming.
  const [visibleText] = useSmoothText(message.text, {
    startStreaming: message.status === "streaming",
  });

  const isAssistantMsg = message.role === "assistant";

  const editorRef = React.useRef<EditorView | null>(null);

  if (!isAssistantMsg) return null;

  React.useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const changes = { from: 0, to: view.state.doc.length, insert: visibleText };
    view.dispatch(view.state.update({ changes }));
  }, [visibleText]);

  return (
    // <p>{visibleText}</p>
    <CodeMirror
      onCreateEditor={(view) => {
        editorRef.current = view;
      }}
      value={visibleText}
      height="372px"
      extensions={[markdown(), EditorView.lineWrapping]}
      editable={false}
      theme={"dark"}
    />
  );
}

// // DEBUG MESSAGE
// function Message({ message }: { message: UIMessage }) {
//   const isUser = message.role === "user";
//   const [visibleText] = useSmoothText(message.text, {
//     // This tells the hook that it's ok to start streaming immediately.
//     // If this was always passed as true, messages that are already done would
//     // also stream in.
//     // IF this was always passed as false (default), then the streaming message
//     // wouldn't start streaming until the second chunk was received.
//     startStreaming: message.status === "streaming",
//   });
//   return (
//     <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
//       <div
//         className={`rounded-lg px-4 py-2 max-w-lg whitespace-pre-wrap shadow-sm ${
//           isUser ? "bg-blue-100 text-blue-900" : "bg-gray-200 text-gray-800"
//         }`}
//       >
//         {visibleText}
//       </div>
//     </div>
//   );
/**
 * Renders the assistant thread UI for a given threadId: input prompt, send flow,
 * streaming assistant messages, copy-to-clipboard, and pagination.
 *
 * This component subscribes to server paginated results and streaming deltas,
 * merges them into a single timeline (preserving streaming text as it arrives),
 * prefers live streaming data while generation is in progress, and falls back to
 * a cached snapshot once streaming finishes. It also provides an input area
 * with optimistic send, per-thread caching of finalized message snapshots, and
 * controls to copy the currently visible assistant message and navigate between
 * assistant responses.
 *
 * @param threadId - Identifier of the conversation thread to display and interact with.
 * @returns The Story component's JSX element.
 */

function Story({ threadId }: { threadId: string }) {
  const messages = useThreadMessages(
    api.chat.listMarkdownThreadMessages,
    { threadId },
    { initialNumItems: 100, stream: true }
  );

  // Debugging: inspect the messages object returned by the hook to ensure the
  // streaming "streams" are present and that assistant messages have status
  // "streaming" while they are being generated.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.debug("[Assistant] useThreadMessages result", messages);
    }
  }, [messages]);
  const sendMessage = useMutation(
    api.chat.streamMarkdownAsynchronously
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listMarkdownThreadMessages)
  );
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Convert server results into UI messages and only keep assistant messages
  // `messages` returned by useThreadMessages includes paginated.results and a
  // `streams` object. On some runs the stream deltas arrive via `streams`
  // without an immediately updated paginated snapshot; ensure we merge them
  // so the UI sees streaming text even when paginated page is empty.
  const paginatedResults = (messages as any).results ?? [];
  const streamResults = (messages as any).streams?.streams ?? [];
  // Merge paginated results and active streams by concatenating and deduping by _id.
  const mergedById: Record<string, any> = {};
  for (const r of paginatedResults) {
    if (r && r._id) mergedById[r._id] = r;
  }
  for (const s of streamResults) {
    if (!s) continue;
    // Streams typically have an `_id` matching the originating message or a stream id;
    // prefer keeping an existing paginated document and augment it with stream fields.
    const id =
      s._id ??
      s.streamId ??
      `${s.threadId}-stream-${s.streamId ?? Math.random()}`;
    const existing = mergedById[id] ?? {};
    mergedById[id] = {
      ...existing,
      ...s,
      // Ensure we keep the canonical fields from existing if present.
      _id: existing._id ?? id,
      threadId: existing.threadId ?? s.threadId,
      order: existing.order ?? s.order,
      stepOrder: existing.stepOrder ?? s.stepOrder,
      message: existing.message ?? s.message,
      text: (existing.text ?? "") + (s.text ?? ""),
      streaming: s.streaming ?? existing.streaming ?? true,
      status: s.streaming ? "streaming" : existing.status ?? s.status,
    };
  }
  const rawResults = Object.values(mergedById).sort((a: any, b: any) => {
    const aKey = (a.order ?? 0) * 100000 + (a.stepOrder ?? 0);
    const bKey = (b.order ?? 0) * 100000 + (b.stepOrder ?? 0);
    return aKey - bKey;
  });

  // Detect if any incoming result is still streaming so we prefer live data while streaming.
  const hasStreaming = React.useMemo(
    () => rawResults.some((r: any) => (r as any).status === "streaming"),
    [rawResults]
  );

  // Local ref to the cached snapshot for this thread to avoid reading the Map every render.
  const cachedRef = React.useRef<any[] | null>(cacheGet(threadId) ?? null);

  React.useEffect(() => {
    // Keep the ref in sync with the global cache if it changes for this threadId.
    cachedRef.current = cacheGet(threadId) ?? cachedRef.current;
  }, [threadId]);

  React.useEffect(() => {
    // When we receive a non-empty, non-streaming snapshot, persist it to the cache.
    if (rawResults.length > 0 && !hasStreaming) {
      cacheSet(threadId, rawResults);
      cachedRef.current = rawResults;
    }
  }, [rawResults, threadId, hasStreaming]);

  // Prefer live results while streaming; otherwise use cached snapshot (if present).
  const sourceResults = hasStreaming
    ? rawResults
    : cachedRef.current ?? rawResults;

  // Memoize conversion to UI messages so we don't re-parse on every render.
  const uiMessages = React.useMemo(
    () => toUIMessages(sourceResults),
    [sourceResults]
  );

  const assistantMessages = React.useMemo(
    () => uiMessages.filter((m) => m.role === "assistant"),
    [uiMessages]
  );

  // Current page index (0-based). Default to the latest message.
  const [currentIndex, setCurrentIndex] = React.useState<number>(
    assistantMessages.length > 0 ? assistantMessages.length - 1 : 0
  );

  // Track previous assistantMessages length so we only auto-jump when a new
  // message arrives (not when user navigates).
  const prevLenRef = React.useRef(assistantMessages.length);

  React.useEffect(() => {
    const len = assistantMessages.length;
    if (len === 0) {
      setCurrentIndex(0);
    } else if (len > prevLenRef.current) {
      // New message(s) arrived -> jump to latest
      setCurrentIndex(len - 1);
    } else if (currentIndex >= len) {
      // Messages removed/truncated -> clamp the index
      setCurrentIndex(Math.max(0, len - 1));
    }
    prevLenRef.current = len;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantMessages.length]);

  function onSendClicked() {
    if (prompt) {
      if (prompt.trim() === "") return;
      void sendMessage({ threadId, prompt }).catch(() => setPrompt(prompt));
      setPrompt("");
    }
  }

  function goPrev() {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }
  function goNext() {
    setCurrentIndex((i) => Math.min(assistantMessages.length - 1, i + 1));
  }
  function goToIndex(i: number) {
    setCurrentIndex(i);
  }

  return (
    <div>
      <div className="w-full">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSendClicked();
          }}
          className="mb-3 w-full"
        >
          <Textarea
            placeholder="Enter your prompt here..."
            value={prompt ? prompt : ""}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full"
          />

          {/* Controls below the prompt: Copy on the left, Send on the right */}
          <div className="mt-2 flex items-center justify-between gap-2 w-full">
            <div>
              {assistantMessages.length > 0 ? (
                <div className="relative inline-block">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        const text =
                          assistantMessages[currentIndex]?.text ?? "";
                        await navigator.clipboard.writeText(text);
                        setCopied(true);
                        if (copyTimeoutRef.current) {
                          window.clearTimeout(copyTimeoutRef.current);
                        }
                        copyTimeoutRef.current = window.setTimeout(() => {
                          setCopied(false);
                        }, 1200);
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error("Copy failed", err);
                      }
                    }}
                    aria-label="Copy current assistant message"
                    className="underline"
                  >
                    <File />
                    Copy
                  </Button>

                  <span
                    role="status"
                    aria-live="polite"
                    className={`absolute -top-6 left-1/2 transform -translate-x-1/2 bg-neutral-800 text-white text-xs px-2 py-1 rounded shadow pointer-events-none transition-opacity duration-200 ${
                      copied ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    Copied!
                  </span>
                </div>
              ) : (
                <div className="w-12" />
              )}
            </div>

            <div>
              <Button
                type="submit"
                disabled={!prompt?.trim()}
                className="font-medium"
              >
                Send
              </Button>
            </div>
          </div>
        </form>
      </div>

      {assistantMessages.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="border rounded-md overflow-hidden bg-neutral-950">
            {assistantMessages.map((msg, idx) => (
              <div
                key={msg.key}
                // keep all Message components mounted so streaming continues,
                // but only show the active one visually.
                className={idx === currentIndex ? "" : "hidden"}
              >
                <Message message={msg} />
              </div>
            ))}
          </div>

          <Pagination className="mt-2">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={goPrev}
                  aria-disabled={currentIndex <= 0}
                />
              </PaginationItem>

              {assistantMessages.map((m, idx) => (
                <PaginationItem key={m.key}>
                  <PaginationLink
                    isActive={idx === currentIndex}
                    onClick={() => goToIndex(idx)}
                  >
                    {idx + 1}
                  </PaginationLink>
                </PaginationItem>
              ))}

              <PaginationItem>
                <PaginationNext
                  onClick={goNext}
                  aria-disabled={currentIndex >= assistantMessages.length - 1}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : (
        <div className="text-sm text-neutral-500">
          No assistant messages yet.
        </div>
      )}
    </div>
  );
}

/**
 * Popover content that displays balance controls and the thread conversation.
 *
 * Renders a header with BalanceDisplay and AddBalanceButton. The main area shows the
 * Story component for the given `threadId`. If `threadId` is not provided, a
 * centered "Loading..." placeholder is shown.
 *
 * @param threadId - The thread identifier whose messages should be displayed.
 */
export default function AssistantPopoverContent({
  threadId,
}: PopoverContentProps) {
  return (
    <div className="flex flex-col w-full">
      {/* Header with title, balance, and add balance button */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b">
        <div className="flex items-center gap-2">
          <BalanceDisplay />
        </div>
        <AddBalanceButton />
      </div>

      <main className="flex-1 w-full">
        {threadId ? (
          <Story threadId={threadId} />
        ) : (
          <div className="text-center text-gray-500">Loading...</div>
        )}
      </main>

      {/* <Toast /> */}
    </div>
  );
}
