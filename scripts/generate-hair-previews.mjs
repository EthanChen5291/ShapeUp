// ============================================================
// generate-hair-previews.mjs
//
// Batch-generates one uniform hairstyle preview per trending cut into
// public/hair-previews/<slug>.png, using the same image model the app
// already uses. Each image shares an identical base spec so the previews
// look like one consistent set — only the hairstyle geometry changes.
//
// Run:  node scripts/generate-hair-previews.mjs
//       node scripts/generate-hair-previews.mjs --force   (regenerate all)
//
// Reads GEMINI_API_KEY from .env.local / .env (or the environment).
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'hair-previews');
const MODEL_NAME = 'gemini-3.1-flash-image-preview';
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 3;
const MAX_RETRIES = 3;

// ── env ──────────────────────────────────────────────────────────────
function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const p = join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}
loadEnv();
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('✗ GEMINI_API_KEY not found in env or .env.local / .env');
  process.exit(1);
}

const slug = (label) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ── the uniform base spec — identical for every image ────────────────
const basePrompt = (headForm) => `A studio product photograph of a smooth, featureless ${headForm} mannequin
head wig display, shown from a 3/4 front angle, head and neck only, centered in frame.
The mannequin is a uniform matte light-grey (#D8D8D8) with NO facial features, NO eyes,
NO nose, NO mouth — a clean abstract head form, like a salon wig stand.

The ONLY subject of interest is the HAIRSTYLE fitted onto the head. Render the hair as a
realistic wig with clearly visible structure, strand flow, and silhouette so the cut's
shape reads instantly.

UNIFORM SPECIFICATION — identical across every image:
- Hair color: medium neutral ash brown (#6B4F3A), matte natural finish, no highlights,
  no dye, no grey. Exactly the same color in every single image.
- Lighting: soft even three-point studio softbox lighting, neutral 5500K white balance,
  gentle shadow under the jaw, no harsh speculars.
- Background: seamless flat studio background, very light cool grey (#F2F3F5), no gradient
  banding, no props, no text, no logos.
- Framing: head occupies ~70% of vertical frame, centered, slight negative space above the
  hair, 3/4 turn to camera-left, eye-line level. Same crop and distance every time.
- Camera: 85mm portrait lens look, clean focus, full hair sharp, f/5.6 equivalent.
- Output: square 1:1, photorealistic, high detail, clean edges, isolated subject. No hands,
  no body, no shoulders below the collar, no jewelry, no clothing, no watermark.

Do NOT add a face. Do NOT change the head color or background between images.
Render ONLY this hairstyle:

HAIRSTYLE: `;

// ── per-cut descriptors (keys MUST match TRENDING_CUTS in EditPanel.tsx) ──
const MENS = {
  'low taper fade, textured fringe': 'Short textured top swept slightly forward into a soft fringe over the forehead; sides and back blended down in a low taper fade that drops close to the skin near the ears and neckline.',
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
  // 2026 teen/young-adult trend additions (incl. perms)
  'wavy perm, middle part': 'Loose permed waves through a medium-length top parted down the middle into soft curtains framing the forehead; tapered sides, natural tousled movement.',
  'broccoli perm, taper fade': 'Tight short permed curls packed densely on top forming a rounded broccoli-like dome of curls; clean taper fade on the sides and back.',
  'textured mod, fringe': 'Medium-length mod cut with a full textured fringe brushed forward over the forehead, blunt rounded perimeter, soft natural movement on the sides over the ears.',
  'k-pop perm, curtain bangs': 'Soft airy Korean-style perm with loose S-curls and center-parted curtain bangs sweeping the forehead; light volume, fluffy natural finish, tapered sides.',
  'burst fade, textured fringe': 'Choppy textured top falling into a forward fringe; a burst fade curving around the ear leaving a little length at the back nape, shortest behind the ear.',
  'bro flow, swept back': 'Medium-to-long flowing hair swept up and back off the forehead with natural body and movement, length reaching the nape and tucking behind the ears, blended natural sides, no fade.',
  'twist out, taper': 'Defined coily twist-out curls on top with springy separated curl clumps; clean taper fade on the sides and a sharp lined-up hairline.',
  'caesar cut, textured fringe': 'Short uniform top brushed forward into a short blunt horizontal fringe across the forehead; textured piece-y finish, tapered short sides.',
  'spiky eboy, mid fade': 'Piece-y textured top pinched up into soft spikes with a slight forward fringe (e-boy style); mid fade on the sides.',
  'perm mullet, taper fade': 'Permed curly top and crown with curly length kept long at the back over the nape; taper-faded sides — a curly modern mullet.',
};

const WOMENS = {
  'long layers, curtain bangs': 'Long flowing hair past the shoulders with soft cascading layers; center-parted curtain bangs framing the face.',
  'collarbone bob, soft waves': 'Collarbone-length one-length bob with loose soft bends and waves through the lengths.',
  'shaggy wolf cut, wispy ends': 'Heavily layered shag with volume at the crown, choppy wispy feathered ends and face-framing pieces.',
  'blunt lob, center part': 'Sleek blunt-cut long bob ending at the shoulders, sharp clean ends, center part.',
  'butterfly layers, face framing': 'Long hair with voluminous shorter top layers and longer bottom layers; bouncy face-framing pieces around the cheeks.',
  'french bob, micro fringe': 'Chin-length rounded French bob with a short blunt micro fringe across the forehead.',
  'beachy waves, long layers': 'Long tousled beachy S-waves with soft long layers.',
  'pixie cut, textured crop': 'Short cropped pixie with textured piece-y top, tapered sides and nape, wispy fringe.',
  'money piece, balayage layers': 'Long layered hair (keep the single ash-brown color — render as soft tonal layers, NOT dyed) with shaped brighter face-framing front pieces, matte natural finish.',
  'curly shag, volume on top': 'Bouncy defined curls in a shaggy layered shape with maximum volume at the crown, shorter curly layers up top.',
  'sleek straight, middle part': 'Long pin-straight glossy hair with a sharp center part, smooth flat crown.',
  'choppy bixie cut': 'Between a bob and pixie — short choppy layered cut at the jaw with textured piece-y ends and tousled volume.',
  'feathered layers, side bangs': 'Soft feathered flicked-back layers (70s-style) with long sweeping side bangs framing the face.',
  'voluminous blowout, soft curls': 'Big bouncy blowout with rounded volume, ends curled under and away from the face, glossy smooth body.',
  'half-up bun, loose waves': 'Top section pulled into a half-up bun at the crown, remaining length falling in loose waves.',
  'jellyfish cut, blunt crown': 'Disconnected two-tier cut: blunt rounded short bob layer on top, long straight curtain of hair underneath.',
  // 2026 teen/young-adult trend additions (incl. perms)
  'butterfly blowout, curtain bangs': 'Big voluminous butterfly blowout — shorter face-framing top layers flipped back away from the face, longer layers beneath, rounded bouncy body, with soft curtain bangs.',
  'birkin layers, wispy bangs': 'Effortless Jane-Birkin-inspired long layers with a tousled lived-in texture and long wispy see-through bangs grazing the brows.',
  'italian bob, blunt ends': 'Chin-to-jaw length rounded Italian bob with thick blunt ends and soft bombshell volume bending under, voluminous and glossy.',
  'octopus cut, choppy layers': 'Short choppy layered crown with long stringy spiky tendril layers underneath (octopus cut) — disconnected short-top, long-bottom shape with piece-y ends.',
  'hush cut, curtain bangs': 'Soft low-maintenance hush cut — long hair with gentle face-framing layers that blend into seamless curtain bangs, airy and barely-there layering.',
  'C-curl perm, shoulder length': 'Shoulder-length hair with a Korean C-curl perm — ends curled gently inward in a smooth C shape with a soft face-framing curve, glossy and bouncy.',
  'spiral perm, voluminous curls': 'Tight defined spiral perm curls with big all-over volume and springy ringlets cascading from crown to ends.',
  'soft body perm, long layers': 'Long layered hair with a soft body-wave perm adding loose relaxed waves and natural fullness through the lengths.',
  'modern shag, micro bangs': 'Heavily layered modern shag with choppy texture and volume up top, paired with short blunt micro baby bangs high on the forehead.',
  'mixie cut, textured pixie': 'A mixie (between a mullet and pixie) — short textured cropped top and sides with a longer wispy spiky nape, edgy piece-y finish.',
};

const JOBS = [
  ...Object.entries(MENS).map(([label, desc]) => ({ label, desc, headForm: 'masculine' })),
  ...Object.entries(WOMENS).map(([label, desc]) => ({ label, desc, headForm: 'feminine' })),
];

// ── generation ───────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: MODEL_NAME,
  generationConfig: { responseModalities: ['IMAGE'] },
});

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

async function generateOne(job) {
  const file = join(OUT_DIR, `${slug(job.label)}.png`);
  if (!FORCE && existsSync(file)) return { label: job.label, status: 'skip' };

  const prompt = basePrompt(job.headForm) + job.desc;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent([prompt]);
      const parts = result.response.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (!img?.data) throw new Error('no image part in response');
      writeFileSync(file, Buffer.from(img.data, 'base64'));
      return { label: job.label, status: 'ok' };
    } catch (err) {
      if (attempt === MAX_RETRIES) return { label: job.label, status: 'fail', error: String(err?.message ?? err) };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function run() {
  console.log(`Generating ${JOBS.length} previews → ${OUT_DIR}\n`);
  const queue = [...JOBS];
  let done = 0;
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      const res = await generateOne(job);
      results.push(res);
      const icon = res.status === 'ok' ? '✓' : res.status === 'skip' ? '·' : '✗';
      console.log(`  ${icon} [${++done}/${JOBS.length}] ${res.label}${res.error ? `  — ${res.error}` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const fails = results.filter((r) => r.status === 'fail');
  console.log(`\nDone. ${results.filter(r => r.status === 'ok').length} generated, ` +
    `${results.filter(r => r.status === 'skip').length} skipped, ${fails.length} failed.`);
  if (fails.length) { console.log('Re-run to retry failures.'); process.exit(1); }
}

run();
