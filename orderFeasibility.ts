// ============================================================
// Order Feasibility — runs BEFORE any LLM call.
//
// A barber order is a physical contract: clippers only remove
// hair. This module classifies the (baseline → target) delta
// into one of five kinds and produces the notices / short-
// circuit cards for everything that should never reach Gemini:
//
//   no_change    → no receipt; optional maintenance mini-ticket
//   buzz         → trivial deterministic ticket, no LLM needed
//   growth_only  → impossible to cut into; grow-out plan instead
//   mixed        → some zones cut, some zones must grow
//   cut          → normal flow, proceed to clarify → Gemini
//
// It also owns the deterministic color read (dye is a salon
// service, never an LLM guess) and geometric contradiction
// checks (fade with sides longer than top, etc.).
// ============================================================

import { UserHeadProfile } from '@/types';
import { OrderComputedContext, ZoneDelta, SILHOUETTE_FACTOR } from './barberOrder';
import { EditReport, reconcileReport } from './editReport';

export type OrderKind = 'no_change' | 'buzz' | 'growth_only' | 'mixed' | 'cut';

export type NoticeSeverity = 'info' | 'warn' | 'block';

export interface OrderNotice {
  id: string;
  severity: NoticeSeverity;
  title: string;
  body: string;
}

export interface GrowOutZonePlan {
  zone: ZoneDelta['zone'];
  targetSpec: string;
  /** Estimated inches of growth still needed (null when unparseable). */
  inchesNeeded: number | null;
  /** Estimated weeks at ~0.5 in / month (null when unparseable). */
  weeksEstimate: number | null;
}

export interface ColorRead {
  requested: boolean;
  fromHex?: string;
  toHex: string;
  shadeFamily: string;       // e.g. "ash blonde", "dark brown"
  isGreyBlendCandidate: boolean;
  serviceNote: string;       // routing copy: salon vs barbershop
}

export interface FeasibilityReport {
  kind: OrderKind;
  notices: OrderNotice[];
  cutZones: ZoneDelta[];
  keepZones: ZoneDelta[];
  growZones: ZoneDelta[];
  growOutPlan: GrowOutZonePlan[];
  color: ColorRead | null;
  /** True when the back baseline is inferred from a front-only scan. */
  backInferred: boolean;
  /** The hair-edit model's own declaration of what it changed, if present. */
  editIntent: EditReport | null;
  /** Back declared 'same' by the edit model while the prior-derived
      measurement moved — forces the back clarify question. */
  backDeclaredSameConflict: boolean;
}

export interface FeasibilityOptions {
  /**
   * Hair color sampled from the original scan texture (hex). Passed by the
   * caller per-request so we don't touch the core schema. If omitted, color
   * changes are only surfaced when `requestedColorHex` is set explicitly.
   */
  baselineColorRGB?: string;
  /** Set when the user's edit prompt explicitly asked for a color change. */
  requestedColorHex?: string;
  /**
   * EDIT_REPORT sidecar from the last hair edit (already sanitized).
   * Drives back intent (unobservable in a frontal photo) and exposes
   * frontal-insensitivity conflicts (declared shorter, measured keep).
   */
  editReport?: EditReport | null;
}

// ── Constants ───────────────────────────────────────────────────────

/** Average scalp hair growth: ~0.5 in / month → 0.125 in / week. */
const GROWTH_IN_PER_WEEK = 0.125;

/** Params at or below this on all three zones = buzz territory. */
const BUZZ_PARAM_MAX = 0.12;
/** Params at or below this = effectively shaved. */
const BALD_PARAM_MAX = 0.03;

/** RGB euclidean distance below which two hair colors read "the same". */
const COLOR_SAME_THRESHOLD = 42;

// ── Spec parsing (inches midpoint from a targetSpec string) ─────────

/**
 * Best-effort midpoint length (inches) from a spec string like
 * "scissor, 1.5–2.5 in", "~1 in", "#3–#4 (10–13 mm)", "skin / #0.5".
 * Returns null when the spec carries no parseable length.
 */
export function specMidInches(spec: string): number | null {
  const s = spec.replace(/–/g, '-');
  const inMatch = s.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*in/);
  if (inMatch) {
    const a = parseFloat(inMatch[1]);
    const b = inMatch[2] ? parseFloat(inMatch[2]) : a;
    return (a + b) / 2;
  }
  const mmMatch = s.match(/\((\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*mm\)/);
  if (mmMatch) {
    return (parseFloat(mmMatch[1]) + parseFloat(mmMatch[2])) / 2 / 25.4;
  }
  if (/skin/i.test(s)) return 0.05;
  if (/#0\.5/.test(s)) return 1.5 / 25.4;
  if (/#1\b/.test(s)) return 3 / 25.4;
  return null;
}

/**
 * Inches of growth needed for a grow_out zone.
 * baseline = estimated / (1 + Δ)  ⇒  needed = target · Δ / (1 + Δ).
 * Uses the target spec's inch midpoint as the absolute anchor since
 * scene units carry no physical scale of their own.
 */
function growthNeeded(delta: ZoneDelta, silhouetteFactor = 1): GrowOutZonePlan {
  const targetIn = specMidInches(delta.targetSpec);
  if (targetIn === null || delta.deltaPct <= 0) {
    return { zone: delta.zone, targetSpec: delta.targetSpec, inchesNeeded: null, weeksEstimate: null };
  }
  const inchesNeeded = targetIn * (delta.deltaPct / (1 + delta.deltaPct));
  // Strand grows ~0.5 in/month, but only `silhouetteFactor` of that shows
  // as visible length on textured hair — curls *look* like they grow slower.
  const visibleGrowthPerWeek = GROWTH_IN_PER_WEEK * Math.max(silhouetteFactor, 0.2);
  const weeks = Math.min(78, Math.max(2, Math.ceil(inchesNeeded / visibleGrowthPerWeek)));
  return {
    zone: delta.zone,
    targetSpec: delta.targetSpec,
    inchesNeeded: Number(inchesNeeded.toFixed(1)),
    weeksEstimate: weeks,
  };
}

// ── Color ───────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(a: string, b: string): number | null {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  return Math.hypot(ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]);
}

/** Rough shade family from hex — good enough for a service ticket. */
export function shadeFamilyFromHex(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'custom shade';
  const [r, g, b] = rgb.map(v => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  if (sat < 0.08) {
    if (l < 0.12) return 'black';
    if (l < 0.45) return 'dark grey';
    if (l < 0.75) return 'silver / grey';
    return 'platinum / white';
  }
  if (h < 20 || h >= 345) return l < 0.35 ? 'auburn' : 'red';
  if (h < 45) return l < 0.18 ? 'black-brown' : l < 0.35 ? 'dark brown' : l < 0.55 ? 'medium brown' : 'light brown / chestnut';
  if (h < 70) return l < 0.5 ? 'golden brown' : 'blonde';
  if (h < 170) return 'fashion green';
  if (h < 260) return 'fashion blue';
  return 'fashion violet / pink';
}

function readColor(profile: UserHeadProfile, opts: FeasibilityOptions): ColorRead | null {
  const toHex = opts.requestedColorHex ?? profile.currentStyle.colorRGB;
  const fromHex = opts.baselineColorRGB;
  if (!fromHex && !opts.requestedColorHex) return null; // nothing to compare against — stay silent
  if (fromHex) {
    const dist = colorDistance(fromHex, toHex);
    if (dist !== null && dist < COLOR_SAME_THRESHOLD && !opts.requestedColorHex) return null;
  }
  const family = shadeFamilyFromHex(toHex);
  const fromFamily = fromHex ? shadeFamilyFromHex(fromHex) : null;
  const isGreyBlendCandidate =
    fromFamily !== null && /grey|silver|platinum/.test(fromFamily) && !/grey|silver|platinum/.test(family);
  return {
    requested: true,
    fromHex,
    toHex,
    shadeFamily: family,
    isGreyBlendCandidate,
    serviceNote: isGreyBlendCandidate
      ? 'Grey blending — ask for a demi-permanent men\u2019s blend (ash-toned, ~5 min process). It softens grey rather than fully covering it.'
      : 'Color is a separate service. Many barbershops don\u2019t do color — call ahead or book a salon/colorist for this part.',
  };
}

// ── Contradiction & geometry checks ─────────────────────────────────

function geometryNotices(profile: UserHeadProfile, ctx: OrderComputedContext): OrderNotice[] {
  const notices: OrderNotice[] = [];
  const p = profile.currentStyle.params;
  const fade = p.taper >= 0.5;

  if (fade && p.sideLength > p.topLength + 0.15) {
    notices.push({
      id: 'fade_sides_longer_than_top',
      severity: 'warn',
      title: 'Unusual combination',
      body: 'This target has a fade with sides longer than the top. A barber can cut it, but it won\u2019t read as a typical fade — worth confirming this is intentional.',
    });
  }
  if (fade && p.sideLength > 1.1) {
    notices.push({
      id: 'fade_on_scissor_length_sides',
      severity: 'warn',
      title: 'Fade needs clipper-length sides',
      body: 'The sides on this target are scissor-length (1.5 in+). A true fade blends from skin/short guards — at this length it becomes a layered taper instead. The ticket will spec it as a taper.',
    });
  }
  return notices;
}

// ── Main analysis ───────────────────────────────────────────────────

export function analyzeOrderFeasibility(
  ctx: OrderComputedContext,
  profile: UserHeadProfile,
  opts: FeasibilityOptions = {},
): FeasibilityReport {
  const notices: OrderNotice[] = [];
  const params = profile.currentStyle.params;
  const editIntent = opts.editReport ?? null;

  // The edit model declaring a color change is evidence enough to surface
  // the color section, even without a sampled baseline color.
  if (editIntent?.colorChanged && !opts.requestedColorHex) {
    opts = { ...opts, requestedColorHex: profile.currentStyle.colorRGB };
  }

  const cutZones = ctx.deltas.filter(d => d.direction === 'take_down');
  const keepZones = ctx.deltas.filter(d => d.direction === 'keep');
  const growZones = ctx.deltas.filter(d => d.direction === 'grow_out');
  const silhouetteFactor = SILHOUETTE_FACTOR[profile.currentStyle.hairType] ?? 1;
  const growOutPlan = growZones.map(d => growthNeeded(d, silhouetteFactor));
  const color = readColor(profile, opts);

  // Back baseline provenance: the scan is front-facing; the back of the
  // current head is always inferred. Target back is exact (it's the model),
  // but any *relative* claim about the back ("down 50%") is soft.
  const backInferred = true;

  // ── Declaration vs measurement (the closed box's confession) ──
  const recon = editIntent ? reconcileReport(editIntent, ctx) : null;
  const backDeclaredSameConflict = recon?.backDeclaredSameConflict ?? false;
  if (recon) {
    for (const zone of recon.unreadZones) {
      // Frontal-insensitivity signature: the edit model says it shortened
      // this zone, but the frontal re-measure barely moved. Most common on
      // the top — "2 inches off" projects backward, edge-on to the camera.
      notices.push({
        id: `intent_${zone}_unread`,
        severity: 'warn',
        title: `The ${zone} may not have changed in the preview`,
        body: `The edit declared the ${zone} shorter, but the re-measured model barely moved — front-facing photos under-read ${zone === 'top' ? 'top length (it projects backward, edge-on to the camera)' : 'this change'}. If the preview doesn\u2019t look shorter, re-run the edit with more specific wording (e.g. \u201ctake the ${zone} down to 2 inches\u201d). The ticket below follows the measured model.`,
      });
    }
    if (backDeclaredSameConflict) {
      notices.push({
        id: 'back_declared_same',
        severity: 'info',
        title: 'Back: edit says unchanged, model disagrees',
        body: 'The edit declared the back untouched, but the reconstructed model moved it — the back is invisible in a frontal photo, so that movement is the 3D model\u2019s guess, not a measurement. Confirm below what you actually want for the back.',
      });
    }
  }

  // Shrinkage caveat: visible length lags strand length on curls.
  if (growOutPlan.length > 0 && profile.currentStyle.hairType !== 'straight') {
    notices.push({
      id: 'curl_shrinkage_growth',
      severity: 'info',
      title: 'Curl shrinkage and the grow-out clock',
      body: profile.currentStyle.hairType === 'curly'
        ? 'The weeks estimate accounts for shrinkage \u2014 curly hair grows at the same rate but shows much less of it. Stretched, you\u2019ll hit the length sooner than it looks in the mirror.'
        : 'The weeks estimate accounts for wave shrinkage \u2014 stretched length arrives a bit sooner than it looks.',
    });
  }

  // 1. Buzz / bald — trivial, no LLM, no clarify.
  const allBuzz = [params.topLength, params.sideLength, params.backLength].every(v => v <= BUZZ_PARAM_MAX);
  if (allBuzz) {
    const bald = [params.topLength, params.sideLength, params.backLength].every(v => v <= BALD_PARAM_MAX);
    notices.push({
      id: 'buzz_simple',
      severity: 'info',
      title: bald ? 'Full shave' : 'One-length buzz',
      body: bald
        ? 'This one\u2019s simple: clippers with no guard, then razor or foil shaver to finish. Any barber can do it.'
        : 'This one\u2019s simple: one guard all over. The ticket below is all you need.',
    });
    if (color) notices.push(colorNotice(color));
    return { kind: 'buzz', notices: [...notices, ...geometryNotices(profile, ctx)], cutZones, keepZones, growZones, growOutPlan, color, backInferred, editIntent, backDeclaredSameConflict };
  }

  // 2. No change — same haircut, no receipt.
  if (cutZones.length === 0 && growZones.length === 0 && !color) {
    notices.push({
      id: 'no_change',
      severity: 'info',
      title: 'No difference from your current cut',
      body: 'This model matches your current hair. There\u2019s nothing for a barber to change — but you can grab a maintenance ticket (tighten the fade, clean the edges, same lengths everywhere) if you\u2019re due for a clean-up.',
    });
    return { kind: 'no_change', notices, cutZones, keepZones, growZones, growOutPlan, color, backInferred, editIntent, backDeclaredSameConflict };
  }

  // 3. Growth only — physically impossible to cut into.
  if (cutZones.length === 0 && growZones.length > 0) {
    const longestWeeks = Math.max(0, ...growOutPlan.map(g => g.weeksEstimate ?? 0));
    notices.push({
      id: 'growth_only',
      severity: 'block',
      title: 'This cut needs more hair than you have',
      body: longestWeeks > 0
        ? `Every changed zone on this model is longer than your current hair — a barber can\u2019t add length. At typical growth (~\u00bd inch a month) you\u2019re roughly ${longestWeeks} weeks out. Here\u2019s the grow-out plan, plus a shape-up ticket to keep it clean on the way.`
        : 'Every changed zone on this model is longer than your current hair — a barber can\u2019t add length. Here\u2019s the grow-out plan, plus a shape-up ticket to keep it clean on the way.',
    });
    if (color) notices.push(colorNotice(color));
    return { kind: 'growth_only', notices, cutZones, keepZones, growZones, growOutPlan, color, backInferred, editIntent, backDeclaredSameConflict };
  }

  // 4. Mixed — cuttable today, but some zones must grow.
  if (growZones.length > 0) {
    const zoneNames = growZones.map(g => g.zone).join(' & ');
    notices.push({
      id: 'mixed_growth',
      severity: 'warn',
      title: `The ${zoneNames} can\u2019t get there today`,
      body: `Your ${zoneNames} ${growZones.length > 1 ? 'are' : 'is'} currently shorter than this target. The ticket marks ${growZones.length > 1 ? 'those zones' : 'that zone'} as \u201cgrowing out — leave it\u201d and cuts everything else. The full look lands once it grows in.`,
    });
  }

  if (color) notices.push(colorNotice(color));

  // Back-of-head honesty notice — only when the back actually changes.
  const backDelta = ctx.deltas.find(d => d.zone === 'back');
  if (backDelta && backDelta.direction !== 'keep') {
    notices.push({
      id: 'back_inferred',
      severity: 'info',
      title: 'Back read is an estimate',
      body: 'Your scan is front-facing, so your current back length is inferred. The target length on the ticket is exact — the \u201chow much comes off\u201d part is approximate. Your barber will see the real starting point in the chair.',
    });
  }

  notices.push(...geometryNotices(profile, ctx));

  return {
    kind: growZones.length > 0 ? 'mixed' : 'cut',
    notices,
    cutZones,
    keepZones,
    growZones,
    growOutPlan,
    color,
    backInferred,
    editIntent,
    backDeclaredSameConflict,
  };
}

function colorNotice(color: ColorRead): OrderNotice {
  return {
    id: 'color_service',
    severity: 'info',
    title: `Color change: ${color.shadeFamily}`,
    body: color.serviceNote,
  };
}
