import { describe, expect, it } from 'vitest';
import { judgeSelfie, type SelfieMetrics } from './selfieCheck';

/** A comfortably good selfie: bright enough, face centered and mid-sized. */
function good(overrides: Partial<SelfieMetrics> = {}): SelfieMetrics {
  return {
    width: 1080,
    height: 1440,
    meanLuma: 130,
    clippedDark: 0.02,
    clippedBright: 0.02,
    face: { x: 300, y: 400, width: 480, height: 560 },
    ...overrides,
  };
}

describe('judgeSelfie', () => {
  it('passes a well-lit, well-framed selfie', () => {
    expect(judgeSelfie(good())).toEqual({ level: 'ok', message: 'Photo looks good' });
  });

  it('fails a tiny image before looking at anything else', () => {
    const verdict = judgeSelfie(good({ width: 240, height: 320, face: null }));
    expect(verdict).toEqual({ level: 'fail', message: 'Move slightly closer' });
  });

  it('fails a photo that is too dark', () => {
    expect(judgeSelfie(good({ meanLuma: 30 }))).toEqual({ level: 'fail', message: 'Use even lighting' });
    expect(judgeSelfie(good({ clippedDark: 0.7 })).level).toBe('fail');
  });

  it('only warns on a blown-out photo — the model can often still work with it', () => {
    expect(judgeSelfie(good({ meanLuma: 230 }))).toEqual({ level: 'warn', message: 'Use even lighting' });
    expect(judgeSelfie(good({ clippedBright: 0.6 })).level).toBe('warn');
  });

  it('fails when detection ran and found no face', () => {
    expect(judgeSelfie(good({ face: null }))).toEqual({ level: 'fail', message: 'Face the camera' });
  });

  it('skips face rules entirely when detection was unavailable', () => {
    expect(judgeSelfie(good({ face: undefined }))).toEqual({ level: 'ok', message: 'Photo looks good' });
  });

  it('fails a face that is too small in frame', () => {
    const verdict = judgeSelfie(good({ face: { x: 480, y: 600, width: 120, height: 140 } }));
    expect(verdict).toEqual({ level: 'fail', message: 'Move slightly closer' });
  });

  it('warns when the face nearly fills the frame', () => {
    const verdict = judgeSelfie(good({ face: { x: 20, y: 300, width: 900, height: 1000 } }));
    expect(verdict).toEqual({ level: 'warn', message: 'Keep your full head in frame' });
  });

  it('fails when the face box is pressed against the top edge (hairline cropped)', () => {
    const verdict = judgeSelfie(good({ face: { x: 300, y: 10, width: 480, height: 560 } }));
    expect(verdict).toEqual({ level: 'fail', message: 'Hairline not visible' });
  });

  it('warns when the head sits high enough that hair may be clipped', () => {
    const verdict = judgeSelfie(good({ face: { x: 300, y: 100, width: 480, height: 560 } }));
    expect(verdict).toEqual({ level: 'warn', message: 'Keep your full head in frame' });
  });
});
