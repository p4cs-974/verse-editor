"use client";

import { Menu } from "lucide-react";

export default function Toolbar({
  sidebarOpen,
  onToggle,
}: {
  sidebarOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="h-14 border-b bg-background/95 flex items-center px-3">
      <button
        type="button"
        aria-pressed={sidebarOpen}
        aria-label="Toggle documents sidebar"
        onClick={onToggle}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium
          bg-emerald-100/0 hover:bg-emerald-100/10 focus:outline-none focus:ring-2 focus:ring-emerald-300`}
      >
        <Menu className="w-5 h-5" />
        <span>Documents</span>
      </button>
    </div>
  );
}
