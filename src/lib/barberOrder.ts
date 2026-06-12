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
//   3. STYLE — the active preset/params (taper, messiness).
//
// Confidence per zone = measurement provenance × delta clarity,
// blended with Gemini's own visual certainty.
// ============================================================

import { HairMeasurementSnapshot, HairParams, UserHeadProfile } from '@/types';

export type BarberZoneId = 'top' | 'sides' | 'back' | 'edges' | 'finish';

export interface BarberZone {
  zone: BarberZoneId;
  label: string;       // printed header, e.g. "THE TOP"
  move: string;        // barber-talk instruction, one or two short sentences
  technique: string;   // single named technique, e.g. "point cutting"
  spec: string;        // hard number, e.g. "#2 into skin" / "~2.5 in"
  confidence: number;  // 0–1
}

export interface BarberOrder {
  styleName: string;            // e.g. "Low Taper, Textured Crop"
  hairRead: {
    pattern: string;            // Andre Walker scale, e.g. "2B · wavy"
    density: string;            // e.g. "medium-high"
    note: string;               // one line on how this hair behaves
  };
  zones: BarberZone[];          // always exactly: top, sides, back, edges, finish
  askFor: string;               // the literal sentence to say in the chair
  maintenance: string;          // e.g. "tight again in 3–4 weeks"
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
}

export interface OrderComputedContext {
  deltas: ZoneDelta[];
  taperRead: string;           // from params.taper
  finishRead: string;          // from params.messiness
  source: HairMeasurementSnapshot['source'];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

const SOURCE_CONFIDENCE: Record<HairMeasurementSnapshot['source'], number> = {
  mesh_bbox: 0.95,        // measured straight off the rendered hair mesh
  scan: 0.9,              // from the original capture
  derived_params: 0.82,   // estimated from style params only
};

export function computeZoneDeltas(profile: UserHeadProfile): OrderComputedContext {
  const snapshot = profile.measurementSnapshot;
  const params = profile.currentStyle.params;
  const baseline = snapshot?.baseline ?? profile.hairMeasurements;
  const estimated = snapshot?.estimated ?? profile.hairMeasurements;
  const source: HairMeasurementSnapshot['source'] = snapshot?.source ?? 'derived_params';

  const zoneDefs = [
    { zone: 'top' as const,   base: baseline.crownHeight, est: estimated.crownHeight, param: params.topLength },
    { zone: 'sides' as const, base: baseline.sideWidth,   est: estimated.sideWidth,   param: params.sideLength },
    { zone: 'back' as const,  base: baseline.backLength,  est: estimated.backLength,  param: params.backLength },
  ];

  const deltas: ZoneDelta[] = zoneDefs.map(({ zone, base, est, param }) => {
    const safeBase = base > 1e-4 ? base : 1e-4;
    const deltaPct = (est - safeBase) / safeBase;
    const direction: ZoneDelta['direction'] =
      Math.abs(deltaPct) < 0.08 ? 'keep' : deltaPct < 0 ? 'take_down' : 'grow_out';

    const pctLabel = Math.round(Math.abs(deltaPct) * 100);
    const amount =
      direction === 'keep' ? 'hold the length'
      : direction === 'take_down' ? `down ~${pctLabel}%`
      : `+${pctLabel}% to grow into`;

    // Borderline deltas (8–15%) are visually ambiguous — dock confidence.
    const ambiguity = Math.abs(deltaPct) > 0.08 && Math.abs(deltaPct) < 0.15 ? 0.08 : 0;
    const confidence = clamp(SOURCE_CONFIDENCE[source] - ambiguity, 0.55, 0.97);

    return {
      zone,
      baseline: Number(safeBase.toFixed(4)),
      estimated: Number(est.toFixed(4)),
      deltaPct: Number(deltaPct.toFixed(3)),
      direction,
      amount,
      targetSpec: specForLength(param, zone),
      confidence: Number(confidence.toFixed(2)),
    };
  });

  return {
    deltas,
    taperRead: taperDescriptor(params.taper),
    finishRead: finishDescriptor(params.messiness),
    source,
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

export function validateBarberOrder(raw: unknown, ctx: OrderComputedContext, profile: UserHeadProfile): BarberOrder {
  const fallback = buildFallbackOrder(ctx, profile);
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;

  const rawZones = Array.isArray(obj.zones) ? (obj.zones as Record<string, unknown>[]) : [];
  const deltaByZone = new Map(ctx.deltas.map(d => [d.zone, d]));

  const zones: BarberZone[] = ZONE_ORDER.map((zoneId) => {
    const fb = fallback.zones.find(z => z.zone === zoneId)!;
    const cand = rawZones.find(z => z.zone === zoneId);
    if (!cand) return fb;
    const deterministic = deltaByZone.get(zoneId as 'top' | 'sides' | 'back')?.confidence ?? 0.78;
    return {
      zone: zoneId,
      label: ZONE_LABELS[zoneId],
      move: cleanString(cand.move, 180, fb.move),
      technique: cleanString(cand.technique, 48, fb.technique),
      spec: cleanString(cand.spec, 48, fb.spec),
      confidence: cleanConfidence(cand.confidence, deterministic),
    };
  });

  const hairRead = (obj.hairRead ?? {}) as Record<string, unknown>;

  return {
    styleName: cleanString(obj.styleName, 60, fallback.styleName),
    hairRead: {
      pattern: cleanString(hairRead.pattern, 32, fallback.hairRead.pattern),
      density: cleanString(hairRead.density, 32, fallback.hairRead.density),
      note: cleanString(hairRead.note, 140, fallback.hairRead.note),
    },
    zones,
    askFor: cleanString(obj.askFor, 220, fallback.askFor),
    maintenance: cleanString(obj.maintenance, 80, fallback.maintenance),
  };
}

// ── Deterministic fallback — the order still prints if Gemini is down ──
export function buildFallbackOrder(ctx: OrderComputedContext, profile: UserHeadProfile): BarberOrder {
  const { deltas, taperRead, finishRead } = ctx;
  const byZone = Object.fromEntries(deltas.map(d => [d.zone, d])) as Record<'top' | 'sides' | 'back', ZoneDelta>;
  const hairType = profile.currentStyle.hairType;
  const preset = profile.currentStyle.preset.replace('_', ' ');

  const moveFor = (d: ZoneDelta) =>
    d.direction === 'keep' ? `Hold the length, just reshape. Land at ${d.targetSpec}.`
    : d.direction === 'take_down' ? `Take it ${d.amount}. Land at ${d.targetSpec}.`
    : `Growing this out — clean it up only, target ${d.targetSpec}.`;

  return {
    styleName: preset.charAt(0).toUpperCase() + preset.slice(1),
    hairRead: {
      pattern: hairType,
      density: 'medium',
      note: 'Read from style settings — confirm texture in the chair.',
    },
    zones: [
      { zone: 'top',   label: ZONE_LABELS.top,    move: moveFor(byZone.top),   technique: 'scissor over comb', spec: byZone.top.targetSpec,   confidence: byZone.top.confidence },
      { zone: 'sides', label: ZONE_LABELS.sides,  move: moveFor(byZone.sides), technique: 'clipper over comb', spec: byZone.sides.targetSpec, confidence: byZone.sides.confidence },
      { zone: 'back',  label: ZONE_LABELS.back,   move: moveFor(byZone.back),  technique: 'clipper work',      spec: byZone.back.targetSpec,  confidence: byZone.back.confidence },
      { zone: 'edges', label: ZONE_LABELS.edges,  move: `Blend with a ${taperRead}. Natural neckline unless asked.`, technique: 'taper/fade blend', spec: taperRead, confidence: 0.8 },
      { zone: 'finish', label: ZONE_LABELS.finish, move: `Style it ${finishRead}. Light product, no shine bombs.`, technique: 'blow dry & style', spec: finishRead, confidence: 0.75 },
    ],
    askFor: `Give me a ${preset}: ${byZone.sides.targetSpec} on the sides with a ${taperRead}, ${byZone.top.targetSpec} on top, ${finishRead} finish.`,
    maintenance: 'Tight again in 3–4 weeks.',
  };
}

// ── Plaintext formatter (clipboard / fallback rendering) ────────────
export function formatBarberOrderText(order: BarberOrder, ticketNo: string): string {
  const lines: string[] = [
    'SHAPE UP — BARBER’S ORDER',
    `ticket ${ticketNo}`,
    '',
    `THE CUT: ${order.styleName}`,
    `HAIR READ: ${order.hairRead.pattern} · ${order.hairRead.density} density`,
    order.hairRead.note,
    '',
  ];
  for (const z of order.zones) {
    lines.push(`${z.label} — ${z.spec}  [${Math.round(z.confidence * 100)}%]`);
    lines.push(`  ${z.move}`);
    lines.push(`  technique: ${z.technique}`);
    lines.push('');
  }
  lines.push(`SAY THIS IN THE CHAIR:`);
  lines.push(`"${order.askFor}"`);
  lines.push('');
  lines.push(`MAINTENANCE: ${order.maintenance}`);
  return lines.join('\n');
}
