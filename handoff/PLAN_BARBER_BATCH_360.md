# Implementation Plan — Barber Card "Best Cuts" Batch 360 Flow

> **Handoff packet.** Written 2026-07-17 on branch `maincopy` after a design discussion.
> All product decisions below are settled — do not re-litigate them. Read
> `convex/_generated/ai/guidelines.md` before touching Convex code (CLAUDE.md requirement).
> Use the `ui-ux-pro-max` skill for the UI work. Every phase ships with tests;
> done = `npm run typecheck && npm run lint && npm test` green.

---

## Objective

On the public barber card (`/b/<slug>`), replace the current single-cut
"Show me my best hairstyles" path with a **batch flow**: one selfie → Gemini
analyzes the face/hair and proposes 8 feasibility-checked hairstyles → 8 Gemini
edits → 8 Modal 3D splat renders (4 concurrent, pipelined) → a grid of 8
**looping 360 turntable mp4s** → tap one to enlarge into the live splat viewer
with a "Final Touches" prompt box → send choice + hair analysis to the barber
with the appointment. Batches survive refresh/tab-close. Free for users
(outreach), hard-capped server-side.

## Decisions already made (do not reopen)

1. **All 8 cuts get 3D renders + 360 mp4s**, not 2D-only with render-on-tap.
   Render times measured: ~13–15s warm, 20–30s cold. 4 Modal containers.
   Target: first tile spinning ~40s, full grid ~90s.
2. **The grid shows the turntable mp4s** (`videoUrl` already returned by
   `/api/facelift`) — scaled down, `muted playsInline loop`. **Never mount more
   than one `HairScene`/WebGL splat viewer at a time** (mobile WebGL eviction —
   see the hard-won sequencing comments in `src/components/BarberTryOn.tsx`).
3. **Pipelined orchestration, server-side**: each Gemini edit dispatches its
   facelift render the moment it lands. Never "all edits, then all renders".
   Never let the client loop 8 API calls itself.
4. **Login popup on both entry CTAs** ("Just doing a trim." and "Show me my best
   hairstyles") per the founder's spec. (Engineering note, already raised: the
   trim path touches no backend, so this costs walk-up conversion. It was not
   overturned — implement as specced, keep the gate one component so it's easy
   to remove later.)
5. **Selfie gating**: keep the existing client-side `judgeSelfie` as a soft
   warn-with-override. The **analysis call is the hard gate** — if Gemini can't
   see hairline/temples/texture it rejects with a specific fixable reason
   BEFORE the 8 edits spend money. No stricter upfront checklist.
6. **Perms gate**: explicit boolean on the barber page (builder toggle), NOT
   string-matching the free-text services list.
   - `offersPerms: false` → only styles achievable at the client's current
     length or shorter, same texture (no added curl, no straightening).
   - `offersPerms: true` → texture-transformation styles allowed too.
7. **Stay on Modal for GPU** for this feature. EC2/AWS-credit migration is a
   separate later task (the facelift route's multi-upstream design in
   `src/lib/facelift.ts` makes an EC2 worker just another upstream URL when
   that day comes). Do not start that migration here.
8. **Rate limiting**: a batch consumes **one batch entitlement** (not 8
   generations). 1 free batch/user/month + per-IP backstop + fingerprint check,
   modeled on `convex/freeGen.ts`. Enforced even while `FREE_MODE = true`
   (`src/lib/freeMode.ts`) — FREE_MODE waives *payment*, not abuse caps.
   Entitlement is consumed **after** the analysis gate passes, before edits.

## Cost model (for context, not action)

~$0.32/user Gemini (8 edits ≈ $0.04 each + analysis), ~$0.04–0.05/user Modal
GPU (8 × ~15–20s). $30/mo Modal credits ≈ 600–800 batches. S3/bandwidth on AWS
credits. Set `GPU_BUDGET_SECONDS` in Convex prod env (guard already exists in
`convex/gpuUsage.ts`, currently unset).

---

## Current-state map (verified 2026-07-17)

| What | Where |
|---|---|
| Card page + entry CTAs (`EntryMode`: choice/trim/orbit/tryon) | `src/components/BarberCard.tsx` |
| Existing single-cut flow (phase machine, warmup, station queue, send) | `src/components/BarberTryOn.tsx` |
| 2D edit route (auth + durable rate limits + prompt hardening + EDIT_REPORT) | `src/app/api/gemini-hair-edit/route.ts` |
| 3D render route (Modal/OSCAR upstreams, PLY→splat, S3, `videoUrl` turntable, GPU metering) | `src/app/api/facelift/route.ts` |
| Selfie/send Convex plumbing (`barberSends`, rate-limited `sendToBarber`) | `convex/barberTryOn.ts` |
| Free-gen entitlement pattern to copy (Sybil gates, month buckets) | `convex/freeGen.ts` + `convex/lib/freeGen.ts` |
| GPU budget guard | `convex/gpuUsage.ts` |
| Render queue, `RENDER_STATION_CAPACITY = 2` | `convex/renderStations.ts` |
| Schema (`barberPages` ~L256, `barberSends` ~L313) | `convex/schema.ts` |
| Hairstyle catalog | `src/data/hairstyles.ts` |
| i18n | `src/lib/i18n` (add ES strings to `es.ts`) |
| Client selfie heuristics | `src/lib/selfieCheck.ts` |

Auth: every generation path requires Clerk sign-in (`requireSignedIn` in
`src/lib/serverAuth.ts`); referral attribution on sign-in already handled in
`BarberTryOn` via `users.getOrCreate` — keep that pattern in the new flow.

---

## Phase 1 — Schema + entitlement (Convex)

**`convex/schema.ts`:**

- `barberPages`: add `offersPerms: v.optional(v.boolean())`.
- New `barberBatches`:
  ```
  userId: v.id("users"), pageId: v.id("barberPages"),
  selfieStorageId: v.id("_storage"),
  status: "analyzing" | "generating" | "ready" | "rejected" | "failed",
  rejectionReason: v.optional(v.string()),   // user-facing, specific
  hairProfile: v.optional(v.object({...})),  // see Phase 2 schema
  createdAt: v.number(),
  ```
  index `by_user` (+ createdAt for latest-first resume), `by_page`.
- New `barberBatchItems` (separate table — 8 rows patched concurrently by the
  orchestrator; one array field on the batch doc would OCC-conflict):
  ```
  batchId: v.id("barberBatches"), idx: v.number(),
  title: v.string(),              // ≤4 words, shown on the enlarged view
  prompt: v.string(),             // full edit prompt, also sent to barber
  why: v.optional(v.string()),    // one-line rationale shown to user
  status: "pending" | "editing" | "rendering" | "done" | "failed",
  imageStorageId: v.optional(v.id("_storage")),  // 2D edit result
  splatS3Key: v.optional(v.string()),
  videoS3Key: v.optional(v.string()),            // turntable mp4
  error: v.optional(v.string()),
  ```
  index `by_batch`.

**New `convex/barberBatch.ts`:**

- `consumeBatch` mutation — copy the transactional shape of
  `freeGen.consumeGeneration`: cap **1/user/calendar-month** (month-key bucket
  on the user or a grants table), disposable-email + verified-email gates
  reused from `convex/lib/disposableEmail.ts`, fingerprint capped at the same
  monthly rate, per-IP backstop (~5/day) via a `signalHash` grants pattern.
  Enforce regardless of `FREE_MODE`.
- `create` / `setAnalysis` / `patchItem` / `finish` internal mutations for the
  orchestrator (server routes call these with the user's identity — follow the
  existing pattern of routes using `ConvexHttpClient` with the caller's auth,
  as `/api/facelift` does).
- `latestForPage` query (user + slug → most recent non-failed batch + its
  items, items resolved to fetchable URLs via `ctx.storage.getUrl` /
  S3 signed URLs through the existing `/api/img`-style indirection). This
  powers refresh-resume and the reactive grid (client `useQuery` = the
  realtime channel; no polling, no streaming response needed).
- Extend `barberSends` + `sendToBarber` (in `convex/barberTryOn.ts`): add
  optional `styleTitle`, `stylePrompt`, `hairProfile` (compact string) args and
  columns; thread them into `convex/lib/barberEmail.ts` so the barber's email
  shows the analysis + exact prompt. Existing sends without them must render
  unchanged (all optional).

**Builder toggle:** add "We offer perms / texture services" checkbox in the
barber builder (`src/app/barber/` page editing `barberPages`), persisted to
`offersPerms`, passed through the public page query into `BarberCardData`.

**Tests:** `convex/barberBatch.test.ts` mirroring `freeGen.test.ts` — cap
enforcement, month rollover, IP/fingerprint gates, double-spend under
concurrency; `barberPages` round-trips `offersPerms`.

## Phase 2 — Analysis endpoint

**New `src/app/api/barber-batch/analyze/route.ts`** (or first step inside the
orchestrator route — implementer's choice; separate route keeps retries clean).

- Auth (`requireSignedIn`) + durable rate limits (copy the
  `enforceDurableRateLimits` block from `gemini-hair-edit/route.ts`).
- Input: `{ selfieUrl (Convex storage URL), barberSlug }`. Server resolves the
  page's `offersPerms`.
- One Gemini call (text+vision; text-only output — plain `gemini-3.1-flash`
  class model, NOT the image-preview model), selfie attached, strict-JSON
  response, parsed defensively (model output is untrusted — same posture as
  `parseEditReport` in `src/lib/editReport.ts`).

**System prompt spec** (reuse the barber-realism vocabulary already proven in
`buildEditPrompt` — scale anchor, curl-class shrinkage, zone language):

1. **GATE first**: can you clearly see hairline, both temples, hair texture,
   and the full face, in usable lighting, no hat/heavy filter? If not →
   `{ ok:false, reason:"<specific, fixable, ≤15 words>" }` and STOP.
2. **ANALYZE**: `hairProfile` = curl class (1A–4C), per-zone current length
   (top/sides/back, inches, strand length not silhouette), density
   (low/med/high), hairline state (intact/mature/receding + where), growth
   pattern quirks (cowlicks, whorls), face shape, skin-adjacent notes a barber
   needs (e.g. widow's peak). This object goes to the barber verbatim —
   write for a barber, not a data scientist.
3. **PROPOSE 8** `{ title ≤4 words, prompt, why ≤12 words }`:
   - Feasibility is a HARD constraint: no style requiring more length than the
     client currently has in the relevant zone; `offersPerms=false` → same
     texture only (no perm, no relaxer, no "add curl/wave"); `offersPerms=true`
     → texture transformations allowed and encouraged where they suit.
   - "Looks good" = face-shape balancing, proportion, working WITH the growth
     pattern and hairline (never a style that fights a cowlick or exposes
     recession the client is covering).
   - Diversify silhouettes — never 8 variants of one fade. Order by confidence.
   - Each `prompt` must be a complete edit instruction in the style the edit
     route expects (zones, lengths in inches, texture handling) — it is passed
     verbatim as the `gemini-hair-edit` client request AND shown to the barber.

**Tests:** unit-test the prompt builder (perms flag flips the constraint
block), the JSON parser (rejects malformed/oversized output, clamps to
exactly 8 items, truncates over-long strings).

## Phase 3 — Batch orchestrator

**New `src/app/api/barber-batch/route.ts`**, `export const maxDuration = 300`.

Flow: auth → durable rate limits → analysis (Phase 2, if not already done) →
on gate pass: `consumeBatch` → `barberBatch.create` + 8 `barberBatchItems`
rows → **pipelined fan-out, edit-concurrency 4**:

- Per item: reuse the edit logic. **Extract the Gemini-edit core** (fetch/
  resize/sharp/prompt/call/EDIT_REPORT parse, i.e. the body of
  `gemini-hair-edit/route.ts`) into `src/lib/geminiHairEdit.ts` shared by the
  existing route and the orchestrator. Do the same for the facelift core
  (upstream call + PLY→splat + S3 upload from `facelift/route.ts` →
  `src/lib/faceliftCore.ts`) so the orchestrator doesn't self-HTTP through 8
  rate-limited route invocations. Keep both existing routes as thin wrappers —
  their behavior must not change (their tests prove it).
- The moment an edit lands: store the 2D image to Convex storage, patch item
  → `rendering`, dispatch its facelift immediately (up to 4 in flight).
  Record GPU seconds via `api.gpuUsage.record` exactly as the facelift route
  does, and respect `gpuUsage.isOverBudget` (fail remaining items gracefully
  with a friendly error, not silently).
- Patch each item `done` (with `splatS3Key` + `videoS3Key`) or `failed`
  (short user-safe error) as it settles. Batch → `ready` when all items settle
  (≥1 done) or `failed` (0 done).
- **Warmup**: on flow entry (client-side, at "Let's go"), fire the existing
  `/api/facelift/warmup` poke; the selfie + analysis (~20–30s) absorbs the
  cold start.

**Resilience:** items stuck non-terminal >5 min are treated as failed by the
client/query layer (compute staleness in `latestForPage`, don't require a
cron). Add a single-item retry endpoint (`POST /api/barber-batch/item`) that
re-runs edit+render for one failed item WITHOUT a new batch entitlement,
durable-rate-limited (~10/hr/user) so retry can't become a free-generation
loophole.

**Render stations:** raise `RENDER_STATION_CAPACITY` to 4 in
`convex/renderStations.ts` (matching Modal) and have the orchestrator claim
**one** station for the whole batch (the queue stays honest for studio users;
a batch is one "customer"). Update `renderStations.test.ts`.

**Modal check (manual, before building):** confirm the Modal app allows ≥4
concurrent containers (`max_containers`/concurrency in the worker deploy —
worker code under `server/`). If it's lower, the fan-out silently serializes.
Report what you find; do not redeploy Modal without asking.

**Tests:** orchestrator logic with mocked edit/facelift cores — pipelining
(render N starts before edit N+4 finishes), partial failure leaves other items
done, entitlement consumed exactly once, budget-exhausted path.

## Phase 4 — UI

All new strings through `useT()` + `src/lib/i18n/es.ts`. Respect
`prefers-reduced-motion` everywhere (codebase-wide convention — grep for
`prefers-reduced-motion` in `BarberCard.tsx` for the exact pattern).
Styling: dark studio palette / existing `bc-*` + `bt-*` token families; use
`ui-ux-pro-max` for the build pass.

1. **Rundown screen** (new `EntryMode: 'rundown'` in `BarberCard.tsx`,
   replacing the current `orbit` timeout path for "Show me my best
   hairstyles"): 4 bullets appearing one-by-one, 0.5s stagger (instant when
   reduced-motion):
   - "Take or upload one selfie"
   - "We show you 8 hairstyles picked for your face and hair."
   - "Choose your favorite and make final touches."
   - "We'll send it to your barber along with the appointment."
   (Second bullet copy was cut off in the spec — the founder wrote "8
   hairstyles we think ."; the line above is the approved completion.)
   Then a **"Let's go."** button.
2. **Auth popup**: pressing either "Just doing a trim." or "Show me my best
   hairstyles" while signed out → short overlay popup (dialog, dismissible)
   wrapping the existing `SignUpWidget`, over the card — not a page swap.
   One shared component (`BarberAuthPopup`) so both CTAs use it and it's
   removable per-CTA later. After sign-in: continue where they were
   (referral attribution via `users.getOrCreate` exactly as `BarberTryOn`
   does it — do not lose the `referralCode` path).
3. **New `BarberBatchFlow` component** (sibling of `BarberTryOn`, swapped into
   the same `bc-exp` panel): phases
   `rundown → capture → checking → analyzing → generating → grid → enlarged`.
   Reuse `SelfieCapture`, `judgeSelfie` warn/override UI, and the
   staged-progress presentation style of `StageTracker` (honest stages, no
   fake percentages). During `generating`, show the grid skeleton immediately
   and fill tiles as items flip to `done` (reactive via `useQuery` on
   `latestForPage`).
4. **Grid**: 8 tiles (2-col mobile / 4-col desktop), each a scaled-down
   looping turntable `<video muted playsInline loop preload="metadata">`
   (≤~720px source is fine; do NOT transcode client-side), title beneath.
   Hover: smooth scale lerp (CSS `transform` transition). Click: brief bounce
   keyframe, then enlarge. IntersectionObserver pauses offscreen videos.
   Failed tiles show a small retry affordance (hits the item-retry endpoint).
5. **Enlarged view**: the existing splat-viewer treatment — one `HairScene`
   with `splatSrcOverride={/api/proxy-ply?url=…}` (signed URL for
   `splatS3Key`), `disableDefaultHairLayers`, concise `title`, back-to-grid
   affordance, and the prompt box: **placeholder** "Final Touches" (never a
   value). Submitting runs the single-item re-edit (edit from the ORIGINAL
   selfie + combined prompt — same anti-drift rule as `BarberTryOn`) and
   updates that item in place. Unmount `HairScene` when returning to grid.
6. **Send to barber**: from the enlarged view — existing send UI, now passing
   `styleTitle`, `stylePrompt`, `hairProfile`. Keep the book-appointment close
   (`onBook` / `bookingUrl`).
7. **Resume**: on card mount (signed-in), if `latestForPage` returns an active/
   ready batch, offer/jump straight to the grid ("Your looks from earlier" +
   "Start over" which just begins a new flow — entitlement still applies).
8. **Hair profile teaser**: one line above the grid from the analysis
   ("Curly 3B · dense · slight temple recession — these 8 work with that") so
   the picks read as diagnosed, not random.

**Tests:** vitest for rundown stagger + reduced-motion, auth-popup gating on
both CTAs, grid fill from mocked query states, enlarged view mounts exactly
one scene, retry visibility; extend `BarberCard.test.tsx` for the new entry
mode; e2e `e2e/barber-batch.spec.ts` with mocked API routes (grid appears,
tap enlarges, refresh resumes).

## Phase 5 — Guardrails + polish

- Set `GPU_BUDGET_SECONDS` on prod Convex (suggest 90000 ≈ covers the $30
  credit with margin) — flag for the founder to run
  `npx convex env set GPU_BUDGET_SECONDS 90000` on prod; don't touch prod
  yourself.
- Add a monthly Gemini-edit counter (tiny table patterned on `gpuUsage`,
  incremented in the shared edit core) — visibility only, no enforcement yet.
- `vendor_name_scrubbing` memory applies: say "primary worker" / "image
  model" in comments/logs, never Modal/Gemini vendor names.

## Out of scope (do not do)

- EC2/AWS GPU migration (separate task; multi-upstream design already
  accommodates it).
- Paid tiers / Stripe changes.
- Changing the existing single-cut `BarberTryOn` flow (tapping a lookbook
  tile still uses it unchanged).
- Redeploying the Modal worker or touching prod env vars (report needs
  instead).
- Deploy/push (CLAUDE.md: don't deploy or push unless asked).

## Open questions for the founder (proceed with defaults if unanswered)

1. Batch cap default: 1 free batch/user/month (default) — confirm.
2. Should "Start over" within the same month be blocked once the entitlement
   is spent, or allow re-entering the existing batch only? Default: re-enter
   existing batch; new batch requires next month.
3. Turntable mp4 size from the worker — if sources are large (>~8 MB each),
   consider asking the worker for a smaller variant later; for now serve
   as-is.

## Verification (definition of done)

```bash
npm run typecheck && npm run lint && npm test
npm run test:e2e   # barber-batch spec
```

Plus a manual drive of the real flow (use the `verify` skill): dev servers up
(`npx convex dev`, `npm run dev`), visit `/b/<slug>` of a test page, run a
batch end-to-end with a real selfie, kill the tab mid-generation and confirm
resume, confirm the barber inbox row carries title/prompt/profile.
