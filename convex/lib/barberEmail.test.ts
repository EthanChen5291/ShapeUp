import { describe, it, expect } from "vitest";
import {
  buildBarberEmail,
  buildBookingBarberEmail,
  buildBookingClientEmail,
  type BookingEmailInput,
} from "./barberEmail";

describe("buildBarberEmail", () => {
  it("names the cut in the subject and greets the barber by name", () => {
    const { subject, html } = buildBarberEmail({
      displayName: "Marcus",
      cutLabel: "burst fade, textured fringe",
      imageUrl: "https://example.com/result.png",
      videoUrl: "https://example.com/turntable.mp4",
      clientRequest: "Keep the top airy, taper the neckline",
      clientEmail: "client@example.com",
    });
    expect(subject).toContain("burst fade, textured fringe");
    expect(html).toContain("Hi Marcus,");
    expect(html).toContain("https://example.com/result.png");
    expect(html).toContain("https://example.com/turntable.mp4");
    expect(html).toContain("Keep the top airy, taper the neckline");
    expect(html).toContain("View the client’s 360°");
  });

  it("joins email and phone when both are given", () => {
    const { html } = buildBarberEmail({
      displayName: "Marcus",
      cutLabel: "blowout taper",
      imageUrl: "https://example.com/x.png",
      clientEmail: "client@example.com",
      clientPhone: "4155550134",
    });
    expect(html).toContain("client@example.com · 4155550134");
  });

  it("falls back to a plain notice when no contact info was given", () => {
    const { html } = buildBarberEmail({
      displayName: "Marcus",
      cutLabel: "blowout taper",
      imageUrl: "https://example.com/x.png",
    });
    expect(html).toContain("no contact info given");
  });

  it("keeps the email useful when a render has no turntable clip", () => {
    const { html } = buildBarberEmail({
      displayName: "Marcus",
      cutLabel: "blowout taper",
      imageUrl: "https://example.com/x.png",
      clientRequest: "Just clean the neckline",
    });
    expect(html).toContain("360° clip was not available");
    expect(html).toContain("Just clean the neckline");
  });

  it("escapes hostile input in the barber name and cut label", () => {
    const { html } = buildBarberEmail({
      displayName: '<script>alert(1)</script>',
      cutLabel: '"><img onerror=alert(1)>',
      imageUrl: "https://example.com/x.png",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
  });
});

const BOOKING: BookingEmailInput = {
  barberName: "Marcus",
  shopName: "Fade Theory",
  location: "Telegraph Ave, Oakland",
  clientName: "Dre",
  clientEmail: "dre@example.com",
  clientPhone: "4155550134",
  service: "Skin fade",
  note: "First visit",
  startMs: Date.UTC(2026, 6, 14, 16, 0), // Tue 9:00 AM in LA
  endMs: Date.UTC(2026, 6, 14, 16, 30),
  timezone: "America/Los_Angeles",
};

describe("booking emails", () => {
  it("tells the barber who, when (their wall clock), and how to reach them", () => {
    const { subject, html } = buildBookingBarberEmail(BOOKING);
    expect(subject).toContain("Dre");
    expect(subject).toMatch(/Tuesday, July 14/);
    expect(html).toContain("9:00");
    expect(html).toContain("dre@example.com · 4155550134");
    expect(html).toContain("Skin fade");
    expect(html).toContain("calendar.google.com/calendar/render");
  });

  it("confirms the client with place, service, and a calendar link", () => {
    const { subject, html } = buildBookingClientEmail(BOOKING);
    expect(subject).toContain("Marcus");
    expect(html).toContain("Hi Dre,");
    expect(html).toContain("Telegraph Ave, Oakland");
    expect(html).toContain("calendar.google.com/calendar/render");
  });

  it("switches both sides to cancellation copy without calendar buttons", () => {
    const barber = buildBookingBarberEmail({ ...BOOKING, cancelled: true });
    const client = buildBookingClientEmail({ ...BOOKING, cancelled: true });
    expect(barber.subject).toMatch(/^Cancelled/);
    expect(client.subject).toMatch(/^Cancelled/);
    expect(barber.html).not.toContain("calendar.google.com");
    expect(client.html).not.toContain("calendar.google.com");
  });

  it("escapes hostile client names", () => {
    const { html } = buildBookingBarberEmail({
      ...BOOKING,
      clientName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>");
  });
});
