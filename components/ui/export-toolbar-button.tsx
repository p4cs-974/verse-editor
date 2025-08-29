"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import ToolbarButton from "./toolbar-button";
import { Download } from "lucide-react";
import {
  exportPreview,
  exportProgress,
  cancelCurrentExport,
} from "@/lib/export-utils";

interface ExportToolbarButtonProps {
  docId?: string;
  getDocumentTitle?: () => string | undefined;
  markdownContent?: string;
  settings?: { pagination: boolean; pageFormat: "4:3" | "A4" };
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function ExportToolbarButton({
  docId,
  getDocumentTitle,
  markdownContent,
  settings = { pagination: false, pageFormat: "A4" },
  className,
  open: controlledOpen,
  onOpenChange,
}: ExportToolbarButtonProps) {
  const id = useId();
  const popoverId = `export-menu-${id}`;
  const [openInternal, setOpenInternal] = useState(false);
  const open = controlledOpen ?? openInternal;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setOpenInternal(v);
  };

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = [
    useRef<HTMLButtonElement | null>(null),
    useRef<HTMLButtonElement | null>(null),
    useRef<HTMLButtonElement | null>(null),
  ];
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const [progress, setProgress] = useState<{
    stage?: string;
    current?: number;
    total?: number;
    message?: string;
  } | null>(null);

  useEffect(() => {
    const unsub = exportProgress.subscribe((p) => {
      setProgress(p);
    });
    return () => unsub();
  }, []);

  const mergedSettings = settings;

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        // focus first menu item when open
        itemRefs[0].current?.focus();
        setActiveIndex(0);
      }, 0);
    } else {
      setError(null);
      setRunning(false);
      controllerRef.current = null;
    }
  }, [open]);

  function toggleOpen() {
    setOpen(!open);
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleOpen();
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((idx) => {
        const next = (idx + 1) % itemRefs.length;
        itemRefs[next].current?.focus();
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => {
        const next = (idx - 1 + itemRefs.length) % itemRefs.length;
        itemRefs[next].current?.focus();
        return next;
      });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      // trigger current item
      itemRefs[activeIndex].current?.click();
    }
  }

  async function runExport(format: "pdf" | "html" | "markdown") {
    setError(null);
    setRunning(true);
    controllerRef.current = new AbortController();
    const controller = controllerRef.current;
    const fileName =
      getDocumentTitle?.() ?? (docId ? `document-${docId}` : "document");

    try {
      await exportPreview(format, {
        pagination: mergedSettings.pagination,
        pageFormat: mergedSettings.pageFormat,
        fileName,
        docId,
        markdownContent,
      });
      // On success close the menu
      setRunning(false);
      setOpen(false);
    } catch (err: any) {
      if (controller.signal.aborted) {
        setError("Export cancelled");
      } else {
        setError(err?.message || "Export failed");
      }
      setRunning(false);
    } finally {
      controllerRef.current = null;
    }
  }

  function cancelExport() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    try {
      cancelCurrentExport();
    } catch (e) {
      // ignore if cancel not available
    }
    setRunning(false);
    setError("Export cancelled");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={popoverId}
        onKeyDown={onTriggerKeyDown}
      >
        <ToolbarButton
          ref={buttonRef}
          icon={Download}
          label="Export"
          ariaLabel="Export document"
          className={className}
        />
      </PopoverTrigger>

      <PopoverContent
        id={popoverId}
        role="menu"
        sideOffset={8}
        align="center"
        onKeyDown={onMenuKeyDown}
        // add a small wrapper to capture focus sentinels
      >
        <div className="flex flex-col gap-2" style={{ minWidth: 220 }}>
          {/* Focus sentinel - redirect to last when shift-tabbing */}
          <div
            tabIndex={0}
            onFocus={() => itemRefs[itemRefs.length - 1].current?.focus()}
          />

          <button
            ref={itemRefs[0]}
            role="menuitem"
            className="text-left px-2 py-1 rounded hover:bg-gray-100 focus:outline-none"
            onClick={() => runExport("pdf")}
          >
            Export as PDF
          </button>

          <button
            ref={itemRefs[1]}
            role="menuitem"
            className="text-left px-2 py-1 rounded hover:bg-gray-100 focus:outline-none"
            onClick={() => runExport("html")}
          >
            Export as HTML + CSS
          </button>

          <button
            ref={itemRefs[2]}
            role="menuitem"
            className="text-left px-2 py-1 rounded hover:bg-gray-100 focus:outline-none"
            onClick={() => runExport("markdown")}
          >
            Export as Markdown
          </button>

          {running && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full border-2 border-gray-300 border-t-gray-700 w-4 h-4" />
                <div className="flex-1">
                  <div className="text-sm">
                    {progress?.message ||
                      progress?.stage ||
                      "Preparing export…"}
                  </div>
                  {typeof progress?.current === "number" &&
                    typeof progress?.total === "number" && (
                      <div className="w-full bg-gray-200 h-2 rounded mt-1">
                        <div
                          className="bg-emerald-600 h-2 rounded"
                          style={{
                            width: `${Math.round(
                              (progress.current / Math.max(1, progress.total)) *
                                100
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                </div>
                <button
                  className="ml-2 text-sm text-red-600"
                  onClick={cancelExport}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 mt-2" role="alert">
              {error}
            </div>
          )}

          {/* Focus sentinel - redirect to first when tabbing forward */}
          <div tabIndex={0} onFocus={() => itemRefs[0].current?.focus()} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
