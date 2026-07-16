/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
  styles: ["burst-fade-textured-fringe"],
  published: true,
};

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateUploadUrl / getUploadedImageUrl", () => {
  test("require sign-in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.barberTryOn.generateUploadUrl, {})).rejects.toThrow(/unauthenticated/i);
  });
});

describe("sendToBarber", () => {
  test("requires sign-in", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.barberTryOn.sendToBarber, {
        slug: "marcus",
        cutLabel: "blowout taper",
        imageUrl: "https://example.com/x.png",
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  test("saves to the barber's inbox even when the barber never added a contact email", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const client = await barber(t, "client1");
    const result = await client.action(api.barberTryOn.sendToBarber, {
      slug: "marcus",
      cutLabel: "blowout taper",
      imageUrl: "https://example.com/x.png",
      clientRequest: "keep the top long",
      clientEmail: "client1@example.com",
    });
    expect(result).toEqual({ ok: true, emailed: false });

    const inbox = await marcus.query(api.barberTryOn.listMySends, {});
    expect(inbox).toHaveLength(1);
    expect(inbox![0]).toMatchObject({
      cutLabel: "blowout taper",
      imageUrl: "https://example.com/x.png",
      clientRequest: "keep the top long",
      clientEmail: "client1@example.com",
    });
  });

  test("fails only for an unpublished or unknown slug, saving nothing", async () => {
    const t = convexTest(schema, modules);
    const client = await barber(t, "client1");
    const result = await client.action(api.barberTryOn.sendToBarber, {
      slug: "nobody-here",
      cutLabel: "blowout taper",
      imageUrl: "https://example.com/x.png",
    });
    expect(result).toEqual({ ok: false, reason: "unknown_page" });
  });

  test("still saves (emailed:false) when RESEND_API_KEY is unset, even with a contact email on file", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, { ...CARD, contactEmail: "marcus@fades.com" });

    const client = await barber(t, "client1");
    const result = await client.action(api.barberTryOn.sendToBarber, {
      slug: "marcus",
      cutLabel: "blowout taper",
      imageUrl: "https://example.com/x.png",
    });
    expect(result).toEqual({ ok: true, emailed: false });

    const inbox = await marcus.query(api.barberTryOn.listMySends, {});
    expect(inbox).toHaveLength(1);
  });
});

describe("listMySends", () => {
  test("is owner-scoped: another barber's inbox never shows your sends", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);
    const rival = await barber(t, "rival");
    await rival.mutation(api.barberPages.upsert, { ...CARD, slug: "rival", displayName: "Rival" });

    const client = await barber(t, "client1");
    await client.action(api.barberTryOn.sendToBarber, {
      slug: "marcus",
      cutLabel: "blowout taper",
      imageUrl: "https://example.com/x.png",
    });

    expect(await marcus.query(api.barberTryOn.listMySends, {})).toHaveLength(1);
    expect(await rival.query(api.barberTryOn.listMySends, {})).toHaveLength(0);
    expect(await t.query(api.barberTryOn.listMySends, {})).toBeNull();
  });
});
