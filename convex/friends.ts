import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
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

async function getAcceptedFriendship(ctx: Ctx, a: Id<"users">, b: Id<"users">) {
  const outgoing = await ctx.db
    .query("friends")
    .withIndex("by_requester_and_addressee", (q) => q.eq("requesterId", a).eq("addresseeId", b))
    .unique();
  if (outgoing?.status === "accepted") return outgoing;

  const incoming = await ctx.db
    .query("friends")
    .withIndex("by_requester_and_addressee", (q) => q.eq("requesterId", b).eq("addresseeId", a))
    .unique();
  return incoming?.status === "accepted" ? incoming : null;
}

function toFriendData(user: Doc<"users">, cutCount: number, unreadCount: number) {
  return {
    userId: user._id,
    username: user.username ?? "friend",
    cutCount,
    unreadCount,
  };
}

export const searchUsers = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const me = await requireCurrentUser(ctx);
    const q = args.query.trim().toLowerCase();
    if (q.length < 2) return [];

    const users = await ctx.db.query("users").withIndex("by_username").take(50);
    return users
      .filter((user) => user._id !== me._id && user.username?.toLowerCase().includes(q))
      .slice(0, 10)
      .map((user) => ({
        userId: user._id,
        username: user.username!,
      }));
  },
});

export const sendRequest = mutation({
  args: { addresseeId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireCurrentUser(ctx);
    if (me._id === args.addresseeId) throw new Error("Cannot add yourself");

    const addressee = await ctx.db.get(args.addresseeId);
    if (!addressee) throw new Error("User not found");

    const outgoing = await ctx.db
      .query("friends")
      .withIndex("by_requester_and_addressee", (q) => q.eq("requesterId", me._id).eq("addresseeId", args.addresseeId))
      .unique();
    if (outgoing) return outgoing._id;

    const incoming = await ctx.db
      .query("friends")
      .withIndex("by_requester_and_addressee", (q) => q.eq("requesterId", args.addresseeId).eq("addresseeId", me._id))
      .unique();
    if (incoming) return incoming._id;

    return ctx.db.insert("friends", {
      requesterId: me._id,
      addresseeId: args.addresseeId,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const listRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireCurrentUser(ctx);
    const requests = await ctx.db
      .query("friends")
      .withIndex("by_addressee_and_status", (q) => q.eq("addresseeId", me._id).eq("status", "pending"))
      .take(50);

    const rows = [];
    for (const request of requests) {
      const requester = await ctx.db.get(request.requesterId);
      if (requester?.username) {
        rows.push({
          friendshipId: request._id,
          userId: requester._id,
          username: requester.username,
        });
      }
    }
    return rows;
  },
});

export const acceptRequest = mutation({
  args: { friendshipId: v.id("friends") },
  handler: async (ctx, args) => {
    const me = await requireCurrentUser(ctx);
    const friendship = await ctx.db.get(args.friendshipId);
    if (!friendship || friendship.addresseeId !== me._id) throw new Error("Not found");
    if (friendship.status === "accepted") return null;
    await ctx.db.patch(args.friendshipId, {
      status: "accepted",
      acceptedAt: Date.now(),
    });
    return null;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireCurrentUser(ctx);
    const [outgoing, incoming] = await Promise.all([
      ctx.db
        .query("friends")
        .withIndex("by_requester_and_status", (q) => q.eq("requesterId", me._id).eq("status", "accepted"))
        .take(50),
      ctx.db
        .query("friends")
        .withIndex("by_addressee_and_status", (q) => q.eq("addresseeId", me._id).eq("status", "accepted"))
        .take(50),
    ]);

    const rows = [];
    for (const friendship of [...outgoing, ...incoming]) {
      const friendId = friendship.requesterId === me._id ? friendship.addresseeId : friendship.requesterId;
      const friend = await ctx.db.get(friendId);
      if (!friend?.username) continue;
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", friend.tokenIdentifier))
        .take(50);
      const unread = await ctx.db
        .query("messages")
        .withIndex("by_receiver_and_sender", (q) => q.eq("receiverId", me._id).eq("senderId", friend._id))
        .take(50);
      rows.push(toFriendData(friend, projects.length, unread.filter((message) => !message.read).length));
    }
    return rows;
  },
});

export const getFriendProjects = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireCurrentUser(ctx);
    const friendship = await getAcceptedFriendship(ctx, me._id, args.userId);
    if (!friendship) throw new Error("Not found");

    const friend = await ctx.db.get(args.userId);
    if (!friend) throw new Error("Not found");

    return ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", friend.tokenIdentifier))
      .order("desc")
      .take(50);
  },
});
