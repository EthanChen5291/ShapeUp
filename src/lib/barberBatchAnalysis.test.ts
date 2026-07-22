import { describe, expect, test } from 'vitest';
import {
  BARBER_BATCH_STYLE_COUNT,
  buildBarberAnalysisPrompt,
  MAX_BARBER_ANALYSIS_OUTPUT_CHARS,
  MAX_BARBER_STYLE_PROMPT_CHARS,
  parseBarberBatchAnalysis,
} from './barberBatchAnalysis';

function acceptedOutput(styleCount = BARBER_BATCH_STYLE_COUNT) {
  return JSON.stringify({
    ok: true,
    hairProfile: {
      curlClass: '3b',
      lengthInches: { top: 4.25, sides: 2, back: 2.5 },
      density: 'high',
      hairline: { state: 'mature', notes: 'Slight recession at both temples.' },
      growthPatterns: ['Clockwise crown whorl'],
      faceShape: 'oval',
      barberNotes: 'Keep enough temple weight to soften the corners.',
    },
    styles: Array.from({ length: styleCount }, (_, idx) => ({
      title: `Style Number ${idx} Extra Words`,
      prompt: `Cut style ${idx} with 3 inches on top and a low taper.`,
      why: `Balances the face while respecting the crown growth pattern number ${idx} today`,
    })),
  });
}

describe('buildBarberAnalysisPrompt', () => {
  test('flips only the settled texture-service constraint', () => {
    const sameTexture = buildBarberAnalysisPrompt(false);
    expect(sameTexture).toContain('SAME TEXTURE ONLY');
    expect(sameTexture).toContain('Never add curl or wave');
    expect(sameTexture).not.toContain('TEXTURE SERVICES AVAILABLE');

    const transformations = buildBarberAnalysisPrompt(true);
    expect(transformations).toContain('TEXTURE SERVICES AVAILABLE');
    expect(transformations).toContain('Texture transformations are allowed');
    expect(transformations).not.toContain('SAME TEXTURE ONLY');
  });
});

describe('parseBarberBatchAnalysis', () => {
  test('rejects malformed and oversized output', () => {
    expect(parseBarberBatchAnalysis('{not json')).toBeNull();
    expect(parseBarberBatchAnalysis('x'.repeat(MAX_BARBER_ANALYSIS_OUTPUT_CHARS + 1))).toBeNull();
  });

  test('takes the first eight styles and assigns stable indexes', () => {
    const parsed = parseBarberBatchAnalysis(acceptedOutput(11));
    expect(parsed?.ok).toBe(true);
    if (!parsed?.ok) throw new Error('expected accepted analysis');
    expect(parsed.items).toHaveLength(BARBER_BATCH_STYLE_COUNT);
    expect(parsed.items.map((item) => item.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('rejects accepted output with fewer than eight usable styles', () => {
    expect(parseBarberBatchAnalysis(acceptedOutput(7))).toBeNull();
  });

  test('truncates hostile over-long strings and word-limited fields', () => {
    const value = JSON.parse(acceptedOutput()) as {
      hairProfile: { barberNotes: string };
      styles: Array<{ title: string; prompt: string; why: string }>;
    };
    value.hairProfile.barberNotes = 'n'.repeat(2_000);
    value.styles[0] = {
      title: 'one two three four five six',
      prompt: 'p'.repeat(2_000),
      why: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen',
    };

    const parsed = parseBarberBatchAnalysis(JSON.stringify({ ok: true, ...value }));
    expect(parsed?.ok).toBe(true);
    if (!parsed?.ok) throw new Error('expected accepted analysis');
    expect(parsed.hairProfile.barberNotes).toHaveLength(240);
    expect(parsed.items[0].title).toBe('one two three four');
    expect(parsed.items[0].prompt).toHaveLength(MAX_BARBER_STYLE_PROMPT_CHARS);
    expect(parsed.items[0].why?.split(' ')).toHaveLength(12);
  });

  test('bounds a rejection reason to the gate contract', () => {
    const parsed = parseBarberBatchAnalysis(JSON.stringify({
      ok: false,
      reason: 'Move closer and remove the hat so both temples and the complete hairline are clearly visible in even light now',
    }));
    expect(parsed).toEqual({
      ok: false,
      reason: 'Move closer and remove the hat so both temples and the complete hairline are clearly',
    });
  });
});
