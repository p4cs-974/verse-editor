"use client";

import React, { useId, useRef, useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import ToolbarButton from "./toolbar-button";
import { Files } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import DocumentsPopoverContent from "./documents-popover-content";

export default function DocumentsToolbarButton({
  selectedId,
  onSelect,
  className,
}: {
  selectedId?: Id<"documents"> | null;
  onSelect: (id: Id<"documents">) => void;
  className?: string;
}) {
  const id = useId();
  const popoverId = `documents-menu-${id}`;
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => !v);
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      e.preventDefault();
      setOpen(true);
    }
  }

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
          icon={Files}
          label="Documents"
          ariaLabel="Open documents"
          className={className}
        />
      </PopoverTrigger>

      <PopoverContent
        id={popoverId}
        role="dialog"
        aria-modal="true"
        sideOffset={8}
        align="start"
        className="w-auto p-0"
      >
        <DocumentsPopoverContent
          selectedId={selectedId}
          onSelect={onSelect}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
