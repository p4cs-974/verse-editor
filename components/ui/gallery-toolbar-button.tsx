"use client";

import React, { useId, useRef, useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import ToolbarButton from "./toolbar-button";
import { Images } from "lucide-react";
import GalleryPopoverContent from "@/components/ui/gallery-popover-content";

export default function GalleryToolbarButton({
  className,
}: {
  className?: string;
}) {
  const id = useId();
  const popoverId = `gallery-menu-${id}`;
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
          icon={Images}
          label="Gallery"
          ariaLabel="Open image gallery"
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
        <GalleryPopoverContent onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
