"use client";

import React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  isActive?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  className?: string;
}

/**
 * Forwarding ref so parent components can measure the button DOM node
 * (e.g., for popover positioning with getBoundingClientRect).
 */
const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  (
    {
      icon: Icon,
      label,
      onClick,
      isActive = false,
      ariaLabel,
      ariaPressed,
      className,
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label={ariaLabel || label}
        aria-pressed={ariaPressed}
        className={cn(
          "inline-flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-md text-xs font-medium transition-colors",
          "bg-emerald-100/0 hover:bg-emerald-100/10 focus:outline-none focus:ring-2 focus:ring-emerald-300",
          "dark:hover:bg-emerald-900/10 dark:focus:ring-emerald-600",
          isActive && "bg-emerald-100/20 dark:bg-emerald-900/20",
          className
        )}
      >
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
      </button>
    );
  }
);

ToolbarButton.displayName = "ToolbarButton";

export default ToolbarButton;
