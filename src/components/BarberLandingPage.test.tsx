// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { default: BarberLandingPage } = await import('./BarberLandingPage');

/* ── environment doubles ─────────────────────────────────────────────────
   The landing page's demo scenes are driven by IntersectionObserver (play
   only on screen) and matchMedia (pin the final frame for reduced motion).
   jsdom has neither, so both are controllable fakes. */

type IoCallback = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;

let ioInstances: Array<{ callback: IoCallback; targets: Element[] }>;
let reducedMotion: boolean;

function intersectAll(isIntersecting: boolean) {
  act(() => {
    for (const io of ioInstances) {
      io.callback(io.targets.map((target) => ({ isIntersecting, target })));
    }
  });
}

beforeEach(() => {
  ioInstances = [];
  reducedMotion = false;

  class FakeIntersectionObserver {
    private entry: { callback: IoCallback; targets: Element[] };
    constructor(callback: IoCallback) {
      this.entry = { callback, targets: [] };
      ioInstances.push(this.entry);
    }
    observe(target: Element) { this.entry.targets.push(target); }
    unobserve() {}
    disconnect() { this.entry.targets = []; }
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ── tests ── */

describe('BarberLandingPage', () => {
  it('sells the card with try-on-first hero copy, the logo, and both CTAs', () => {
    const { container } = render(<BarberLandingPage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/only barber card your clients can try on/i);

    // The real ShapeUp mark sits top-left in the nav.
    const mark = container.querySelector('header .bl-brand-mark')!;
    expect(mark).toHaveAttribute('src', '/shapeup_logo_sm.png');

    const build = screen.getAllByRole('link', { name: /build my barber card/i });
    expect(build.length).toBeGreaterThanOrEqual(2); // hero + final CTA
    for (const link of build) expect(link).toHaveAttribute('href', '/barber');

    expect(screen.getByRole('link', { name: /watch how it works/i })).toHaveAttribute('href', '#watch');
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/sign-in');
  });

  it('advances the hero builder loop only while it is on screen', () => {
    vi.useFakeTimers();
    const { container } = render(<BarberLandingPage />);
    const builder = container.querySelector('.bl-builder')!;

    // Off screen: the timeline must not run.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(builder.getAttribute('data-step')).toBe('0');

    // On screen: beats advance (first builder beat is 1500ms).
    intersectAll(true);
    act(() => { vi.advanceTimersByTime(1600); });
    expect(builder.getAttribute('data-step')).toBe('1');

    // Scrolled away again: the scene freezes at its current beat.
    intersectAll(false);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(builder.getAttribute('data-step')).toBe('1');
  });

  it('defers all real footage until its section approaches, then plays it muted and inline', () => {
    const { container } = render(<BarberLandingPage />);

    // 2 journey try-on layers + 1 playground idle + 8 playground renders.
    let videos = Array.from(container.querySelectorAll('video'));
    expect(videos.length).toBe(11);
    for (const video of videos) expect(video).not.toHaveAttribute('src');

    intersectAll(true);
    videos = Array.from(container.querySelectorAll('video'));
    const srcs = videos.map((v) => v.getAttribute('src'));
    expect(srcs).toContain('/landing_face1/face1a.mp4');
    expect(srcs).toContain('/landing_face1/face1b.mp4');
    expect(srcs).toContain('/landing_face2/face2.mp4');
    expect(srcs.filter((src) => /landing_face2\/face2[a-h]\.mp4$/.test(src ?? ''))).toHaveLength(8);
    for (const video of videos) {
      expect(video.muted).toBe(true);
      expect(video).toHaveAttribute('playsinline');
      expect(video.getAttribute('poster')).toMatch(/_poster\.jpg$/);
    }
  });

  it('lets a visitor fire a try-on request and swaps in that real render', () => {
    const { container } = render(<BarberLandingPage />);
    intersectAll(true);

    const chip = screen.getByRole('button', { name: /go full pink/i });
    fireEvent.click(chip);

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    const active = container.querySelector('.bl-play-media.is-active')!;
    expect(active.getAttribute('src')).toBe('/landing_face2/face2g.mp4');
    expect(screen.getByText(/“go full pink”/i)).toBeInTheDocument();
  });

  it('labels analytics numbers as seeded demonstration data', () => {
    render(<BarberLandingPage />);
    expect(screen.getByText(/seeded demo data/i)).toBeInTheDocument();
    expect(screen.getByText(/seeded demonstration data from a sample card/i)).toBeInTheDocument();
  });

  it('reserves the testimonial wall instead of inventing barber quotes', () => {
    render(<BarberLandingPage />);
    expect(screen.getAllByText(/reserved for a working barber/i)).toHaveLength(3);
    expect(screen.getByText(/we don.t print reviews we don.t have/i)).toBeInTheDocument();
  });

  it('pins every scene to its finished frame under prefers-reduced-motion', () => {
    reducedMotion = true;
    const { container } = render(<BarberLandingPage />);
    intersectAll(true);

    // Final beat indices: builder 6, journey 6, customize 6, everywhere 5, receipt 5.
    expect(container.querySelector('.bl-builder')!.getAttribute('data-step')).toBe('6');
    expect(container.querySelector('.bl-journey')!.getAttribute('data-step')).toBe('6');
    expect(container.querySelector('.bl-customize')!.getAttribute('data-step')).toBe('6');
    expect(container.querySelector('.bl-everywhere')!.getAttribute('data-step')).toBe('5');
    expect(container.querySelector('.bl-receipt-scene')!.getAttribute('data-step')).toBe('5');

    // Reduced motion swaps autoplaying footage for still posters.
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(container.querySelectorAll('img.bl-tryon-media')).toHaveLength(2);
    expect(container.querySelectorAll('img.bl-play-media')).toHaveLength(1);
  });
});
