import type { Metadata } from 'next';
import ContactPage from '@/components/ContactPage';

export const metadata: Metadata = {
  title: 'Contact us | ShapeUp',
  description:
    'Get in touch with the ShapeUp team — support, refunds, privacy and data requests, barbershop partnerships, or press. We reply within a business day.',
  openGraph: {
    title: 'Contact ShapeUp',
    description: 'Talk to a real human. Support, refunds, privacy, partnerships, and press.',
    url: 'https://tryshapeup.cc/contact',
  },
};

export default function Page() {
  return <ContactPage />;
}
