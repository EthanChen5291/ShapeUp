import { describe, it, expect, beforeEach } from 'vitest';
import { genderStorageKey, loadGender, saveGender } from './editPanelGender';

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('loadGender', () => {
  it("defaults to 'mens' when nothing is stored", () => {
    expect(loadGender('proj-1', makeStorage())).toBe('mens');
  });

  it('returns the stored choice for the project', () => {
    const store = makeStorage({ [genderStorageKey('proj-1')]: 'womens' });
    expect(loadGender('proj-1', store)).toBe('womens');
  });

  it("treats unknown stored values as 'mens'", () => {
    const store = makeStorage({ [genderStorageKey('proj-1')]: 'garbage' });
    expect(loadGender('proj-1', store)).toBe('mens');
  });

  it("defaults to 'mens' when projectId is missing", () => {
    expect(loadGender(undefined, makeStorage({ 'shapeup-gender:': 'womens' }))).toBe('mens');
  });

  it('keeps separate choices per project', () => {
    const store = makeStorage();
    saveGender('mens', 'proj-1', store);
    saveGender('womens', 'proj-2', store);
    expect(loadGender('proj-1', store)).toBe('mens');
    expect(loadGender('proj-2', store)).toBe('womens');
  });
});

describe('saveGender', () => {
  let store: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    store = makeStorage();
  });

  it('persists the choice under the project key', () => {
    saveGender('womens', 'proj-1', store);
    expect(store._map.get(genderStorageKey('proj-1'))).toBe('womens');
  });

  it('round-trips through loadGender', () => {
    saveGender('womens', 'proj-9', store);
    expect(loadGender('proj-9', store)).toBe('womens');
  });

  it('does nothing when projectId is missing', () => {
    saveGender('womens', undefined, store);
    expect(store._map.size).toBe(0);
  });
});
