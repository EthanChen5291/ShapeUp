// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Hairstyle } from '@/data/hairstyles';
import type { SelfieVerdict } from '@/lib/selfieCheck';

vi.mock('@convex/_generated/api', () => ({
  api: {
    barberPages: { recordEvent: 'barberPages:recordEvent' },
    barberTryOn: {
      generateUploadUrl: 'barberTryOn:generateUploadUrl',
      getUploadedImageUrl: 'barberTryOn:getUploadedImageUrl',
      sendToBarber: 'barberTryOn:sendToBarber',
    },
    users: { getOrCreate: 'users:getOrCreate' },
    renderStations: {
      claim: 'renderStations:claim',
      heartbeat: 'renderStations:heartbeat',
      release: 'renderStations:release',
      status: 'renderStations:status',
    },
  },
}));

const generateUploadUrlMock = vi.fn(async () => 'https://mock-upload-url');
const getOrCreateMock = vi.fn(async () => ({}));
const recordEventMock = vi.fn(async () => null);
const sendToBarberMock = vi.fn(
  async () => ({ ok: true, emailed: true }) as { ok: boolean; emailed?: boolean; reason?: string },
);
const convexQueryMock = vi.fn(async () => 'https://storage.example.com/original-selfie.png');
const claimStationMock = vi.fn(async () => ({
  jobId: 'station-1', status: 'active', queuePosition: 0, activeCount: 1, capacity: 2,
}));
const heartbeatStationMock = vi.fn(async () => ({ ok: true }));
const releaseStationMock = vi.fn(async () => null);

const mutationsByRef: Record<string, unknown> = {
  'barberPages:recordEvent': recordEventMock,
  'barberTryOn:generateUploadUrl': generateUploadUrlMock,
  'users:getOrCreate': getOrCreateMock,
  'renderStations:claim': claimStationMock,
  'renderStations:heartbeat': heartbeatStationMock,
  'renderStations:release': releaseStationMock,
};

vi.mock('convex/react', () => ({
  useMutation: (ref: string) => mutationsByRef[ref],
  useAction: () => sendToBarberMock,
  useConvex: () => ({ query: convexQueryMock }),
  useQuery: () => undefined,
}));

const hairScenePropsSpy = vi.fn();
vi.mock('@/components/HairScene', () => ({
  default: (props: { splatSrcOverride?: string }) => {
    hairScenePropsSpy(props);
    return <div data-testid="hair-scene-stub">{props.splatSrcOverride}</div>;
  },
}));

let mockAuth: { isSignedIn: boolean; user: null | { primaryEmailAddress: { emailAddress: string } } } = {
  isSignedIn: true,
  user: { primaryEmailAddress: { emailAddress: 'client@example.com' } },
};
vi.mock('@clerk/nextjs', () => ({ useUser: () => mockAuth }));
vi.mock('@/components/SignUpWidget', () => ({
  default: () => <div data-testid="signup-widget-stub" />,
}));

const selfieBlob = new Blob(['selfie'], { type: 'image/png' });
vi.mock('@/components/SelfieCapture', () => ({
  default: ({ onPhoto }: { onPhoto: (blob: Blob) => void }) => (
    <button type="button" data-testid="selfie-capture-stub" onClick={() => onPhoto(selfieBlob)}>
      provide selfie
    </button>
  ),
}));

let selfieVerdict: SelfieVerdict = { level: 'ok', message: 'Photo looks good' };
vi.mock('@/lib/selfieCheck', () => ({
  analyzeSelfie: vi.fn(async () => ({ width: 1000, height: 1000 })),
  judgeSelfie: vi.fn(() => selfieVerdict),
}));

const { default: BarberTryOn } = await import('./BarberTryOn');

let geminiResponse: { ok: boolean; newImageUrl?: string; error?: string };
let faceliftResponse: { ok: boolean; body: { splatUrl?: string; videoUrl?: string; error?: string } };
const geminiCalls: Array<{ imageUrl: string; prompt: string }> = [];
const faceliftCalls: Array<{ imageDataUrl: string }> = [];
const warmupCalls: RequestInit[] = [];

vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : String(input);
  if (url === '/api/facelift/warmup') {
    warmupCalls.push(init ?? {});
    return { ok: true, json: async () => ({ ok: true }) };
  }
  if (url === 'https://mock-upload-url') {
    return { ok: true, json: async () => ({ storageId: 'storage-1' }) };
  }
  if (url === '/api/gemini-hair-edit') {
    const body = JSON.parse(init?.body as string);
    geminiCalls.push({ imageUrl: body.imageUrl, prompt: body.prompt });
    return { ok: geminiResponse.ok, json: async () => geminiResponse };
  }
  if (url === '/api/facelift') {
    const body = JSON.parse(init?.body as string);
    faceliftCalls.push({ imageDataUrl: body.imageDataUrl });
    return { ok: faceliftResponse.ok, json: async () => faceliftResponse.body };
  }
  if (url.startsWith('data:')) {
    return { ok: true, blob: async () => new Blob(['result'], { type: 'image/png' }) };
  }
  if (url === 'https://s3.example.com/turntable.mp4') {
    return { ok: true, blob: async () => new Blob(['360-video'], { type: 'video/mp4' }) };
  }
  throw new Error(`unexpected fetch: ${url}`);
}));

const CUT: Hairstyle = {
  slug: 'blowout-taper',
  label: 'blowout taper',
  desc: 'Voluminous top blown up and back.',
  gender: 'mens',
};
const OTHER_CUT: Hairstyle = {
  slug: 'burst-fade-textured-fringe',
  label: 'burst fade, textured fringe',
  desc: 'Choppy textured top with a burst fade.',
  gender: 'mens',
};

const baseProps = {
  barberSlug: 'marcus',
  barberName: 'Marcus',
  cut: CUT,
  otherCuts: [] as Hairstyle[],
  onClose: vi.fn(),
};

async function reachCapture() {
  expect(screen.getByText('Let’s see how it looks on you!')).toBeInTheDocument();
  return await screen.findByTestId('selfie-capture-stub', {}, { timeout: 2500 });
}

async function generateResult() {
  const capture = await reachCapture();
  fireEvent.click(capture);
  return await screen.findByTestId('hair-scene-stub');
}

beforeEach(() => {
  vi.clearAllMocks();
  geminiCalls.length = 0;
  faceliftCalls.length = 0;
  warmupCalls.length = 0;
  geminiResponse = { ok: true, newImageUrl: 'data:image/png;base64,RESULT1' };
  faceliftResponse = { ok: true, body: { splatUrl: 'https://s3.example.com/result.splat', videoUrl: 'https://s3.example.com/turntable.mp4' } };
  selfieVerdict = { level: 'ok', message: 'Photo looks good' };
  mockAuth = {
    isSignedIn: true,
    user: { primaryEmailAddress: { emailAddress: 'client@example.com' } },
  };
});
afterEach(() => cleanup());

describe('BarberTryOn', () => {
  it('shows the interstitial before the inline sign-up gate for signed-out visitors', async () => {
    mockAuth = { isSignedIn: false, user: null };
    render(<BarberTryOn {...baseProps} referralCode="ABC123" />);
    expect(screen.getByText('Let’s see how it looks on you!')).toBeInTheDocument();
    expect(await screen.findByTestId('signup-widget-stub', {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.queryByTestId('selfie-capture-stub')).not.toBeInTheDocument();
    expect(geminiCalls).toHaveLength(0);
  });

  it('attributes a signed-in client to the barber exactly once', () => {
    const { rerender } = render(<BarberTryOn {...baseProps} referralCode="ABC123" />);
    rerender(<BarberTryOn {...baseProps} referralCode="ABC123" />);
    expect(getOrCreateMock).toHaveBeenCalledTimes(1);
    expect(getOrCreateMock).toHaveBeenCalledWith({ referralCode: 'ABC123' });
  });

  it('warms the GPU when capture becomes visible, validates, then renders the real 3D viewer', async () => {
    render(<BarberTryOn {...baseProps} />);
    await generateResult();
    expect(warmupCalls.length).toBeGreaterThan(0);
    expect(warmupCalls[0]).toMatchObject({ method: 'POST' });
    expect(geminiCalls[0]).toEqual({
      imageUrl: 'https://storage.example.com/original-selfie.png',
      prompt: 'blowout taper',
    });
    expect(faceliftCalls[0]).toEqual({ imageDataUrl: 'data:image/png;base64,RESULT1' });
    expect(hairScenePropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        splatSrcOverride: `/api/proxy-ply?url=${encodeURIComponent('https://s3.example.com/result.splat')}`,
        disableDefaultHairLayers: true,
      }),
    );
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'selfieStart' });
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'preview' });
  });

  it('lets a warning continue without forcing a restart', async () => {
    selfieVerdict = { level: 'warn', message: 'Keep your full head in frame' };
    render(<BarberTryOn {...baseProps} />);
    fireEvent.click(await reachCapture());
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep your full head in frame');
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument();
    expect(geminiCalls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Use this photo' }));
    expect(await screen.findByTestId('hair-scene-stub')).toBeInTheDocument();
  });

  it('keeps a failed validation recoverable at the selfie step', async () => {
    selfieVerdict = { level: 'fail', message: 'Face the camera' };
    render(<BarberTryOn {...baseProps} />);
    fireEvent.click(await reachCapture());
    expect(await screen.findByRole('alert')).toHaveTextContent('Face the camera');
    expect(screen.queryByRole('button', { name: 'Use this photo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    expect(screen.getByTestId('selfie-capture-stub')).toBeInTheDocument();
    expect(geminiCalls).toHaveLength(0);
  });

  it('claims and releases the render station around 3D generation', async () => {
    render(<BarberTryOn {...baseProps} />);
    await generateResult();
    expect(claimStationMock).toHaveBeenCalledTimes(1);
    expect(releaseStationMock).toHaveBeenCalledWith({ jobId: 'station-1' });
  });

  it('retains the successful 2D edit when 3D generation fails', async () => {
    faceliftResponse = { ok: false, body: { error: 'GPU worker unavailable' } };
    render(<BarberTryOn {...baseProps} />);
    fireEvent.click(await reachCapture());
    const image = await screen.findByAltText('You, wearing blowout taper');
    expect(image).toHaveAttribute('src', 'data:image/png;base64,RESULT1');
    expect(screen.queryByTestId('hair-scene-stub')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('GPU worker unavailable');
    expect(screen.getByRole('button', { name: 'Retake selfie' })).toBeInTheDocument();
  });

  it('always regenerates prompt edits and alternate cuts from the original selfie', async () => {
    render(<BarberTryOn {...baseProps} otherCuts={[OTHER_CUT]} />);
    await generateResult();

    geminiResponse = { ok: true, newImageUrl: 'data:image/png;base64,RESULT2' };
    fireEvent.change(screen.getByLabelText('Describe a change'), {
      target: { value: 'shorter on the sides' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(geminiCalls).toHaveLength(2));
    expect(geminiCalls[1]).toEqual({
      imageUrl: 'https://storage.example.com/original-selfie.png',
      prompt: 'shorter on the sides',
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /burst fade/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /burst fade/ }));
    await waitFor(() => expect(geminiCalls).toHaveLength(3));
    expect(geminiCalls[2]).toEqual({
      imageUrl: 'https://storage.example.com/original-selfie.png',
      prompt: 'burst fade, textured fringe',
    });
  });

  it('keeps a 2D edit failure recoverable without calling the 3D endpoint', async () => {
    geminiResponse = { ok: false, error: 'Blocked by safety filters' };
    render(<BarberTryOn {...baseProps} />);
    fireEvent.click(await reachCapture());
    expect(await screen.findByRole('alert')).toHaveTextContent('Blocked by safety filters');
    expect(screen.getByTestId('selfie-capture-stub')).toBeInTheDocument();
    expect(faceliftCalls).toHaveLength(0);
  });

  it('sends the result to the barber and records booking clicks', async () => {
    render(<BarberTryOn {...baseProps} bookingUrl="https://booksy.com/marcus" />);
    await generateResult();
    fireEvent.click(screen.getByRole('button', { name: 'Send 360 to Marcus' }));
    await waitFor(() => expect(sendToBarberMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'marcus',
        cutLabel: 'blowout taper',
        clientRequest: 'blowout taper',
        videoUrl: 'https://storage.example.com/original-selfie.png',
        clientEmail: 'client@example.com',
      }),
    ));
    expect(await screen.findByRole('status')).toHaveTextContent(/see exactly what you want/i);

    fireEvent.click(screen.getByRole('link', { name: 'Book with Marcus' }));
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'bookingClick' });
  });

  it('tells the client the send landed in the inbox when no email went out', async () => {
    sendToBarberMock.mockResolvedValueOnce({ ok: true, emailed: false });
    render(<BarberTryOn {...baseProps} />);
    await generateResult();
    fireEvent.click(screen.getByRole('button', { name: 'Send 360 to Marcus' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/ShapeUp inbox/i);
  });

  it('prefers the native scheduler over the external booking link when onBook is given', async () => {
    const onBook = vi.fn();
    render(<BarberTryOn {...baseProps} bookingUrl="https://booksy.com/marcus" onBook={onBook} />);
    await generateResult();
    expect(screen.queryByRole('link', { name: 'Book with Marcus' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Book with Marcus' }));
    expect(onBook).toHaveBeenCalledTimes(1);
  });

  it('returns to style discovery through the explicit back action', () => {
    const onClose = vi.fn();
    render(<BarberTryOn {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'All styles' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
