import { describe, it, expect } from 'vitest';
import {
  isSafeLinkUrl,
  normalizeBarberLink,
  normalizeSlug,
  suggestSlug,
} from './barberLinks';

/** Unwrap a successful normalize, failing loudly if it wasn't one. */
function url(kind: string, raw: string, customLabel?: string): string {
  const result = normalizeBarberLink(kind, raw, customLabel);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.link.url;
}

describe('normalizeBarberLink — handles', () => {
  it('accepts a handle with or without its sigil', () => {
    expect(url('instagram', '@marcus')).toBe('https://instagram.com/marcus');
    expect(url('instagram', 'marcus')).toBe('https://instagram.com/marcus');
    expect(url('venmo', '@marcus-fades')).toBe('https://venmo.com/u/marcus-fades');
    expect(url('cashapp', '$marcusfades')).toBe('https://cash.app/$marcusfades');
    expect(url('cashapp', 'marcusfades')).toBe('https://cash.app/$marcusfades');
    expect(url('tiktok', '@marcus')).toBe('https://tiktok.com/@marcus');
  });

  it('recovers the handle when a barber pastes the whole profile URL', () => {
    // This is what people actually do — copy the address bar.
    expect(url('instagram', 'https://www.instagram.com/marcus/')).toBe('https://instagram.com/marcus');
    expect(url('instagram', 'instagram.com/marcus')).toBe('https://instagram.com/marcus');
    expect(url('venmo', 'https://venmo.com/u/marcus')).toBe('https://venmo.com/u/marcus');
    expect(url('tiktok', 'https://www.tiktok.com/@marcus')).toBe('https://tiktok.com/@marcus');
  });

  it('rejects a URL for the wrong service, rather than minting a broken handle', () => {
    const result = normalizeBarberLink('instagram', 'https://evil.com/marcus');
    expect(result.ok).toBe(false);
  });

  it('recovers the handle from a pasted profile URL missing its protocol, and from mobile subdomains', () => {
    // Regression: "www.instagram.com/…" doesn't start with "instagram.com", so
    // the old `startsWith` check never even tried to parse it as a URL — it fell
    // through to the bare-handle regex and failed on the slash.
    expect(url('instagram', 'www.instagram.com/marcus')).toBe('https://instagram.com/marcus');
    // Regression: the old host check only stripped a leading "www.", so
    // Instagram's own mobile domain (m.instagram.com) was rejected outright.
    expect(url('instagram', 'https://m.instagram.com/marcus')).toBe('https://instagram.com/marcus');
    expect(url('instagram', 'm.instagram.com/marcus')).toBe('https://instagram.com/marcus');
  });

  it('still rejects a lookalike host, even as a bare (protocol-less) string', () => {
    expect(normalizeBarberLink('instagram', 'evilinstagram.com.evil.com/marcus').ok).toBe(false);
    expect(normalizeBarberLink('instagram', 'notinstagram.evil.com/marcus').ok).toBe(false);
  });

  it('rejects handles with illegal characters', () => {
    expect(normalizeBarberLink('instagram', 'marcus/../admin').ok).toBe(false);
    expect(normalizeBarberLink('venmo', 'marcus fades').ok).toBe(false);
    expect(normalizeBarberLink('instagram', '').ok).toBe(false);
  });
});

describe('normalizeBarberLink — phone, maps, web', () => {
  it('strips phone formatting down to what tel:/sms: want', () => {
    expect(url('phone', '(415) 555-0134')).toBe('tel:4155550134');
    expect(url('sms', '415-555-0134')).toBe('sms:4155550134');
    expect(url('phone', '+44 20 7946 0958')).toBe('tel:+442079460958');
  });

  it('rejects phone numbers that are too short or too long to be real', () => {
    expect(normalizeBarberLink('phone', '911').ok).toBe(false);
    expect(normalizeBarberLink('phone', '1234567890123456789').ok).toBe(false);
  });

  it('turns an address into a maps search, but passes a maps URL straight through', () => {
    expect(url('maps', '123 Main St, Oakland CA')).toBe(
      'https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Oakland%20CA',
    );
    expect(url('maps', 'https://maps.app.goo.gl/abc123')).toBe('https://maps.app.goo.gl/abc123');
  });

  it('assumes https for a bare domain — nobody types the scheme', () => {
    expect(url('booking', 'booksy.com/marcus')).toBe('https://booksy.com/marcus');
    expect(url('website', 'http://fadetheory.com')).toBe('http://fadetheory.com');
  });

  it('uses the barber’s own label for a custom link, falling back to a default', () => {
    const custom = normalizeBarberLink('custom', 'fadetheory.com', 'My portfolio');
    expect(custom.ok && custom.link.label).toBe('My portfolio');
    const unlabeled = normalizeBarberLink('custom', 'fadetheory.com');
    expect(unlabeled.ok && unlabeled.link.label).toBe('Link');
  });
});

// These URLs end up as hrefs on a page we host and hand to the public, so a
// bad protocol here is a stored XSS. The server runs this exact check.
describe('link safety', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('rejects %s', (hostile) => {
    expect(isSafeLinkUrl(hostile)).toBe(false);
    expect(normalizeBarberLink('website', hostile).ok).toBe(false);
    expect(normalizeBarberLink('custom', hostile).ok).toBe(false);
  });

  it('rejects links pointing back at localhost', () => {
    expect(isSafeLinkUrl('http://localhost:3000/admin')).toBe(false);
    expect(isSafeLinkUrl('http://127.0.0.1/')).toBe(false);
  });

  it('accepts ordinary http(s) links', () => {
    expect(isSafeLinkUrl('https://booksy.com/marcus')).toBe(true);
    expect(isSafeLinkUrl('http://fadetheory.com')).toBe(true);
  });
});

describe('normalizeSlug', () => {
  it('lowercases and accepts a reasonable slug', () => {
    expect(normalizeSlug('MarcusFades')).toEqual({ ok: true, slug: 'marcusfades' });
    expect(normalizeSlug('fade-theory-3')).toEqual({ ok: true, slug: 'fade-theory-3' });
  });

  it('enforces length', () => {
    expect(normalizeSlug('ab').ok).toBe(false);
    expect(normalizeSlug('a'.repeat(31)).ok).toBe(false);
  });

  it('rejects leading/trailing dashes and illegal characters', () => {
    expect(normalizeSlug('-marcus').ok).toBe(false);
    expect(normalizeSlug('marcus-').ok).toBe(false);
    expect(normalizeSlug('marcus fades').ok).toBe(false);
    expect(normalizeSlug('marcus/../admin').ok).toBe(false);
  });

  // A barber on /b/admin or /b/shapeup could impersonate us.
  it('reserves our own names', () => {
    expect(normalizeSlug('admin').ok).toBe(false);
    expect(normalizeSlug('shapeup').ok).toBe(false);
    expect(normalizeSlug('dashboard').ok).toBe(false);
  });
});

describe('suggestSlug', () => {
  it('derives a slug from a display name', () => {
    expect(suggestSlug('Marcus @ Fade Theory')).toBe('marcus-fade-theory');
    expect(suggestSlug('Kev')).toBe('kev');
  });

  it('returns empty when it cannot make a usable one', () => {
    expect(suggestSlug('!!')).toBe('');
    expect(suggestSlug('Jo')).toBe('');
  });
});
