"use client";

import { useState } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Badge } from "./badge";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

interface BalanceOption {
  amount: number;
  label: string;
  paymentUrl: string;
  popular?: boolean;
}

const BALANCE_OPTIONS: BalanceOption[] = [
  {
    amount: 5,
    label: "$5",
    paymentUrl: "https://buy.stripe.com/test_3cIbIUdnH4ofeL133hdAk01",
  },
  {
    amount: 10,
    label: "$10",
    paymentUrl: "https://buy.stripe.com/test_eVqeV60AV3kb6evgU7dAk00",
    popular: true,
  },
  {
    amount: 25,
    label: "$25",
    paymentUrl: "https://buy.stripe.com/test_00w7sE2J32g79qH8nBdAk02",
  },
  {
    amount: 50,
    label: "$50",
    paymentUrl: "https://buy.stripe.com/test_28E4gsfvP8Ev1YffQ3dAk03",
  },
];

interface BalanceSelectionDialogProps {
  children: React.ReactNode;
}

export function BalanceSelectionDialog({
  children,
}: BalanceSelectionDialogProps) {
  const [isLoading, setIsLoading] = useState<number | null>(null);
  const balanceData = useQuery(api.billing.getUserBalanceForDisplay);

  const handleSelectAmount = async (option: BalanceOption) => {
    setIsLoading(option.amount);
    try {
      // Create dynamic checkout session with user context
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amountCents: option.amount * 100, // Convert dollars to cents
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create checkout session");
      }

      const { sessionUrl } = await response.json();
      window.open(sessionUrl, "_blank");
    } catch (error) {
      console.error("Error creating checkout session:", error);
      // Fallback to static payment link
      window.open(option.paymentUrl, "_blank");
    } finally {
      setIsLoading(null);
    }
  };

  const calculateBonus = (amount: number) => {
    if (!balanceData?.firstPaidTopupApplied) {
      return amount * 0.05; // 5% bonus for first-time users
    }
    return 0;
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Balance</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose how much you'd like to add to your account balance:
          </p>

          {!balanceData?.firstPaidTopupApplied && (
            <div className="bg-green-50 dark:bg-green-950 p-3 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                🎉 First-time bonus: Get 5% extra on your first top-up!
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {BALANCE_OPTIONS.map((option) => {
              const bonus = calculateBonus(option.amount);
              const total = option.amount + bonus;

              return (
                <Button
                  key={option.amount}
                  variant="outline"
                  className="relative h-auto p-4 flex flex-col items-center gap-2"
                  onClick={() => handleSelectAmount(option)}
                  disabled={isLoading !== null}
                >
                  {option.popular && (
                    <Badge className="absolute -top-2 text-xs bg-primary">
                      Popular
                    </Badge>
                  )}

                  <span className="text-lg font-semibold">{option.label}</span>

                  {bonus > 0 && (
                    <div className="text-xs text-center">
                      <div className="text-muted-foreground">
                        +${bonus.toFixed(2)} bonus
                      </div>
                      <div className="font-medium text-green-600">
                        = ${total.toFixed(2)} total
                      </div>
                    </div>
                  )}

                  {isLoading === option.amount && (
                    <span className="text-xs text-muted-foreground">
                      Opening...
                    </span>
                  )}
                </Button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            You'll be redirected to Stripe to complete your payment securely.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
