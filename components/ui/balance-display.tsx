"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import React, { useEffect, useState } from "react";

interface BalanceDisplayProps {
  className?: string;
}

export function BalanceDisplay({ className = "" }: BalanceDisplayProps) {
  const balanceData = useQuery(api.billing.getUserBalanceForDisplay);
  const [displayBalance, setDisplayBalance] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Animate balance changes
  useEffect(() => {
    if (balanceData?.balanceInDollars !== undefined) {
      if (displayBalance !== balanceData.balanceInDollars) {
        setIsAnimating(true);

        // Animate the balance change
        const startBalance = displayBalance;
        const endBalance = balanceData.balanceInDollars;
        const duration = 800; // 800ms animation
        const startTime = Date.now();

        const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);

          // Ease out animation
          const easeOutProgress = 1 - Math.pow(1 - progress, 3);

          const currentBalance =
            startBalance + (endBalance - startBalance) * easeOutProgress;
          setDisplayBalance(currentBalance);

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            setIsAnimating(false);
          }
        };

        requestAnimationFrame(animate);
      }
    }
  }, [balanceData?.balanceInDollars, displayBalance]);

  // Initialize display balance when data first loads
  useEffect(() => {
    if (balanceData?.balanceInDollars !== undefined && displayBalance === 0) {
      setDisplayBalance(balanceData.balanceInDollars);
    }
  }, [balanceData?.balanceInDollars, displayBalance]);

  if (!balanceData) {
    return (
      <div className={`text-sm text-muted-foreground ${className}`}>
        Loading...
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1 text-sm ${className}`}>
      <span className="text-muted-foreground">Balance:</span>
      <span
        className={`font-mono transition-all duration-200 ${
          isAnimating ? "scale-110 text-green-600" : "text-foreground"
        }`}
      >
        ${displayBalance.toFixed(4)}
      </span>
    </div>
  );
}
