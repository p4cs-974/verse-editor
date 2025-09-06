import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "@/convex/_generated/api";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not configured");
}
if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

/**
 * Next.js POST handler for Stripe webhooks.
 *
 * Verifies the Stripe webhook signature (expects the `stripe-signature` header),
 * parses the incoming event, and dispatches it to the appropriate event-specific
 * handlers (e.g., payment success, checkout completion, payment failure, dispute).
 *
 * Responds with:
 * - 200 JSON `{ received: true }` on successful processing,
 * - 400 JSON `{ error: "Missing signature" | "Invalid signature" }` when the signature header is missing or verification fails,
 * - 500 JSON `{ error: "Webhook processing failed" }` if an error occurs while handling the event.
 *
 * The handler relies on the configured Stripe webhook endpoint secret to validate signatures
 * and uses event metadata (when present) to associate Stripe objects with application users.
 *
 * @returns A NextResponse containing JSON status for the webhook delivery.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const headersList = await headers();
  // Replace non-null assertion with a safe lookup
  const sig = headersList.get("stripe-signature");

  if (!sig) {
    console.error("Missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      endpointSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`Processing Stripe event: ${event.type}`);

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSuccess(paymentIntent);
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentFailed(paymentIntent);
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        await handleDispute(dispute);
        break;
      }

      // case "invoice.payment_succeeded": {
      //   const invoice = event.data.object as Stripe.Invoice;
      //   await handleInvoicePayment(invoice);
      //   break;
      // }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`Error processing webhook for event ${event.type}:`, error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/**
 * Apply a successful Stripe PaymentIntent as a user top-up in Convex.
 *
 * Extracts `userId` from `paymentIntent.metadata` and the top-up amount (in cents)
 * from `paymentIntent.amount`. If `userId` is absent, the function returns early.
 * Uses `paymentIntent.id` as an idempotency key and calls the Convex mutation
 * `api.billing.webhookApplyTopup` with `paymentProvider` set to `"stripe"` and
 * `paymentReference` set to the PaymentIntent ID.
 *
 * @param paymentIntent - The Stripe PaymentIntent representing a completed payment.
 * @throws Errors propagated from the Convex mutation when applying the top-up.
 */
async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const userId = paymentIntent.metadata?.userId;
  const topupAmountCents = paymentIntent.amount; // Stripe amount is in cents

  if (!userId) {
    console.error("No userId in payment intent metadata");
    return;
  }

  // Use payment intent ID as idempotency key
  const idempotencyKey = paymentIntent.id;

  try {
    const result = await convex.mutation(api.billing.webhookApplyTopup, {
      userId,
      amountCents: topupAmountCents,
      paymentProvider: "stripe",
      paymentReference: paymentIntent.id,
      idempotencyKey,
    });

    console.log(`Successfully processed topup for user ${userId}:`, result);
  } catch (error) {
    console.error(`Failed to process topup for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Process a completed Stripe Checkout Session.
 *
 * Looks for `session.metadata.userId` to associate the checkout with a user. If `session.mode`
 * is `"subscription"`, the function currently logs the completed subscription and returns.
 * For non-subscription checkouts that include a `payment_intent`, it resolves the PaymentIntent
 * (handles both string ID and object forms) and delegates processing to `handlePaymentSuccess`.
 *
 * If `session.metadata.userId` is missing the function logs an error and exits without further action.
 *
 * @param session - The Stripe Checkout Session received from the webhook. Expects `metadata.userId` when actionable.
 */
async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;

  if (!userId) {
    console.error("No userId in checkout session metadata");
    return;
  }

  // If this was a subscription checkout, handle subscription creation
  if (session.mode === "subscription") {
    // Handle subscription logic here if needed
    console.log("Subscription checkout completed for user:", userId);
    return;
  }

  // For payment mode, get the payment intent
  if (session.payment_intent) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    await handlePaymentSuccess(paymentIntent);
  }
}

/**
 * Handle a failed Stripe PaymentIntent by extracting the associated user ID and recording the failure.
 *
 * If `paymentIntent.metadata.userId` is missing the function returns without action. Currently this logs the failure and is intended to be extended to notify the user, record analytics, or mark related charges as failed.
 *
 * @param paymentIntent - The Stripe PaymentIntent that failed; the user association is expected in `paymentIntent.metadata.userId`.
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const userId = paymentIntent.metadata?.userId;

  if (!userId) {
    console.error("No userId in failed payment intent metadata");
    return;
  }

  console.log(
    `Payment failed for user ${userId}, payment intent: ${paymentIntent.id}`
  );

  // You might want to:
  // 1. Notify the user
  // 2. Log the failure for analytics
  // 3. Mark any pending charges as failed
}

/**
 * Process a Stripe dispute (chargeback) event and log user-facing context for review.
 *
 * Looks up the related Charge and, if available, the PaymentIntent to determine the associated
 * userId from metadata. When a userId is found, logs a summary of the dispute (user, amount,
 * dispute id, reason) to surface the case for manual review and potential follow-up actions
 * (refund, account freeze, review, etc.). The function also attempts to retrieve the Stripe
 * Customer for additional metadata when present.
 *
 * Errors are caught and logged; this function does not throw. Note: the implementation currently
 * references an undefined `customerId` variable when retrieving the Customer.
 *
 * @param dispute - The Stripe Dispute object received from the webhook
 */
async function handleDispute(dispute: Stripe.Dispute) {
  const chargeId = dispute.charge as string;

  try {
    const charge = await stripe.charges.retrieve(chargeId);
    const paymentIntentId = charge.payment_intent as string;

    if (paymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId
      );
      const userId = paymentIntent.metadata?.userId;

      if (userId) {
        console.log(
          `Dispute created for user ${userId}, amount: ${dispute.amount}`
        );

        // You might want to:
        // 1. Automatically refund if within policy
        // 2. Flag for manual review
        // 3. Freeze the account if needed
        // 4. Create a refund transaction

        // For now, log it for manual review
        console.log("Dispute requires manual review:", {
          userId,
          disputeId: dispute.id,
          amount: dispute.amount,
          reason: dispute.reason,
        });
      }
    }
    const customer = await stripe.customers.retrieve(customerId);

    if ("deleted" in customer && customer.deleted) {
      console.log("Invoice payment for deleted customer");
      return;
    }

    const userId = !("deleted" in customer)
      ? customer.metadata?.userId
      : undefined;
  } catch (error) {
    console.error("Error handling dispute:", error);
  }
}

/**
 * Handle successful invoice payments (for subscriptions if implemented)
 */
// async function handleInvoicePayment(invoice: Stripe.Invoice) {
//   const customerId = invoice.customer as string;

//   try {
//     const customer = await stripe.customers.retrieve(customerId);

//     if (customer.deleted) {
//       console.log("Invoice payment for deleted customer");
//       return;
//     }

//     const userId = customer.metadata?.userId;

//     if (userId) {
//       console.log(
//         `Invoice payment succeeded for user ${userId}, amount: ${invoice.amount_paid}`
//       );

//       // Handle recurring subscription payments here if needed
//       // This might credit the user's account or extend their subscription
//     }
//   } catch (error) {
//     console.error("Error handling invoice payment:", error);
//   }
// }}
