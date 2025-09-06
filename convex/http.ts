import { httpRouter } from "convex/server";
import { stripeWebhook } from "./stripe";

const http = httpRouter();

// Stripe webhook endpoint
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

export default http;
