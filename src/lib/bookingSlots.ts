// Slot math is defined server-side (the server is the authority on what's
// bookable) and re-exported here so the card's picker renders exactly the
// grid barberBooking.book will accept. Same arrangement as barberLinks.
export {
  MAX_BOOKING_DAYS_AHEAD,
  MIN_LEAD_MS,
  SLOT_MINUTES_OPTIONS,
  dateISOInZone,
  isOfferedSlot,
  isValidTimeZone,
  normalizeBookingConfig,
  slotsForDate,
  upcomingDays,
  weekdayOfDateISO,
  zonedTimeToUtc,
} from '@convex/lib/bookingSlots';

export type {
  BookedInterval,
  BookingConfig,
  BookingConfigCheck,
  BookingDay,
  DaySlots,
} from '@convex/lib/bookingSlots';
