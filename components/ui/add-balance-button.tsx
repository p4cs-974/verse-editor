"use client";

import { Button } from "./button";
import { Plus } from "lucide-react";
import { BalanceSelectionDialog } from "./balance-selection-dialog";

interface AddBalanceButtonProps {
  className?: string;
}

/**
 * Renders an "Add Balance" button wrapped in a BalanceSelectionDialog.
 *
 * The button is small, outlined, contains a plus icon, and delegates dialog behavior
 * to the surrounding BalanceSelectionDialog.
 *
 * @param className - Optional additional CSS classes appended to the button's class list.
 * @returns A JSX element containing the dialog-wrapped button.
 */
export function AddBalanceButton({ className = "" }: AddBalanceButtonProps) {
  return (
    <BalanceSelectionDialog>
      <Button size="sm" variant="outline" className={`gap-1 ${className}`}>
        <Plus className="h-3 w-3" />
        Add Balance
      </Button>
    </BalanceSelectionDialog>
  );
}
