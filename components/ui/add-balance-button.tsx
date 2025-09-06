"use client";

import { Button } from "./button";
import { Plus } from "lucide-react";
import { BalanceSelectionDialog } from "./balance-selection-dialog";

interface AddBalanceButtonProps {
  className?: string;
}

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
