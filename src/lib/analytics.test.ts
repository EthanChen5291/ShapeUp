// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the vi.mock factory (also hoisted) can safely reference these.
const { captureMock, state } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  state: { loaded: false },
}));

vi.mock('posthog-js', () => ({
  default: {
    capture: captureMock,
    get __loaded() {
      return state.loaded;
    },
  },
}));

import { track } from './analytics';

describe('track', () => {
  beforeEach(() => {
    captureMock.mockReset();
    state.loaded = false;
  });

  it('no-ops when PostHog is not initialized', () => {
    track('project_created');
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('captures the event with props once PostHog is loaded', () => {
    state.loaded = true;
    track('purchase_completed', { source: 'dashboard' });
    expect(captureMock).toHaveBeenCalledWith('purchase_completed', { source: 'dashboard' });
  });

  it('never throws if capture blows up', () => {
    state.loaded = true;
    captureMock.mockImplementationOnce(() => {
      throw new Error('network down');
    });
    expect(() => track('refund_requested')).not.toThrow();
  });
});
