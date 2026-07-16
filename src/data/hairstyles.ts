// ============================================================
// The hairstyle catalog — the single source of truth for the 52 cuts.
//
// These labels used to live as two private arrays in EditPanel, while their
// prose descriptions lived only inside scripts/generate-hair-previews.mjs (the
// batch job that renders public/hair-previews/<slug>.png). Two surfaces needed
// both halves — the studio's trending chips and the barber card's style menu —
// so the catalog moved here and both halves travel together.
//
// The `desc` strings are the exact prompts the preview art was generated from,
// so they describe what is actually in the PNG. hairstyles.test.ts pins the
// catalog to the files on disk; if you add a cut here, run
// `node scripts/generate-hair-previews.mjs` or that test goes red.
// ============================================================

export type Gender = 'mens' | 'womens';

export interface Hairstyle {
  /** Filename-safe key: the `/hair-previews/<slug>.png` art and the `?cut=` param. */
  slug: string;
  /** The human label, and the prompt fragment the studio sends to the image model. */
  label: string;
  /** What the cut actually looks like — used as the preview art's generation prompt. */
  desc: string;
  gender: Gender;
}

/**
 * Filename-safe slug for a cut label. MUST stay in lockstep with the `slug()`
 * in scripts/generate-hair-previews.mjs, or labels stop resolving to their art.
 */
export function slugForCut(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── per-cut descriptors (keys mirror scripts/generate-hair-previews.mjs) ──
const MENS: Record<string, string> = {
  'low taper fade, textured fringe': 'Short textured top swept slightly forward into a soft fringe over the forehead; sides and back blended down in a low taper fade.',
  'textured crop, skin fade': 'Choppy, piece-y cropped top with a blunt textured fringe; sides taken down to bare skin in a high skin fade.',
  'modern mullet, faded sides': 'Short faded sides with length kept at the back falling onto the nape; disconnected, edgy mullet shape with textured top.',
  'blowout taper': 'Voluminous top blown up and back for height and lift; tapered sides, rounded full crown silhouette.',
  'edgar cut, high fade': 'Blunt straight-across fringe sitting flat on the forehead, flat dense top; high fade up the sides.',
  'wolf cut, light layers': 'Shaggy layered top with feathered, slightly spiky pieces; medium length with soft wispy layers framing the sides.',
  'curtain fringe, mid fade': 'Center-parted curtain bangs sweeping to both sides of the forehead; medium-length top with a mid fade on the sides.',
  'comma hair, low taper': 'Soft top styled forward into curved comma-shaped strands over the forehead; clean low taper on the sides.',
  'afro taper, sponge curls': 'Dense tight sponge-twist curls on top forming a rounded afro shape; tapered sides and clean neckline.',
  'two block, soft layers': 'Fuller soft-layered top with length over the ears, undercut disconnected shorter sides and back (Korean two-block).',
  'slick back undercut': 'Medium-length top slicked straight back with shine and flow; sharply disconnected shorter undercut sides.',
  'side part pompadour': 'High voluminous pompadour swept up and back from a defined hard side part; tapered sides.',
  'french crop, hard part': 'Short blunt fringe with a textured cropped top and a razored hard part line; clean tapered sides.',
  'mid taper with waves': 'Short 360 waves pattern across the top with visible wave definition; mid taper fade on the sides.',
  'buzz cut, clean line-up': 'Very short even all-over buzz cut; sharp defined hairline and line-up at the temples and forehead.',
  'fluffy crop, low fade': 'Soft fluffy voluminous cropped top with airy texture; low fade on the sides.',
  'wavy perm, middle part': 'Loose permed waves through a medium-length top parted down the middle into soft curtains; tapered sides, natural tousled movement.',
  'broccoli perm, taper fade': 'Tight short permed curls packed densely on top forming a rounded dome of curls; clean taper fade on the sides and back.',
  'textured mod, fringe': 'Medium-length mod cut with a full textured fringe brushed forward over the forehead, blunt rounded perimeter, soft movement over the ears.',
  'k-pop perm, curtain bangs': 'Soft airy Korean-style perm with loose S-curls and center-parted curtain bangs; light volume, fluffy natural finish, tapered sides.',
  'burst fade, textured fringe': 'Choppy textured top falling into a forward fringe; a burst fade curving around the ear, leaving a little length at the back nape.',
  'bro flow, swept back': 'Medium-to-long flowing hair swept up and back off the forehead with natural body, length reaching the nape and tucking behind the ears.',
  'twist out, taper': 'Defined coily twist-out curls on top with springy separated curl clumps; clean taper fade and a sharp lined-up hairline.',
  'caesar cut, textured fringe': 'Short uniform top brushed forward into a short blunt horizontal fringe across the forehead; textured piece-y finish, tapered short sides.',
  'spiky eboy, mid fade': 'Piece-y textured top pinched up into soft spikes with a slight forward fringe (e-boy style); mid fade on the sides.',
  'perm mullet, taper fade': 'Permed curly top and crown with curly length kept long at the back over the nape; taper-faded sides — a curly modern mullet.',
};

const WOMENS: Record<string, string> = {
  'long layers, curtain bangs': 'Long flowing hair past the shoulders with soft cascading layers; center-parted curtain bangs framing the face.',
  'collarbone bob, soft waves': 'Collarbone-length one-length bob with loose soft bends and waves through the lengths.',
  'shaggy wolf cut, wispy ends': 'Heavily layered shag with volume at the crown, choppy wispy feathered ends and face-framing pieces.',
  'blunt lob, center part': 'Sleek blunt-cut long bob ending at the shoulders, sharp clean ends, center part.',
  'butterfly layers, face framing': 'Long hair with voluminous shorter top layers and longer bottom layers; bouncy face-framing pieces around the cheeks.',
  'french bob, micro fringe': 'Chin-length rounded French bob with a short blunt micro fringe across the forehead.',
  'beachy waves, long layers': 'Long tousled beachy S-waves with soft long layers.',
  'pixie cut, textured crop': 'Short cropped pixie with textured piece-y top, tapered sides and nape, wispy fringe.',
  'money piece, balayage layers': 'Long layered hair with shaped brighter face-framing front pieces, matte natural finish.',
  'curly shag, volume on top': 'Bouncy defined curls in a shaggy layered shape with maximum volume at the crown, shorter curly layers up top.',
  'sleek straight, middle part': 'Long pin-straight glossy hair with a sharp center part, smooth flat crown.',
  'choppy bixie cut': 'Between a bob and a pixie — short choppy layered cut at the jaw with textured piece-y ends and tousled volume.',
  'feathered layers, side bangs': 'Soft feathered flicked-back layers (70s-style) with long sweeping side bangs framing the face.',
  'voluminous blowout, soft curls': 'Big bouncy blowout with rounded volume, ends curled under and away from the face, glossy smooth body.',
  'half-up bun, loose waves': 'Top section pulled into a half-up bun at the crown, remaining length falling in loose waves.',
  'jellyfish cut, blunt crown': 'Disconnected two-tier cut: blunt rounded short bob layer on top, long straight curtain of hair underneath.',
  'butterfly blowout, curtain bangs': 'Big voluminous butterfly blowout — shorter face-framing top layers flipped back, longer layers beneath, with soft curtain bangs.',
  'birkin layers, wispy bangs': 'Effortless Jane-Birkin-inspired long layers with a tousled lived-in texture and long wispy see-through bangs grazing the brows.',
  'italian bob, blunt ends': 'Chin-to-jaw length rounded Italian bob with thick blunt ends and soft bombshell volume bending under, voluminous and glossy.',
  'octopus cut, choppy layers': 'Short choppy layered crown with long stringy spiky tendril layers underneath — a disconnected short-top, long-bottom shape.',
  'hush cut, curtain bangs': 'Soft low-maintenance hush cut — long hair with gentle face-framing layers that blend into seamless curtain bangs.',
  'C-curl perm, shoulder length': 'Shoulder-length hair with a Korean C-curl perm — ends curled gently inward in a smooth C shape, glossy and bouncy.',
  'spiral perm, voluminous curls': 'Tight defined spiral perm curls with big all-over volume and springy ringlets cascading from crown to ends.',
  'soft body perm, long layers': 'Long layered hair with a soft body-wave perm adding loose relaxed waves and natural fullness through the lengths.',
  'modern shag, micro bangs': 'Heavily layered modern shag with choppy texture and volume up top, paired with short blunt micro baby bangs high on the forehead.',
  'mixie cut, textured pixie': 'A mixie (between a mullet and a pixie) — short textured cropped top and sides with a longer wispy spiky nape, edgy piece-y finish.',
};

function build(descriptors: Record<string, string>, gender: Gender): Hairstyle[] {
  return Object.entries(descriptors).map(([label, desc]) => ({
    slug: slugForCut(label),
    label,
    desc,
    gender,
  }));
}

export const HAIRSTYLES: Hairstyle[] = [...build(MENS, 'mens'), ...build(WOMENS, 'womens')];

const BY_SLUG = new Map(HAIRSTYLES.map((cut) => [cut.slug, cut]));

export function hairstyleBySlug(slug: string): Hairstyle | undefined {
  return BY_SLUG.get(slug);
}

/** True if `slug` names a real cut — the guard for any `?cut=` / stored style slug. */
export function isHairstyleSlug(slug: string): boolean {
  return BY_SLUG.has(slug);
}

/**
 * Trending cuts, by gender — the pools EditPanel's chips page through, and the
 * menu the barber card picks from. Labels only; same shape it had in EditPanel.
 */
export const TRENDING_CUTS: Record<Gender, string[]> = {
  mens: HAIRSTYLES.filter((cut) => cut.gender === 'mens').map((cut) => cut.label),
  womens: HAIRSTYLES.filter((cut) => cut.gender === 'womens').map((cut) => cut.label),
};
