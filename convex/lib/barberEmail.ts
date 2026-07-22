// ============================================================
// The emails around a barber card: the try-on handoff a barber gets when a
// client sends them a cut, and the appointment emails both sides get when a
// client books a slot.
//
// Kept pure (no fetch, no Convex imports) so the content can be unit tested
// without a network call — convex/barberTryOn.ts and convex/barberBooking.ts
// do the actual sending.
// ============================================================

import { formatEventTime, googleCalendarUrl } from "./calendarLinks";

export interface BarberEmailInput {
  /** The barber's own display name, for the greeting. */
  displayName: string;
  /** The hairstyle label the client tried on. */
  cutLabel: string;
  /** URL of the AI-edited preview image to embed. */
  imageUrl: string;
  /** Stable URL for the finished turntable MP4. */
  videoUrl?: string;
  /** The exact request/prompt the client used for the final render. */
  clientRequest?: string;
  /** Batch recommendation details, present only for the multi-style handoff. */
  styleTitle?: string;
  stylePrompt?: string;
  hairProfile?: string;
  /** However the client chose to be reached — at least one should be present. */
  clientEmail?: string;
  clientPhone?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildBarberEmail(input: BarberEmailInput): { subject: string; html: string } {
  const contactLine = [input.clientEmail, input.clientPhone].filter(Boolean).join(" · ") || "no contact info given";
  const request = input.clientRequest?.trim() || input.cutLabel;
  const batchRows: [string, string][] = [];
  if (input.styleTitle?.trim()) batchRows.push(["Selected style", input.styleTitle.trim()]);
  if (input.stylePrompt?.trim()) batchRows.push(["Exact style prompt", input.stylePrompt.trim()]);
  if (input.hairProfile?.trim()) batchRows.push(["Hair profile", input.hairProfile.trim()]);
  const batchDetails = batchRows.length > 0 ? detailRows(batchRows) : "";

  const subject = `A client wants "${input.cutLabel}" — from your ShapeUp card`;

  const videoButton = input.videoUrl
    ? `<a href="${escapeHtml(input.videoUrl)}" style="display:block;background:#ef6b55;color:#170a07;text-decoration:none;text-align:center;font-weight:800;font-size:15px;padding:15px 20px;border-radius:12px;margin:18px 0 0;">View the client’s 360°</a>`
    : `<div style="margin-top:16px;padding:12px 14px;border:1px solid #eadfd5;border-radius:10px;color:#776a61;font-size:12px;">The still preview is attached below; the 360° clip was not available for this render.</div>`;

  const html = `<!doctype html>
  <html><body style="margin:0;background:#f3eee7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#211914;">
    <div style="max-width:560px;margin:0 auto;background:#fffdf9;border:1px solid #e8ded4;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(55,38,27,.10);">
      <div style="background:#151416;padding:22px 26px;border-bottom:3px solid #ef6b55;">
        <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#ef6b55;font-weight:800;">ShapeUp · client handoff</div>
        <div style="margin-top:8px;color:#fffaf3;font-size:24px;line-height:1.15;font-weight:800;">A cut is ready for your chair.</div>
      </div>
      <div style="padding:26px;">
        <p style="margin:0 0 8px;font-size:16px;">Hi ${escapeHtml(input.displayName)},</p>
        <p style="margin:0 0 22px;color:#6f6258;font-size:14px;line-height:1.6;">A client scanned your barber page, tried on <strong style="color:#211914;">${escapeHtml(input.cutLabel)}</strong>, and sent you the finished reference.</p>

        <div style="background:#19181a;border-radius:16px;padding:10px;">
          <img src="${escapeHtml(input.imageUrl)}" alt="Client wearing the requested cut" style="display:block;width:100%;max-height:520px;object-fit:cover;border-radius:11px;" />
          ${videoButton}
        </div>

        <div style="margin-top:18px;background:#fff4e8;border-left:4px solid #ef6b55;border-radius:0 12px 12px 0;padding:16px 18px;">
          <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9b4c3c;font-weight:800;">What they asked for</div>
          <div style="margin-top:7px;font-family:Georgia,serif;font-size:17px;line-height:1.45;color:#2c211b;">“${escapeHtml(request)}”</div>
        </div>

        ${batchDetails}

        <div style="margin-top:18px;padding:16px 18px;border:1px solid #eadfd5;border-radius:12px;">
          <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8a796c;font-weight:800;">Client contact</div>
          <div style="margin-top:7px;font-size:14px;font-weight:700;color:#2c211b;">${escapeHtml(contactLine)}</div>
        </div>

        <p style="color:#94867a;font-size:11px;line-height:1.55;margin:24px 0 0;">This reference was sent from your ShapeUp barber page. Confirm the final cut and any adjustments with your client in the chair.</p>
      </div>
    </div>
  </body></html>`;

  return { subject, html };
}

// ── appointment emails ──────────────────────────────────────

export interface BookingEmailInput {
  barberName: string;
  shopName?: string;
  location?: string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  service?: string;
  price?: string;
  note?: string;
  startMs: number;
  endMs: number;
  /** The barber's IANA timezone — times are written as their wall clock. */
  timezone: string;
  cancelled?: boolean;
}

function bookingEvent(input: BookingEmailInput, forBarber: boolean) {
  return {
    title: forBarber
      ? `${input.clientName} — ${input.service ?? "haircut"} (ShapeUp)`
      : `Haircut with ${input.barberName}`,
    details: [input.service, input.price, input.note, "Booked via ShapeUp"].filter(Boolean).join(" · "),
    location: input.location ?? input.shopName,
    startMs: input.startMs,
    endMs: input.endMs,
  };
}

function bookingShell(headline: string, body: string): string {
  return `<!doctype html>
  <html><body style="margin:0;background:#f3eee7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#211914;">
    <div style="max-width:560px;margin:0 auto;background:#fffdf9;border:1px solid #e8ded4;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(55,38,27,.10);">
      <div style="background:#151416;padding:22px 26px;border-bottom:3px solid #ef6b55;">
        <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#ef6b55;font-weight:800;">ShapeUp · appointments</div>
        <div style="margin-top:8px;color:#fffaf3;font-size:24px;line-height:1.15;font-weight:800;">${headline}</div>
      </div>
      <div style="padding:26px;">${body}</div>
    </div>
  </body></html>`;
}

function detailRows(rows: [string, string][]): string {
  return rows
    .map(
      ([label, value]) => `
        <div style="margin-top:14px;padding:14px 18px;border:1px solid #eadfd5;border-radius:12px;">
          <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8a796c;font-weight:800;">${escapeHtml(label)}</div>
          <div style="margin-top:6px;font-size:15px;font-weight:700;color:#2c211b;">${escapeHtml(value)}</div>
        </div>`,
    )
    .join("");
}

function calendarButton(url: string): string {
  return `<a href="${escapeHtml(url)}" style="display:block;background:#ef6b55;color:#170a07;text-decoration:none;text-align:center;font-weight:800;font-size:15px;padding:15px 20px;border-radius:12px;margin:22px 0 0;">Add to Google Calendar</a>
    <p style="color:#94867a;font-size:11px;line-height:1.55;margin:10px 0 0;text-align:center;">Use the attached invite (.ics) for Apple or Outlook calendars.</p>`;
}

/** What the barber gets when a client books a slot on their card. */
export function buildBookingBarberEmail(input: BookingEmailInput): { subject: string; html: string } {
  const when = formatEventTime(input.startMs, input.timezone);
  const contactLine =
    [input.clientEmail, input.clientPhone].filter(Boolean).join(" · ") || "no contact info given";

  if (input.cancelled) {
    const subject = `Cancelled: ${input.clientName} on ${when}`;
    const body = `
      <p style="margin:0 0 8px;font-size:16px;">Hi ${escapeHtml(input.barberName)},</p>
      <p style="margin:0;color:#6f6258;font-size:14px;line-height:1.6;">The appointment below was cancelled — the slot is open again on your card.</p>
      ${detailRows([
        ["When", when],
        ["Client", input.clientName],
      ])}`;
    return { subject, html: bookingShell("An appointment was cancelled.", body) };
  }

  const subject = `New booking: ${input.clientName} — ${when}`;
  const rows: [string, string][] = [
    ["When", when],
    ["Client", input.clientName],
    ["Contact", contactLine],
  ];
  if (input.service) rows.push(["Service", input.service]);
  if (input.price) rows.push(["Price", input.price]);
  if (input.note) rows.push(["Note", input.note.slice(0, 500)]);
  const body = `
    <p style="margin:0 0 8px;font-size:16px;">Hi ${escapeHtml(input.barberName)},</p>
    <p style="margin:0;color:#6f6258;font-size:14px;line-height:1.6;">A client just booked a chair through your ShapeUp card.</p>
    ${detailRows(rows)}
    ${calendarButton(googleCalendarUrl(bookingEvent(input, true)))}`;
  return { subject, html: bookingShell("You have a new appointment.", body) };
}

/** The confirmation the client gets after booking. */
export function buildBookingClientEmail(input: BookingEmailInput): { subject: string; html: string } {
  const when = formatEventTime(input.startMs, input.timezone);

  if (input.cancelled) {
    const subject = `Cancelled: your appointment with ${input.barberName}`;
    const body = `
      <p style="margin:0 0 8px;font-size:16px;">Hi ${escapeHtml(input.clientName)},</p>
      <p style="margin:0;color:#6f6258;font-size:14px;line-height:1.6;">${escapeHtml(input.barberName)} had to cancel your appointment on <strong>${escapeHtml(when)}</strong>. Their card has the open times if you'd like to rebook.</p>`;
    return { subject, html: bookingShell("Your appointment was cancelled.", body) };
  }

  const subject = `Booked: ${input.barberName}, ${when}`;
  const rows: [string, string][] = [
    ["When", when],
    ["With", input.shopName ? `${input.barberName} · ${input.shopName}` : input.barberName],
  ];
  if (input.location) rows.push(["Where", input.location]);
  if (input.service) rows.push(["Service", input.service]);
  if (input.price) rows.push(["Price", input.price]);
  const body = `
    <p style="margin:0 0 8px;font-size:16px;">Hi ${escapeHtml(input.clientName)},</p>
    <p style="margin:0;color:#6f6258;font-size:14px;line-height:1.6;">You're on ${escapeHtml(input.barberName)}'s books.</p>
    ${detailRows(rows)}
    ${calendarButton(googleCalendarUrl(bookingEvent(input, false)))}`;
  return { subject, html: bookingShell("You're booked.", body) };
}
