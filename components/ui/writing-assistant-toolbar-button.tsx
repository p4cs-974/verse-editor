"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import ToolbarButton from "./toolbar-button";
import { Sparkles } from "lucide-react";
import AssistantPopoverView from "./assistant-popover-view";
import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";

interface WritingAssistantToolbarButtonProps {
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function WritingAssistantToolbarButton({
  className,
  open: controlledOpen,
  onOpenChange,
}: WritingAssistantToolbarButtonProps) {
  const id = useId();
  const popoverId = `assistant-popover-${id}`;

  const [open, setOpen] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(!open);
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      e.preventDefault();
      setOpen(true);
    }
  }
  const [threadId, setThreadId] = React.useState<string | null>(null);

  const createMarkdownThread = useMutation(api.chat.createMarkdownThread);

  useEffect(() => {
    createMarkdownThread()
      .then(setThreadId)
      .catch((err) => setThreadId(null));
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onKeyDown={onTriggerKeyDown}
      >
        <ToolbarButton
          ref={buttonRef}
          icon={Sparkles}
          label="assistant"
          ariaLabel="assistant"
          className={className}
        />
      </PopoverTrigger>

      <PopoverContent
        id={popoverId}
        role="dialog"
        aria-modal="true"
        sideOffset={8}
        align="center"
        className="w-auto p-0"
      >
        {threadId && (
          <AssistantPopoverView
            threadId={threadId}
            onClose={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
