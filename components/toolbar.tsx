"use client";

import { Files } from "lucide-react";
import { useEffect, useState } from "react";
import ToolbarButton from "./ui/toolbar-button";
import SyncStatusDot from "@/components/ui/SyncStatusDot";
import ExportToolbarButton from "./ui/export-toolbar-button";
import ExportSettingsButton from "./ui/export-settings-button";
import StyleToolbarButton from "@/components/ui/style-toolbar-button";
import type { Id } from "../convex/_generated/dataModel";

export default function Toolbar({
  sidebarOpen,
  onToggle,
  syncStatus = "synced",
  documentId,
  cssContent,
}: {
  sidebarOpen: boolean;
  onToggle: () => void;
  syncStatus?: "local" | "synced";
  documentId?: Id<"documents"> | null;
  cssContent?: string | null;
}) {
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Cmd/Ctrl + E opens export menu unless focus is in an input, textarea, or contenteditable
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "e") {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            (target as HTMLElement).isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        setExportOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-14 border-b bg-background/95 flex items-center px-3 justify-between">
      <div className="flex items-center gap-2">
        <ToolbarButton
          icon={Files}
          label="Documents"
          onClick={onToggle}
          isActive={sidebarOpen}
          ariaLabel="Toggle documents sidebar"
          ariaPressed={sidebarOpen}
        />
        <StyleToolbarButton documentId={documentId} cssContent={cssContent} />
      </div>

      <div className="flex items-center gap-2">
        <ExportToolbarButton open={exportOpen} onOpenChange={setExportOpen} />
        <ExportSettingsButton />
        <SyncStatusDot status={syncStatus} />
      </div>
    </div>
  );
}
