import { mutation, query, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireConvexAdmin } from "./lib/adminAuth";
import { hasProfanity } from "./lib/contentFilter";

// Same address regex the waitlist uses — keep validation behaviour consistent.
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

const MAX_NAME_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 4000;
const MIN_MESSAGE_LENGTH = 10;

// The topics the contact form offers. Mirrors the radio options on the page so
// the two can't drift — the page imports this list.
export const CONTACT_TOPICS = [
  "support",
  "billing",
  "privacy",
  "partnership",
  "press",
  "other",
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

const TOPIC_LABELS: Record<string, string> = {
  support: "Help & support",
  billing: "Billing & refunds",
  privacy: "Privacy & data",
  partnership: "Barbershop / partnership",
  press: "Press & media",
  other: "Something else",
};

// Public, unauthenticated — the contact page lives on the marketing site, so
// logged-out visitors must be able to reach us. Spam is handled with a honeypot
// + validation rather than an auth gate, matching waitlist.joinWaitlist.
export const submitMessage = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    topic: v.string(),
    message: v.string(),
    // Honeypot — must be empty; bots tend to fill every field.
    hp: v.string(),
  },
  handler: async (ctx, args) => {
    // Honeypot: pretend everything's fine but drop it on the floor.
    if (args.hp !== "") return { ok: true as const };

    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    const message = args.message.trim();
    const topic = CONTACT_TOPICS.includes(args.topic as ContactTopic)
      ? args.topic
      : "other";

    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
      throw new Error("Please enter your name.");
    }
    if (!EMAIL_RE.test(email)) {
      throw new Error("Please enter a valid email address so we can reply.");
    }
    if (message.length < MIN_MESSAGE_LENGTH) {
      throw new Error("Please add a little more detail so we can help.");
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new Error("That message is a bit long — please trim it down.");
    }
    if (hasProfanity(name)) {
      throw new Error("Please enter a valid name.");
    }

    // Tie the message back to an account when the sender is signed in, but never
    // require it — most senders won't be.
    const identity = await ctx.auth.getUserIdentity();

    await ctx.db.insert("contactMessages", {
      name,
      email,
      topic,
      message: message.slice(0, MAX_MESSAGE_LENGTH),
      tokenIdentifier: identity?.tokenIdentifier,
      createdAt: Date.now(),
    });

    // Fan out to Discord out-of-band so a webhook hiccup never blocks the send.
    await ctx.scheduler.runAfter(0, internal.contact.notifyDiscord, {
      name,
      email,
      topic,
      message,
    });

    return { ok: true as const };
  },
});

// Admin: most recent contact messages, newest first. Enforces admin directly,
// in addition to any route-level check.
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireConvexAdmin(ctx);
    const limit = Math.min(args.limit ?? 100, 500);
    return await ctx.db.query("contactMessages").order("desc").take(limit);
  },
});

// Real-time fan-out to Discord. Falls back to the feedback webhook so a single
// configured channel still receives contact messages.
export const notifyDiscord = internalAction({
  args: {
    name: v.string(),
    email: v.string(),
    topic: v.string(),
    message: v.string(),
  },
  handler: async (_ctx, args) => {
    const webhookUrl =
      process.env.DISCORD_CONTACT_WEBHOOK_URL ??
      process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn(
        "[contact] No DISCORD_CONTACT_WEBHOOK_URL / DISCORD_FEEDBACK_WEBHOOK_URL set — skipping alert",
      );
      return null;
    }

    const topicLabel = TOPIC_LABELS[args.topic] ?? args.topic;

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "ShapeUp Contact",
        embeds: [
          {
            title: `📨 ${topicLabel}`,
            description: args.message.slice(0, 1800),
            color: 0xd94e3a, // tomato — brand
            fields: [
              { name: "From", value: args.name, inline: true },
              { name: "Email", value: args.email, inline: true },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error(
        "[contact] Discord webhook failed:",
        res.status,
        await res.text().catch(() => ""),
      );
    }
    return null;
  },
});
