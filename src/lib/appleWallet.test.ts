import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let barberWalletFields: typeof import('./appleWallet').barberWalletFields;

beforeAll(async () => {
  ({ barberWalletFields } = await import('./appleWallet'));
});

describe('barberWalletFields', () => {
  it('turns the live card, booking link, and services into Wallet fields', () => {
    const fields = barberWalletFields({
      slug: 'marcus',
      displayName: 'Marcus Rivera',
      shopName: 'Fade Theory',
      location: 'Oakland, CA',
      hours: 'Tue–Sat · 10–7',
      services: [{ name: 'Signature cut', price: '$45' }],
      links: [{ kind: 'booking', label: 'Book', url: 'https://booksy.com/marcus' }],
    }, 'https://tryshapeup.cc/b/marcus');

    expect(fields.primaryFields[0]).toMatchObject({ label: 'YOUR BARBER', value: 'Marcus Rivera' });
    expect(fields.secondaryFields[0]).toMatchObject({ label: 'SHOP', value: 'Fade Theory' });
    expect(fields.auxiliaryFields).toHaveLength(2);
    expect(fields.backFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'live-card', value: 'https://tryshapeup.cc/b/marcus' }),
      expect.objectContaining({ key: 'booking', value: 'https://booksy.com/marcus' }),
      expect.objectContaining({ key: 'services', value: 'Signature cut — $45' }),
    ]));
  });

  it('does not put unsafe booking protocols into the pass', () => {
    const fields = barberWalletFields({
      slug: 'marcus',
      displayName: 'Marcus Rivera',
      links: [{ kind: 'booking', label: 'Book', url: 'javascript:alert(1)' }],
    }, 'https://tryshapeup.cc/b/marcus');

    expect(fields.backFields.some((field) => field.key === 'booking')).toBe(false);
  });
});
