// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const recordEventMock = vi.fn(() => Promise.resolve(null));
vi.mock('convex/react', () => ({ useMutation: () => recordEventMock }));
vi.mock('@convex/_generated/api', () => ({
  api: { barberPages: { recordEvent: 'barberPages:recordEvent' } },
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

async function enterBestStyles() {
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Show me my best hairstyles' }));
  expect(screen.getByRole('status', { name: 'Preparing the selfie camera' })).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(2250));
  vi.useRealTimers();
}

beforeEach(() => vi.clearAllMocks());
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

  it('passes only valid recommendations, in chosen order, as barber picks', async () => {
    render(
      <BarberCard page={{ ...PAGE, styles: ['blowout-taper', 'not-a-real-cut', 'burst-fade-textured-fringe'] }} />,
    );
    await enterBestStyles();
    const props = barberTryOnPropsSpy.mock.calls[0][0] as { barberPicks: { slug: string }[] };
    expect(props.barberPicks.map((cut) => cut.slug)).toEqual(['blowout-taper', 'burst-fade-textured-fringe']);
  });

  it('keeps best-style discovery available when the barber has no recommendations', () => {
    render(<BarberCard page={{ ...PAGE, styles: [] }} />);
    expect(screen.getByRole('button', { name: 'Show me my best hairstyles' })).toBeInTheDocument();
  });

  it('opens the try-on directly from a tapped lookbook tile — no orbit detour', () => {
    render(<BarberCard page={PAGE} />);
    expect(screen.getByText('Barber’s picks')).toBeInTheDocument();
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
    expect(screen.getByText('From the menu')).toBeInTheDocument();
    expect(container.querySelectorAll('.bc-tile')).toHaveLength(8);
  });

  it('gives the trim branch somewhere to go: booking and the try-on, no dead end', () => {
    render(<BarberCard page={PAGE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Just doing a trim.' }));

    const booking = screen.getByRole('link', { name: /Book with Marcus Rivera/ });
    expect(booking).toHaveAttribute('href', 'https://booksy.com/marcus');
    fireEvent.click(booking);
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'bookingClick', cutSlug: undefined });

    fireEvent.click(screen.getByRole('button', { name: /While you wait/ }));
    expect(screen.getByRole('status', { name: 'Preparing the selfie camera' })).toBeInTheDocument();
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

  it('opens the inline flow after the orbit and returns to the two choices', async () => {
    render(<BarberCard page={PAGE} />);
    await enterBestStyles();
    expect(screen.getByTestId('barber-tryon-stub')).toHaveTextContent('burst fade, textured fringe');
    expect(barberTryOnPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        barberSlug: 'marcus',
        barberName: 'Marcus Rivera',
        referralCode: 'ABC123',
        bookingUrl: 'https://booksy.com/marcus',
      }),
    );
    fireEvent.click(screen.getByText('all-styles'));
    expect(screen.queryByTestId('barber-tryon-stub')).not.toBeInTheDocument();
    expect(screen.getByText('What are we doing today?')).toBeInTheDocument();
  });

  it('passes the other valid recommendations to the flow', async () => {
    render(<BarberCard page={PAGE} />);
    await enterBestStyles();
    const props = barberTryOnPropsSpy.mock.calls[0][0] as { otherCuts: { slug: string }[] };
    expect(props.otherCuts.map((cut) => cut.slug)).toEqual(['blowout-taper']);
  });

  it('records view, style-specific try-on, link, and booking events', async () => {
    render(<BarberCard page={PAGE} />);
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'view' });

    await enterBestStyles();
    expect(recordEventMock).toHaveBeenCalledWith({
      slug: 'marcus',
      kind: 'tryOn',
      cutSlug: 'burst-fade-textured-fringe',
    });

    fireEvent.click(screen.getByRole('link', { name: /Book an appointment/ }));
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'linkClick', cutSlug: undefined });
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'bookingClick', cutSlug: undefined });
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
    expect(screen.queryByRole('link', { name: /Book with Marcus Rivera/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Book with Marcus Rivera/ })).toBeInTheDocument();
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
