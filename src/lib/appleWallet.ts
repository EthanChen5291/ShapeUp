import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PKPass, type Field } from 'passkit-generator';
import sharp from 'sharp';

export interface WalletBarberCard {
  slug: string;
  displayName: string;
  shopName?: string;
  location?: string;
  hours?: string;
  services?: { name: string; price?: string }[];
  links: { kind: string; label: string; url: string }[];
}

interface WalletConfig {
  teamIdentifier: string;
  passTypeIdentifier: string;
  signerCert: Buffer;
  signerKey: Buffer;
  signerKeyPassphrase?: string;
  wwdr: Buffer;
}

const REQUIRED_ENV = [
  'APPLE_WALLET_TEAM_ID',
  'APPLE_WALLET_PASS_TYPE_ID',
  'APPLE_WALLET_SIGNER_CERT_BASE64',
  'APPLE_WALLET_SIGNER_KEY_BASE64',
  'APPLE_WALLET_WWDR_CERT_BASE64',
] as const;

function decodeSecret(value: string): Buffer {
  // Base64 is the least error-prone format in Vercel and other deployment
  // dashboards. Raw PEM is accepted too, which is convenient during local dev.
  if (value.trimStart().startsWith('-----BEGIN')) {
    return Buffer.from(value.replace(/\\n/g, '\n'));
  }
  return Buffer.from(value.replace(/\s/g, ''), 'base64');
}

function walletConfig(): WalletConfig | null {
  if (REQUIRED_ENV.some((key) => !process.env[key]?.trim())) return null;

  return {
    teamIdentifier: process.env.APPLE_WALLET_TEAM_ID!.trim(),
    passTypeIdentifier: process.env.APPLE_WALLET_PASS_TYPE_ID!.trim(),
    signerCert: decodeSecret(process.env.APPLE_WALLET_SIGNER_CERT_BASE64!),
    signerKey: decodeSecret(process.env.APPLE_WALLET_SIGNER_KEY_BASE64!),
    signerKeyPassphrase: process.env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE?.trim() || undefined,
    wwdr: decodeSecret(process.env.APPLE_WALLET_WWDR_CERT_BASE64!),
  };
}

export function isAppleWalletConfigured(): boolean {
  return walletConfig() !== null;
}

function trimField(value: string | undefined, maxLength: number): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function barberWalletFields(card: WalletBarberCard, publicUrl: string) {
  const shop = trimField(card.shopName, 48);
  const location = trimField(card.location, 64);
  const hours = trimField(card.hours, 64);
  const bookingUrl = safeHttpUrl(card.links.find((link) => link.kind === 'booking')?.url);
  const services = card.services
    ?.slice(0, 8)
    .map((service) => {
      const name = trimField(service.name, 50);
      if (!name) return null;
      const price = trimField(service.price, 20);
      return `${name}${price ? ` — ${price}` : ''}`;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const primaryFields: Field[] = [
    { key: 'barber', label: 'YOUR BARBER', value: trimField(card.displayName, 60) ?? 'Barber' },
  ];
  const secondaryFields: Field[] = shop
    ? [{ key: 'shop', label: 'SHOP', value: shop }]
    : [{ key: 'card', label: 'CARD', value: 'ShapeUp Barber Card' }];
  const auxiliaryFields: Field[] = [];
  if (location) auxiliaryFields.push({ key: 'location', label: 'LOCATION', value: location });
  if (hours) auxiliaryFields.push({ key: 'hours', label: 'HOURS', value: hours });

  const backFields: Field[] = [
    {
      key: 'live-card',
      label: 'LIVE BARBER CARD',
      value: publicUrl,
      attributedValue: `<a href="${publicUrl}">Open live barber card</a>`,
      dataDetectorTypes: ['PKDataDetectorTypeLink'],
    },
  ];
  if (bookingUrl) {
    backFields.push({
      key: 'booking',
      label: 'BOOK AN APPOINTMENT',
      value: bookingUrl,
      attributedValue: `<a href="${bookingUrl}">Book an appointment</a>`,
      dataDetectorTypes: ['PKDataDetectorTypeLink'],
    });
  }
  if (services) backFields.push({ key: 'services', label: 'SERVICES', value: services });
  backFields.push({
    key: 'about',
    label: 'ABOUT THIS PASS',
    value: 'Scan the QR code to open the current barber card, try on a cut, or book an appointment.',
  });

  return { primaryFields, secondaryFields, auxiliaryFields, backFields };
}

let iconBuffersPromise: Promise<Record<string, Buffer>> | undefined;

function iconBuffers(): Promise<Record<string, Buffer>> {
  if (!iconBuffersPromise) {
    iconBuffersPromise = (async () => {
      const source = await readFile(path.join(process.cwd(), 'public', 'shapeup_logo.png'));
      const render = (size: number) =>
        sharp(source)
          .resize(size, size, { fit: 'contain' })
          .png()
          .toBuffer();
      const [icon, icon2x, icon3x] = await Promise.all([render(29), render(58), render(87)]);
      return { 'icon.png': icon, 'icon@2x.png': icon2x, 'icon@3x.png': icon3x };
    })();
  }
  return iconBuffersPromise;
}

export async function createBarberWalletPass(
  card: WalletBarberCard,
  publicUrl: string,
): Promise<Buffer> {
  const config = walletConfig();
  if (!config) throw new Error('Apple Wallet is not configured');

  const pass = new PKPass(await iconBuffers(), {
    wwdr: config.wwdr,
    signerCert: config.signerCert,
    signerKey: config.signerKey,
    signerKeyPassphrase: config.signerKeyPassphrase,
  }, {
    formatVersion: 1,
    serialNumber: `barber-${card.slug}`,
    passTypeIdentifier: config.passTypeIdentifier,
    teamIdentifier: config.teamIdentifier,
    organizationName: 'ShapeUp',
    description: `${card.displayName}'s ShapeUp barber card`,
    logoText: 'ShapeUp',
    backgroundColor: 'rgb(15, 15, 16)',
    foregroundColor: 'rgb(245, 241, 234)',
    labelColor: 'rgb(232, 97, 77)',
    groupingIdentifier: 'shapeup-barbers',
  });

  pass.type = 'generic';
  const fields = barberWalletFields(card, publicUrl);
  pass.primaryFields.push(...fields.primaryFields);
  pass.secondaryFields.push(...fields.secondaryFields);
  pass.auxiliaryFields.push(...fields.auxiliaryFields);
  pass.backFields.push(...fields.backFields);
  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: publicUrl,
    messageEncoding: 'utf-8',
    altText: publicUrl.replace(/^https?:\/\//, ''),
  });

  return pass.getAsBuffer();
}
