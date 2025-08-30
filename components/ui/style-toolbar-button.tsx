"use client";

import React, { useId, useMemo, useRef, useState, useEffect } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import ToolbarButton from "./toolbar-button";
import { Paintbrush } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import StylingPopoverContent from "@/components/ui/style-popover-content";

export default function StyleToolbarButton({
  documentId,
  cssContent,
  className,
}: {
  documentId?: Id<"documents"> | null;
  cssContent?: string | null;
  className?: string;
}) {
  const id = useId();
  const popoverId = `style-menu-${id}`;

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
          icon={Paintbrush}
          label="Styles"
          ariaLabel="Styles"
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
        <StylingPopoverContent
          documentId={documentId}
          cssContent={cssContent}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
