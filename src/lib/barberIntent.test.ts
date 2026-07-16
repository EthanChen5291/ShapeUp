// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureBarberIntentFromUrl,
  clearBarberIntent,
  peekBarberIntent,
  takeBarberCutIntent,
} from './barberIntent';

function land(search: string) {
  Object.defineProperty(window, 'location', {
    value: { search },
    writable: true,
  });
  captureBarberIntentFromUrl();
}

// Node 22 ships its own partial `localStorage`, which shadows jsdom's and has
// no `clear()`. Pin a real Map-backed one so the test doesn't depend on which
// implementation wins.
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, val: string) => void store.set(k, val),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    writable: true,
    configurable: true,
  });
  clearBarberIntent();
});

describe('captureBarberIntentFromUrl', () => {
  it('stashes the cut and the barber who sent them', () => {
    land('?ref=ABC123&cut=burst-fade-textured-fringe&b=marcus');
    expect(peekBarberIntent()).toEqual({
      cut: 'burst-fade-textured-fringe',
      page: 'marcus',
    });
  });

  it('keeps the cut even when the barber page is absent', () => {
    land('?cut=blowout-taper');
    expect(peekBarberIntent()).toEqual({ cut: 'blowout-taper', page: undefined });
  });

  it('does nothing when there is no cut in the URL', () => {
    land('?ref=ABC123');
    expect(peekBarberIntent()).toBeUndefined();
  });

  // The value selects a chip and is echoed into the UI, so an unrecognized slug
  // is never worth storing.
  it('drops a cut slug that is not in the catalog', () => {
    land('?cut=../../etc/passwd&b=marcus');
    expect(peekBarberIntent()).toBeUndefined();
    land('?cut=not-a-real-cut');
    expect(peekBarberIntent()).toBeUndefined();
  });
});

describe('takeBarberCutIntent', () => {
  it('returns the intent once, then forgets it', () => {
    land('?cut=blowout-taper&b=marcus');
    expect(takeBarberCutIntent()).toEqual({ cut: 'blowout-taper', page: 'marcus' });
    // A project the user starts next week must not inherit this.
    expect(takeBarberCutIntent()).toBeUndefined();
    expect(peekBarberIntent()).toBeUndefined();
  });
});
