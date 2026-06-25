import { describe, it, expect } from 'vitest';
import { nextSelectedChip, resolveApplyPrompt } from './editPanelChipSelection';

describe('nextSelectedChip', () => {
  it('selects a chip when nothing is selected', () => {
    expect(nextSelectedChip(null, 'buzz cut')).toBe('buzz cut');
  });

  it('switches selection to a different chip', () => {
    expect(nextSelectedChip('buzz cut', 'mullet')).toBe('mullet');
  });

  it('un-selects when the same chip is tapped again', () => {
    expect(nextSelectedChip('buzz cut', 'buzz cut')).toBeNull();
  });
});

describe('resolveApplyPrompt', () => {
  it('applies the selected chip on mobile, ignoring the prompt box', () => {
    expect(resolveApplyPrompt(true, 'mullet', 'typed text')).toBe('mullet');
  });

  it('falls back to the prompt box on mobile when nothing is selected', () => {
    expect(resolveApplyPrompt(true, null, 'typed text')).toBe('typed text');
  });

  it('always uses the prompt box on desktop, even if a chip is selected', () => {
    expect(resolveApplyPrompt(false, 'mullet', 'typed text')).toBe('typed text');
  });
});
