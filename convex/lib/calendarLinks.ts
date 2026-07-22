// ============================================================
// "Put it on the calendar" without OAuth.
//
// A booking lands on the barber's (and client's) Google Calendar through a
// prefilled template URL, and on everything else through a standard .ics
// file — no Google Cloud app, no tokens to store, works from an email.
// Pure string-building so it's unit-testable; convex/barberBooking.ts and the
// client success screen both consume it (re-exported via
// src/lib/calendarLinks.ts).
// ============================================================

export interface CalendarEvent {
  title: string;
  details?: string;
  location?: string;
  startMs: number;
  endMs: number;
}

/** "20260716T170000Z" — the compact UTC stamp both formats want. */
function utcStamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A calendar.google.com link that opens a prefilled "save event" screen. */
export function googleCalendarUrl(ev: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${utcStamp(ev.startMs)}/${utcStamp(ev.endMs)}`,
  });
  if (ev.details) params.set("details", ev.details);
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// TEXT values in iCalendar escape backslash, semicolon, comma, and newlines
// (RFC 5545 §3.3.11).
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * A minimal single-event VCALENDAR. `uid` must be stable per booking so a
 * re-download updates the same event instead of duplicating it.
 */
export function buildIcs(ev: CalendarEvent & { uid: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ShapeUp//Barber Booking//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${icsEscape(ev.uid)}`,
    `DTSTAMP:${utcStamp(Date.now())}`,
    `DTSTART:${utcStamp(ev.startMs)}`,
    `DTEND:${utcStamp(ev.endMs)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    "STATUS:CONFIRMED",
    ...(ev.details ? [`DESCRIPTION:${icsEscape(ev.details)}`] : []),
    ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Event time as the barber's wall clock reads it, for email/UI copy. */
export function formatEventTime(epochMs: number, timeZone: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochMs));
}
