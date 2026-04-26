import { mutation } from "./_generated/server";
import { v } from "convex/values";

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

const PROFANITY = [
  "fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy",
  "nigger", "nigga", "faggot", "fag", "asshole", "bastard",
];

function hasProfanity(local: string): boolean {
  const clean = local.toLowerCase().replace(/[^a-z]/g, "");
  return PROFANITY.some((w) => clean.includes(w));
}

export const joinWaitlist = mutation({
  args: {
    email: v.string(),
    notifyOnRelease: v.boolean(),
    // Honeypot — must be empty; bots tend to fill every field
    hp: v.string(),
  },
  handler: async (ctx, args) => {
    // Honeypot: silently accept but don't save
    if (args.hp !== "") return "joined";

    const email = args.email.trim().toLowerCase();

    if (!EMAIL_RE.test(email)) {
      throw new Error("Please enter a valid email address.");
    }

    const [local] = email.split("@");

    if (hasProfanity(local)) {
      throw new Error("Please enter a valid email address.");
    }

    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existing) {
      if (!existing.notifyOnRelease && args.notifyOnRelease) {
        await ctx.db.patch(existing._id, { notifyOnRelease: true });
      }
      return "already_joined";
    }

    await ctx.db.insert("waitlist", {
      email,
      notifyOnRelease: args.notifyOnRelease,
      createdAt: Date.now(),
    });

    return "joined";
  },
});
