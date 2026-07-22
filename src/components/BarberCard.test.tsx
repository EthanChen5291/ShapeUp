// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const recordEventMock = vi.fn(() => Promise.resolve(null));
const getOrCreateMock = vi.fn(() => Promise.resolve(null));
let latestBatchMock: null | { _id: string; status: 'analyzing' | 'generating' | 'ready' } = null;
const mutationsByRef: Record<string, unknown> = {
  'barberPages:recordEvent': recordEventMock,
  'users:getOrCreate': getOrCreateMock,
};
vi.mock('convex/react', () => ({
  useMutation: (ref: string) => mutationsByRef[ref],
  useQuery: () => latestBatchMock,
}));
vi.mock('@convex/_generated/api', () => ({
  api: {
    barberPages: { recordEvent: 'barberPages:recordEvent' },
    barberBatch: { latestForPage: 'barberBatch:latestForPage' },
    users: { getOrCreate: 'users:getOrCreate' },
  },
}));

let mockAuth = { isSignedIn: true };
vi.mock('@clerk/nextjs', () => ({ useUser: () => mockAuth }));

vi.mock('@/components/SignUpWidget', () => ({
  default: ({ onEnter }: { onEnter: () => void }) => (
    <button type="button" data-testid="signup-widget-stub" onClick={onEnter}>complete sign-in</button>
  ),
}));

const barberBatchFlowPropsSpy = vi.fn();
vi.mock('@/components/BarberBatchFlow', () => ({
  default: (props: { onClose: () => void }) => {
    barberBatchFlowPropsSpy(props);
    return (
      <div data-testid="barber-batch-flow-stub">
        batch-rundown
        <button type="button" onClick={props.onClose}>close-batch</button>
      </div>
    );
  },
}));

const barberTryOnPropsSpy = vi.fn();
vi.mock('@/components/BarberTryOn', () => ({
  default: (props: {
    cut: { label: string };
    barberSlug: string;
    referralCode?: string;
    onClose: () => void;
  }) => {
    barberTryOnPropsSpy(props);
    return (
      <div data-testid="barber-tryon-stub">
        {props.cut.label}
        <button type="button" onClick={props.onClose}>all-styles</button>
      </div>
    );
  },
}));

const barberBookingPropsSpy = vi.fn();
vi.mock('@/components/BarberBooking', () => ({
  default: (props: { slug: string; cutLabel?: string; preview?: boolean }) => {
    barberBookingPropsSpy(props);
    return <div data-testid="barber-booking-stub" />;
  },
}));

const { default: BarberCard } = await import('./BarberCard');

const PAGE = {
  slug: 'marcus',
  displayName: 'Marcus Rivera',
  shopName: 'Fade Theory',
  bio: 'Ten years on Telegraph Ave.',
  avatarUrl: 'https://images.example.com/marcus.jpg',
  location: 'Oakland, CA',
  hours: 'Tue–Sat · 10–7',
  services: [
    { name: 'Cut', price: '$45' },
    { name: 'Cut + beard', price: '$65' },
  ],
  referralCode: 'ABC123',
  links: [
    { kind: 'booking', label: 'Book an appointment', url: 'https://booksy.com/marcus' },
    { kind: 'venmo', label: 'Venmo', url: 'https://venmo.com/u/marcus' },
  ],
  styles: ['burst-fade-textured-fringe', 'blowout-taper'],
};

function enterBestStyles() {
  fireEvent.click(screen.getByRole('button', { name: 'Show me my best hairstyles' }));
  expect(screen.getByTestId('barber-batch-flow-stub')).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth = { isSignedIn: true };
  latestBatchMock = null;
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe('BarberCard', () => {
  it('strictly separates barber information from the ShapeUp experience', () => {
    const { container } = render(<BarberCard page={PAGE} />);
    const barberSide = container.querySelector('.bc-side');
    const experienceSide = container.querySelector('.bc-exp');
    expect(barberSide).not.toBeNull();
    expect(experienceSide).not.toBeNull();

    const barber = within(barberSide as HTMLElement);
    const experience = within(experienceSide as HTMLElement);
    expect(barber.getByRole('heading', { level: 1, name: 'Marcus Rivera' })).toBeInTheDocument();
    expect(barber.getByText('Fade Theory')).toBeInTheDocument();
    expect(barber.getByText('Oakland, CA')).toBeInTheDocument();
    expect(barber.getByText('Cut + beard')).toBeInTheDocument();
    expect(barber.getByRole('link', { name: /Book an appointment/ })).toBeInTheDocument();
    expect(barber.queryByText('What are we doing today?')).not.toBeInTheDocument();
    expect(barber.queryByRole('button', { name: /Try on/ })).not.toBeInTheDocument();

    expect(experience.getByText('What are we doing today?')).toBeInTheDocument();
    expect(experience.getByRole('button', { name: 'Just doing a trim.' })).toBeInTheDocument();
    expect(experience.getByRole('button', { name: 'Show me my best hairstyles' })).toBeInTheDocument();
    expect(experience.queryByText('Marcus Rivera')).not.toBeInTheDocument();
    expect(experience.queryByText('Cut + beard')).not.toBeInTheDocument();
  });

  it('passes only valid recommendations, in chosen order, as barber picks', () => {
    render(
      <BarberCard page={{ ...PAGE, styles: ['blowout-taper', 'not-a-real-cut', 'burst-fade-textured-fringe'] }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try on blowout taper' }));
    const props = barberTryOnPropsSpy.mock.calls[0][0] as { barberPicks: { slug: string }[] };
    expect(props.barberPicks.map((cut) => cut.slug)).toEqual(['blowout-taper', 'burst-fade-textured-fringe']);
  });

  it('keeps best-style discovery available when the barber has no recommendations', () => {
    render(<BarberCard page={{ ...PAGE, styles: [] }} />);
    expect(screen.getByRole('button', { name: 'Show me my best hairstyles' })).toBeInTheDocument();
  });

  it('opens the try-on directly from a tapped lookbook tile — no orbit detour', () => {
    render(<BarberCard page={PAGE} />);
    expect(screen.queryByText('Barber’s picks')).not.toBeInTheDocument();
    expect(screen.queryByText('Tap a cut to try it on')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try on blowout taper' }));
    expect(screen.getByTestId('barber-tryon-stub')).toHaveTextContent('blowout taper');
    expect(recordEventMock).toHaveBeenCalledWith({
      slug: 'marcus',
      kind: 'tryOn',
      cutSlug: 'blowout-taper',
    });
  });

  it('offers a taste of the menu as tappable tiles when the barber has no picks', () => {
    const { container } = render(<BarberCard page={{ ...PAGE, styles: [] }} />);
    expect(screen.queryByText('From the menu')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.bc-tile')).toHaveLength(7);
    expect(container.querySelector('.bc-cut-rail')).not.toBeNull();
  });

  it('gives the trim branch somewhere to go: booking and the try-on, no dead end', () => {
    render(<BarberCard page={PAGE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Just doing a trim.' }));

    const booking = screen.getByRole('link', { name: /Book appointment/ });
    expect(booking).toHaveAttribute('href', 'https://booksy.com/marcus');
    fireEvent.click(booking);
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'bookingClick', cutSlug: undefined });

    fireEvent.click(screen.getByRole('button', { name: /While you wait/ }));
    expect(screen.getByTestId('barber-batch-flow-stub')).toBeInTheDocument();
  });

  it('omits the trim branch booking CTA when the barber has no booking link', () => {
    render(<BarberCard page={{ ...PAGE, links: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Just doing a trim.' }));
    expect(screen.queryByRole('link', { name: /Book with/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /While you wait/ })).toBeInTheDocument();
  });

  it('contains none of the removed promotional copy, prebaked videos, or legacy assets', () => {
    const { container } = render(<BarberCard page={PAGE} />);
    expect(screen.queryByText(/FREE — NO APP/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Shop your next cut on your own head.')).not.toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    expect(container.innerHTML).not.toContain('landing_face2');
  });

  it('opens the new rundown entry mode and returns to the two choices', () => {
    render(<BarberCard page={PAGE} />);
    enterBestStyles();
    expect(barberBatchFlowPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        barberSlug: 'marcus',
        barberName: 'Marcus Rivera',
        bookingUrl: 'https://booksy.com/marcus',
      }),
    );
    fireEvent.click(screen.getByText('close-batch'));
    expect(screen.queryByTestId('barber-batch-flow-stub')).not.toBeInTheDocument();
    expect(screen.getByText('What are we doing today?')).toBeInTheDocument();
  });

  it('keeps lookbook tiles on the unchanged single-cut flow', () => {
    render(<BarberCard page={PAGE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try on burst fade, textured fringe' }));
    const props = barberTryOnPropsSpy.mock.calls[0][0] as { otherCuts: { slug: string }[] };
    expect(props.otherCuts.map((cut) => cut.slug)).toEqual(['blowout-taper']);
  });

  it('records view, style-specific try-on, link, and booking events', () => {
    render(<BarberCard page={PAGE} />);
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'view' });

    fireEvent.click(screen.getByRole('button', { name: 'Try on burst fade, textured fringe' }));
    expect(recordEventMock).toHaveBeenCalledWith({
      slug: 'marcus',
      kind: 'tryOn',
      cutSlug: 'burst-fade-textured-fringe',
    });

    fireEvent.click(screen.getByRole('link', { name: /Book an appointment/ }));
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'linkClick', cutSlug: undefined });
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'bookingClick', cutSlug: undefined });
  });

  it.each([
    ['Just doing a trim.', 'trim'],
    ['Show me my best hairstyles', 'batch'],
  ])('gates %s in the shared auth popup and continues after sign-in', async (label, intent) => {
    mockAuth = { isSignedIn: false };
    const { rerender } = render(<BarberCard page={PAGE} />);

    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('dialog', { name: 'One quick sign-in to continue.' })).toBeInTheDocument();
    expect(screen.getByTestId('signup-widget-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('barber-batch-flow-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('Sure. What kind of trim?')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('barber-card-intent:marcus')).toBe(intent);

    mockAuth = { isSignedIn: true };
    rerender(<BarberCard page={PAGE} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    if (intent === 'batch') {
      expect(screen.getByTestId('barber-batch-flow-stub')).toBeInTheDocument();
    } else {
      expect(screen.getByText('Sure. What kind of trim?')).toBeInTheDocument();
    }
  });

  it('lets signed-in visitors use either entry choice without opening auth', () => {
    const { unmount } = render(<BarberCard page={PAGE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Just doing a trim.' }));
    expect(screen.getByText('Sure. What kind of trim?')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    unmount();
    render(<BarberCard page={PAGE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show me my best hairstyles' }));
    expect(screen.getByTestId('barber-batch-flow-stub')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves referral attribution once after card-level sign-in', () => {
    const { rerender } = render(<BarberCard page={PAGE} />);
    rerender(<BarberCard page={PAGE} />);
    expect(getOrCreateMock).toHaveBeenCalledTimes(1);
    expect(getOrCreateMock).toHaveBeenCalledWith({ referralCode: 'ABC123' });
  });

  it('resumes an earlier active batch on mount', async () => {
    latestBatchMock = { _id: 'batch-1', status: 'ready' };
    render(<BarberCard page={PAGE} />);
    expect(await screen.findByTestId('barber-batch-flow-stub')).toBeInTheDocument();
  });

  it('renders the native scheduler and routes the trim CTA to it when booking is on', () => {
    const BOOKED_PAGE = {
      ...PAGE,
      booking: {
        timezone: 'America/Los_Angeles',
        slotMinutes: 30,
        days: [{ day: 2, start: '09:00', end: '18:00' }],
      },
    };
    const { container } = render(<BarberCard page={BOOKED_PAGE} />);
    // Scheduler lives on the barber's side of the card.
    expect(
      container.querySelector('.bc-side [data-testid="barber-booking-stub"]'),
    ).not.toBeNull();
    expect(barberBookingPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'marcus', barberName: 'Marcus Rivera', preview: false }),
    );

    // The trim branch books natively (a button, not the external link).
    fireEvent.click(screen.getByRole('button', { name: 'Just doing a trim.' }));
    expect(screen.queryByRole('link', { name: /Book appointment/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Book appointment/ })).toBeInTheDocument();
  });

  it('carries the tried-on cut into the native booking', () => {
    const BOOKED_PAGE = {
      ...PAGE,
      booking: {
        timezone: 'America/Los_Angeles',
        slotMinutes: 30,
        days: [{ day: 2, start: '09:00', end: '18:00' }],
      },
    };
    render(<BarberCard page={BOOKED_PAGE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try on blowout taper' }));
    expect(barberBookingPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ cutLabel: 'blowout taper' }),
    );
  });

  it('hides the scheduler when the barber has not enabled booking', () => {
    render(<BarberCard page={PAGE} />);
    expect(screen.queryByTestId('barber-booking-stub')).not.toBeInTheDocument();
  });

  it('offers the signed Wallet pass only on a configured public card', () => {
    const { rerender } = render(<BarberCard page={PAGE} walletEnabled />);
    expect(screen.getByRole('link', { name: 'Download Marcus Rivera’s Apple Wallet pass' }))
      .toHaveAttribute('href', '/api/barber/marcus/wallet');

    rerender(<BarberCard page={PAGE} walletEnabled preview />);
    expect(screen.queryByRole('link', { name: /Apple Wallet pass/ })).not.toBeInTheDocument();
  });

  it('keeps builder preview inert while rendering the real public structure', () => {
    const { container } = render(<BarberCard page={PAGE} preview />);
    fireEvent.click(screen.getByRole('button', { name: 'Show me my best hairstyles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try on blowout taper' }));
    fireEvent.click(screen.getByRole('link', { name: /Venmo/ }));
    expect(recordEventMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('barber-tryon-stub')).not.toBeInTheDocument();
    expect(container.querySelector('.bc-root')).toHaveClass('is-embedded');
  });
});
