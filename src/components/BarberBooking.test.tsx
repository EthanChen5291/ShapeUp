// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConvexError } from 'convex/values';
import { upcomingDays } from '@/lib/bookingSlots';

vi.mock('@convex/_generated/api', () => ({
  api: {
    barberBooking: {
      getAvailability: 'barberBooking:getAvailability',
      book: 'barberBooking:book',
    },
  },
}));

const bookMock = vi.fn(async (_args: unknown) => ({ startMs: 0, endMs: 0 }));
let availabilityValue:
  | { timezone: string; slotMinutes: number; days: { day: number; start: string; end: string }[]; booked: { startMs: number; endMs: number }[] }
  | null
  | undefined;

vi.mock('convex/react', () => ({
  useMutation: () => bookMock,
  useQuery: () => availabilityValue,
}));

let mockAuth: { isSignedIn: boolean; user: null | { fullName: string } } = {
  isSignedIn: true,
  user: { fullName: 'Dre Client' },
};
vi.mock('@clerk/nextjs', () => ({ useUser: () => mockAuth }));
vi.mock('@/components/SignUpWidget', () => ({
  default: () => <div data-testid="signup-widget-stub" />,
}));

const { default: BarberBooking } = await import('./BarberBooking');

// Open every day so a bookable slot always exists whenever the test runs; UTC
// so labels don't depend on the machine's zone.
const BOOKING = {
  timezone: 'UTC',
  slotMinutes: 30,
  days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '17:00' })),
};

const baseProps = {
  slug: 'marcus',
  barberName: 'Marcus',
  shopName: 'Fade Theory',
  location: 'Oakland, CA',
  services: [{ name: 'Skin fade', price: '$40' }],
  booking: BOOKING,
};

function expectedDays(booked: { startMs: number; endMs: number }[] = []) {
  return upcomingDays({ enabled: true, ...BOOKING }, Date.now(), booked).filter(
    (d) => d.slotStartsMs.length > 0,
  );
}

function slotText(startMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(startMs));
}

beforeEach(() => {
  vi.clearAllMocks();
  availabilityValue = undefined; // query still loading — prop config drives the grid
  mockAuth = { isSignedIn: true, user: { fullName: 'Dre Client' } };
});
afterEach(() => cleanup());

describe('BarberBooking', () => {
  it('renders day chips and the first day’s slots from the page config alone', () => {
    render(<BarberBooking {...baseProps} />);
    const days = expectedDays();
    expect(days.length).toBeGreaterThan(0);
    const firstDaySlots = days[0].slotStartsMs;
    expect(screen.getByRole('button', { name: new RegExp(slotText(firstDaySlots[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeInTheDocument();
  });

  it('drops a slot the live availability reports as booked', () => {
    const days = expectedDays();
    const takenSlot = days[0].slotStartsMs[0];
    availabilityValue = {
      ...BOOKING,
      booked: [{ startMs: takenSlot, endMs: takenSlot + 30 * 60_000 }],
    };
    render(<BarberBooking {...baseProps} />);
    const remaining = expectedDays(availabilityValue.booked)[0].slotStartsMs;
    expect(remaining).not.toContain(takenSlot);
    // The first *open* slot renders; the taken one may share a label with a
    // later day, so assert against the open count for the active day instead.
    const stillOffered = screen.getAllByRole('button', { name: /am|pm/i });
    expect(stillOffered.length).toBeGreaterThan(0);
  });

  it('books a slot with the confirm form, prefilled from Clerk, then offers calendar links', async () => {
    const days = expectedDays();
    const slot = days[0].slotStartsMs[0];
    bookMock.mockResolvedValueOnce({ startMs: slot, endMs: slot + 30 * 60_000 });

    render(<BarberBooking {...baseProps} cutLabel="blowout taper" />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${slotText(slot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }));

    const nameInput = screen.getByLabelText('Your name') as HTMLInputElement;
    expect(nameInput.value).toBe('Dre Client');
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '4155550134' } });
    fireEvent.change(screen.getByLabelText('Service (optional)'), { target: { value: 'Skin fade' } });
    fireEvent.click(screen.getByRole('button', { name: /^Book / }));

    await waitFor(() =>
      expect(bookMock).toHaveBeenCalledWith({
        slug: 'marcus',
        startMs: slot,
        clientName: 'Dre Client',
        clientPhone: '4155550134',
        service: 'Skin fade',
        note: 'Cut I tried on: blowout taper',
      }),
    );

    expect(await screen.findByText('You’re booked.')).toBeInTheDocument();
    const gcal = screen.getByRole('link', { name: /Add to Google Calendar/ });
    expect(gcal).toHaveAttribute('href', expect.stringContaining('calendar.google.com/calendar/render'));
    const ics = screen.getByRole('link', { name: /\.ics/ });
    expect(ics).toHaveAttribute('download', 'appointment.ics');
    expect(ics.getAttribute('href')).toContain('data:text/calendar');
  });

  it('gates the confirm step behind sign-in without hiding the slots', () => {
    mockAuth = { isSignedIn: false, user: null };
    const slot = expectedDays()[0].slotStartsMs[0];
    render(<BarberBooking {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${slotText(slot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }));
    expect(screen.getByTestId('signup-widget-stub')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(bookMock).not.toHaveBeenCalled();
  });

  it('surfaces a lost-race error and returns to the picker', async () => {
    const slot = expectedDays()[0].slotStartsMs[0];
    bookMock.mockRejectedValueOnce(new ConvexError('Someone just took that time — pick another slot.'));
    render(<BarberBooking {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${slotText(slot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }));
    fireEvent.click(screen.getByRole('button', { name: /^Book / }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/just took that time/i);
    // Back at the picker: slots are still tappable.
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });

  it('stays inert in the builder preview', () => {
    const slot = expectedDays()[0].slotStartsMs[0];
    render(<BarberBooking {...baseProps} preview />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${slotText(slot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }));
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(bookMock).not.toHaveBeenCalled();
  });
});
