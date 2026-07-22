export const BARBER_BATCH_STYLE_COUNT = 8;
export const MAX_BARBER_ANALYSIS_OUTPUT_CHARS = 64 * 1024;
export const MAX_BARBER_STYLE_PROMPT_CHARS = 500;

const MAX_REASON_CHARS = 160;
const MAX_TITLE_CHARS = 80;
const MAX_WHY_CHARS = 160;
const MAX_PROFILE_TEXT_CHARS = 240;

export type BarberHairProfile = {
  curlClass: string;
  lengthInches: {
    top: number;
    sides: number;
    back: number;
  };
  density: 'low' | 'med' | 'high';
  hairline: {
    state: 'intact' | 'mature' | 'receding';
    notes?: string;
  };
  growthPatterns: string[];
  faceShape: string;
  barberNotes?: string;
};

export type BarberBatchStyle = {
  idx: number;
  title: string;
  prompt: string;
  why?: string;
};

export type BarberBatchAnalysis =
  | { ok: false; reason: string }
  | { ok: true; hairProfile: BarberHairProfile; items: BarberBatchStyle[] };

function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
    .trim();
}

function cleanWords(value: unknown, maxWords: number, maxChars: number): string {
  return cleanText(value, maxChars * 2)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ')
    .slice(0, maxChars)
    .trim();
}

function optionalText(value: unknown, maxChars = MAX_PROFILE_TEXT_CHARS): string | undefined {
  const cleaned = cleanText(value, maxChars);
  return cleaned || undefined;
}

function boundedLength(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.min(30, Math.max(0, value)) * 100) / 100;
}

function sanitizeHairProfile(value: unknown): BarberHairProfile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Record<string, unknown>;
  const lengths = profile.lengthInches;
  const hairline = profile.hairline;
  if (!lengths || typeof lengths !== 'object' || !hairline || typeof hairline !== 'object') {
    return null;
  }

  const curlClass = cleanText(profile.curlClass, 8).toUpperCase();
  if (!/^[1-4][ABC]$/.test(curlClass)) return null;

  const lengthObject = lengths as Record<string, unknown>;
  const top = boundedLength(lengthObject.top);
  const sides = boundedLength(lengthObject.sides);
  const back = boundedLength(lengthObject.back);
  if (top === null || sides === null || back === null) return null;

  const density = profile.density;
  if (density !== 'low' && density !== 'med' && density !== 'high') return null;

  const hairlineObject = hairline as Record<string, unknown>;
  const hairlineState = hairlineObject.state;
  if (hairlineState !== 'intact' && hairlineState !== 'mature' && hairlineState !== 'receding') {
    return null;
  }

  const faceShape = cleanText(profile.faceShape, 80);
  if (!faceShape) return null;

  const growthPatterns = Array.isArray(profile.growthPatterns)
    ? profile.growthPatterns
        .map((entry) => cleanText(entry, 120))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    curlClass,
    lengthInches: { top, sides, back },
    density,
    hairline: {
      state: hairlineState,
      ...(optionalText(hairlineObject.notes) ? { notes: optionalText(hairlineObject.notes) } : {}),
    },
    growthPatterns,
    faceShape,
    ...(optionalText(profile.barberNotes) ? { barberNotes: optionalText(profile.barberNotes) } : {}),
  };
}

function extractJsonObject(raw: string): string | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  return stripped.slice(firstBrace, lastBrace + 1);
}

/** Parse and bound model output before it is persisted or used as an edit prompt. */
export function parseBarberBatchAnalysis(raw: string | undefined | null): BarberBatchAnalysis | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_BARBER_ANALYSIS_OUTPUT_CHARS) {
    return null;
  }
  const json = extractJsonObject(raw);
  if (!json) return null;

  let value: unknown;
  try {
    value = JSON.parse(json.replace(/[\x00-\x1f\x7f]/g, ' '));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;

  if (result.ok === false) {
    const reason = cleanWords(result.reason, 15, MAX_REASON_CHARS);
    return reason ? { ok: false, reason } : null;
  }
  if (result.ok !== true) return null;

  const hairProfile = sanitizeHairProfile(result.hairProfile);
  if (!hairProfile || !Array.isArray(result.styles) || result.styles.length < BARBER_BATCH_STYLE_COUNT) {
    return null;
  }

  const items: BarberBatchStyle[] = [];
  for (const [idx, candidate] of result.styles.slice(0, BARBER_BATCH_STYLE_COUNT).entries()) {
    if (!candidate || typeof candidate !== 'object') return null;
    const style = candidate as Record<string, unknown>;
    const title = cleanWords(style.title, 4, MAX_TITLE_CHARS);
    const prompt = cleanText(style.prompt, MAX_BARBER_STYLE_PROMPT_CHARS);
    const why = cleanWords(style.why, 12, MAX_WHY_CHARS);
    if (!title || !prompt) return null;
    items.push({ idx, title, prompt, ...(why ? { why } : {}) });
  }

  return { ok: true, hairProfile, items };
}

export function buildBarberAnalysisPrompt(offersPerms: boolean): string {
  const textureConstraint = offersPerms
    ? `TEXTURE SERVICE CONSTRAINT — TEXTURE SERVICES AVAILABLE
- Texture transformations are allowed. Encourage a perm, relaxer, or other texture service when it genuinely improves fit.
- Still describe the target texture precisely and keep every length recommendation feasible for the current hair.`
    : `TEXTURE SERVICE CONSTRAINT — SAME TEXTURE ONLY
- Propose only cuts achievable at the client's current length or shorter with the photographed texture.
- Never add curl or wave, straighten, relax, perm, or otherwise transform texture.`;

  return `ROLE
You are ShapeUp's master-barber analyst. Inspect one client selfie, reject unusable photos before any paid edits, then recommend eight realistic cuts a barber can execute.

OUTPUT CONTRACT
- Return one strict JSON object only: no markdown, comments, or prose outside JSON.
- On a failed gate return exactly {"ok":false,"reason":"<specific fix, 15 words maximum>"} and stop.
- On success return {"ok":true,"hairProfile":{"curlClass":"1A-4C","lengthInches":{"top":0,"sides":0,"back":0},"density":"low|med|high","hairline":{"state":"intact|mature|receding","notes":"optional"},"growthPatterns":["..."],"faceShape":"...","barberNotes":"optional"},"styles":[{"title":"4 words maximum","prompt":"complete edit instruction","why":"12 words maximum"}]}.
- Return exactly eight styles, ordered from highest to lowest confidence.

1. GATE — DO THIS FIRST
- Confirm the hairline, both temples, natural hair texture, and full face are clearly visible.
- Require usable lighting and reject a hat, heavy filter, severe blur, or obstruction.
- If any required evidence is missing, return ok:false with one specific, fixable reason and STOP.

2. ANALYZE — WRITE FOR A BARBER
- Classify curl pattern from 1A through 4C.
- Estimate current strand length in inches for top, sides, and back. Measure strand length, not silhouette height.
- Record density as low, med, or high.
- Record whether the hairline is intact, mature, or receding and where; note a widow's peak or other skin-adjacent detail a barber needs.
- Record cowlicks, whorls, and other growth-pattern quirks, plus face shape.
- Be concise, practical, and specific. This profile is sent to the barber verbatim.

BARBER-REALISM SCALE AND ZONES
- Use the face as a ruler: chin-to-hairline is approximately 7 inches / 18 cm on an average adult.
- Inches always mean strand length. Straight 1A-1C hair shows nearly full silhouette change; wavy 2A-2C shows roughly one-half to three-quarters; curly/coily 3A-4C is dominated by shrinkage.
- Never confuse curl shrinkage with missing length. For curly/coily hair, describe reduced mass and a reshaped outline instead of an impossible literal drop.
- Use explicit top, sides, back, temple, edge, crown, and nape language. A fade implies sides, back, and edges; a taper changes only the edges unless stated otherwise.
- Work with the existing density, hairline, cowlicks, and whorls. Never expose recession the client is covering or prescribe a shape that fights a growth pattern.

${textureConstraint}

3. PROPOSE EIGHT FEASIBLE STYLES
- Feasibility is a hard constraint: no style may require more hair than is currently present in any relevant zone.
- Balance the face shape and proportions while working with the hairline and growth pattern.
- Diversify silhouettes; never return eight variants of one fade.
- Each title is four words maximum. Each why is one useful line of twelve words maximum.
- Each prompt is a complete, standalone haircut edit instruction. State the affected zones, strand lengths in inches, fade/taper/edge treatment, texture handling, crown/nape intent, and which unmentioned zones stay unchanged.
- The prompt must preserve face geometry, skin, expression, facial hair, camera angle, framing, background, lighting, and photographic realism.`;
}
