import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Admin-only helpers, meant to be invoked from the CLI via `npx convex run`
// (which only exposes `internal*` functions), never from the client. Run them
// against the dev deployment by default; pass `--prod` to target production.
//
//   List every account's username/credits:
//     npx convex run admin:listAccounts
//   Grant tokens (credits) to one account:
//     npx convex run admin:grantTokens '{"username":"alice","amount":5}'

/**
 * List every account in the current deployment with its username, email,
 * Clerk id, and current token balance (the `credits` field). Sorted by
 * username so the output is stable and easy to scan.
 */
export const listAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .map((u) => ({
        username: u.username ?? null,
        email: u.email ?? null,
        clerkId: u.clerkId,
        credits: u.credits,
      }))
      .sort((a, b) => (a.username ?? "~").localeCompare(b.username ?? "~"));
  },
});

/**
 * Grant `amount` tokens (credits) to a single account, identified by exactly
 * one of username / email / clerkId. `amount` may be negative to deduct.
 * Returns the matched account and its new balance.
 */
export const grantTokens = internalMutation({
  args: {
    amount: v.number(),
    username: v.optional(v.string()),
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.amount)) {
      throw new Error("amount must be a finite number");
    }
    const selectors = [args.username, args.email, args.clerkId].filter(
      (v) => v !== undefined,
    );
    if (selectors.length !== 1) {
      throw new Error("Pass exactly one of: username, email, clerkId");
    }

    const user = args.username
      ? await ctx.db
          .query("users")
          .withIndex("by_username", (q) => q.eq("username", args.username))
          .unique()
      : args.email
        ? await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique()
        : await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId!))
            .unique();

    if (!user) {
      throw new Error(
        `No account found for ${JSON.stringify({
          username: args.username,
          email: args.email,
          clerkId: args.clerkId,
        })}`,
      );
    }

    const credits = user.credits + args.amount;
    await ctx.db.patch(user._id, { credits });
    return {
      username: user.username ?? null,
      email: user.email ?? null,
      clerkId: user.clerkId,
      granted: args.amount,
      credits,
    };
  },
});
