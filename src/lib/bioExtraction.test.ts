import { describe, it, expect } from 'vitest';
import { buildBioExtractionMessages, parseBioDetails } from './bioExtraction';

describe('buildBioExtractionMessages', () => {
  it('embeds the bio and forbids invention in the system prompt', () => {
    const { system, user } = buildBioExtractionMessages('Cuts on Telegraph Ave');
    expect(user).toContain('Cuts on Telegraph Ave');
    expect(system.toLowerCase()).toContain('never invent');
  });
});

describe('parseBioDetails', () => {
  it('parses a clean JSON object', () => {
    const out = parseBioDetails(
      JSON.stringify({
        location: 'Telegraph Ave, Oakland',
        hours: 'Tue–Sat · 9–6',
        services: [
          { name: 'Skin fade', price: '$40' },
          { name: 'Beard trim', price: '' },
        ],
      }),
    );
    expect(out.location).toBe('Telegraph Ave, Oakland');
    expect(out.hours).toBe('Tue–Sat · 9–6');
    expect(out.services).toEqual([{ name: 'Skin fade', price: '$40' }, { name: 'Beard trim' }]);
  });

  it('strips ```json code fences the model adds', () => {
    const out = parseBioDetails('```json\n{"location":"Oakland","services":[]}\n```');
    expect(out.location).toBe('Oakland');
  });

  it('recovers a JSON object embedded in surrounding prose', () => {
    const out = parseBioDetails('Sure! Here you go: {"hours":"9–5","services":[]} — enjoy.');
    expect(out.hours).toBe('9–5');
  });

  it('treats empty strings as absent fields', () => {
    const out = parseBioDetails(JSON.stringify({ location: '', hours: '   ', services: [] }));
    expect(out.location).toBeUndefined();
    expect(out.hours).toBeUndefined();
    expect(out.services).toEqual([]);
  });

  it('drops service entries with no name', () => {
    const out = parseBioDetails(
      JSON.stringify({ services: [{ price: '$30' }, { name: 'Lineup' }] }),
    );
    expect(out.services).toEqual([{ name: 'Lineup' }]);
  });

  it('caps services at 12 and truncates over-long fields', () => {
    const out = parseBioDetails(
      JSON.stringify({
        location: 'L'.repeat(200),
        services: Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, price: '$'.repeat(50) })),
      }),
    );
    expect(out.services).toHaveLength(12);
    expect(out.location?.length).toBe(80);
    expect(out.services[0].price?.length).toBe(20);
  });

  it('returns empty details for non-JSON or malformed input', () => {
    expect(parseBioDetails('not json at all').services).toEqual([]);
    expect(parseBioDetails('{ broken').services).toEqual([]);
    expect(parseBioDetails('[]').services).toEqual([]);
    expect(parseBioDetails('null').services).toEqual([]);
  });
});
