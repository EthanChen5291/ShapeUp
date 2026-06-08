import Link from 'next/link';
import type { ReactNode } from 'react';

export type LegalPage = {
  title: string;
  updated: string;
  review: string;
  body: ReactNode;
};

const reviewBadge = 'PLACEHOLDER - NEEDS HUMAN/LEGAL REVIEW BEFORE PRODUCTION USE';

export const legalPages: Record<string, LegalPage> = {
  privacy: {
    title: 'Privacy Policy',
    updated: '2026-06-08',
    review: reviewBadge,
    body: (
      <>
        <p>
          This placeholder policy describes how [PLACEHOLDER_COMPANY_LEGAL_NAME] expects to handle ShapeUp account,
          payment, image, 3D asset, AI-processing, cookie, retention, and deletion data. It is not final legal text.
        </p>
        <h2>Information We Process</h2>
        <ul>
          <li>Account data from Clerk, such as login identifiers and authentication metadata.</li>
          <li>Payment workflow data handled by Stripe. ShapeUp should not store full card numbers.</li>
          <li>Face photos, scan metadata, PLY files, and SPLAT files stored in AWS S3 for the haircut visualization workflow.</li>
          <li>Hair-edit prompts and structured profile/parameter data sent to Google Gemini for AI edit and barber-spec generation.</li>
          <li>Essential cookies or similar technologies needed for authentication, security, payments, and app operation.</li>
        </ul>
        <h2>AI Processing</h2>
        <p>
          ShapeUp currently sends edit-loop and barber-summary prompts to Google Gemini. [PLACEHOLDER_DPA_CONTACT]
          must verify Gemini data-use, retention, and opt-out terms before launch.
        </p>
        <h2>Retention And Deletion</h2>
        <p>
          Proposed placeholder retention: keep account records while the account is active; keep scan images and derived
          assets until the user deletes the account/data or [PLACEHOLDER_RETENTION_PERIOD] expires; keep payment and
          security logs as required by law and fraud-prevention needs.
        </p>
        <h2>Your Rights</h2>
        <p>
          Depending on where you live, you may have rights to access, export, correct, delete, or restrict processing of
          personal information. Use <Link href="/delete-my-data">Delete my data</Link> or contact [PLACEHOLDER_PRIVACY_EMAIL].
        </p>
      </>
    ),
  },
  terms: {
    title: 'Terms of Service',
    updated: '2026-06-08',
    review: reviewBadge,
    body: (
      <>
        <p>
          These placeholder terms govern use of ShapeUp by [PLACEHOLDER_COMPANY_LEGAL_NAME]. They require legal review
          before they are shown as final terms.
        </p>
        <h2>Use Of The Service</h2>
        <p>
          ShapeUp provides virtual haircut visualization and barber-spec assistance. Results are illustrative and may not
          match a real haircut outcome.
        </p>
        <h2>Accounts, Credits, And Payments</h2>
        <p>
          Users are responsible for account security. Paid credits are processed through Stripe and used for AI/ML
          generation workflows. Refund rules require [PLACEHOLDER_REFUND_POLICY].
        </p>
        <h2>Acceptable Use</h2>
        <p>
          Use must comply with the <Link href="/acceptable-use">Acceptable Use Policy</Link>. Do not upload content you
          do not have rights or consent to use.
        </p>
        <h2>Disclaimers And Liability</h2>
        <p>
          [PLACEHOLDER_LIMITATION_OF_LIABILITY], [PLACEHOLDER_GOVERNING_LAW], and [PLACEHOLDER_DISPUTE_RESOLUTION]
          must be completed by counsel.
        </p>
      </>
    ),
  },
  accessibility: {
    title: 'Accessibility Statement',
    updated: '2026-06-08',
    review: reviewBadge,
    body: (
      <>
        <p>
          ShapeUp targets WCAG 2.1 AA accessibility. This statement is a production-readiness placeholder and needs
          human review plus assistive-technology testing.
        </p>
        <h2>Current Commitments</h2>
        <ul>
          <li>Support semantic landmarks, keyboard navigation, visible focus states, and reduced-motion preferences.</li>
          <li>Provide text alternatives for meaningful images and hide decorative imagery from assistive technology.</li>
          <li>Review color contrast, including lime-on-white usages flagged for design approval.</li>
        </ul>
        <h2>Report An Issue</h2>
        <p>
          Contact [PLACEHOLDER_ACCESSIBILITY_EMAIL] with the page URL, assistive technology used, browser, and a brief
          description of the issue.
        </p>
      </>
    ),
  },
  'acceptable-use': {
    title: 'Acceptable Use Policy',
    updated: '2026-06-08',
    review: reviewBadge,
    body: (
      <>
        <p>This placeholder policy describes prohibited abuse patterns for ShapeUp and ties into username moderation.</p>
        <h2>Do Not Use ShapeUp To</h2>
        <ul>
          <li>Upload images of another person without permission.</li>
          <li>Attempt to impersonate ShapeUp staff, support, moderators, or official accounts.</li>
          <li>Create profane, hateful, harassing, or abusive usernames or prompts.</li>
          <li>Probe, scrape, overload, reverse engineer, or bypass payment, rate limit, or consent controls.</li>
          <li>Submit illegal, exploitative, or non-consensual content.</li>
        </ul>
        <h2>Enforcement</h2>
        <p>
          ShapeUp may reject inputs, rate limit requests, suspend accounts, remove data, or block access where abuse is
          detected. [PLACEHOLDER_APPEALS_PROCESS] requires review.
        </p>
      </>
    ),
  },
  cookies: {
    title: 'Cookie And Tracking Notice',
    updated: '2026-06-08',
    review: reviewBadge,
    body: (
      <>
        <p>
          ShapeUp currently uses essential technologies for authentication, security, payments, and app operation. No
          non-essential analytics cookie banner was added because no non-essential analytics/tracking integration was
          found in source during this pass.
        </p>
        <h2>Essential Technologies</h2>
        <ul>
          <li>Clerk authentication session cookies or tokens.</li>
          <li>Stripe checkout/payment security flows.</li>
          <li>Convex real-time connection state needed for the app.</li>
        </ul>
        <h2>Future Non-Essential Tracking</h2>
        <p>
          If analytics, ads, or non-essential tracking are added later, ShapeUp should add an opt-in consent mechanism
          before those tools run.
        </p>
      </>
    ),
  },
  'biometric-notice': {
    title: 'Biometric Data Notice And Consent',
    updated: '2026-06-08',
    review: reviewBadge,
    body: (
      <>
        <p>
          ShapeUp processes face photos and derived 3D meshes such as PLY and SPLAT files to generate virtual haircut
          previews. These may be considered biometric identifiers or biometric information in some jurisdictions.
        </p>
        <h2>Purpose</h2>
        <p>
          We use face photos and derived geometry only to create, store, render, and refine your haircut visualization.
        </p>
        <h2>Consent</h2>
        <p>
          Before the first scan or upload, ShapeUp asks for explicit opt-in consent and records that consent in Convex.
          Upload and FaceLift processing routes reject requests when consent is not recorded.
        </p>
        <h2>Retention And Destruction</h2>
        <p>
          Placeholder schedule: delete face photos, PLY files, SPLAT files, scan sessions, and project assets when you
          request deletion or after [PLACEHOLDER_BIOMETRIC_RETENTION_PERIOD], whichever occurs first, unless law requires
          a different period. Legal counsel must finalize this schedule.
        </p>
        <h2>No Sale Of Biometric Data</h2>
        <p>ShapeUp does not sell biometric data. Disclosure rules and processor terms require legal review.</p>
        <h2>Delete Your Data</h2>
        <p>
          You can request deletion at <Link href="/delete-my-data">Delete my data</Link>.
        </p>
      </>
    ),
  },
};

export const legalSlugs = Object.keys(legalPages);
