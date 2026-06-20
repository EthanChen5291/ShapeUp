"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import Stripe from "stripe";

export const handleWebhook = internalAction({
  args: { body: v.string(), signature: v.string() },
  handler: async (ctx, { body, signature }) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeSecretKey || !webhookSecret) {
      console.error("[stripe-webhook] MISSING ENV VARS — STRIPE_SECRET_KEY present:", !!stripeSecretKey, "STRIPE_WEBHOOK_SECRET present:", !!webhookSecret);
      throw new Error("Stripe env vars not configured");
    }

    const stripe = new Stripe(stripeSecretKey);

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
      console.log("[stripe-webhook] signature verified — event.type=", event.type, "event.id=", event.id);
    } catch (err) {
      console.error("[stripe-webhook] SIGNATURE VERIFICATION FAILED:", String(err));
      throw new Error(`Webhook signature verification failed: ${String(err)}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const clerkId = session.metadata?.clerkId;
      const credits = Number(session.metadata?.credits);
      const rawPlan = session.metadata?.plan;
      const plan = rawPlan === "starter" || rawPlan === "popular" || rawPlan === "pro" ? rawPlan : undefined;
      console.log("[stripe-webhook] checkout.session.completed — session.id=", session.id, "clerkId from metadata=", clerkId ?? "MISSING", "plan=", plan ?? "none");
      if (clerkId && Number.isFinite(credits) && credits > 0) {
        console.log("[stripe-webhook] calling addCreditsForStripeEvent — clerkId=", clerkId, "amount=", credits, "eventId=", event.id);
        await ctx.runMutation(internal.users.addCreditsForStripeEvent, { eventId: event.id, clerkId, amount: credits, plan });
        console.log("[stripe-webhook] credit mutation completed successfully");
      } else {
        console.error("[stripe-webhook] MISSING or invalid checkout metadata — credits NOT added. session.metadata=", JSON.stringify(session.metadata));
      }
    } else {
      console.log("[stripe-webhook] ignoring unhandled event type:", event.type);
    }
  },
});
