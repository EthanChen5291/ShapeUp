// ============================================================
// Preset hairstyles — the FREE "try-on" library
// ------------------------------------------------------------
// Free users can try pre-baked hairstyles on top of their own
// scan before spending a token. Each look is a hair-only Gaussian
// splat (.splat) that OVERLAYS the user's head splat at a fixed
// scale/rotation/position (see HairScene PREBAKE_OVERLAY).
//
// A "cut" is a base style (e.g. Middle Part) that ships in one or
// more hair colors. A user only gets their own hair color for free
// — the other colors are a paid-plan perk (no tokens, just a plan).
//
// Files live in /public/prebake/<gender>/<cut>_<color>.splat
// ============================================================

export type HairColor = 'black' | 'brown' | 'blonde';
export type PresetGender = 'man' | 'woman';

export const HAIR_COLOR_LABEL: Record<HairColor, string> = {
  black: 'Black',
  brown: 'Brown',
  blonde: 'Blonde',
};

// Swatch used for the little color dot in the UI.
export const HAIR_COLOR_SWATCH: Record<HairColor, string> = {
  black: '#2b2622',
  brown: '#5a3a22',
  blonde: '#c9a05a',
};

export interface PresetVariant {
  /** Stable id — `${cutId}_${colorKey}`. */
  id: string;
  color: HairColor;
  /** Display label, e.g. "Blonde" or "Blonde 2". */
  label: string;
  splatUrl: string;
}

export interface HairCut {
  id: string;
  name: string;
  blurb?: string;
  variants: PresetVariant[];
}

export interface PresetCategory {
  id: PresetGender;
  label: string;
  tagline: string;
  cuts: HairCut[];
}

const MEN_DIR = '/prebake/men';

function variant(cutId: string, file: string, color: HairColor, label: string): PresetVariant {
  return { id: `${cutId}_${file}`, color, label, splatUrl: `${MEN_DIR}/${file}.splat` };
}

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    id: 'man',
    label: "Men's",
    tagline: 'Fades, crops & classic cuts',
    cuts: [
      {
        id: 'middlepart',
        name: 'Middle Part',
        blurb: 'soft centre part',
        variants: [
          variant('middlepart', 'middlepart_black', 'black', 'Black'),
          variant('middlepart', 'middlepart_brown', 'brown', 'Brown'),
          variant('middlepart', 'middlepart_blonde', 'blonde', 'Blonde'),
          variant('middlepart', 'middlepart_blonde2', 'blonde', 'Blonde 2'),
        ],
      },
      {
        id: 'topshort',
        name: 'Short Crop',
        blurb: 'tidy short top',
        variants: [
          variant('topshort', 'topshort_black', 'black', 'Black'),
          variant('topshort', 'topshort_brown', 'brown', 'Brown'),
          variant('topshort', 'topshort_blonde', 'blonde', 'Blonde'),
        ],
      },
      {
        id: 'topcurl',
        name: 'Curly Top',
        blurb: 'volume on top',
        variants: [
          variant('topcurl', 'topcurl_blonde', 'blonde', 'Blonde'),
        ],
      },
      {
        id: 'dreads',
        name: 'Dreads',
        blurb: 'rope locs',
        variants: [
          variant('dreads', 'dreads_black', 'black', 'Black'),
        ],
      },
    ],
  },
  {
    id: 'woman',
    label: "Women's",
    tagline: 'Layers, lobs & waves — coming soon',
    cuts: [],
  },
];

export function getCategory(id: PresetGender): PresetCategory | undefined {
  return PRESET_CATEGORIES.find((c) => c.id === id);
}

// Pick the variant to feature for a cut given the user's hair color: prefer a
// matching color, otherwise fall back to the cut's first variant.
export function primaryVariant(cut: HairCut, userColor: HairColor): PresetVariant {
  return cut.variants.find((v) => v.color === userColor) ?? cut.variants[0];
}

// ── Hair-color classification ──────────────────────────────
// Map a hex hair color (profile.currentStyle.colorRGB) to one of our three
// preset buckets by luminance: very dark → black, very light/warm → blonde,
// everything in between → brown.
export function classifyHairColor(hex: string | undefined | null): HairColor {
  if (!hex) return 'brown';
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 'brown';
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  // Perceived luminance (0–255).
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 70) return 'black';
  if (lum > 150) return 'blonde';
  return 'brown';
}
