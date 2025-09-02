import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import React, { useState } from "react";
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

interface PopoverContentProps {
  threadId: string;
}

function Message({ message }: { message: UIMessage }) {
  // visibleText animates incoming text; default to the final text when not streaming.
  const [visibleText] = useSmoothText(message.text, {
    startStreaming: message.status === "streaming",
  });

  // Debugging: message streaming state
  // eslint-disable-next-line no-console
  console.debug("[Assistant] Message debug", {
    key: message.key,
    role: message.role,
    status: message.status,
    textLength: message.text?.length ?? 0,
    visibleLength: visibleText.length,
  });

  const isAssistantMsg = message.role === "assistant";

  // Some streaming implementations place incremental text on message.parts
  // as parts of type "text" with state "streaming". Prefer that when present.
  const streamingPart = message.parts?.find((p) => {
    return p.type === "text" && (p as any).text && p.state === "streaming";
  });
  const streamingPartText = streamingPart
    ? (streamingPart as any).text
    : undefined;

  // Determine which text to display: prefer streaming part, then the smooth
  // visibleText, then the final message.text.
  const displayedText =
    message.status === "streaming"
      ? streamingPartText ?? visibleText ?? message.text ?? ""
      : message.text ?? visibleText ?? "";

  // Mirror displayedText into local editor state so CodeMirror receives an updated
  // controlled value as streaming updates arrive.
  const [editorValue, setEditorValue] = React.useState(visibleText);

  React.useEffect(() => {
    setEditorValue(displayedText);
  }, [displayedText]);

  if (!isAssistantMsg) return null;

  return (
    <CodeMirror
      value={editorValue}
      height="372px"
      extensions={[markdown(), EditorView.lineWrapping]}
      editable={false}
      theme={"dark"}
    />
  );
}

function Story({ threadId }: { threadId: string }) {
  const messages = useThreadMessages(
    api.chat.listMarkdownThreadMessages,
    { threadId },
    { initialNumItems: 10, stream: true }
  );

  // Debugging: inspect the messages object returned by the hook to ensure the
  // streaming "streams" are present and that assistant messages have status
  // "streaming" while they are being generated.
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.debug("[Assistant] useThreadMessages result", messages);
  }, [messages]);
  const sendMessage = useMutation(
    api.chat.streamMarkdownAsynchronously
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listMarkdownThreadMessages)
  );
  const [prompt, setPrompt] = useState<string | null>(null);

  // Convert server results into UI messages and only keep assistant messages
  const uiMessages = toUIMessages(messages.results ?? []);
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      const text = assistantMessages[currentIndex]?.text ?? "";
                      await navigator.clipboard.writeText(text);
                    } catch (err) {
                      // eslint-disable-next-line no-console
                      console.error("Copy failed", err);
                    }
                  }}
                  aria-label="Copy current assistant message"
                >
                  Copy
                </Button>
              ) : (
                <div className="w-12" />
              )}
            </div>

            <div>
              <Button type="submit" disabled={!prompt?.trim()}>
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

export default function AssistantPopoverContent({
  threadId,
}: PopoverContentProps) {
  return (
    <div className="flex flex-col w-full">
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
