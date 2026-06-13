// ============================================================
// Order Clarify — generates up to MAX_QUESTIONS clarifying
// chips for cut/mixed orders, then converts answers into
// STYLE_CONTEXT lines injected into the Gemini prompt.
//
// Questions are deterministically generated — no LLM, no
// ambiguity. Answers never reach the prompt as raw text;
// each value maps to a pre-written STYLE_CONTEXT sentence.
// ============================================================

import { HairPreset, UserHeadProfile } from '@/types';
import { OrderComputedContext } from './barberOrder';
import { FeasibilityReport } from './orderFeasibility';

export interface ClarifyOption {
  value: string;
  label: string;
}

export interface ClarifyQuestion {
  id: string;
  prompt: string;
  options: ClarifyOption[];
  defaultValue: string;
}

/** Presets whose back is deterministically pinned — suppress the back question. */
export const BACK_PINNED_PRESETS: HairPreset[] = ['taper_fade', 'undercut', 'buzz'];

export const MAX_QUESTIONS = 3;

export function buildClarifyQuestions(
  ctx: OrderComputedContext,
  feas: FeasibilityReport,
  profile: UserHeadProfile,
): ClarifyQuestion[] {
  const qs: ClarifyQuestion[] = [];
  const params = profile.currentStyle.params;
  const preset = profile.currentStyle.preset;

  // 1. Fade bottom — when a meaningful fade/taper is in play and cuts exist.
  if (params.taper >= 0.5 && feas.cutZones.length > 0) {
    qs.push({
      id: 'fade_bottom',
      prompt: 'How low should the fade start?',
      options: [
        { value: 'skin', label: 'Skin (cleanest)' },
        { value: 'half', label: '#0.5 (soft low)' },
        { value: 'one',  label: '#1 (subtle)' },
      ],
      defaultValue: params.taper >= 0.75 ? 'skin' : 'half',
    });
  }

  // 2. Borderline top — delta in 8–15% range; visually ambiguous intent.
  const topDelta = ctx.deltas.find(d => d.zone === 'top');
  if (topDelta && Math.abs(topDelta.deltaPct) >= 0.08 && Math.abs(topDelta.deltaPct) < 0.15) {
    qs.push({
      id: 'borderline_top',
      prompt: 'Your hair on the top seems to have changed. Do you want it cut down or just cleaned up?',
      options: [
        { value: 'cut',     label: 'Cut it down' },
        { value: 'cleanup', label: 'Just clean it up' },
      ],
      defaultValue: 'cleanup',
    });
  }

  // 3. Back intent — add only when the preset doesn't pin the back.
  if (qs.length < MAX_QUESTIONS && !BACK_PINNED_PRESETS.includes(preset)) {
    const backDelta = ctx.deltas.find(d => d.zone === 'back');

    if (feas.backDeclaredSameConflict) {
      // Edit model said back was unchanged but the reconstruction moved it —
      // the back is out of frame so we ask rather than assume.
      qs.push({
        id: 'back_intent',
        prompt:
          'Looks like the back of your head may have shifted a bit — it\'s hard to tell since the photo only shows the front. Keep it as-is or have the barber bring it in to match the sides?',
        options: [
          { value: 'leave', label: 'Keep as-is' },
          { value: 'match', label: 'Match the sides' },
        ],
        defaultValue: 'leave',
      });
    } else if (
      backDelta?.direction === 'keep' &&
      feas.cutZones.filter(d => d.zone !== 'back' && Math.abs(d.deltaPct) >= 0.25).length > 0
    ) {
      // Back holds while the sides/top drop significantly.
      qs.push({
        id: 'back_intent',
        prompt: 'Your sides shortened significantly. Should the back of your head match?',
        options: [
          { value: 'match', label: 'Yes, match it' },
          { value: 'leave', label: 'No, keep it' },
        ],
        defaultValue: 'leave',
      });
    }
  }

  // 4. Neckline — if there's still room and the order has cuts.
  if (qs.length < MAX_QUESTIONS && feas.cutZones.length > 0) {
    qs.push({
      id: 'neckline',
      prompt: 'Neckline style?',
      options: [
        { value: 'natural', label: 'Natural (follows hairline)' },
        { value: 'squared', label: 'Squared / blocked' },
        { value: 'tapered', label: 'Tapered / faded out' },
      ],
      defaultValue: 'natural',
    });
  }

  return qs.slice(0, MAX_QUESTIONS);
}

/**
 * Converts clarify answers into STYLE_CONTEXT lines for the Gemini prompt.
 * Only known answer values map to pre-written sentences — raw user text
 * never reaches the prompt.
 */
export function answersToStyleContext(
  qs: ClarifyQuestion[],
  answers: Record<string, string>,
): string[] {
  const lines: string[] = [];

  for (const q of qs) {
    const answer = answers[q.id] ?? q.defaultValue;
    switch (q.id) {
      case 'fade_bottom':
        if (answer === 'skin') lines.push('FADE BOTTOM: skin — start the fade from skin');
        else if (answer === 'half') lines.push('FADE BOTTOM: #0.5 — soft low fade');
        else lines.push('FADE BOTTOM: #1 — subtle taper only');
        break;
      case 'borderline_top':
        if (answer === 'cleanup')
          lines.push('TOP: CLEANUP ONLY — reshape and tidy, no significant length change; treat this zone as keep');
        else
          lines.push('TOP: TAKE IT DOWN — apply the measured delta');
        break;
      case 'back_intent':
        if (answer === 'leave')
          lines.push('BACK: LEFT AS-IS — do not touch the back length; leave it exactly as it is');
        else
          lines.push('BACK: MATCH THE SIDES — take the back down to match the side take-down');
        break;
      case 'neckline':
        if (answer === 'squared') lines.push('NECKLINE: squared / blocked');
        else if (answer === 'tapered') lines.push('NECKLINE: tapered / faded out');
        else lines.push('NECKLINE: natural — follow the hairline');
        break;
    }
  }

  return lines;
}
