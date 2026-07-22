/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function identity(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
    nickname: clerkId,
  });
}

/** A signed-in barber with a ShapeUp account. */
async function barber(t: ReturnType<typeof convexTest>, clerkId: string) {
  const who = identity(t, clerkId);
  await who.mutation(api.users.getOrCreate, {});
  return who;
}

const CARD = {
  slug: "marcus",
  displayName: "Marcus",
  shopName: "Fade Theory",
  links: [{ kind: "venmo", value: "@marcus-fades" }],
  styles: ["burst-fade-textured-fringe", "blowout-taper"],
  published: true,
};

describe("upsert", () => {
  test("requires sign-in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.barberPages.upsert, CARD)).rejects.toThrow(/sign in/i);
  });

  test("creates a card and normalizes the links the barber typed", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");

    await marcus.mutation(api.barberPages.upsert, CARD);

    const page = await t.query(api.barberPages.getBySlug, { slug: "marcus" });
    expect(page?.displayName).toBe("Marcus");
    expect(page?.shopName).toBe("Fade Theory");
    // "@marcus-fades" went in; a real URL comes out.
    expect(page?.links).toEqual([
      { kind: "venmo", label: "Venmo", url: "https://venmo.com/u/marcus-fades" },
    ]);
    expect(page?.styles).toEqual(["burst-fade-textured-fringe", "blowout-taper"]);
  });

  test("gives the barber a referral code — the card is useless without one", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const page = await t.query(api.barberPages.getBySlug, { slug: "marcus" });
    expect(page?.referralCode).toMatch(/^[A-Z2-9]{6}$/);
  });

  test("edits in place instead of minting a second card", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");

    await marcus.mutation(api.barberPages.upsert, CARD);
    await marcus.mutation(api.barberPages.upsert, { ...CARD, displayName: "Marcus D." });

    const pages = await t.run((ctx) => ctx.db.query("barberPages").collect());
    expect(pages).toHaveLength(1);
    expect(pages[0].displayName).toBe("Marcus D.");
  });

  test("lets a barber keep their own slug when re-saving", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);
    // Same slug, second save — must not read as "taken" by themselves.
    await expect(
      marcus.mutation(api.barberPages.upsert, { ...CARD, bio: "10 years on Telegraph." }),
    ).resolves.toEqual({ slug: "marcus" });
  });

  test("refuses a slug another barber already holds", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    const kev = await barber(t, "kev");

    await marcus.mutation(api.barberPages.upsert, CARD);
    await expect(
      kev.mutation(api.barberPages.upsert, { ...CARD, displayName: "Kev" }),
    ).rejects.toThrow(/taken/i);
  });

  test("refuses reserved slugs that would let a barber impersonate us", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await expect(
      marcus.mutation(api.barberPages.upsert, { ...CARD, slug: "shapeup" }),
    ).rejects.toThrow(/reserved/i);
  });

  // These become hrefs on a page we host and hand to the public.
  test("refuses a javascript: link even though the form would have blocked it", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await expect(
      marcus.mutation(api.barberPages.upsert, {
        ...CARD,
        links: [{ kind: "website", value: "javascript:alert(document.cookie)" }],
      }),
    ).rejects.toThrow(/valid link/i);
  });

  test("caps styles and drops duplicates", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, {
      ...CARD,
      styles: [...Array(20).keys()].map((i) => `cut-${i}`).concat("cut-1"),
    });

    const page = await t.query(api.barberPages.getBySlug, { slug: "marcus" });
    expect(page?.styles).toHaveLength(12);
    expect(new Set(page?.styles).size).toBe(12);
  });

  test("binds the private contact email to the ShapeUp account and never leaks it publicly", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.contactEmail).toBe("marcus@example.com");

    const publicPage = await t.query(api.barberPages.getBySlug, { slug: "marcus" });
    expect(publicPage).not.toHaveProperty("contactEmail");
  });

  test("requires an email on the barber's ShapeUp account", async () => {
    const t = convexTest(schema, modules);
    const marcus = t.withIdentity({
      subject: "marcus",
      tokenIdentifier: "https://clerk.test|marcus",
      nickname: "marcus",
    });
    await marcus.mutation(api.users.getOrCreate, {});
    await expect(
      marcus.mutation(api.barberPages.upsert, CARD),
    ).rejects.toThrow(/account needs a valid email/i);
  });
});

describe("getBySlug", () => {
  test("hides an unpublished card rather than 403ing it", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, { ...CARD, published: false });

    expect(await t.query(api.barberPages.getBySlug, { slug: "marcus" })).toBeNull();
  });

  test("returns null for an unknown or malformed slug", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.barberPages.getBySlug, { slug: "nobody" })).toBeNull();
    expect(await t.query(api.barberPages.getBySlug, { slug: "../../admin" })).toBeNull();
  });

  test("never leaks the owner's user id", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const page = await t.query(api.barberPages.getBySlug, { slug: "marcus" });
    expect(page).not.toHaveProperty("ownerUserId");
  });
});

describe("checkSlug", () => {
  test("reports a taken slug, but not to the barber who owns it", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    const kev = await barber(t, "kev");
    await marcus.mutation(api.barberPages.upsert, CARD);

    expect(await kev.query(api.barberPages.checkSlug, { slug: "marcus" })).toEqual({
      available: false,
      error: "That name is taken.",
    });
    expect(await marcus.query(api.barberPages.checkSlug, { slug: "marcus" })).toEqual({
      available: true,
    });
  });

  test("explains why a malformed slug is unusable", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.barberPages.checkSlug, { slug: "-nope-" });
    expect(result.available).toBe(false);
    expect(result.error).toMatch(/dash/i);
  });
});

describe("recordEvent", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test("counts views, try-ons and link clicks into today's bucket", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    // Anonymous — this is a stranger with a phone camera, which is the point.
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "view" });
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "view" });
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "tryOn" });
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "linkClick" });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.totals).toEqual({ views: 2, tryOns: 1, linkClicks: 1 });

    const rows = await t.run((ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket).toBe(new Date().toISOString().slice(0, 10));
  });

  test("ignores events for unknown or unpublished cards", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, { ...CARD, published: false });

    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "view" });
    await t.mutation(api.barberPages.recordEvent, { slug: "ghost", kind: "view" });

    const rows = await t.run((ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows).toHaveLength(0);
  });

  // The counters are the barber's evidence the QR is working — inflating them
  // is the obvious abuse, and they're writable by anyone.
  test("rate-limits a flood of fake scans", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const flood = async () => {
      for (let i = 0; i < 200; i++) {
        await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "view" });
      }
    };
    await expect(flood()).rejects.toThrow(/too many/i);

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.totals.views).toBeLessThanOrEqual(120);
  });
});

describe("getMine", () => {
  test("is null for a signed-out visitor and for a barber with no card", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.barberPages.getMine, {})).toBeNull();

    const kev = await barber(t, "kev");
    expect(await kev.query(api.barberPages.getMine, {})).toBeNull();
  });

  test("never returns another barber's card", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    const kev = await barber(t, "kev");
    await marcus.mutation(api.barberPages.upsert, CARD);

    expect(await kev.query(api.barberPages.getMine, {})).toBeNull();
    expect((await marcus.query(api.barberPages.getMine, {}))?.slug).toBe("marcus");
  });
});

describe("setPublished", () => {
  test("takes a card offline without freeing its slug", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    const kev = await barber(t, "kev");
    await marcus.mutation(api.barberPages.upsert, CARD);

    await marcus.mutation(api.barberPages.setPublished, { published: false });
    expect(await t.query(api.barberPages.getBySlug, { slug: "marcus" })).toBeNull();

    // Offline, but still theirs.
    await expect(
      kev.mutation(api.barberPages.upsert, { ...CARD, displayName: "Kev" }),
    ).rejects.toThrow(/taken/i);
  });
});

// ── new event kinds ──────────────────────────────────────────

describe("recordEvent — new event kinds", () => {
  test("bookingClick increments bookingClicks counter", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "bookingClick" });
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "bookingClick" });

    const rows = await t.run(async (ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].bookingClicks).toBe(2);
    // Other counters untouched
    expect(rows[0].views).toBe(0);
    expect(rows[0].tryOns).toBe(0);
  });

  test("selfieStart increments selfieStarts counter", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "selfieStart" });

    const rows = await t.run(async (ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows[0].selfieStarts).toBe(1);
    expect(rows[0].bookingClicks).toBeUndefined();
  });

  test("preview increments previews counter", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "preview" });
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "preview" });
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "preview" });

    const rows = await t.run(async (ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows[0].previews).toBe(3);
  });

  test("tryOn with valid cutSlug populates byStyle", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "tryOn", cutSlug: "burst-fade" });
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "tryOn", cutSlug: "burst-fade" });
    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "tryOn", cutSlug: "blowout" });

    const rows = await t.run(async (ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].tryOns).toBe(3);
    expect(rows[0].byStyle).toEqual({ "burst-fade": 2, "blowout": 1 });
  });

  test("invalid cutSlug is silently ignored but tryOn is still counted", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    // Contains uppercase and spaces — fails /^[a-z0-9-]{1,60}$/
    await t.mutation(api.barberPages.recordEvent, {
      slug: "marcus",
      kind: "tryOn",
      cutSlug: "INVALID SLUG!!",
    });

    const rows = await t.run(async (ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows[0].tryOns).toBe(1);
    expect(rows[0].byStyle).toBeUndefined();
  });

  test("tryOn without cutSlug counts tryOn but leaves byStyle undefined", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    await t.mutation(api.barberPages.recordEvent, { slug: "marcus", kind: "tryOn" });

    const rows = await t.run(async (ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows[0].tryOns).toBe(1);
    expect(rows[0].byStyle).toBeUndefined();
  });

  test("byStyle 60-key cap: new keys beyond cap are dropped, tryOn still counted", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    // Fill exactly 60 unique slugs
    for (let i = 0; i < 60; i++) {
      await t.mutation(api.barberPages.recordEvent, {
        slug: "marcus",
        kind: "tryOn",
        cutSlug: `style-${i}`,
      });
    }

    // style-60 is a new key beyond the cap — should NOT be stored
    await t.mutation(api.barberPages.recordEvent, {
      slug: "marcus",
      kind: "tryOn",
      cutSlug: "style-60",
    });

    const rows = await t.run(async (ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows[0].tryOns).toBe(61); // all 61 tryOns counted
    expect(Object.keys(rows[0].byStyle ?? {}).length).toBe(60); // cap enforced
    expect(rows[0].byStyle?.["style-60"]).toBeUndefined();
  });

  test("byStyle 60-key cap: incrementing an existing key always works even at cap", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    // Fill 60 unique slugs
    for (let i = 0; i < 60; i++) {
      await t.mutation(api.barberPages.recordEvent, {
        slug: "marcus",
        kind: "tryOn",
        cutSlug: `style-${i}`,
      });
    }

    // style-0 already exists — should still increment at cap
    await t.mutation(api.barberPages.recordEvent, {
      slug: "marcus",
      kind: "tryOn",
      cutSlug: "style-0",
    });

    const rows = await t.run(async (ctx) => ctx.db.query("barberPageStats").collect());
    expect(rows[0].byStyle?.["style-0"]).toBe(2);
    expect(Object.keys(rows[0].byStyle ?? {}).length).toBe(60);
  });
});

// ── upsert new fields ─────────────────────────────────────────

describe("upsert — location, hours, services", () => {
  test("round-trips the perms and texture-services setting", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, { ...CARD, offersPerms: true });

    expect((await marcus.query(api.barberPages.getMine, {}))?.offersPerms).toBe(true);
    expect((await t.query(api.barberPages.getBySlug, { slug: "marcus" }))?.offersPerms).toBe(true);

    await marcus.mutation(api.barberPages.upsert, { ...CARD, offersPerms: false });
    expect((await marcus.query(api.barberPages.getMine, {}))?.offersPerms).toBe(false);
    expect((await t.query(api.barberPages.getBySlug, { slug: "marcus" }))?.offersPerms).toBe(false);
  });

  test("stores and trims location and hours", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, {
      ...CARD,
      location: "  Telegraph Ave, Oakland  ",
      hours: "  Tue–Sat · 9–6  ",
    });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.location).toBe("Telegraph Ave, Oakland");
    expect(mine?.hours).toBe("Tue–Sat · 9–6");
  });

  test("caps location at 80 chars", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, {
      ...CARD,
      location: "A".repeat(100),
    });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.location).toHaveLength(80);
  });

  test("caps hours at 120 chars", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, {
      ...CARD,
      hours: "B".repeat(150),
    });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.hours).toHaveLength(120);
  });

  test("stores and normalizes services (trims name/price, drops empty names, caps entries)", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");

    // 14 entries, one empty name (drops to 13 → capped to 12)
    const services = [
      { name: "  Fade  ", price: "  $25  " },   // trimmed
      { name: "", price: "$10" },                // dropped — empty name
      { name: "Buzz", price: "" },               // empty price → undefined
      ...Array.from({ length: 12 }, (_, i) => ({ name: `Style ${i}` })),
    ];

    await marcus.mutation(api.barberPages.upsert, { ...CARD, services });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.services).toBeDefined();
    expect(mine!.services!.length).toBe(12); // 13 valid entries capped to 12
    expect(mine!.services![0].name).toBe("Fade");
    expect(mine!.services![0].price).toBe("$25");
    // empty-name entry is absent
    expect(mine!.services!.find((s) => s.name === "")).toBeUndefined();
    // empty-price entry: Buzz should have no price
    const buzz = mine!.services!.find((s) => s.name === "Buzz");
    expect(buzz).toBeDefined();
    expect(buzz?.price).toBeUndefined();
  });

  test("caps service name at 60 chars and price at 20 chars", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, {
      ...CARD,
      services: [{ name: "X".repeat(80), price: "Y".repeat(30) }],
    });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine!.services![0].name).toHaveLength(60);
    expect(mine!.services![0].price).toHaveLength(20);
  });

  test("services not provided clears existing services on re-save", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, {
      ...CARD,
      services: [{ name: "Fade", price: "$25" }],
    });
    await marcus.mutation(api.barberPages.upsert, { ...CARD }); // no services arg

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.services).toBeUndefined();
  });
});

// ── upsert avatar ────────────────────────────────────────────

describe("upsert — avatar", () => {
  test("avatar set via upsert appears as avatarStorageId in getMine and avatarUrl in both getMine and getBySlug", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");

    // Store a blob using action-level storage available in t.run
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["fake-avatar"], { type: "image/jpeg" }));
    });

    await marcus.mutation(api.barberPages.upsert, { ...CARD, avatarStorageId: storageId });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.avatarStorageId).toBe(storageId);
    expect(mine?.avatarUrl).toBeDefined();
    expect(typeof mine?.avatarUrl).toBe("string");

    const publicPage = await t.query(api.barberPages.getBySlug, { slug: "marcus" });
    expect(publicPage?.avatarUrl).toBeDefined();
    // avatarStorageId is owner-only — must never appear on the public card
    expect(publicPage).not.toHaveProperty("avatarStorageId");
  });

  test("clearAvatar unsets avatarStorageId and avatarUrl becomes undefined", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["fake-avatar"], { type: "image/jpeg" }));
    });

    // First save with avatar
    await marcus.mutation(api.barberPages.upsert, { ...CARD, avatarStorageId: storageId });
    let mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.avatarStorageId).toBe(storageId);

    // Clear it
    await marcus.mutation(api.barberPages.upsert, { ...CARD, clearAvatar: true });
    mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.avatarStorageId).toBeUndefined();
    expect(mine?.avatarUrl).toBeUndefined();
  });

  test("re-saving without avatarStorageId or clearAvatar leaves avatar unchanged", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["fake-avatar"], { type: "image/jpeg" }));
    });

    await marcus.mutation(api.barberPages.upsert, { ...CARD, avatarStorageId: storageId });
    // Re-save with no avatar args — should not clear the existing one
    await marcus.mutation(api.barberPages.upsert, { ...CARD, displayName: "Marcus D." });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.avatarStorageId).toBe(storageId);
    expect(mine?.displayName).toBe("Marcus D.");
  });
});

// ── getMine insights ─────────────────────────────────────────

describe("getMine — insights", () => {
  test("insights reflects correct week splits from stat buckets", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const page = await t.run(async (ctx) =>
      ctx.db.query("barberPages").withIndex("by_slug", (q) => q.eq("slug", "marcus")).unique(),
    );

    const now = Date.now();
    const dayStr = (offset: number) =>
      new Date(now + offset * 86_400_000).toISOString().slice(0, 10);

    await t.run(async (ctx) => {
      // last7: today and -3 days
      await ctx.db.insert("barberPageStats", {
        pageId: page!._id,
        bucket: dayStr(0),
        views: 5,
        tryOns: 2,
        linkClicks: 1,
        bookingClicks: 3,
        byStyle: { "fade": 10 },
      });
      await ctx.db.insert("barberPageStats", {
        pageId: page!._id,
        bucket: dayStr(-3),
        views: 1,
        tryOns: 0,
        linkClicks: 0,
      });
      // prev7
      await ctx.db.insert("barberPageStats", {
        pageId: page!._id,
        bucket: dayStr(-7),
        views: 10,
        tryOns: 5,
        linkClicks: 2,
        byStyle: { "buzz": 4, "fade": 3 },
      });
      // outside both windows — still contributes to topStyles
      await ctx.db.insert("barberPageStats", {
        pageId: page!._id,
        bucket: dayStr(-14),
        views: 99,
        tryOns: 0,
        linkClicks: 0,
        byStyle: { "fade": 2 },
      });
    });

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.insights.last7.views).toBe(6);
    expect(mine?.insights.last7.tryOns).toBe(2);
    expect(mine?.insights.last7.linkClicks).toBe(1);
    expect(mine?.insights.last7.bookingClicks).toBe(3);
    expect(mine?.insights.last7.selfieStarts).toBe(0);

    expect(mine?.insights.prev7.views).toBe(10);
    expect(mine?.insights.prev7.tryOns).toBe(5);

    // topStyles sums across ALL buckets (10 + 3 + 2 = 15 for fade, 4 for buzz)
    const topStyles = mine?.insights.topStyles ?? [];
    const fade = topStyles.find((s) => s.slug === "fade");
    const buzz = topStyles.find((s) => s.slug === "buzz");
    expect(fade?.count).toBe(15);
    expect(buzz?.count).toBe(4);
    expect(topStyles[0].slug).toBe("fade"); // highest first
  });

  test("insights returns all zeros when no stats exist", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const mine = await marcus.query(api.barberPages.getMine, {});
    expect(mine?.insights.last7).toEqual({
      views: 0, tryOns: 0, linkClicks: 0,
      bookingClicks: 0, selfieStarts: 0, previews: 0,
    });
    expect(mine?.insights.topStyles).toEqual([]);
  });
});
