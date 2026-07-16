import type { Metadata } from 'next';
import ForBarbersPage from '@/components/ForBarbersPage';

export const metadata: Metadata = {
  title: 'For barbers | ShapeUp',
  description:
    'A free link-in-bio for your chair — booking, socials, Venmo — with a fitting room that shows clients the cut on their own head before you pick up the clippers. Print the QR, tape it to your mirror.',
  openGraph: {
    title: 'ShapeUp for barbers',
    description:
      'Free page for your clients, with a fitting room attached. Print the QR for your mirror.',
    url: 'https://tryshapeup.cc/for-barbers',
  },
};

export default function Page() {
  return <ForBarbersPage />;
}
