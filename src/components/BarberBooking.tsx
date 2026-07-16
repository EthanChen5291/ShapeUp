'use client';

// ============================================================
// BarberBooking — the native "pick a time" panel on /b/<slug>.
//
// Renders the same slot grid the server will validate (the math is shared —
// src/lib/bookingSlots re-exports convex/lib/bookingSlots), enriched live
// with already-booked intervals from barberBooking.getAvailability, so a slot
// someone else just took disappears in real time.
//
// Flow: day chip → slot chip → (sign-in if needed) → confirm → booked, with
// "Add to Google Calendar" + .ics on the success screen. Times are always the
// BARBER's wall clock; when the visitor's device is in a different zone the
// panel says so instead of silently confusing them.
//
// In the builder's live preview (`preview`) the grid renders from the form's
// config with booking disabled — no queries, no mutations, no sign-in.
// ============================================================

import { useMemo, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@convex/_generated/api';
import SignUpWidget from '@/components/SignUpWidget';
import { upcomingDays, type BookingConfig } from '@/lib/bookingSlots';
import { buildIcs, googleCalendarUrl } from '@/lib/calendarLinks';
import { useT } from '@/lib/i18n';

export interface BarberBookingProps {
  slug: string;
  barberName: string;
  shopName?: string;
  location?: string;
  services?: { name: string; price?: string }[];
  /** The page's booking config (enabled implied by presence). */
  booking: { timezone: string; slotMinutes: number; days: { day: number; start: string; end: string }[] };
  /** When set (the cut just tried on), carried into the booking note. */
  cutLabel?: string;
  /** Builder preview: render the grid, never book. */
  preview?: boolean;
  /** Fired once when a booking lands — the card counts it as a bookingClick. */
  onBooked?: () => void;
}

function CalendarIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** "Tue, Jul 14" for a barber-calendar date, zone-shift-proof. */
function dayChipLabel(dateISO: string, locale?: string): { weekday: string; date: string } {
  const [y, m, d] = dateISO.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(noon),
    date: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(noon),
  };
}

function slotLabel(startMs: number, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(startMs));
}

/** "Oakland time" beats "America/Los_Angeles". */
function zoneCity(tz: string): string {
  const city = tz.split('/').pop() ?? tz;
  return city.replaceAll('_', ' ');
}

type Phase = 'pick' | 'confirm' | 'booking' | 'booked';

export default function BarberBooking({
  slug,
  barberName,
  shopName,
  location,
  services,
  booking,
  cutLabel,
  preview = false,
  onBooked,
}: BarberBookingProps) {
  const t = useT();
  const { isSignedIn, user } = useUser();
  const book = useMutation(api.barberBooking.book);

  // Live schedule + booked intervals; the page's config is the fallback so the
  // grid renders immediately (and in the builder preview, exclusively).
  const availability = useQuery(api.barberBooking.getAvailability, preview ? 'skip' : { slug });
  const config: BookingConfig = useMemo(
    () => ({
      enabled: true,
      timezone: availability?.timezone ?? booking.timezone,
      slotMinutes: availability?.slotMinutes ?? booking.slotMinutes,
      days: availability?.days ?? booking.days,
    }),
    [availability, booking],
  );

  const [phase, setPhase] = useState<Phase>('pick');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [service, setService] = useState('');
  const [error, setError] = useState('');
  const [bookedSlot, setBookedSlot] = useState<{ startMs: number; endMs: number } | null>(null);

  const days = useMemo(
    () => upcomingDays(config, Date.now(), availability?.booked ?? []),
    [config, availability],
  );
  const openDays = days.filter((d) => d.slotStartsMs.length > 0);
  const activeDay = openDays.find((d) => d.dateISO === selectedDay) ?? openDays[0];

  const viewerZone =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const crossZone = viewerZone !== undefined && viewerZone !== config.timezone;

  // A selected slot can vanish under us (someone books it live) — drop back.
  const activeSlotGone =
    selectedSlot !== null && activeDay !== undefined && !activeDay.slotStartsMs.includes(selectedSlot);

  const pickSlot = (startMs: number) => {
    if (preview) return;
    setSelectedSlot(startMs);
    setError('');
    setPhase('confirm');
    if (!clientName && user?.fullName) setClientName(user.fullName);
  };

  const confirm = async () => {
    if (selectedSlot === null) return;
    setPhase('booking');
    setError('');
    try {
      const result = await book({
        slug,
        startMs: selectedSlot,
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim() || undefined,
        service: service || undefined,
        note: cutLabel ? t('Cut I tried on: {cut}', { cut: cutLabel }) : undefined,
      });
      setBookedSlot(result);
      setPhase('booked');
      onBooked?.();
    } catch (e) {
      setError(
        e instanceof ConvexError
          ? (e.data as string)
          : t('Something went wrong. Check your connection and try again.'),
      );
      setSelectedSlot(null);
      setPhase('pick');
    }
  };

  // ── booked: the receipt, with calendar handoffs ──
  if (phase === 'booked' && bookedSlot) {
    const whenLabel = new Intl.DateTimeFormat(undefined, {
      timeZone: config.timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(bookedSlot.startMs));
    const event = {
      title: t('Haircut with {name}', { name: barberName }),
      details: [service, cutLabel ? t('Cut I tried on: {cut}', { cut: cutLabel }) : undefined]
        .filter(Boolean)
        .join(' · ') || undefined,
      location: location ?? shopName,
      startMs: bookedSlot.startMs,
      endMs: bookedSlot.endMs,
    };
    const icsHref = `data:text/calendar;charset=utf-8,${encodeURIComponent(
      buildIcs({ ...event, uid: `shapeup-${slug}-${bookedSlot.startMs}@tryshapeup.cc` }),
    )}`;
    return (
      <section className="bb-panel" aria-label={t('Book a time')}>
        <div className="bb-done" role="status">
          <span className="bb-done-mark" aria-hidden><CheckIcon /></span>
          <p className="bb-done-title">{t('You’re booked.')}</p>
          <p className="bb-done-when font-sans">{whenLabel}</p>
          {crossZone ? (
            <p className="bb-zone-hint font-mono">{t('{city} time', { city: zoneCity(config.timezone) })}</p>
          ) : null}
          <div className="bb-done-actions">
            <a className="bb-cal-btn" href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
              <CalendarIcon />
              {t('Add to Google Calendar')}
            </a>
            <a className="bb-cal-btn is-quiet" href={icsHref} download="appointment.ics">
              <CalendarIcon />
              {t('Apple / Outlook (.ics)')}
            </a>
          </div>
          <p className="bb-done-note font-sans">
            {t('{name} got the details — just show up.', { name: barberName })}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="bb-panel" aria-label={t('Book a time')} id="bb-book">
      <div className="bb-head">
        <h2 className="bc-side-heading font-mono">{t('Book a chair')}</h2>
        {crossZone ? (
          <span className="bb-zone-hint font-mono">
            {t('{city} time', { city: zoneCity(config.timezone) })}
          </span>
        ) : null}
      </div>

      {openDays.length === 0 ? (
        <p className="bb-empty font-sans">{t('No open times in the next two weeks — reach out directly.')}</p>
      ) : (
        <>
          {/* day rail */}
          <div className="bb-days" role="group" aria-label={t('Pick a day')}>
            {openDays.map((day) => {
              const label = dayChipLabel(day.dateISO);
              const on = day.dateISO === activeDay?.dateISO;
              return (
                <button
                  key={day.dateISO}
                  type="button"
                  className={`bb-day${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    setSelectedDay(day.dateISO);
                    setSelectedSlot(null);
                    setError('');
                    setPhase('pick');
                  }}
                >
                  <span className="bb-day-dow font-mono">{label.weekday}</span>
                  <span className="bb-day-date font-sans">{label.date}</span>
                </button>
              );
            })}
          </div>

          {/* slot grid */}
          {activeDay ? (
            <div className="bb-slots" role="group" aria-label={t('Pick a time')}>
              {activeDay.slotStartsMs.map((startMs) => {
                const on = selectedSlot === startMs && !activeSlotGone;
                return (
                  <button
                    key={startMs}
                    type="button"
                    className={`bb-slot font-sans${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    disabled={phase === 'booking'}
                    onClick={() => pickSlot(startMs)}
                  >
                    {slotLabel(startMs, config.timezone)}
                  </button>
                );
              })}
            </div>
          ) : null}

          {error ? <p className="bb-error font-sans" role="alert">{error}</p> : null}

          {/* confirm step */}
          {(phase === 'confirm' || phase === 'booking') && selectedSlot !== null && !activeSlotGone ? (
            !isSignedIn ? (
              <div className="bb-auth">
                <p className="bb-auth-copy font-sans">
                  {t('One quick sign-in so {name} knows the booking is real.', { name: barberName })}
                </p>
                <SignUpWidget onEnter={() => {}} />
              </div>
            ) : (
              <form
                className="bb-confirm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirm();
                }}
              >
                <p className="bb-confirm-when font-sans">
                  {new Intl.DateTimeFormat(undefined, {
                    timeZone: config.timezone,
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date(selectedSlot))}
                </p>
                <label className="bb-field">
                  <span className="font-mono">{t('Your name')}</span>
                  <input
                    className="bb-input font-sans"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    maxLength={80}
                    required
                    disabled={phase === 'booking'}
                    autoComplete="name"
                  />
                </label>
                <label className="bb-field">
                  <span className="font-mono">{t('Phone (optional)')}</span>
                  <input
                    className="bb-input font-sans"
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="(415) 555-0134"
                    maxLength={30}
                    disabled={phase === 'booking'}
                    autoComplete="tel"
                  />
                </label>
                {services && services.length > 0 ? (
                  <label className="bb-field">
                    <span className="font-mono">{t('Service (optional)')}</span>
                    <select
                      className="bb-input font-sans"
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                      disabled={phase === 'booking'}
                    >
                      <option value="">{t('Just a cut')}</option>
                      {services.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.price ? `${s.name} — ${s.price}` : s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  type="submit"
                  className="bb-book-btn"
                  disabled={phase === 'booking' || !clientName.trim()}
                >
                  {phase === 'booking'
                    ? t('Booking…')
                    : t('Book {time}', { time: slotLabel(selectedSlot, config.timezone) })}
                </button>
              </form>
            )
          ) : null}
        </>
      )}
    </section>
  );
}
