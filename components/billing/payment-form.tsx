"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

interface PaymentFormProps {
  userId: Id<"users">;
  amountCents: number;
  onSuccess?: (result: {
    paymentIntentId: string;
    amountCents: number;
    bonusCents: number;
  }) => void;
  onError?: (error: string) => void;
}

function CheckoutForm({
  userId,
  amountCents,
  onSuccess,
  onError,
}: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsLoading(true);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Return URL after payment
        return_url: `${window.location.origin}/billing/success`,
      },
      redirect: "if_required",
    });

    if (error) {
      onError?.(error.message || "Payment failed");
    } else {
      // Payment succeeded
      onSuccess?.({
        paymentIntentId: "payment-intent-id",
        amountCents,
        bonusCents: 0, // Will be calculated by server
      });
    }

    setIsLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <Button type="submit" disabled={!stripe || isLoading} className="w-full">
        {isLoading ? "Processing..." : `Add $${(amountCents / 100).toFixed(2)}`}
      </Button>
    </form>
  );
}

export function PaymentForm(props: PaymentFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const createPaymentIntent = useAction(api.stripe.createPaymentIntent);

  const initializePayment = async () => {
    try {
      const result = await createPaymentIntent({
        userId: props.userId,
        amountCents: props.amountCents,
      });
      setClientSecret(result.clientSecret);
    } catch (error) {
      props.onError?.("Failed to initialize payment");
    }
  };

  if (!clientSecret) {
    return (
      <div className="text-center">
        <Button onClick={initializePayment}>Initialize Payment</Button>
      </div>
    );
  }

  const appearance = {
    theme: "stripe" as const,
  };

  const options = {
    clientSecret,
    appearance,
  };

  return (
    <Elements options={options} stripe={stripePromise}>
      <CheckoutForm {...props} />
    </Elements>
  );
}
