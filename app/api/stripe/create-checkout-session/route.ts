import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";

/**
 * Create a Stripe Checkout Session on the server so we can include metadata.userId.
 * We pass the Clerk user id (auth subject) as metadata.userId; the Convex webhook
 * will resolve it to the billing users._id when processing the session.
 *
 * Requires: STRIPE_SECRET_KEY in environment.
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY in environment");
}
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: process.env.STRIPE_API_VERSION as
    | Stripe.LatestApiVersion
    | undefined,
});

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { amountCents } = await request.json();

    if (!amountCents || amountCents <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    // Map to existing Stripe price IDs (kept in sync with Convex pricing map)
    const priceMap: Record<number, string> = {
      500: process.env.NEXT_PUBLIC_STRIPE_PRICE_5 || "", // $5
      1000: process.env.NEXT_PUBLIC_STRIPE_PRICE_10 || "", // $10
      2500: process.env.NEXT_PUBLIC_STRIPE_PRICE_25 || "", // $25
      5000: process.env.NEXT_PUBLIC_STRIPE_PRICE_50 || "", // $50
    };

    const priceId = priceMap[amountCents];
    if (!priceId) {
      return NextResponse.json(
        { error: `No price configured for amount: $${amountCents / 100}` },
        { status: 400 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const successUrl = `${baseUrl}`;
    const cancelUrl = `${baseUrl}`;

    // Create a real Stripe Checkout Session and attach the Clerk user id as metadata.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: {
        userId,
      },
    });

    return NextResponse.json({
      sessionUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
