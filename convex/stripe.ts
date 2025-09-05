import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

export const stripeWebhook = httpAction(async (ctx, request) => {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("No signature provided", { status: 400 });
  }

  try {
    // In a real app, you would verify the webhook signature here
    // For this demo, we'll process the event directly
    const event = JSON.parse(body);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Extract user information and payment details
      const customerId = session.customer;
      const amountTotal = session.amount_total; // in cents

      // Convert cents to microcents (multiply by 1,000,000)
      const amountMicroCents = amountTotal * 1_000_000;

      // Extract user ID from session metadata or client_reference_id.
      // The value may be either:
      // 1) a billing users table _id (preferred), or
      // 2) a Clerk user id (the identity subject).
      // Try to resolve Clerk ids to billing user _ids so downstream logic
      // can always work with the users table id.
      let providedUserId =
        session.client_reference_id || session.metadata?.userId;
      if (!providedUserId) {
        console.error("No user ID found in Stripe session:", session.id);
        return new Response("No user ID in session", { status: 400 });
      }

      let userId: string;
      try {
        // Heuristic: Convex billing user _ids are document-like (e.g. start with "k_").
        // If the provided identifier looks like a billing users._id, use it directly.
        // Otherwise treat it as a Clerk subject id and resolve/create the billing user.
        if (
          typeof providedUserId === "string" &&
          providedUserId.startsWith("k_")
        ) {
          userId = providedUserId;
        } else {
          // Resolve or create a billing users._id from the Clerk id via an internal mutation.
          // This avoids using ctx.db inside httpAction (not available) and centralizes creation.
          userId = await ctx.runMutation(
            internal.billing.resolveOrCreateBillingUserByClerkId,
            { clerkId: providedUserId, email: undefined, name: undefined }
          );
        }
      } catch (err) {
        console.error("Error resolving user id from Stripe session:", err);
        return new Response("Error resolving user id", { status: 500 });
      }

      // Apply the topup to the user's balance
      await ctx.runMutation(api.billing.webhookApplyTopup, {
        userId,
        amountMicroCents,
        paymentProvider: "stripe",
        paymentReference: session.id,
        idempotencyKey: event.id,
      });

      console.log(
        `Successfully processed payment for user ${userId}: $${
          amountTotal / 100
        }`
      );
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return new Response("Webhook processing failed", { status: 400 });
  }
});
