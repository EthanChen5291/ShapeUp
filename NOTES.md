# Mobile Support — Mechanism

**Hard rule: desktop stays pixel-for-pixel identical.** All mobile work is additive
and gated behind a breakpoint; the desktop code path is never altered.

Because ~95% of the UI is styled with inline `style={{}}` objects (Tailwind
`md:`/`sm:` prefixes do not affect inline styles), mobile overrides use a hook:

- `src/hooks/useMediaQuery.ts` exports `useIsMobile()` and `MOBILE_BREAKPOINT = 768`.
- Components merge a mobile-only style object onto the existing desktop one:
  `style={{ ...desktopStyle, ...(isMobile ? mobileStyle : {}) }}`.
- The desktop branch is left byte-identical, so `isMobile === false` reproduces
  today's UI exactly.
- Breakpoint: **768px** (`max-width: 768px` ⇒ mobile). Use this everywhere.
- SSR/first client render report `false` (desktop) to avoid hydration mismatch;
  the real value lands in an effect after mount.

Viewport meta + safe-area handling live in `src/app/layout.tsx` (`export const
viewport`) and `src/app/globals.css`.

---

# Barber Output v2 — Integration Notes

## What changed, in one paragraph

Barber Output is no longer "always call Gemini and print whatever comes back."
A deterministic feasibility pass now classifies every order before any LLM call
(`no_change` / `buzz` / `growth_only` / `mixed` / `cut`), three of those five
kinds short-circuit to deterministic tickets with zero hallucination surface,
and the two that do reach Gemini go through an optional 1–3 question clarify
step whose answers become STYLE_CONTEXT constraints. Gemini's output is then
validated against the numbers with teeth: moves that contradict a zone's
direction, invented percentages, collapsed fade ranges, dropped landing specs,
and internal jargon are all replaced by the deterministic fallback per-zone.

## Files

| File | Role |
|---|---|
| `src/lib/orderFeasibility.ts` | NEW — classification, notices, grow-out estimates, color read, contradiction checks |
| `src/lib/orderClarify.ts` | NEW — question generation + answers → STYLE_CONTEXT |
| `src/lib/barberOrder.ts` | REPLACES yours — fade ranges, back hedging, validation guards, buzz/maintenance builders, neckline + color on the order |
| `src/lib/barberPrompt.ts` | NEW — SYSTEM_PROMPT v2 + user-content builder (replaces the inline const at your line 34) |
| `src/app/api/barber-order/clarify/route.ts` | NEW route per your flow2 spec |
| `src/app/api/barber-order/finalize/route.ts` | NEW route per your flow2 spec |
| `src/components/BarberOrderSheet.tsx` + `.css` | NEW UI — notices, clarify chips, ticket |
| `test/edgeCases.ts` | 38 behavioral checks, all passing (`npx tsx test/edgeCases.ts`) |

## Wiring points (3)

1. **Gemini client** — `finalize/route.ts` has a `generateOrderJSON()` stub
   marked `WIRE-UP POINT`. Drop in your existing gemini-2.5-flash call
   (responseMimeType json + the render image part). On throw, the route
   degrades to the deterministic fallback and flags `degraded: true`.
2. **Baseline color** — pass `options.baselineColorRGB` (sample the scan
   texture's dominant hair-region color client-side) into both routes. I
   deliberately did NOT add it to `index.ts` since that schema is marked
   "team consensus required" — it travels per-request instead. If you later
   get consensus, `HairMeasurementSnapshot.baselineColorRGB?: string` is the
   natural home and the request option becomes a fallback.
3. **Theme** — remap the six `--su-theme-*` variables at the top of
   `barberOrderSheet.css` to your existing tokens. Everything inherits.

## The decision flow

```
click "Barber Output"
        │
   POST /clarify  ──────────── computeZoneDeltas + analyzeOrderFeasibility
        │
        ├─ no_change   → notice "no difference" + optional maintenance ticket (no LLM)
        ├─ buzz/bald   → deterministic one-guard / razor ticket (no LLM)
        ├─ growth_only → BLOCK notice + grow-out plan (~weeks) + shape-up ticket (no LLM)
        └─ cut/mixed   → notices + ≤3 clarify chips
                              │ user answers (or skips → defaults)
                         POST /finalize
                              │ answers → STYLE_CONTEXT → Gemini → validate → enforce
                              ▼
                           TICKET
```

## Edge-case matrix (your list + the QA doc's)

| Case | Handling |
|---|---|
| Same haircut | `no_change`: **no receipt** — notice + optional "Maintenance — Same Cut" ticket (tighten fade, clean edges, same lengths). Also sidesteps the "same as last time" barber pet peeve: the ticket IS the previous spec. |
| Longer-than-current hair | `growth_only`: block notice ("a barber can't add length"), grow-out plan with inches-to-go and a weeks estimate at ½ in/month, plus a "Shape-Up While Growing" edges-only ticket so a barber visit still has a purpose. |
| Partially longer (e.g. growing the top, cutting the sides) | `mixed`: cut zones get real instructions, grow zones are hard-forced to "leave it — dust the ends only" with a GROWING OUT badge. Gemini cannot phrase grow zones at all — its output for them is discarded. |
| Bald / buzz | Deterministic ticket, no LLM, no clarify. Bald → "clippers no guard, razor/foil finish." Texture read replaced with "doesn't matter at this length." |
| Dye | Color section appears only with evidence (baseline color differs, or explicit request) — never guessed. Carries shade family from hex, **blend vs full coverage**, a salon-routing note (most barbershops don't do color), grey-blend terminology when applicable, and its own color-language `askFor` (no guard/inch phrasing). |
| Back of head | Treated as what it is: target = exact (it's the model), current = inferred (front-only scan). Back confidence hard-capped at 0.75, relative amounts hedged ("roughly… back read is an estimate"), an info notice explains it, and the zone carries a "confirm in chair" badge. Distinct-back styles still get exact target specs — only the *delta* is soft. |
| Unmentioned zones | Your stated policy, enforced at the order layer: a zone whose delta says `keep` reads "hold the length, just reshape" — never a take-down. When the back holds while everything else drops ≥25% (and the preset doesn't pin the back, e.g. taper_fade/undercut/buzz do), the **back_intent clarify question** asks "leave as-is or match the sides?" instead of assuming. Note the *edit loop* upstream decides what unmentioned zones become; this layer guarantees the ticket never invents a change the geometry doesn't show. |
| Contradictory cuts | Geometry checks: fade + sides longer than top → warn; fade + scissor-length sides → warn AND the spec auto-degrades to "tapered, …" (a skin fade at 2 inches isn't a thing). Both still produce a ticket — a barber *can* cut weird; the notice just confirms intent. |
| Fade ≠ one guard (QA #2) | Sides/back specs with taper ≥0.25 are ranges: `skin → #3–#4`. The fade-bottom clarify question (skin / #0.5 / #1) pins the start. Validation restores the range if Gemini collapses it. |
| Invented percentages (QA #4) | Any `%` in a move that isn't within 10pts of the real delta → move replaced. Edges/finish may never carry percentages. |
| Direction contradiction (QA #1) | "Hold the length" on a take_down zone (and vice versa) → move replaced with the deterministic one. |
| Internal jargon (QA #5) | `humanStyleName()` maps presets ("default" → "trim and reshape"); any `askFor` containing "default" is rejected for the fallback sentence. |
| Vague product line (QA #7) | `productForFinish()` maps messiness → product type + hold + shine ("matte clay or paste — low–medium hold, no shine"). |
| Neckline (QA: top-5 barber ask) | First-class field on the order + a clarify chip (natural / squared / tapered), normalized in validation, pinned post-validation from the user's explicit answer. |
| Gemini down / garbage JSON | Per-zone fallback already existed; now the whole route degrades gracefully and the UI shows "Built from measurements only." |
| Client calling /finalize directly with spoofed answers | Numbers recomputed server-side from the profile; questions rebuilt server-side; only known answer ids map to pre-written STYLE_CONTEXT lines — raw user text never reaches the prompt. |

## Deliberately NOT handled here (upstream)

The QA doc's headline failure — "take two inches off" becoming "hold the
length" — was the **edit loop** failing to change `topLength`, which the order
layer then truthfully reported. This layer now guarantees the ticket matches
the geometry; it cannot guarantee the geometry matches the user's words. Two
cheap upstream guards worth adding to the edit loop: (1) after an edit prompt
that contains length words, assert at least one zone param actually moved,
else surface "I didn't change anything — did you mean…?"; (2) log the user's
prompt alongside the resulting param diff so you can eval intent-fidelity
separately from ticket-fidelity.

## Tuning knobs

- `BUZZ_PARAM_MAX` (0.12) / `BALD_PARAM_MAX` (0.03) — buzz/bald thresholds
- keep band ±8%, borderline band 8–15% — in `computeZoneDeltas`
- `BACK_CONFIDENCE_CAP` (0.75)
- `GROWTH_IN_PER_WEEK` (0.125 in)
- `COLOR_SAME_THRESHOLD` (RGB distance 42)
- `MAX_QUESTIONS` (3) and `BACK_PINNED_PRESETS` in `orderClarify.ts`

---

## Update 2 — the dimension bug, diagnosed and (half) fixed

**Bug A (edit layer, NOT fixed here — needs the edit-loop route):** "take two
inches off the top" never moved `topLength`. The edit LLM works in the 0–2
mesh-scale space with no anchor for what the current length is in inches, so
relative+absolute instructions are unanchorable and it punts. The barber order
then truthfully reported unchanged top geometry. Evidence: sides (−60%) and
back (−50%) registered fine in the same ticket, so measurement was live.
Fix belongs in the edit route: (1) inject the measurement snapshot + the
`specForLength` param→inches table into the edit prompt so the model can
compute target params from relative requests; (2) post-edit assertion — if the
prompt contains length words and no zone param moved > ε, return a
clarification instead of a render; (3) enforce the unmentioned-zone policy
there (the same ticket changed the back unprompted). **Send the edit-loop
route file and I'll implement all three.**

**Bug B (order layer, FIXED):** `/api/barber-order` overlays `body.params`
onto the profile but never verified `snapshot.estimated` was measured AFTER
those params — a stale snapshot produces deltas from old geometry glued to
specs from new params ("hold the length… land at X"). `computeZoneDeltas` now
compares `params` to `snapshot.currentParams`; on drift > 0.02 it re-derives
the zone's estimate by scaling the snapshot measurement by the param ratio
(params are mesh-group scales, so first-order linear), flags
`ctx.staleSnapshot`, and docks that zone to derived_params confidence (0.82,
back still capped at 0.75). Covered by test §11.

## Update 2 — wiring done with your real code

- `src/lib/barberOrderPipeline.ts` — your actual Gemini client
  (gemini-2.5-flash, responseMimeType json, temperature 0.6), your
  `imageToInlineData`, shared by all three routes so /finalize can't bypass
  the gates and the legacy route ≡ clarify→finalize with default answers.
- `/api/barber-order` (upgraded in place), `/clarify`, `/finalize` — all with
  your `requireSignedIn`, `enforceDurableRateLimits`, payload caps,
  `isSafeImageSource`, and your ticketNo scheme. Legacy response shape kept
  (`ok/order/text/ticketNo`) and extended with `kind/notices/degraded`.
- UI rebuilt on the house system: `.receipt`/`.receipt-print`/`.receipt-zone`/
  `.conf-meter`/`.receipt-askfor`/`.receipt-tear`/`.receipt-barcode` for the
  ticket, `.receipt-stub` while printing, `.chip-suggest`+`.chip-pop` clarify
  chips, `.btn-cta-order` confirm, `.pill-tomato`/`.pill-denim` badges.
  One small CSS block to append to globals.css:
  `src/components/barberOrder.append.css` (order notes + `.is-on` chip state).
- `baselineColorRGB` now travels in the request body of all three routes.

---

## Update 3 — controlling the closed box

Corrected mental model: the edit "LLM" outputs **pixels**, not params. The
chain is prompt → image edit → 3D reconstruction from the edited *frontal*
image → measurements → deltas. Two structural consequences:

1. **The top under-reads.** A frontal photo is nearly edge-on to the top of
   the head; "2 inches off the top" mostly projects backward and barely moves
   the frontal silhouette, so `crownHeight` is insensitive to exactly the
   change users request most. This — not the edit model — is the prime
   suspect for the QA ticket's "keep" on the top.
2. **The back was never measured.** It's invisible frontally; the −50% back
   delta in the QA ticket was the reconstruction's prior wearing a
   measurement's clothes. The back must be *declared*, not measured.

Three levers implemented on `/api/gemini-hair-edit`:

- **Steering (prompt):** scale anchor (chin-to-hairline ≈ 7 in, so "two
  inches" is a computable pixel distance), the unmentioned-zone policy
  verbatim (untouched unless the named style implies it: fade ⇒
  sides/back/edges, mullet ⇒ back, buzz ⇒ all), and explicit nape guidance.
  Client prompt is now delimited, control-char-scrubbed, and capped at 500
  chars (it's hostile input inside our prompt). `currentProfile` is slimmed
  to geometry only — v1 stringified the whole profile into the prompt, which
  can include `faceScanData` base64 (token bomb + selfie-in-prompt leak).
- **Confession (EDIT_REPORT):** `responseModalities` already includes TEXT,
  so the model must append one JSON line declaring per-zone intent
  (`shorter|longer|same`), approx amounts, and `colorChanged`. Parsed by
  `editReport.ts` with enum whitelists + length caps + control-char scrub —
  treated as hostile. Returned as `editReport` in the route response
  (null-safe: everything degrades to current behavior if the model skips it).
- **Reconciliation (order layer):** client passes `editReport` to the order
  routes (re-sanitized server-side). Declared-shorter + measured-keep on a
  front-visible zone → `intent_<zone>_unread` warn notice ("the preview may
  not show your change — re-run the edit"; the ticket still follows measured
  geometry, never invented absolutes). Back declared `same` while the
  reconstruction moved it → notice + the back clarify question is FORCED with
  out-of-frame phrasing. `colorChanged: true` surfaces the color section even
  without a sampled baseline color. Declared no-op strengthens no-receipt.

Also: v1 of the edit route had **no auth and no rate limiting** while being
the most expensive endpoint; both added (clearly commented for removal if it
must stay public).

Client wiring (one line each): keep the `editReport` from the last
`/api/gemini-hair-edit` response in the project state, pass it to
`<BarberOrderSheet editReport={...}>` — it flows to clarify/finalize
automatically.

Tests: 57 passing — §12 sidecar parsing (valid / fenced / hostile / garbage),
§13 reconciliation (top-unread warn, back declaration conflict forcing the
question, declared color change, no-report no-op).

---

## Update 4 — strand length vs silhouette drop

Correct objection: "2 inches off" means STRAND length (hair pulled straight,
the barber's measure), but pixels and the 3D reconstruction see SILHOUETTE
drop. Identical only on 1A–1C straight hair; on 3A–4C, shrinkage (30–75%)
means a literal 2-inch silhouette drop massively over-cuts. Fixes:

- **Edit prompt SCALE ANCHOR rewritten**: face ruler kept for absolute scale,
  but inches now defined as strand length with per-texture conversion
  (straight ≈ full drop; wavy ≈ ½–¾; curly/coily → show reduced volume and a
  tighter outline, never the literal drop; never straighten the curl to make
  a change visible).
- **`SILHOUETTE_FACTOR`** (straight 1.0 / wavy 0.7 / curly 0.45) in
  barberOrder.ts now drives: (a) grow-out weeks — visible growth = strand
  growth × factor, so curly grow-outs honestly take longer (cap raised to 78
  wks), with a `curl_shrinkage_growth` notice; (b) confidence — changing
  zones docked 0.03 (wavy) / 0.07 (curly) since a silhouette delta is a
  looser proxy for what the barber must cut; keep zones untouched.
- **Barber SYSTEM_PROMPT**: deltas declared as silhouette quantities; on
  3A–4C Gemini must phrase amounts shrinkage-aware ("takes more off than it
  looks — coils spring back") and note landing lengths as stretched lengths.

Tests §14: curly grow-out weeks > straight for identical deltas, shrinkage
notice on textured grow-outs only, take-down confidence docked on curly,
keep zones never docked. 62 passing.
