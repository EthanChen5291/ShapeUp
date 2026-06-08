# ShapeUp Production Hardening Notes

This document is implementation guidance, not legal advice.

## Rate Limits

- `/api/edit`: 20 requests/minute per signed-in user and 60 requests/minute per IP. This protects the Gemini edit loop while allowing rapid iteration.
- `/api/summary`: 10 requests/minute per signed-in user and 30 requests/minute per IP. Summary generation is less interactive, so the user limit is lower.
- `/api/save-scan`: 10 uploads/hour per signed-in user and 30 uploads/hour per IP, plus a 6 MB decoded image cap.
- `/api/facelift`: 5 submissions/10 minutes per signed-in user and 20 submissions/10 minutes per IP, in addition to credit deduction.
- `users.setUsername`: 5 changes/hour per signed-in user inside Convex.

The current limiter is in-memory for Next.js routes and Convex-table backed for Convex mutations. Production deployments with multiple server instances should move API route counters to shared storage such as Upstash Redis.

## Password Policy

Passwords are intentionally delegated to Clerk. ShapeUp does not store or validate passwords server-side. Before production, verify in the Clerk dashboard that password minimum length is at least 8 characters and that the selected complexity and breach-check settings match the product risk profile.

## Accessibility Notes

The lime accent `#B8E04A` fails WCAG AA contrast when used as text or critical UI on white. A candidate accessible replacement for white backgrounds is `#6B8700`; `#8FB800` is acceptable as a visible focus indicator and may be usable on dark backgrounds, but final color approval needs design review.

The UI now includes a global `:focus-visible` outline, broader reduced-motion handling, legal/accessibility pages, and screen-reader live status updates in the hair editor. A full keyboard and screen-reader QA pass is still recommended before launch.

## Legal And Business Placeholders

- `[PLACEHOLDER_COMPANY_LEGAL_NAME]`
- `[PLACEHOLDER_COMPANY_ADDRESS]`
- `[PLACEHOLDER_PRIVACY_EMAIL]`
- `[PLACEHOLDER_DPA_CONTACT]`
- `[PLACEHOLDER_SECURITY_EMAIL]`
- `[PLACEHOLDER_SECURITY_ACK_SLA]`
- `[PLACEHOLDER_RETENTION_PERIOD]`
- `[PLACEHOLDER_BIOMETRIC_RETENTION_PERIOD]`
- `[PLACEHOLDER_REFUND_POLICY]`
- `[PLACEHOLDER_LIMITATION_OF_LIABILITY]`
- `[PLACEHOLDER_GOVERNING_LAW]`
- `[PLACEHOLDER_DISPUTE_RESOLUTION]`
- `[PLACEHOLDER_ACCESSIBILITY_EMAIL]`
- `[PLACEHOLDER_APPEALS_PROCESS]`

## Needs Human/Legal Review

- Privacy Policy: especially Google Gemini data processing, Clerk/Stripe processor terms, cookie disclosures, retention periods, and jurisdiction-specific rights.
- Biometric Data Notice: especially Illinois BIPA, Texas CUBI, Washington biometric privacy law applicability, retention/destruction schedule, and consent language.
- Terms of Service, Acceptable Use Policy, Accessibility Statement, Cookie Notice, and data deletion language.

## Deferred

- Clerk webhooks are not currently used. If lifecycle automation is added, implement a signed `/api/clerk/webhook` handler using Svix verification.
- Legacy session rows created before `sessions.userId` cannot be automatically attributed during account deletion. Consider a one-time migration/backfill where a safe mapping exists.
- API route rate limiting should use shared durable storage before multi-instance production deployment.
