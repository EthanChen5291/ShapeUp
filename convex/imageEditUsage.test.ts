/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("imageEditUsage", () => {
  test("counts successful edits in server-selected monthly buckets", async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15));
    const t = convexTest(schema, modules);
    const user = t.withIdentity({
      subject: "counter-user",
      tokenIdentifier: "https://clerk.test|counter-user",
    });

    await user.mutation(api.imageEditUsage.record, {});
    await user.mutation(api.imageEditUsage.record, {});
    await expect(t.query(api.imageEditUsage.usage, {})).resolves.toEqual({
      bucket: "2026-01",
      edits: 2,
    });

    vi.setSystemTime(Date.UTC(2026, 1, 1));
    await expect(t.query(api.imageEditUsage.usage, {})).resolves.toEqual({
      bucket: "2026-02",
      edits: 0,
    });
  });
});
