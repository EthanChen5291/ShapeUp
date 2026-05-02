import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listConversation = query({
  args: { friendId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const me = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!me) return [];

    const ids = [me._id as string, args.friendId as string].sort();
    const conversationId = ids.join("_");

    return ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .take(100);
  },
});

export const send = mutation({
  args: { receiverId: v.id("users"), text: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    if (!args.text.trim()) throw new Error("Empty message");

    const me = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!me) throw new Error("User not found");

    const ids = [me._id as string, args.receiverId as string].sort();
    const conversationId = ids.join("_");

    await ctx.db.insert("messages", {
      senderId: me._id,
      receiverId: args.receiverId,
      conversationId,
      text: args.text.trim(),
      createdAt: Date.now(),
      isRead: false,
    });
  },
});

export const markRead = mutation({
  args: { senderId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;

    const me = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!me) return;

    const unread = await ctx.db
      .query("messages")
      .withIndex("by_receiver_unread", (q) =>
        q.eq("receiverId", me._id).eq("isRead", false)
      )
      .filter((q) => q.eq(q.field("senderId"), args.senderId))
      .collect();

    await Promise.all(unread.map((m) => ctx.db.patch(m._id, { isRead: true })));
  },
});
