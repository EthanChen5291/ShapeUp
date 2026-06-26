// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import InferenceNote from './InferenceNote';

afterEach(() => cleanup());

describe('InferenceNote', () => {
  it('renders the model preset copy with an svg sparkle icon (no emoji)', () => {
    const { container } = render(<InferenceNote variant="model" tone="badge" />);
    expect(screen.getByText(/built from your photos/i)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('✨');
  });

  it('badge tone uses a solid white background (not translucent black)', () => {
    const { container } = render(<InferenceNote variant="model" tone="badge" />);
    const badge = container.firstElementChild as HTMLElement;
    // New-user studio popup reads as a white card on the dark 3D scene.
    expect(badge.style.background).toBe('rgb(255, 255, 255)');
    expect(badge.style.color).toBe('var(--char)');
    expect(badge.style.backdropFilter).toBe('');
  });

  it('renders nothing when inline with no children', () => {
    const { container } = render(<InferenceNote variant="inline" />);
    expect(container.firstChild).toBeNull();
  });
});
