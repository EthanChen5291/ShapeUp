import { describe, expect, test } from "vitest";
import { buildIcs, formatEventTime, googleCalendarUrl } from "./calendarLinks";

const EVENT = {
  title: "Haircut with Marcus",
  details: "Skin fade — booked via ShapeUp",
  location: "Fade Theory, Oakland",
  startMs: Date.UTC(2026, 6, 14, 16, 0), // 9:00 LA
  endMs: Date.UTC(2026, 6, 14, 16, 30),
};

describe("googleCalendarUrl", () => {
  test("builds a prefilled template link with UTC-stamped dates", () => {
    const url = new URL(googleCalendarUrl(EVENT));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Haircut with Marcus");
    expect(url.searchParams.get("dates")).toBe("20260714T160000Z/20260714T163000Z");
    expect(url.searchParams.get("location")).toBe("Fade Theory, Oakland");
  });

  test("omits empty optional fields", () => {
    const url = new URL(googleCalendarUrl({ ...EVENT, details: undefined, location: undefined }));
    expect(url.searchParams.has("details")).toBe(false);
    expect(url.searchParams.has("location")).toBe(false);
  });
});

describe("buildIcs", () => {
  test("emits a valid single-event calendar with CRLF endings", () => {
    const ics = buildIcs({ ...EVENT, uid: "booking-123@tryshapeup.cc" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:booking-123@tryshapeup.cc");
    expect(ics).toContain("DTSTART:20260714T160000Z");
    expect(ics).toContain("DTEND:20260714T163000Z");
    expect(ics).toContain("SUMMARY:Haircut with Marcus");
    expect(ics).toContain("LOCATION:Fade Theory\\, Oakland");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  test("escapes newlines and semicolons in text fields", () => {
    const ics = buildIcs({
      ...EVENT,
      uid: "u1",
      details: "line one\nline two; done",
    });
    expect(ics).toContain("DESCRIPTION:line one\\nline two\\; done");
  });
});

describe("formatEventTime", () => {
  test("renders the barber's wall clock, not UTC", () => {
    const label = formatEventTime(EVENT.startMs, "America/Los_Angeles");
    expect(label).toMatch(/Tuesday, July 14/);
    expect(label).toMatch(/9:00 AM|9:00 AM/);
  });
});
