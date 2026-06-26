// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import RefundRequestDialog from './RefundRequestDialog';

afterEach(() => cleanup());

describe('RefundRequestDialog', () => {
  it('casual (user-opened) variant shows a close X and dismisses on backdrop click', async () => {
    const onClose = vi.fn();
    render(<RefundRequestDialog projectId="p1" onClose={onClose} />);
    // Close affordance present.
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    // Backdrop click triggers the dismiss flow (fires onClose after the fade).
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.click(backdrop);
    await new Promise((r) => setTimeout(r, 400));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('acknowledgment-required reminder hides the close X and ignores backdrop clicks', async () => {
    const onClose = vi.fn();
    render(<RefundRequestDialog projectId="p1" onClose={onClose} requireAck />);
    // No quick-close X in the proactive reminder.
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    // Backdrop click must not start a dismiss.
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.click(backdrop);
    await new Promise((r) => setTimeout(r, 400));
    expect(onClose).not.toHaveBeenCalled();
  });
});
