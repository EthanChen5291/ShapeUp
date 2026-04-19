import type { Metadata } from 'next';
import { Fraunces, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'ShapeUp · The 3D Barber',
  description: 'A neighborhood chair. An AI barber. Your sharpest cut yet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body style={{ fontFamily: 'var(--font-dmsans), system-ui, sans-serif' }}>
        <style>{`
          .font-display { font-family: var(--font-fraunces), Georgia, serif !important; font-variation-settings: 'SOFT' 50, 'WONK' 1, 'opsz' 144; }
          .font-serif   { font-family: var(--font-fraunces), Georgia, serif !important; font-variation-settings: 'SOFT' 30, 'opsz' 14; }
          .font-sans    { font-family: var(--font-dmsans), system-ui, sans-serif !important; }
          .font-mono    { font-family: var(--font-jetbrains), ui-monospace, monospace !important; }
        `}</style>
        {children}
      </body>
    </html>
  );
}
