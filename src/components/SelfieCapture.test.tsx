// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SelfieCapture from './SelfieCapture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SelfieCapture', () => {
  it('explains a denied permission and can recover when the user retries', async () => {
    const track = { stop: vi.fn() };
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
      .mockResolvedValueOnce({ getTracks: () => [track] });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();

    render(<SelfieCapture onPhoto={vi.fn()} />);
    expect(await screen.findByText('Camera permission is off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload an image' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try camera again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Match my best hairstyles' })).toBeEnabled());
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
