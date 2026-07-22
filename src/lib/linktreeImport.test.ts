import { describe, it, expect } from 'vitest';
import {
  classifyImportedLink,
  isSupportedImportHost,
  parseLinktreeHtml,
} from './linktreeImport';

/** Wrap a Linktree-shaped payload in the `__NEXT_DATA__` script tag we scrape. */
function page(props: unknown): string {
  return `<!doctype html><html><head><title>x</title></head><body>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: props },
    })}</script>
  </body></html>`;
}

const LINKTREE_PROPS = {
  account: {
    username: 'marcusfades',
    pageTitle: 'Marcus @ Fade Theory',
    description: 'Ten years on Telegraph Ave. Walk-ins welcome.',
    socialLinks: [{ type: 'instagram', url: 'https://instagram.com/marcusfades' }],
  },
  links: [
    { id: '1', title: 'Book an appointment', url: 'https://booksy.com/marcus' },
    { id: '2', title: 'My TikTok', url: 'https://www.tiktok.com/@marcusfades' },
    { id: '3', title: 'Cash App', url: 'https://cash.app/$marcusfades' },
    { id: '4', title: 'My Portfolio', url: 'https://marcusfades.com' },
  ],
};

describe('parseLinktreeHtml', () => {
  it('pulls name, bio, and every link from the __NEXT_DATA__ blob', () => {
    const result = parseLinktreeHtml(page(LINKTREE_PROPS));
    expect(result.displayName).toBe('Marcus @ Fade Theory');
    expect(result.bio).toBe('Ten years on Telegraph Ave. Walk-ins welcome.');
    // booksy + tiktok + cashapp + portfolio + the social instagram = 5, deduped.
    expect(result.links.map((l) => l.kind).sort()).toEqual(
      ['booking', 'cashapp', 'custom', 'instagram', 'tiktok'].sort(),
    );
  });

  it('classifies links into the builder kinds and keeps custom titles', () => {
    const { links } = parseLinktreeHtml(page(LINKTREE_PROPS));
    const custom = links.find((l) => l.kind === 'custom');
    expect(custom?.label).toBe('My Portfolio');
    expect(links.find((l) => l.kind === 'booking')?.value).toBe('https://booksy.com/marcus');
  });

  it('dedupes the same URL appearing in both links and socialLinks', () => {
    const { links } = parseLinktreeHtml(page(LINKTREE_PROPS));
    const igCount = links.filter((l) => l.kind === 'instagram').length;
    expect(igCount).toBe(1);
  });

  it('drops links that point back at Linktree itself', () => {
    const html = page({
      account: { username: 'x' },
      links: [
        { title: 'Real', url: 'https://example.com' },
        { title: 'Share', url: 'https://linktr.ee/x' },
      ],
    });
    const { links } = parseLinktreeHtml(html);
    expect(links.every((l) => !l.value.includes('linktr.ee'))).toBe(true);
    expect(links).toHaveLength(1);
  });

  it('falls back to og meta tags when there is no __NEXT_DATA__', () => {
    const html = `<html><head>
      <meta property="og:title" content="Jae the Barber | Linktree" />
      <meta property="og:description" content="South Side cuts" />
    </head><body></body></html>`;
    const result = parseLinktreeHtml(html);
    expect(result.displayName).toBe('Jae the Barber');
    expect(result.bio).toBe('South Side cuts');
    expect(result.links).toEqual([]);
  });

  it('truncates over-long name and bio to the builder limits', () => {
    const html = page({
      account: { username: 'x', pageTitle: 'N'.repeat(100), description: 'B'.repeat(400) },
      links: [],
    });
    const result = parseLinktreeHtml(html);
    expect(result.displayName?.length).toBe(60);
    expect(result.bio?.length).toBe(240);
  });

  it('returns empty fields for junk HTML instead of throwing', () => {
    const result = parseLinktreeHtml('<html><body>nothing here</body></html>');
    expect(result.displayName).toBeUndefined();
    expect(result.links).toEqual([]);
  });
});

describe('classifyImportedLink', () => {
  it('maps social and payment hosts to their dedicated kinds', () => {
    expect(classifyImportedLink({ title: '', url: 'https://instagram.com/x' }).kind).toBe('instagram');
    expect(classifyImportedLink({ title: '', url: 'https://www.venmo.com/u/x' }).kind).toBe('venmo');
    expect(classifyImportedLink({ title: '', url: 'https://calendly.com/x' }).kind).toBe('booking');
  });

  it('falls back to a custom row that preserves the title', () => {
    const row = classifyImportedLink({ title: 'My Shop', url: 'https://example.com' });
    expect(row.kind).toBe('custom');
    expect(row.label).toBe('My Shop');
  });

  it('uses the hostname as the label when a custom link has no title', () => {
    const row = classifyImportedLink({ title: '', url: 'https://www.example.com/path' });
    expect(row.label).toBe('example.com');
  });
});

describe('isSupportedImportHost', () => {
  it('accepts Linktree hosts and rejects everything else', () => {
    expect(isSupportedImportHost('linktr.ee')).toBe(true);
    expect(isSupportedImportHost('www.linktr.ee')).toBe(true);
    expect(isSupportedImportHost('linktree.com')).toBe(true);
    expect(isSupportedImportHost('evil.com')).toBe(false);
    expect(isSupportedImportHost('notlinktr.ee.evil.com')).toBe(false);
  });
});
