import { notFound } from 'next/navigation';
import { LegalShell } from '../LegalShell';
import { legalPages, legalSlugs } from '../legalPages';

export function generateStaticParams() {
  return legalSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = legalPages[slug];
  return { title: page ? `${page.title} | ShapeUp` : 'ShapeUp' };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = legalPages[slug];
  if (!page) notFound();
  return (
    <LegalShell title={page.title} updated={page.updated} review={page.review}>
      {page.body}
    </LegalShell>
  );
}
