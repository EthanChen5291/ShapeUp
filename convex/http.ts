import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    console.log("[stripe-webhook] received request");
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }
    const body = await req.text();

    try {
      await ctx.runAction(internal.stripe.handleWebhook, { body, signature: sig });
    } catch (err) {
      console.error("[stripe-webhook] handler error:", String(err));
      const message = String(err);
      if (message.includes("signature verification failed")) {
        return new Response(message, { status: 400 });
      }
      return new Response(message, { status: 500 });
    }

    return new Response(null, { status: 200 });
  }),
});

export default http;
