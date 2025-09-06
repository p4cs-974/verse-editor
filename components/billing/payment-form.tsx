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

/**
 * Renders a Stripe PaymentElement and submits payment confirmation to Stripe.
 *
 * This component displays a payment UI (Stripe PaymentElement) and, on submit,
 * calls `stripe.confirmPayment` (with a return URL based on `window.location.origin`)
 * to confirm the payment. It requires Stripe's Elements context (i.e., be rendered
 * inside `<Elements>`). While submitting it manages a local loading state and disables
 * the submit button.
 *
 * @param amountCents - Payment amount in cents (used to label the submit button).
 * @param onSuccess - Called when payment confirmation succeeds with an object:
 *   `{ paymentIntentId: string, amountCents: number, bonusCents: number }`.
 *   (In this implementation `paymentIntentId` is a string identifier and `bonusCents`
 *   is set to 0; final values are expected to be provided/verified server-side.)
 * @param onError - Called with an error message if confirmation fails.
 */
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

/**
 * Render a two-step Stripe payment form: first initialize a PaymentIntent, then render Stripe Elements to collect and confirm payment.
 *
 * The component calls a server action to create a PaymentIntent (using `userId` and `amountCents`) and stores the returned `clientSecret`. Before initialization it shows an "Initialize Payment" button; after a successful initialization it mounts Stripe `Elements` (using the configured publishable key) and renders the internal `CheckoutForm` to complete payment.
 *
 * @param props - Component props including:
 *   - `userId`: the Id of the user making the payment.
 *   - `amountCents`: payment amount in cents.
 *   - `onSuccess?`: optional callback invoked after a successful payment.
 *   - `onError?`: optional callback invoked if initialization or payment fails.
 */
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
