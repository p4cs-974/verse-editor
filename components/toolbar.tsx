"use client";

import { Files } from "lucide-react";
import ToolbarButton from "./ui/toolbar-button";

export default function Toolbar({
  sidebarOpen,
  onToggle,
}: {
  sidebarOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="h-14 border-b bg-background/95 flex items-center px-3">
      <ToolbarButton
        icon={Files}
        label="Documents"
        onClick={onToggle}
        isActive={sidebarOpen}
        ariaLabel="Toggle documents sidebar"
        ariaPressed={sidebarOpen}
      />
    </div>
  );
}
