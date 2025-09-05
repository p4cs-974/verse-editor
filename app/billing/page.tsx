"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { BalanceDisplay } from "@/components/billing/balance-display";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function BillingPage() {
  const { user } = useUser();
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [simulationResult, setSimulationResult] = useState<string>("");

  // Get or create user in our billing system
  const createUser = useMutation(api.billing.createUserWithSignupCredit);
  const finalizeUsage = useMutation(api.billing.webhookFinalizeUsageCharge);

  const handleCreateUser = async () => {
    if (!user) return;

    setIsCreatingUser(true);
    try {
      await createUser({
        email: user.emailAddresses[0]?.emailAddress,
        name: user.fullName || user.firstName || "Unknown",
      });
    } catch (error) {
      console.error("Failed to create user:", error);
    } finally {
      setIsCreatingUser(false);
    }
  };

  const simulateModelCall = async () => {
    if (!user) return;

    try {
      const result = await finalizeUsage({
        userId: user.id,
        modelId: "gpt-4",
        providerCallId: `sim-${Date.now()}`,
        tokensUsed: 1000,
        idempotencyKey: `sim-${user.id}-${Date.now()}`,
      });

      setSimulationResult(
        `Model call simulation: ${result.charged ? "SUCCESS" : "FAILED"}\n` +
          `Provider cost: $${(result.providerCostCents / 100).toFixed(4)}\n` +
          `Fee: $${(result.feeCents / 100).toFixed(4)}\n` +
          `Total: $${(result.totalCents / 100).toFixed(4)}\n` +
          `New balance: $${(result.newBalanceCents / 100).toFixed(2)}`
      );
    } catch (error) {
      setSimulationResult(`Error: ${error}`);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto p-4">
        <Card>
          <CardContent className="p-6">
            <p>Please sign in to access billing information.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Billing Dashboard</h1>
        <p className="text-gray-600">
          Manage your account balance and view usage history
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* User Balance Section */}
        <div>
          <BalanceDisplay userId={user.id as Id<"users">} />
        </div>

        {/* Demo & Testing Section */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Account Setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Create your billing account to receive the $2 signup credit
              </p>
              <Button
                onClick={handleCreateUser}
                disabled={isCreatingUser}
                className="w-full"
              >
                {isCreatingUser ? "Creating..." : "Initialize Billing Account"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage Simulation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Simulate a model call (1000 tokens at $0.00002/token + 5% fee)
              </p>
              <Button onClick={simulateModelCall} className="w-full">
                Simulate GPT-4 Call
              </Button>
              {simulationResult && (
                <div className="bg-gray-100 p-3 rounded text-sm font-mono whitespace-pre-line">
                  {simulationResult}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Integration Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <strong>Signup Credit:</strong> $2.00
              </div>
              <div>
                <strong>First Topup Bonus:</strong> 20% (max $5)
              </div>
              <div>
                <strong>Model Usage Fee:</strong> 5% on provider cost
              </div>
              <div>
                <strong>GPT-4 Price:</strong> $0.00002/token
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Integration Examples */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle>Integration Examples</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">1. Award Signup Credit</h4>
              <code className="block bg-gray-100 p-2 rounded text-sm">
                {`const result = await ctx.runMutation(api.billing.createUserWithSignupCredit, {
  email: "user@example.com",
  name: "User Name"
});`}
              </code>
            </div>

            <div>
              <h4 className="font-medium mb-2">
                2. Process Payment (Stripe Webhook)
              </h4>
              <code className="block bg-gray-100 p-2 rounded text-sm">
                {`const result = await convex.mutation(api.billing.webhookApplyTopup, {
  userId: "user-id",
  amountCents: 2500,
  paymentProvider: "stripe",
  paymentReference: "pi_xxx",
  idempotencyKey: "pi_xxx"
});`}
              </code>
            </div>

            <div>
              <h4 className="font-medium mb-2">3. Charge for Model Usage</h4>
              <code className="block bg-gray-100 p-2 rounded text-sm">
                {`const result = await ctx.runMutation(api.billing.webhookFinalizeUsageCharge, {
  userId: "user-id",
  modelId: "gpt-4",
  providerCallId: "call-xxx",
  tokensUsed: 1000,
  idempotencyKey: "call-xxx"
});`}
              </code>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
