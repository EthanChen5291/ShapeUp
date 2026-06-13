// ============================================================
// Barber Order — systematic breakdown of "what to ask for"
//
// The order is built from three signals:
//   1. NUMERIC — the delta between the initial scan's hair
//      measurements (snapshot.baseline) and the model the user
//      is currently looking at (snapshot.estimated).
//   2. VISUAL — Gemini's read of the current render (curl
//      pattern 1A–4C, density, hairline) so technique choices
//      respect how the client's hair actually behaves.
//   3. STYLE — the active preset/params (taper, messiness)
//      plus the user's clarify answers (STYLE_CONTEXT).
//
// v2 invariants ("numbers are law" got teeth):
//   • A fade is a RANGE, never a single guard.
//   • Back relative amounts are hedged — front-only scan means
//     the back baseline is inferred. Targets stay exact.
//   • Gemini text that contradicts a zone's direction, or that
//     invents percentages, is replaced by the deterministic
//     fallback for that zone.
//   • grow_out zones always read "leave it / growing out".
//   • Internal preset jargon ("default") never reaches askFor.
// ============================================================

import { HairMeasurementSnapshot, HairPreset, UserHeadProfile } from '@/types';
import { FeasibilityReport, GrowOutZonePlan } from './orderFeasibility';

export type BarberZoneId = 'top' | 'sides' | 'back' | 'edges' | 'finish';

export interface BarberZone {
  zone: BarberZoneId;
  label: string;       // printed header, e.g. "THE TOP"
  move: string;        // barber-talk instruction, one or two short sentences
  technique: string;   // single named technique, e.g. "point cutting"
  spec: string;        // hard number, e.g. "skin → #3–#4" / "~2.5 in"
  confidence: number;  // 0–1
  /** Set on zones the barber should NOT cut (growing out). */
  growOut?: boolean;
  /** Set on zones whose baseline is inferred (back, front-only scan). */
  inferredBaseline?: boolean;
}

export interface BarberColorSection {
  shadeFamily: string;
  mode: 'blend' | 'full';
  serviceNote: string;
  askFor: string; // color-specific phrasing — shade family + blend/cover, no guard language
}

export interface BarberOrder {
  styleName: string;
  hairRead: {
    pattern: string;            // Andre Walker scale, e.g. "2B · wavy"
    density: string;            // e.g. "medium-high"
    note: string;               // one line on how this hair behaves
  };
  zones: BarberZone[];          // always exactly: top, sides, back, edges, finish
  neckline: string;             // "natural" | "squared" | "tapered" (free text, validated)
  askFor: string;               // the literal sentence to say in the chair
  maintenance: string;          // e.g. "tight again in 3–4 weeks"
  color?: BarberColorSection;   // only present when a dye is in play
  /** Non-cut companions: grow-out schedule for mixed/growth orders. */
  growOutPlan?: GrowOutZonePlan[];
}

export interface ZoneDelta {
  zone: 'top' | 'sides' | 'back';
  baseline: number;            // scene units, from the initial scan
  estimated: number;           // scene units, current model
  deltaPct: number;            // (estimated - baseline) / baseline
  direction: 'take_down' | 'keep' | 'grow_out';
  amount: string;              // human delta, e.g. "down ~40%"
  targetSpec: string;          // guard/inches for the target length
  confidence: number;          // deterministic, pre-Gemini
  /** Back zone only: baseline inferred from a front-facing scan. */
  inferredBaseline?: boolean;
}

export interface OrderComputedContext {
  deltas: ZoneDelta[];
  taperRead: string;           // from params.taper
  finishRead: string;          // from params.messiness
  source: HairMeasurementSnapshot['source'];
  /**
   * True when the request's params drifted from snapshot.currentParams —
   * i.e. the model was edited after the last mesh re-measure. The affected
   * zones' `estimated` values were re-derived by scaling the snapshot
   * measurement by the param ratio (params are mesh-group scales), and
   * their confidence was downgraded to derived_params level.
   */
  staleSnapshot: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ── Human style names — internal jargon never reaches the chair ─────
const PRESET_HUMAN_NAMES: Record<HairPreset, string> = {
  buzz: 'buzz cut',
  pompadour: 'pompadour',
  undercut: 'undercut',
  taper_fade: 'taper fade',
  afro: 'afro shape-up',
  waves: 'waves',
  default: 'trim and reshape',
};

export function humanStyleName(preset: HairPreset): string {
  return PRESET_HUMAN_NAMES[preset] ?? 'trim and reshape';
}

// ── Length param (0–2 scale, 1.0 ≈ medium) → barber spec ───────────
// Sides/back read in clipper guards, top reads in scissor lengths.
export function specForLength(param: number, zone: 'top' | 'sides' | 'back'): string {
  if (param <= 0.12) return zone === 'top' ? 'buzzed, #1' : 'skin / #0.5';
  if (param <= 0.25) return '#1–#2 (3–6 mm)';
  if (param <= 0.45) return '#3–#4 (10–13 mm)';
  if (param <= 0.7)  return zone === 'top' ? 'short scissor, ~1 in' : '#6–#8 (19–25 mm)';
  if (param <= 1.1)  return 'scissor, 1.5–2.5 in';
  if (param <= 1.5)  return 'scissor, 3–4 in';
  return 'length kept, 4 in+';
}

/** Bottom guard of a fade, from the taper param (or a clarify answer). */
export function fadeBottom(taper: number, override?: 'skin' | 'half' | 'one'): string {
  if (override) return override === 'skin' ? 'skin' : override === 'half' ? '#0.5' : '#1';
  if (taper >= 0.75) return 'skin';
  if (taper >= 0.5) return '#0.5';
  return '#1';
}

/**
 * Sides/back spec when a fade or taper is in play. A fade is a gradient —
 * a single guard plus "fade" is self-contradictory. Output reads
 * "skin → #3–#4" so the barber sees the range, not a flat length.
 */
export function fadeSpec(param: number, zone: 'sides' | 'back', taper: number, bottomOverride?: 'skin' | 'half' | 'one'): string {
  const land = specForLength(param, zone);
  if (taper < 0.25) return land;
  // Scissor-length sides can't skin-fade — it reads as a layered taper.
  if (param > 1.1) return `tapered, ${land}`;
  return `${fadeBottom(taper, bottomOverride)} → ${land}`;
}

export function taperDescriptor(taper: number): string {
  if (taper < 0.25) return 'blunt edges, no taper';
  if (taper < 0.5)  return 'low taper';
  if (taper < 0.75) return 'mid fade';
  return 'high skin fade';
}

export function finishDescriptor(messiness: number): string {
  if (messiness < 0.2)  return 'clean & combed';
  if (messiness < 0.5)  return 'light texture';
  if (messiness < 0.75) return 'choppy texture';
  return 'messy, broken up';
}

/** Finish → product mapping: type + hold + shine, not vibes. */
export function productForFinish(messiness: number): { product: string; holdShine: string } {
  if (messiness < 0.2)  return { product: 'pomade or light gel', holdShine: 'medium hold, some shine' };
  if (messiness < 0.5)  return { product: 'matte clay or paste', holdShine: 'low–medium hold, no shine' };
  if (messiness < 0.75) return { product: 'matte clay', holdShine: 'medium hold, no shine' };
  return { product: 'fiber or strong clay', holdShine: 'high hold, low shine' };
}

const SOURCE_CONFIDENCE: Record<HairMeasurementSnapshot['source'], number> = {
  mesh_bbox: 0.95,        // measured straight off the rendered hair mesh
  scan: 0.9,              // from the original capture
  derived_params: 0.82,   // estimated from style params only
};

/** Hard ceiling on back confidence — its baseline is inferred. */
const BACK_CONFIDENCE_CAP = 0.75;

/**
 * Silhouette-per-strand factor by texture: how much of a strand-length
 * change actually shows in the measured silhouette. Straight hair shows
 * ~all of it; curls shrink the visible change (coils spring back). Used
 * to (a) dock delta confidence on textured hair — a silhouette delta is
 * a looser proxy for strand change — and (b) slow the visible grow-out
 * rate in the grow-out plan.
 */
export const SILHOUETTE_FACTOR: Record<'straight' | 'wavy' | 'curly', number> = {
  straight: 1.0,
  wavy: 0.7,
  curly: 0.45,
};

/** Confidence dock on changing zones when texture loosens the
    silhouette↔strand mapping. */
const TEXTURE_AMBIGUITY: Record<'straight' | 'wavy' | 'curly', number> = {
  straight: 0,
  wavy: 0.03,
  curly: 0.07,
};

/**
 * Params beyond this drift from snapshot.currentParams mean the model was
 * edited after the snapshot was taken — the snapshot's `estimated` no longer
 * describes the model on screen.
 */
const PARAM_DRIFT_EPS = 0.02;

export function computeZoneDeltas(profile: UserHeadProfile): OrderComputedContext {
  const snapshot = profile.measurementSnapshot;
  const params = profile.currentStyle.params;
  const baseline = snapshot?.baseline ?? profile.hairMeasurements;
  const estimated = snapshot?.estimated ?? profile.hairMeasurements;
  const source: HairMeasurementSnapshot['source'] = snapshot?.source ?? 'derived_params';
  const snapParams = snapshot?.currentParams;
  let staleSnapshot = false;

  const zoneDefs = [
    { zone: 'top' as const,   base: baseline.crownHeight, est: estimated.crownHeight, param: params.topLength,  snapParam: snapParams?.topLength },
    { zone: 'sides' as const, base: baseline.sideWidth,   est: estimated.sideWidth,   param: params.sideLength, snapParam: snapParams?.sideLength },
    { zone: 'back' as const,  base: baseline.backLength,  est: estimated.backLength,  param: params.backLength, snapParam: snapParams?.backLength },
  ];

  const deltas: ZoneDelta[] = zoneDefs.map(({ zone, base, est, param, snapParam }) => {
    // ── Snapshot reconciliation ──────────────────────────────────
    // The route receives `params` separately from the profile, so the
    // snapshot may describe the model BEFORE the latest edit. Params are
    // mesh-group scales, so first-order: measurement scales linearly with
    // the param. Re-derive `est` from the ratio and treat the zone as
    // derived_params (lower trust) instead of letting stale geometry
    // produce "hold the length" against a fresh landing spec.
    let zoneSource = source;
    if (snapParam !== undefined && Math.abs(param - snapParam) > PARAM_DRIFT_EPS) {
      const ratio = clamp(param / Math.max(snapParam, 1e-3), 0, 6);
      est = est * ratio;
      zoneSource = 'derived_params';
      staleSnapshot = true;
    }

    const safeBase = base > 1e-4 ? base : 1e-4;
    const deltaPct = (est - safeBase) / safeBase;
    const direction: ZoneDelta['direction'] =
      Math.abs(deltaPct) < 0.08 ? 'keep' : deltaPct < 0 ? 'take_down' : 'grow_out';

    const pctLabel = Math.round(Math.abs(deltaPct) * 100);
    const inferred = zone === 'back'; // front-only scan ⇒ back baseline inferred
    const amount =
      direction === 'keep' ? 'hold the length'
      : direction === 'take_down' ? (inferred ? `down roughly ${pctLabel}% (back read is an estimate)` : `down ~${pctLabel}%`)
      : `+${pctLabel}% to grow into`;

    // Borderline deltas (8–15%) are visually ambiguous — dock confidence.
    const ambiguity = Math.abs(deltaPct) > 0.08 && Math.abs(deltaPct) < 0.15 ? 0.08 : 0;
    // Texture loosens the silhouette↔strand mapping: a measured drop on
    // curly hair says less about what the barber must actually cut.
    const textureDock = direction === 'keep' ? 0 : TEXTURE_AMBIGUITY[profile.currentStyle.hairType] ?? 0;
    let confidence = clamp(SOURCE_CONFIDENCE[zoneSource] - ambiguity - textureDock, 0.55, 0.97);
    if (inferred) confidence = Math.min(confidence, BACK_CONFIDENCE_CAP);

    // Fade-aware spec for clipper zones; top stays scissor language.
    const targetSpec =
      zone === 'top' ? specForLength(param, zone) : fadeSpec(param, zone, params.taper);

    return {
      zone,
      baseline: Number(safeBase.toFixed(4)),
      estimated: Number(est.toFixed(4)),
      deltaPct: Number(deltaPct.toFixed(3)),
      direction,
      amount,
      targetSpec,
      confidence: Number(confidence.toFixed(2)),
      ...(inferred ? { inferredBaseline: true } : {}),
    };
  });

  return {
    deltas,
    taperRead: taperDescriptor(params.taper),
    finishRead: finishDescriptor(params.messiness),
    source,
    staleSnapshot,
  };
}

// ── Validation of the Gemini response ───────────────────────────────
const ZONE_ORDER: BarberZoneId[] = ['top', 'sides', 'back', 'edges', 'finish'];
const ZONE_LABELS: Record<BarberZoneId, string> = {
  top: 'THE TOP',
  sides: 'THE SIDES',
  back: 'THE BACK',
  edges: 'EDGES & NECKLINE',
  finish: 'FINISH & PRODUCT',
};

function cleanString(value: unknown, maxLen: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, maxLen) : fallback;
}

function cleanConfidence(value: unknown, deterministic: number): number {
  const visual = typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : deterministic;
  // Blend: numbers come from real geometry, the model only adjusts.
  return Number(clamp(0.6 * deterministic + 0.4 * visual, 0.5, 0.98).toFixed(2));
}

// ── Anti-hallucination guards on free text ──────────────────────────

/** Move text that contradicts the zone's numeric direction → rejected. */
function moveContradictsDirection(move: string, direction: ZoneDelta['direction']): boolean {
  const m = move.toLowerCase();
  const saysHold = /\b(hold|keep|leave it|just reshape|don'?t touch)\b/.test(m);
  const saysCut = /\b(take|chop|buzz|down|off|shorter|drop)\b/.test(m);
  const saysGrow = /\b(grow|growing|let it)\b/.test(m);
  if (direction === 'take_down' && saysHold && !saysCut) return true;
  if (direction === 'keep' && saysCut && !saysHold) return true;
  if (direction === 'grow_out' && saysCut && !saysGrow) return true;
  return false;
}

/** Percentages Gemini didn't get from us → rejected. */
function moveInventsPercent(move: string, delta?: ZoneDelta): boolean {
  const matches = move.match(/(\d{1,3})\s*%/g);
  if (!matches) return false;
  if (!delta) return true; // edges/finish never carry percentages
  const real = Math.round(Math.abs(delta.deltaPct) * 100);
  return matches.some(m => Math.abs(parseInt(m, 10) - real) > 10);
}

export function validateBarberOrder(
  raw: unknown,
  ctx: OrderComputedContext,
  profile: UserHeadProfile,
  feas?: FeasibilityReport,
): BarberOrder {
  const fallback = buildFallbackOrder(ctx, profile, feas);
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;

  const rawZones = Array.isArray(obj.zones) ? (obj.zones as Record<string, unknown>[]) : [];
  const deltaByZone = new Map(ctx.deltas.map(d => [d.zone, d]));

  const zones: BarberZone[] = ZONE_ORDER.map((zoneId) => {
    const fb = fallback.zones.find(z => z.zone === zoneId)!;
    const cand = rawZones.find(z => z.zone === zoneId);
    if (!cand) return fb;
    const delta = deltaByZone.get(zoneId as 'top' | 'sides' | 'back');
    const deterministic = delta?.confidence ?? 0.78;

    // Grow-out zones are not Gemini's to phrase — enforce the fallback.
    if (delta?.direction === 'grow_out') return fb;

    let move = cleanString(cand.move, 180, fb.move);
    if (delta && (moveContradictsDirection(move, delta.direction) || moveInventsPercent(move, delta))) {
      move = fb.move;
    }
    if (!delta && moveInventsPercent(move)) move = fb.move;

    let spec = cleanString(cand.spec, 48, fb.spec);
    // Numbers are law: clipper-zone specs must carry the deterministic
    // landing length (Gemini may rephrase around it, not replace it).
    if (delta && !specHonorsTarget(spec, delta.targetSpec)) spec = delta.targetSpec;

    return {
      zone: zoneId,
      label: ZONE_LABELS[zoneId],
      move,
      technique: cleanString(cand.technique, 48, fb.technique),
      spec,
      confidence: cleanConfidence(cand.confidence, deterministic),
      ...(delta?.inferredBaseline ? { inferredBaseline: true } : {}),
    };
  });

  const hairRead = (obj.hairRead ?? {}) as Record<string, unknown>;

  const order: BarberOrder = {
    styleName: cleanString(obj.styleName, 60, fallback.styleName),
    hairRead: {
      pattern: cleanString(hairRead.pattern, 32, fallback.hairRead.pattern),
      density: cleanString(hairRead.density, 32, fallback.hairRead.density),
      note: cleanString(hairRead.note, 140, fallback.hairRead.note),
    },
    zones,
    neckline: cleanNeckline(obj.neckline, fallback.neckline),
    askFor: sanitizeAskFor(cleanString(obj.askFor, 220, fallback.askFor), fallback.askFor),
    maintenance: cleanString(obj.maintenance, 80, fallback.maintenance),
    ...(fallback.color ? { color: fallback.color } : {}),
    ...(fallback.growOutPlan?.length ? { growOutPlan: fallback.growOutPlan } : {}),
  };

  return order;
}

/** The landing spec's first hard number must survive Gemini's rewrite. */
function specHonorsTarget(spec: string, target: string): boolean {
  const firstNum = target.match(/#?\d+(?:\.\d+)?/);
  if (!firstNum) return /skin/i.test(target) ? /skin/i.test(spec) : true;
  return spec.includes(firstNum[0]);
}

function cleanNeckline(value: unknown, fallback: string): string {
  const v = cleanString(value, 24, fallback).toLowerCase();
  if (/squar|block/.test(v)) return 'squared';
  if (/taper|fade/.test(v)) return 'tapered';
  if (/natur|round/.test(v)) return 'natural';
  return fallback;
}

/** Internal jargon never reaches the chair. */
function sanitizeAskFor(askFor: string, fallback: string): string {
  if (/\bdefault\b/i.test(askFor)) return fallback;
  return askFor;
}

// ── Deterministic fallback — the order still prints if Gemini is down ──
export function buildFallbackOrder(
  ctx: OrderComputedContext,
  profile: UserHeadProfile,
  feas?: FeasibilityReport,
): BarberOrder {
  const { deltas, taperRead, finishRead } = ctx;
  const byZone = Object.fromEntries(deltas.map(d => [d.zone, d])) as Record<'top' | 'sides' | 'back', ZoneDelta>;
  const hairType = profile.currentStyle.hairType;
  const styleName = humanStyleName(profile.currentStyle.preset);
  const { product, holdShine } = productForFinish(profile.currentStyle.params.messiness);

  const moveFor = (d: ZoneDelta) =>
    d.direction === 'keep' ? `Hold the length, just reshape. Land at ${d.targetSpec}.`
    : d.direction === 'take_down' ? `Take it ${d.amount}. Land at ${d.targetSpec}.`
    : `Growing this out — leave it, dust the ends only. Target ${d.targetSpec} once it's in.`;

  const zoneFor = (id: 'top' | 'sides' | 'back', technique: string): BarberZone => {
    const d = byZone[id];
    return {
      zone: id,
      label: ZONE_LABELS[id],
      move: moveFor(d),
      technique: d.direction === 'grow_out' ? 'leave & dust' : technique,
      spec: d.targetSpec,
      confidence: d.confidence,
      ...(d.direction === 'grow_out' ? { growOut: true } : {}),
      ...(d.inferredBaseline ? { inferredBaseline: true } : {}),
    };
  };

  const askParts: string[] = [];
  if (byZone.sides.direction !== 'grow_out') askParts.push(`${byZone.sides.targetSpec} on the sides with a ${taperRead}`);
  if (byZone.top.direction !== 'grow_out') askParts.push(`${byZone.top.targetSpec} on top`);
  if (byZone.back.direction === 'grow_out') askParts.push('leave the back, I\u2019m growing it');
  else if (byZone.back.direction === 'keep') askParts.push('back stays as-is');
  askParts.push(`${finishRead} finish`);

  const color = feas?.color
    ? {
        shadeFamily: feas.color.shadeFamily,
        mode: (feas.color.isGreyBlendCandidate ? 'blend' : 'full') as 'blend' | 'full',
        serviceNote: feas.color.serviceNote,
        askFor: feas.color.isGreyBlendCandidate
          ? `A grey blend, ${feas.color.shadeFamily} family — blend it, don\u2019t fully cover.`
          : `Color to a ${feas.color.shadeFamily} — even coverage.`,
      }
    : undefined;

  return {
    styleName: styleName.charAt(0).toUpperCase() + styleName.slice(1),
    hairRead: {
      pattern: hairType,
      density: 'medium',
      note: 'Read from style settings — confirm texture in the chair.',
    },
    zones: [
      zoneFor('top', 'scissor over comb'),
      zoneFor('sides', 'clipper over comb'),
      zoneFor('back', 'clipper work'),
      { zone: 'edges', label: ZONE_LABELS.edges, move: `Blend with a ${taperRead}. Natural neckline unless asked.`, technique: 'taper/fade blend', spec: taperRead, confidence: 0.8 },
      { zone: 'finish', label: ZONE_LABELS.finish, move: `Style it ${finishRead}. ${capitalize(product)} — ${holdShine}.`, technique: 'blow dry & style', spec: finishRead, confidence: 0.75 },
    ],
    neckline: 'natural',
    askFor: `Give me a ${styleName}: ${askParts.join(', ')}.`,
    maintenance: 'Tight again in 3–4 weeks.',
    ...(color ? { color } : {}),
    ...(feas?.growOutPlan?.length ? { growOutPlan: feas.growOutPlan } : {}),
  };
}

// ── Special tickets (no LLM involved) ───────────────────────────────

/** One-length buzz or full shave — the simplest order there is. */
export function buildBuzzOrder(ctx: OrderComputedContext, profile: UserHeadProfile, feas?: FeasibilityReport): BarberOrder {
  const params = profile.currentStyle.params;
  const bald = [params.topLength, params.sideLength, params.backLength].every(v => v <= 0.03);
  const spec = bald ? 'skin, no guard' : '#1 all over';
  const move = bald
    ? 'Clippers no guard against the grain, then razor or foil to finish.'
    : 'One guard all over, against the grain. Even everywhere.';
  const zone = (id: BarberZoneId): BarberZone => ({
    zone: id, label: ZONE_LABELS[id], move, technique: bald ? 'razor finish' : 'clipper, no blend', spec, confidence: 0.95,
  });
  return {
    styleName: bald ? 'Full Shave' : 'Buzz Cut',
    hairRead: { pattern: profile.currentStyle.hairType, density: 'n/a at this length', note: 'Texture doesn\u2019t matter at this length.' },
    zones: [
      zone('top'), zone('sides'), zone('back'),
      { zone: 'edges', label: ZONE_LABELS.edges, move: bald ? 'Razor the hairline edges clean.' : 'Crisp line-up, square or natural — your call.', technique: 'line-up', spec: bald ? 'razor clean' : 'line-up', confidence: 0.92 },
      { zone: 'finish', label: ZONE_LABELS.finish, move: bald ? 'Moisturizer or scalp balm, no product needed.' : 'Nothing needed. Maybe a matte balm.', technique: 'none', spec: 'no product', confidence: 0.95 },
    ],
    neckline: 'natural',
    askFor: bald ? 'Shave it all the way down — clippers then razor.' : 'A number one all over, clean up the edges.',
    maintenance: bald ? 'Every 1–2 weeks to keep it smooth.' : 'Every 2–3 weeks.',
    ...(feas?.color ? { color: { shadeFamily: feas.color.shadeFamily, mode: feas.color.isGreyBlendCandidate ? 'blend' : 'full', serviceNote: feas.color.serviceNote, askFor: `Color to ${feas.color.shadeFamily}.` } } : {}),
  };
}

/** Same haircut → no receipt; this is the optional clean-up ticket. */
export function buildMaintenanceOrder(ctx: OrderComputedContext, profile: UserHeadProfile): BarberOrder {
  const base = buildFallbackOrder(ctx, profile);
  return {
    ...base,
    styleName: 'Maintenance — Same Cut',
    zones: base.zones.map(z =>
      z.zone === 'edges'
        ? { ...z, move: `Tighten the ${ctx.taperRead}, clean the neckline and edges.`, confidence: 0.9 }
        : z.zone === 'finish'
        ? z
        : { ...z, move: `Same length — just reshape and tidy. ${z.spec}.`, confidence: Math.max(z.confidence, 0.85) },
    ),
    askFor: `Same cut, just tighten it up — clean the edges and the ${ctx.taperRead}, same lengths everywhere.`,
    maintenance: 'You\u2019re in the maintenance window — every 3–4 weeks keeps it like this.',
  };
}

// ── Plaintext formatter (clipboard / fallback rendering) ────────────
export function formatBarberOrderText(order: BarberOrder, ticketNo: string): string {
  const lines: string[] = [
    'SHAPE UP — BARBER\u2019S ORDER',
    `ticket ${ticketNo}`,
    '',
    `THE CUT: ${order.styleName}`,
    `HAIR READ: ${order.hairRead.pattern} · ${order.hairRead.density} density`,
    order.hairRead.note,
    '',
  ];
  for (const z of order.zones) {
    const flags = [
      z.growOut ? 'GROWING OUT' : null,
      z.inferredBaseline ? 'back read estimated' : null,
    ].filter(Boolean).join(' · ');
    lines.push(`${z.label} — ${z.spec}  [${Math.round(z.confidence * 100)}%]${flags ? `  (${flags})` : ''}`);
    lines.push(`  ${z.move}`);
    lines.push(`  technique: ${z.technique}`);
    lines.push('');
  }
  lines.push(`NECKLINE: ${order.neckline}`);
  if (order.color) {
    lines.push('');
    lines.push(`COLOR — ${order.color.shadeFamily} (${order.color.mode === 'blend' ? 'blend' : 'full coverage'})`);
    lines.push(`  ${order.color.serviceNote}`);
    lines.push(`  say: "${order.color.askFor}"`);
  }
  if (order.growOutPlan?.length) {
    lines.push('');
    lines.push('GROW-OUT PLAN:');
    for (const g of order.growOutPlan) {
      lines.push(
        `  ${g.zone}: target ${g.targetSpec}` +
        (g.inchesNeeded !== null ? ` — ~${g.inchesNeeded}\u2033 to go (\u2248${g.weeksEstimate} wks)` : ' — leave it growing'),
      );
    }
  }
  lines.push('');
  lines.push(`SAY THIS IN THE CHAIR:`);
  lines.push(`"${order.askFor}"`);
  lines.push('');
  lines.push(`MAINTENANCE: ${order.maintenance}`);
  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
