import { describe, expect, it } from 'vitest';
import { MAX_REFERENCE_FILE_BYTES, validateHairReferenceFile } from './hairReferenceImage';

describe('validateHairReferenceFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s references', type => {
    expect(validateHairReferenceFile({ type, size: 1024 })).toBeNull();
  });

  it('rejects unsupported, empty, and oversized files', () => {
    expect(validateHairReferenceFile({ type: 'image/heic', size: 1024 })).toMatch(/JPEG/);
    expect(validateHairReferenceFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(validateHairReferenceFile({ type: 'image/png', size: MAX_REFERENCE_FILE_BYTES + 1 })).toMatch(/10 MB/);
  });
});
