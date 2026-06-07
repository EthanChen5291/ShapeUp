import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

async function requireCurrentUser(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new Error("User not found");
  return user;
}

async function requireAcceptedFriendship(ctx: Ctx, me: Id<"users">, friendId: Id<"users">) {
  const outgoing = await ctx.db
    .query("friends")
    .withIndex("by_requester_and_addressee", (q) => q.eq("requesterId", me).eq("addresseeId", friendId))
    .unique();
  if (outgoing?.status === "accepted") return;

  const incoming = await ctx.db
    .query("friends")
    .withIndex("by_requester_and_addressee", (q) => q.eq("requesterId", friendId).eq("addresseeId", me))
    .unique();
  if (incoming?.status === "accepted") return;

  throw new Error("Not found");
}

export const listConversation = query({
  args: { friendId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireCurrentUser(ctx);
    await requireAcceptedFriendship(ctx, me._id, args.friendId);

    const [sent, received] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_sender_and_receiver", (q) => q.eq("senderId", me._id).eq("receiverId", args.friendId))
        .take(100),
      ctx.db
        .query("messages")
        .withIndex("by_sender_and_receiver", (q) => q.eq("senderId", args.friendId).eq("receiverId", me._id))
        .take(100),
    ]);

    return [...sent, ...received].sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const send = mutation({
  args: { receiverId: v.id("users"), text: v.string() },
  handler: async (ctx, args) => {
    const me = await requireCurrentUser(ctx);
    await requireAcceptedFriendship(ctx, me._id, args.receiverId);

    const text = args.text.trim();
    if (!text) throw new Error("Message cannot be empty");
    if (text.length > 2000) throw new Error("Message is too long");

    return ctx.db.insert("messages", {
      senderId: me._id,
      receiverId: args.receiverId,
      text,
      read: false,
      createdAt: Date.now(),
    });
  },
});

export const markRead = mutation({
  args: { senderId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireCurrentUser(ctx);
    await requireAcceptedFriendship(ctx, me._id, args.senderId);

    const unread = await ctx.db
      .query("messages")
      .withIndex("by_receiver_and_sender", (q) => q.eq("receiverId", me._id).eq("senderId", args.senderId))
      .take(100);

    for (const message of unread) {
      if (!message.read) await ctx.db.patch(message._id, { read: true });
    }
    return null;
  },
});
