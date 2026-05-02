import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const me = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!me) return [];

    const asRequester = await ctx.db
      .query("friends")
      .withIndex("by_requester", (q) => q.eq("requesterId", me._id))
      .filter((q) => q.eq(q.field("status"), "accepted"))
      .collect();

    const asAddressee = await ctx.db
      .query("friends")
      .withIndex("by_addressee", (q) => q.eq("addresseeId", me._id))
      .filter((q) => q.eq(q.field("status"), "accepted"))
      .collect();

    const friendIds = [
      ...asRequester.map((f) => f.addresseeId),
      ...asAddressee.map((f) => f.requesterId),
    ];

    const results = await Promise.all(
      friendIds.map(async (friendId) => {
        const friend = await ctx.db.get(friendId);
        if (!friend) return null;

        const projects = await ctx.db
          .query("projects")
          .withIndex("by_token", (q) => q.eq("tokenIdentifier", friend.tokenIdentifier))
          .collect();

        const unread = await ctx.db
          .query("messages")
          .withIndex("by_receiver_unread", (q) =>
            q.eq("receiverId", me._id).eq("isRead", false)
          )
          .filter((q) => q.eq(q.field("senderId"), friendId))
          .collect();

        return {
          userId: friendId,
          username: friend.username ?? friend.email?.split("@")[0] ?? "unknown",
          cutCount: projects.length,
          unreadCount: unread.length,
        };
      })
    );

    return results.filter(Boolean);
  },
});

export const listRequests = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const me = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!me) return [];

    const pending = await ctx.db
      .query("friends")
      .withIndex("by_addressee", (q) => q.eq("addresseeId", me._id))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    return Promise.all(
      pending.map(async (req) => {
        const requester = await ctx.db.get(req.requesterId);
        return {
          friendshipId: req._id,
          userId: req.requesterId,
          username: requester?.username ?? requester?.email?.split("@")[0] ?? "unknown",
        };
      })
    );
  },
});

export const searchUsers = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || args.query.length < 2) return [];

    const me = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!me) return [];

    const q = args.query.toLowerCase();
    const allUsers = await ctx.db.query("users").collect();

    return allUsers
      .filter((u) => {
        if (u._id === me._id) return false;
        const name = (u.username ?? u.email?.split("@")[0] ?? "").toLowerCase();
        return name.includes(q);
      })
      .slice(0, 8)
      .map((u) => ({
        userId: u._id,
        username: u.username ?? u.email?.split("@")[0] ?? "unknown",
      }));
  },
});

export const getFriendProjects = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const friend = await ctx.db.get(args.userId);
    if (!friend) return [];

    return ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", friend.tokenIdentifier))
      .order("desc")
      .take(20);
  },
});

export const sendRequest = mutation({
  args: { addresseeId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const me = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!me) throw new Error("User not found");
    if (me._id === args.addresseeId) throw new Error("Cannot add yourself");

    const existing = await ctx.db
      .query("friends")
      .withIndex("by_pair", (q) =>
        q.eq("requesterId", me._id).eq("addresseeId", args.addresseeId)
      )
      .unique();
    if (existing) return;

    const reverse = await ctx.db
      .query("friends")
      .withIndex("by_pair", (q) =>
        q.eq("requesterId", args.addresseeId).eq("addresseeId", me._id)
      )
      .unique();
    if (reverse) return;

    await ctx.db.insert("friends", {
      requesterId: me._id,
      addresseeId: args.addresseeId,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const acceptRequest = mutation({
  args: { friendshipId: v.id("friends") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const me = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!me) throw new Error("User not found");

    const friendship = await ctx.db.get(args.friendshipId);
    if (!friendship || friendship.addresseeId !== me._id) throw new Error("Not found");

    await ctx.db.patch(args.friendshipId, { status: "accepted" });
  },
});
