// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  BarberBatchItemSnapshot,
  BarberBatchSnapshot,
} from './BarberBatchFlow';

vi.mock('@convex/_generated/api', () => ({
  api: {
    barberBatch: { latestForPage: 'barberBatch:latestForPage' },
    barberPages: { recordEvent: 'barberPages:recordEvent' },
    barberTryOn: {
      generateUploadUrl: 'barberTryOn:generateUploadUrl',
      getUploadedImageUrl: 'barberTryOn:getUploadedImageUrl',
      sendToBarber: 'barberTryOn:sendToBarber',
    },
    users: {
      hasBiometricConsent: 'users:hasBiometricConsent',
      recordBiometricConsent: 'users:recordBiometricConsent',
    },
  },
}));

let latestBatchMock: BarberBatchSnapshot | null | undefined;
let consentMock = true;
const generateUploadUrlMock = vi.fn(async () => 'https://upload.example.com');
const recordEventMock = vi.fn(async () => null);
const recordConsentMock = vi.fn(async () => ({ consentAt: Date.now() }));
const sendToBarberMock = vi.fn(async () => ({ ok: true, emailed: true }));
const convexQueryMock = vi.fn(async () => 'https://storage.example.com/selfie.jpg');

const mutationsByRef: Record<string, unknown> = {
  'barberPages:recordEvent': recordEventMock,
  'barberTryOn:generateUploadUrl': generateUploadUrlMock,
  'users:recordBiometricConsent': recordConsentMock,
};

vi.mock('convex/react', () => ({
  useAction: () => sendToBarberMock,
  useConvex: () => ({ query: convexQueryMock }),
  useMutation: (ref: string) => mutationsByRef[ref],
  useQuery: (ref: string) => (
    ref === 'barberBatch:latestForPage' ? latestBatchMock : consentMock
  ),
}));

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    isSignedIn: true,
    user: { primaryEmailAddress: { emailAddress: 'client@example.com' } },
  }),
}));

const hairScenePropsSpy = vi.fn();
vi.mock('@/components/HairScene', () => ({
  default: (props: { splatSrcOverride?: string }) => {
    hairScenePropsSpy(props);
    return <div data-testid="hair-scene-renderer-stub" />;
  },
}));

vi.mock('@/components/BiometricConsentDialog', () => ({
  default: () => <div data-testid="consent-dialog-stub" />,
}));

const selfieBlob = new Blob(['selfie'], { type: 'image/png' });
vi.mock('@/components/SelfieCapture', () => ({
  default: ({ onPhoto }: { onPhoto: (blob: Blob) => void }) => (
    <button type="button" data-testid="selfie-capture-stub" onClick={() => onPhoto(selfieBlob)}>
      provide selfie
    </button>
  ),
}));

vi.mock('@/lib/selfieCheck', () => ({
  analyzeSelfie: vi.fn(async () => ({ width: 1000, height: 1000 })),
  judgeSelfie: vi.fn(() => ({ level: 'ok', message: 'Photo looks good' })),
}));

vi.mock('@/lib/visitorId', () => ({ getVisitorId: vi.fn(async () => 'visitor-1') }));

const { default: BarberBatchFlow } = await import('./BarberBatchFlow');

let reducedMotion = false;

class FakeIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect() {}
  unobserve() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = '';
  thresholds = [0];
}

const PROFILE = {
  curlClass: '3B',
  lengthInches: { top: 4, sides: 1, back: 1.5 },
  density: 'high' as const,
  hairline: { state: 'mature' as const, notes: 'slight temple recession' },
  growthPatterns: ['crown cowlick'],
  faceShape: 'oval',
};

function item(
  idx: number,
  status: BarberBatchItemSnapshot['status'],
  overrides: Partial<BarberBatchItemSnapshot> = {},
): BarberBatchItemSnapshot {
  return {
    _id: `item-${idx}`,
    idx,
    title: `Style ${idx + 1}`,
    prompt: `Style prompt ${idx + 1}`,
    status,
    ...overrides,
  };
}

function snapshot(
  status: BarberBatchSnapshot['status'],
  items: BarberBatchItemSnapshot[],
): BarberBatchSnapshot {
  return { _id: 'batch-1', status, hairProfile: PROFILE, items };
}

const baseProps = {
  barberSlug: 'marcus',
  barberName: 'Marcus',
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  latestBatchMock = null;
  consentMock = true;
  reducedMotion = false;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') && reducedMotion,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BarberBatchFlow', () => {
  it('stagger-reveals the rundown by 0.5s and makes it instant for reduced motion', async () => {
    const { unmount } = render(<BarberBatchFlow {...baseProps} />);
    const bullets = screen.getAllByRole('listitem');
    expect(bullets.map((bullet) => bullet.getAttribute('data-stagger-delay')))
      .toEqual(['0', '500', '1000', '1500']);

    unmount();
    reducedMotion = true;
    render(<BarberBatchFlow {...baseProps} />);
    await waitFor(() => {
      expect(screen.getAllByRole('listitem').map((bullet) => bullet.getAttribute('data-stagger-delay')))
        .toEqual(['0', '0', '0', '0']);
    });
  });

  it('warms the renderer only when the visitor presses Let’s go', () => {
    render(<BarberBatchFlow {...baseProps} />);
    expect(fetch).not.toHaveBeenCalledWith('/api/facelift/warmup', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: "Let's go." }));
    expect(fetch).toHaveBeenCalledWith('/api/facelift/warmup', { method: 'POST' });
    expect(screen.getByTestId('selfie-capture-stub')).toBeInTheDocument();
  });

  it('fills the eight-slot grid reactively and uses the image when a done item has no video', async () => {
    latestBatchMock = snapshot('generating', [
      item(0, 'done', {
        title: 'Video Style',
        imageUrl: 'https://storage.example.com/video-style.jpg',
        splatS3Key: 'facelifts/job-1/result.splat',
        videoS3Key: 'facelifts/job-1/turntable.mp4',
      }),
      item(1, 'rendering', { title: 'Still Style' }),
    ]);
    const { container, rerender } = render(<BarberBatchFlow {...baseProps} />);
    expect(await screen.findByRole('list', { name: 'Your 8 hairstyle matches' })).toBeInTheDocument();
    expect(container.querySelectorAll('.bbf-tile-shell')).toHaveLength(8);
    const video = screen.getByLabelText('Video Style 360 preview') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.preload).toBe('metadata');
    expect(video.getAttribute('src')).toContain('/api/proxy-ply?key=facelifts%2Fjob-1%2Fturntable.mp4');

    latestBatchMock = snapshot('ready', [
      ...latestBatchMock.items.slice(0, 1),
      item(1, 'done', {
        title: 'Still Style',
        imageUrl: 'https://storage.example.com/still-style.jpg',
        splatS3Key: 'facelifts/job-2/result.splat',
      }),
    ]);
    rerender(<BarberBatchFlow {...baseProps} />);

    const fallback = await screen.findByAltText('Still Style preview');
    expect(fallback).toHaveAttribute('src', 'https://storage.example.com/still-style.jpg');
    expect(fallback).toHaveAttribute('data-testid', 'batch-image-fallback');
    expect(screen.queryAllByRole('button', { name: /Retry/ })).toHaveLength(0);
  });

  it('shows a retry affordance only on failed tiles', async () => {
    latestBatchMock = snapshot('ready', [
      item(0, 'failed', { title: 'Try Again', error: 'Render interrupted' }),
      item(1, 'done', {
        title: 'Finished',
        imageUrl: 'https://storage.example.com/finished.jpg',
        splatS3Key: 'facelifts/job-2/result.splat',
      }),
    ]);
    render(<BarberBatchFlow {...baseProps} />);
    const retry = await screen.findByRole('button', { name: 'Retry Try Again' });
    expect(retry).toBeInTheDocument();
    expect(within(screen.getByTestId('batch-tile-1')).queryByText('Retry')).not.toBeInTheDocument();
  });

  it('mounts exactly one enlarged scene and unmounts it before returning to the grid', async () => {
    reducedMotion = true;
    latestBatchMock = snapshot('ready', [
      item(0, 'done', {
        title: 'First Look',
        imageUrl: 'https://storage.example.com/first.jpg',
        splatS3Key: 'facelifts/job-1/result.splat',
      }),
      item(1, 'done', {
        title: 'Second Look',
        imageUrl: 'https://storage.example.com/second.jpg',
        splatS3Key: 'facelifts/job-2/result.splat',
      }),
    ]);
    render(<BarberBatchFlow {...baseProps} />);
    await screen.findByRole('button', { name: 'Open First Look in 3D' });
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Open First Look in 3D' }));

    expect(await screen.findByTestId('batch-hair-scene')).toBeInTheDocument();
    expect(screen.getAllByTestId('hair-scene-renderer-stub')).toHaveLength(1);
    expect(hairScenePropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      splatSrcOverride: '/api/proxy-ply?key=facelifts%2Fjob-1%2Fresult.splat',
      disableDefaultHairLayers: true,
    }));
    const finalInput = screen.getByPlaceholderText('Final Touches');
    expect(finalInput).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'All 8 looks' }));
    expect(screen.queryByTestId('batch-hair-scene')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hair-scene-renderer-stub')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Second Look in 3D' }));
    expect(await screen.findByTestId('batch-hair-scene')).toBeInTheDocument();
    expect(screen.getAllByTestId('hair-scene-renderer-stub')).toHaveLength(1);
  });
});
