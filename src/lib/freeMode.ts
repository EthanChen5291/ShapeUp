// ─── Limited-time "everything free" mode ───
//
// While FREE_MODE is true, every generation is free: server-side credit/free-gen
// consumption is skipped and all currency-facing UI (token counters, pricing
// menus, "get more tokens", redeem, refund, phone-bonus, per-token pricing) is
// hidden so nothing hints that payment is required.
//
// This is a soft switch layered ON TOP of the existing billing code rather than
// a rip-out — flip it back to `false` to restore the paywall exactly as it was.
//
// Plain constant (no 'use client', no env plumbing) so it can be imported from
// both client components and server route handlers.
export const FREE_MODE = true;
