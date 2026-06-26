// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import InferenceNoticeDialog from './InferenceNoticeDialog';

afterEach(() => cleanup());

describe('InferenceNoticeDialog', () => {
  it('renders as an acknowledgment dialog with the inference disclaimer copy (no emoji)', () => {
    render(<InferenceNoticeDialog onAcknowledge={() => {}} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/built from your photos/i)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('✨');
  });

  it('acknowledges only when the primary button is pressed', async () => {
    const onAcknowledge = vi.fn();
    render(<InferenceNoticeDialog onAcknowledge={onAcknowledge} />);
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    await waitFor(() => expect(onAcknowledge).toHaveBeenCalledTimes(1));
  });

  it('cannot be dismissed by clicking the backdrop (acknowledgment required)', async () => {
    const onAcknowledge = vi.fn();
    render(<InferenceNoticeDialog onAcknowledge={onAcknowledge} />);
    fireEvent.click(screen.getByTestId('inference-notice-backdrop'));
    // Wait past the dialog's own close animation window to be sure nothing fired.
    await new Promise((r) => setTimeout(r, 400));
    expect(onAcknowledge).not.toHaveBeenCalled();
  });
});
