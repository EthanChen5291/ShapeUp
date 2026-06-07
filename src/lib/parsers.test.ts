import { describe, expect, test, vi } from 'vitest';
import { parseGaussianXYZ, parsePLY } from './parsePLY';

function textBuffer(text: string) {
  return new TextEncoder().encode(text).buffer;
}

describe('PLY parsing utilities', () => {
  test('parseGaussianXYZ returns an empty list when vertex metadata is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      arrayBuffer: async () => textBuffer('ply\nformat binary_little_endian 1.0\nend_header\n'),
    }));

    await expect(parseGaussianXYZ('/bad.ply')).resolves.toEqual([]);
  });

  test('parsePLY reports malformed PLY input instead of silently producing geometry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      arrayBuffer: async () => textBuffer('not a ply file'),
    }));

    await expect(parsePLY('/malformed.ply')).rejects.toThrow();
  });
});
