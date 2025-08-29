"use client";

import { Files } from "lucide-react";
import ToolbarButton from "./ui/toolbar-button";
import SyncStatusDot from "@/src/components/SyncStatusDot";

export default function Toolbar({
  sidebarOpen,
  onToggle,
  syncStatus = "synced",
}: {
  sidebarOpen: boolean;
  onToggle: () => void;
  syncStatus?: "local" | "synced";
}) {
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
      </div>
      <div className="flex items-center gap-2">
        <SyncStatusDot status={syncStatus} />
      </div>
    </div>
  );
}
