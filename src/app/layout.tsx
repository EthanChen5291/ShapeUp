import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Fraunces, DM_Sans, JetBrains_Mono, Montserrat } from 'next/font/google';
import { ConvexClerkProvider } from '@/components/ConvexClerkProvider';
import { PostHogProvider } from '@/components/PostHogProvider';
import { NavLoadingProvider } from '@/components/NavLoadingOverlay';
import { SettingsProvider } from '@/contexts/SettingsContext';
import './globals.css';

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dmsans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['400', '500'],
  display: 'swap',
});

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  weight: ['700', '800'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://tryshapeup.cc'),
  title: 'ShapeUp Barber Cards',
  description: 'Your barber link, booking page, visual consultation, QR code, and performance stats in one place.',
  openGraph: {
    type: 'website',
    title: 'ShapeUp Barber Cards',
    description: 'One barber link for bookings, services, visual consultations, QR sharing, and stats.',
    url: 'https://tryshapeup.cc',
    siteName: 'ShapeUp',
    images: [{ url: '/shapeup_logo.png', width: 1200, height: 630, alt: 'ShapeUp' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ShapeUp Barber Cards',
    description: 'One barber link for bookings, services, visual consultations, QR sharing, and stats.',
    images: ['/shapeup_logo.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      // Point Clerk at our own routes (which render <SignUpWidget />) so any time
      // Clerk needs to send the user to "sign in / sign up" — e.g. the fallback
      // during the Google OAuth callback — it uses our UI instead of Clerk's
      // hosted Account Portal.
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/barber"
      signUpFallbackRedirectUrl="/barber"
    >
      <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${jetbrains.variable} ${montserrat.variable}`}>
        <body style={{ fontFamily: 'var(--font-dmsans), system-ui, sans-serif' }}>
          <style>{`
            .font-display { font-family: var(--font-fraunces), Georgia, serif !important; font-variation-settings: 'SOFT' 50, 'WONK' 1, 'opsz' 144; }
            .font-serif   { font-family: var(--font-fraunces), Georgia, serif !important; font-variation-settings: 'SOFT' 30, 'opsz' 14; }
            .font-sans    { font-family: var(--font-dmsans), system-ui, sans-serif !important; }
            .font-mono    { font-family: var(--font-jetbrains), ui-monospace, monospace !important; }
          `}</style>
          <PostHogProvider>
            <ConvexClerkProvider>
              <SettingsProvider>
                <NavLoadingProvider>
                  {children}
                </NavLoadingProvider>
              </SettingsProvider>
            </ConvexClerkProvider>
          </PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
