// Calendar links (Google template URL + .ics) — defined server-side next to
// the email senders, re-exported for the booking success screen.
export {
  buildIcs,
  formatEventTime,
  googleCalendarUrl,
} from '@convex/lib/calendarLinks';

export type { CalendarEvent } from '@convex/lib/calendarLinks';
