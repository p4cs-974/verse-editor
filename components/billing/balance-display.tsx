"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";
import { PaymentForm } from "./payment-form";

// Typed shape for transactions returned by the Convex query.
// The UI expects an `amountCents` numeric field when rendering; make it required
// to avoid implicit-any / possibly-undefined TypeScript errors at usage sites.
interface Transaction {
  _id: string;
  type: string;
  amountCents: number;
  amountMicroCents?: number;
  createdAt: number;
  referenceId?: string;
  metadata?: any;
}

interface BalanceDisplayProps {
  userId: Id<"users">;
}

/**
 * Displays a user's account balance, reserved amounts, signup/top-up bonus status, a top-up UI, and up to five recent transactions.
 *
 * Shows a loading state while the balance is being fetched. Provides an inline top-up flow (amount input -> PaymentForm)
 * and closes the payment form on success or error; balance updates rely on Convex reactivity. Transaction amounts are
 * color-coded by sign and dates are localized.
 *
 * @param userId - The Id<"users"> for the account whose balance and transactions should be displayed.
 */
export function BalanceDisplay({ userId }: BalanceDisplayProps) {
  const balance = useQuery(api.billing.getUserBalance, { userId });
  const transactions = useQuery(api.billing.getUserTransactions, {
    userId,
    limit: 5,
  });
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [topupAmount, setTopupAmount] = useState(2000); // Default $20

  if (balance === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account Balance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getBalanceColor = () => {
    if (balance.balanceCents < 100) return "text-red-600";
    if (balance.balanceCents < 500) return "text-yellow-600";
    return "text-green-600";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            Account Balance
            {balance.balanceCents < 500 && (
              <span className="text-sm text-red-500">Low Balance</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-3xl font-bold">
              <span className={getBalanceColor()}>
                {formatCurrency(balance.balanceCents)}
              </span>
            </div>

            {balance.reservedCents > 0 && (
              <div className="text-sm text-gray-600">
                Reserved: {formatCurrency(balance.reservedCents)}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Signup Credit:</span>
                <span
                  className={
                    balance.receivedSignupCredit
                      ? "text-green-600"
                      : "text-red-500"
                  }
                >
                  {balance.receivedSignupCredit ? " ✓" : " ✗"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">First Topup Bonus:</span>
                <span
                  className={
                    balance.firstPaidTopupApplied
                      ? "text-green-600"
                      : "text-blue-600"
                  }
                >
                  {balance.firstPaidTopupApplied ? " Used" : " Available"}
                </span>
              </div>
            </div>

            {!showPaymentForm ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={topupAmount / 100}
                    onChange={(e) =>
                      setTopupAmount(
                        Math.round(parseFloat(e.target.value || "0") * 100)
                      )
                    }
                    className="flex-1 px-3 py-2 border rounded-md"
                    placeholder="Amount ($)"
                    min="5"
                    step="0.01"
                  />
                  <Button onClick={() => setShowPaymentForm(true)}>
                    Add Funds
                  </Button>
                </div>
                {!balance.firstPaidTopupApplied && topupAmount > 0 && (
                  <div className="text-sm text-blue-600">
                    You'll get a {Math.min(Math.round(topupAmount * 0.05), 500)}
                    ¢ bonus on your first top-up!
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <PaymentForm
                  userId={userId}
                  amountCents={topupAmount}
                  onSuccess={() => {
                    setShowPaymentForm(false);
                    // Balance will auto-refresh due to Convex reactivity
                  }}
                  onError={(error) => {
                    console.error("Payment error:", error);
                    setShowPaymentForm(false);
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => setShowPaymentForm(false)}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {transactions && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="text-gray-500 text-center py-4">
                No transactions yet
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx: Transaction) => (
                  <div
                    key={tx._id}
                    className="flex justify-between items-center py-2 border-b last:border-b-0"
                  >
                    <div>
                      <div className="font-medium capitalize">
                        {tx.type.replace(/_/g, " ")}
                      </div>
                      <div className="text-sm text-gray-500">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div
                      className={`font-medium ${
                        tx.amountCents >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {tx.amountCents >= 0 ? "+" : ""}
                      {formatCurrency(tx.amountCents)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
