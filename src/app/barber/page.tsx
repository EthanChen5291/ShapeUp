'use client';

// ============================================================
// /barber — the barber's builder.
//
// One screen: an editor organized into collapsible sections on the left, the
// real BarberCard rendering live on the right (the phone layout, exactly what
// a client sees), publish, then download the mirror card (QR) to tape by the
// chair. The insights panel is the barber's reason to keep the card up — it's
// the only place they see what the QR is actually doing.
//
// Editing model: the first save is an explicit "Publish card" (claiming a slug
// mid-keystroke would be rude); after that, changes autosave ~1.5s after the
// barber stops typing, with an explicit chip showing saved/unsaved/saving so
// there's never a mystery about what the public card currently says.
//
// Auth-gated in-component (this repo gates in the component, not middleware).
// Everything the form produces is re-validated server-side in
// convex/barberPages.ts — the live validation here is a convenience.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import Link from 'next/link';
import SignUpWidget from '@/components/SignUpWidget';
import BarberCard, { type BarberCardData } from '@/components/BarberCard';
import { LogoHomeLink } from '@/components/AppUI';
import { HAIRSTYLES, hairstyleBySlug } from '@/data/hairstyles';
import {
  LINK_KINDS,
  LINK_META,
  MAX_LINKS,
  MAX_STYLES,
  type LinkKind,
  normalizeBarberLink,
  normalizeSlug,
  suggestSlug,
} from '@/lib/barberLinks';
import { drawMirrorCard, qrDataUrl } from '@/lib/mirrorCard';
import { SLOT_MINUTES_OPTIONS, normalizeBookingConfig } from '@/lib/bookingSlots';
import { formatEventTime } from '@/lib/calendarLinks';
import { useT, type TFunction } from '@/lib/i18n';

const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://tryshapeup.cc';

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const MAX_SERVICES = 12;

interface LinkRow {
  kind: LinkKind;
  value: string;
  label: string; // only used when kind === 'custom'
}

interface ServiceRow {
  name: string;
  price: string;
}

/** One editable weekday row in the Appointments section (index = 0..6, Sun..Sat). */
interface BookingDayRow {
  on: boolean;
  start: string;
  end: string;
}

const DEFAULT_BOOKING_DAYS: BookingDayRow[] = Array.from({ length: 7 }, (_, day) => ({
  on: day >= 2 && day <= 6, // Tue–Sat, the common barbershop week
  start: '09:00',
  end: '18:00',
}));

function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  } catch {
    return 'America/Los_Angeles';
  }
}

const WEEKDAY_LABELS = (t: TFunction) => [
  t('Sunday'), t('Monday'), t('Tuesday'), t('Wednesday'), t('Thursday'), t('Friday'), t('Saturday'),
];

function timeZoneChoices(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const list = supported.length
    ? supported
    : [
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
        'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
      ];
  return list.includes(current) ? list : [current, ...list];
}

export default function BarberBuilderPage() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) return <Shell>{null}</Shell>;
  if (!isSignedIn) return <SignedOut />;
  return <Builder />;
}

// ── shell (shared header + warm page background) ──
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-shop" style={{ minHeight: '100dvh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 24px',
          maxWidth: 1180,
          margin: '0 auto',
        }}
      >
        <LogoHomeLink />
        <Link
          href="/dashboard"
          className="font-mono"
          style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--char)', textDecoration: 'none' }}
        >
          Dashboard →
        </Link>
      </header>
      {children}
    </div>
  );
}

function SignedOut() {
  const t = useT();
  return (
    <Shell>
      <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 20px', textAlign: 'center' }}>
        <h1 className="font-display" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>
          {t('Build your barber card')}
        </h1>
        <p className="font-sans" style={{ color: 'var(--char)', marginBottom: 24, lineHeight: 1.6 }}>
          {t('Sign in to claim your link and print your mirror QR.')}
        </p>
        <SignUpWidget onEnter={() => {}} redirectUrlComplete="/barber" />
      </div>
    </Shell>
  );
}

/** Center-crop to a square and resize so avatars upload small and consistent. */
async function cropAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(side, 512);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('crop failed'))), 'image/jpeg', 0.9);
  });
}

/** Crop a cover image to a cinematic 3:1 banner. */
async function cropBanner(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const ratio = 3;
  let sourceWidth = bitmap.width;
  let sourceHeight = sourceWidth / ratio;
  if (sourceHeight > bitmap.height) {
    sourceHeight = bitmap.height;
    sourceWidth = sourceHeight * ratio;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, 1440, 480);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('crop failed'))), 'image/jpeg', 0.88);
  });
}

// ── the builder proper ──
function Builder() {
  const t = useT();
  const convex = useConvex();
  const mine = useQuery(api.barberPages.getMine);
  const referralStats = useQuery(api.users.getReferralStats);
  const upsert = useMutation(api.barberPages.upsert);
  const generateUploadUrl = useMutation(api.barberTryOn.generateUploadUrl);

  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [shopName, setShopName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [hours, setHours] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [published, setPublished] = useState(true);

  // Appointments: weekly hours in the barber's own timezone.
  const [bookingEnabled, setBookingEnabled] = useState(false);
  const [bookingTz, setBookingTz] = useState(detectTimeZone);
  const [bookingSlotMin, setBookingSlotMin] = useState<number>(30);
  const [bookingDays, setBookingDays] = useState<BookingDayRow[]>(DEFAULT_BOOKING_DAYS);

  // Avatar: staged locally (uploaded to storage immediately, attached to the
  // card on the next save) so the preview updates the moment the crop lands.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [stagedAvatarId, setStagedAvatarId] = useState<Id<'_storage'> | null>(null);
  const [clearAvatar, setClearAvatar] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [stagedBannerId, setStagedBannerId] = useState<Id<'_storage'> | null>(null);
  const [clearBanner, setClearBanner] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerError, setBannerError] = useState('');
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the form from the saved card, exactly once.
  useEffect(() => {
    if (hydrated || mine === undefined) return;
    setHydrated(true);
    if (mine) {
      setSlug(mine.slug);
      setDisplayName(mine.displayName);
      setShopName(mine.shopName ?? '');
      setBio(mine.bio ?? '');
      setLocation(mine.location ?? '');
      setHours(mine.hours ?? '');
      setContactEmail(mine.contactEmail ?? '');
      setStyles(mine.styles);
      setPublished(mine.published);
      setSavedSlug(mine.slug);
      setAvatarPreview(mine.avatarUrl ?? null);
      setBannerPreview(mine.bannerUrl ?? null);
      setServices((mine.services ?? []).map((s) => ({ name: s.name, price: s.price ?? '' })));
      if (mine.booking) {
        setBookingEnabled(mine.booking.enabled);
        setBookingTz(mine.booking.timezone);
        setBookingSlotMin(mine.booking.slotMinutes);
        setBookingDays(
          Array.from({ length: 7 }, (_, day) => {
            const saved = mine.booking!.days.find((d) => d.day === day);
            return saved
              ? { on: true, start: saved.start, end: saved.end }
              : { ...DEFAULT_BOOKING_DAYS[day], on: false };
          }),
        );
      }
      // Stored links carry normalized URLs; the form edits the raw value, so
      // seed the row value from the URL (the barber can retype to change it).
      setLinks(
        mine.links.map((l) => ({
          kind: (LINK_KINDS as readonly string[]).includes(l.kind) ? (l.kind as LinkKind) : 'custom',
          value: l.url,
          label: l.label,
        })),
      );
    }
  }, [mine, hydrated]);

  // Suggest a slug from the name until the barber has typed their own.
  const slugTouched = useRef(false);
  useEffect(() => {
    if (!slugTouched.current && !savedSlug && displayName) {
      setSlug(suggestSlug(displayName));
    }
  }, [displayName, savedSlug]);

  const slugCheck = normalizeSlug(slug);
  const normalizedSlug = slugCheck.ok ? slugCheck.slug : '';
  // Live availability — skipped until the slug is well-formed.
  const availability = useQuery(
    api.barberPages.checkSlug,
    slugCheck.ok ? { slug: normalizedSlug } : 'skip',
  );

  const referralCode = mine?.referralCode ?? referralStats?.referralCode ?? undefined;

  const markDirty = useCallback(() => {
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
  }, []);

  /** Wraps a setter so every edit flips the saved chip to "unsaved". */
  function edits<T>(setter: (v: T) => void): (v: T) => void {
    return (v: T) => {
      setter(v);
      markDirty();
    };
  }

  // The booking config exactly as upsert wants it; checked with the same
  // normalizer the server runs so autosave never trips on a half-built config.
  const bookingArg = useMemo(
    () => ({
      enabled: bookingEnabled,
      timezone: bookingTz,
      slotMinutes: bookingSlotMin,
      days: bookingDays
        .map((row, day) => (row.on ? { day, start: row.start, end: row.end } : null))
        .filter((d): d is { day: number; start: string; end: string } => d !== null),
    }),
    [bookingEnabled, bookingTz, bookingSlotMin, bookingDays],
  );
  const bookingCheck = useMemo(() => normalizeBookingConfig(bookingArg), [bookingArg]);

  // The card exactly as the public will see it, rebuilt from the form. Invalid
  // link rows drop out of the preview rather than breaking it.
  const previewData: BarberCardData = useMemo(() => {
    const normalizedLinks = links
      .map((row) => normalizeBarberLink(row.kind, row.value, row.label))
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.link);
    return {
      slug: normalizedSlug || 'your-name',
      displayName: displayName || t('Your name'),
      shopName: shopName || undefined,
      bio: bio || undefined,
      location: location || undefined,
      hours: hours || undefined,
      avatarUrl: clearAvatar ? undefined : avatarPreview ?? undefined,
      bannerUrl: clearBanner ? undefined : bannerPreview ?? undefined,
      services: services
        .filter((s) => s.name.trim())
        .map((s) => ({ name: s.name, price: s.price.trim() || undefined })),
      links: normalizedLinks,
      styles,
      referralCode,
      booking:
        bookingEnabled && bookingCheck.ok
          ? {
              timezone: bookingArg.timezone,
              slotMinutes: bookingArg.slotMinutes,
              days: bookingArg.days,
            }
          : undefined,
    };
  }, [links, normalizedSlug, displayName, shopName, bio, location, hours, avatarPreview, clearAvatar, bannerPreview, clearBanner, services, styles, referralCode, bookingEnabled, bookingCheck, bookingArg, t]);

  const addLink = (kind: LinkKind) => {
    setLinks((prev) => (prev.length >= MAX_LINKS ? prev : [...prev, { kind, value: '', label: '' }]));
    markDirty();
  };
  const updateLink = (i: number, patch: Partial<LinkRow>) => {
    setLinks((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    markDirty();
  };
  const removeLink = (i: number) => {
    const row = links[i];
    if (row?.value.trim() && !window.confirm(t('Remove this link from your card?'))) return;
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
    markDirty();
  };
  const moveLink = (i: number, dir: -1 | 1) => {
    setLinks((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    markDirty();
  };

  const updateService = (i: number, patch: Partial<ServiceRow>) => {
    setServices((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    markDirty();
  };
  const removeService = (i: number) => {
    const row = services[i];
    if (row?.name.trim() && !window.confirm(t('Remove this service?'))) return;
    setServices((prev) => prev.filter((_, idx) => idx !== i));
    markDirty();
  };

  const toggleStyle = (styleSlug: string) => {
    setStyles((prev) => {
      if (prev.includes(styleSlug)) return prev.filter((s) => s !== styleSlug);
      if (prev.length >= MAX_STYLES) return prev;
      return [...prev, styleSlug];
    });
    markDirty();
  };

  // ── avatar upload: crop → storage → staged id, preview immediately ──
  const handleAvatarFile = useCallback(
    async (file: File) => {
      setAvatarError('');
      if (!file.type.startsWith('image/')) {
        setAvatarError(t('That file isn’t an image — try a JPG or PNG.'));
        return;
      }
      if (file.size > MAX_AVATAR_BYTES) {
        setAvatarError(t('That photo is too large — keep it under 8 MB.'));
        return;
      }
      setAvatarBusy(true);
      try {
        const cropped = await cropAvatar(file);
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: cropped,
        });
        if (!res.ok) throw new Error('upload failed');
        const { storageId } = await res.json();
        const hosted = await convex.query(api.barberTryOn.getUploadedImageUrl, { storageId });
        setStagedAvatarId(storageId);
        setClearAvatar(false);
        setAvatarPreview(hosted ?? URL.createObjectURL(cropped));
        markDirty();
      } catch {
        setAvatarError(t('Couldn’t upload that photo — try again.'));
      } finally {
        setAvatarBusy(false);
      }
    },
    [convex, generateUploadUrl, markDirty, t],
  );

  const handleRemoveAvatar = useCallback(() => {
    if (!window.confirm(t('Remove your profile photo?'))) return;
    setStagedAvatarId(null);
    setClearAvatar(true);
    setAvatarPreview(null);
    setAvatarError('');
    markDirty();
  }, [markDirty, t]);

  const handleBannerFile = useCallback(async (file: File) => {
    setBannerError('');
    if (!file.type.startsWith('image/') || file.size > MAX_AVATAR_BYTES) {
      setBannerError(t('Use a JPG or PNG under 8 MB.'));
      return;
    }
    setBannerBusy(true);
    try {
      const cropped = await cropBanner(file);
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: cropped });
      if (!res.ok) throw new Error('upload failed');
      const { storageId } = await res.json();
      const hosted = await convex.query(api.barberTryOn.getUploadedImageUrl, { storageId });
      setStagedBannerId(storageId);
      setClearBanner(false);
      setBannerPreview(hosted ?? URL.createObjectURL(cropped));
      markDirty();
    } catch {
      setBannerError(t('Couldn’t upload that banner — try again.'));
    } finally {
      setBannerBusy(false);
    }
  }, [convex, generateUploadUrl, markDirty, t]);

  const handleRemoveBanner = useCallback(() => {
    if (!window.confirm(t('Remove your banner image?'))) return;
    setStagedBannerId(null);
    setClearBanner(true);
    setBannerPreview(null);
    setBannerError('');
    markDirty();
  }, [markDirty, t]);

  const canSave =
    slugCheck.ok &&
    displayName.trim().length > 0 &&
    availability?.available !== false &&
    bookingCheck.ok &&
    saveState !== 'saving';

  const handleSave = useCallback(async () => {
    setError('');
    if (!slugCheck.ok) {
      setError(slugCheck.error);
      return;
    }
    setSaveState('saving');
    try {
      const result = await upsert({
        slug: normalizedSlug,
        displayName,
        shopName: shopName || undefined,
        bio: bio || undefined,
        location: location || undefined,
        hours: hours || undefined,
        contactEmail: contactEmail || undefined,
        avatarStorageId: stagedAvatarId ?? undefined,
        clearAvatar: clearAvatar || undefined,
        bannerStorageId: stagedBannerId ?? undefined,
        clearBanner: clearBanner || undefined,
        services: services
          .filter((row) => row.name.trim())
          .map((row) => ({ name: row.name, price: row.price.trim() || undefined })),
        links: links
          .filter((row) => row.value.trim())
          .map((row) => ({ kind: row.kind, value: row.value, label: row.label || undefined })),
        styles,
        published,
        booking: bookingArg,
      });
      setSavedSlug(result.slug);
      setClearAvatar(false);
      setClearBanner(false);
      setSaveState('saved');
    } catch (e) {
      setError(e instanceof ConvexError ? (e.data as string) : t('Something went wrong. Please try again.'));
      setSaveState('dirty');
    }
  }, [slugCheck, normalizedSlug, displayName, shopName, bio, location, hours, contactEmail, stagedAvatarId, clearAvatar, stagedBannerId, clearBanner, services, links, styles, published, bookingArg, upsert, t]);

  // Autosave, but only once the card exists — the first save (which claims the
  // slug) stays an explicit button press.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;
  useEffect(() => {
    if (saveState !== 'dirty' || !savedSlug) return;
    const timer = setTimeout(() => {
      if (canSaveRef.current) void handleSaveRef.current();
    }, 1500);
    return () => clearTimeout(timer);
  }, [saveState, savedSlug, previewData]);

  const publicUrl = savedSlug ? `${SITE_ORIGIN}/b/${savedSlug}` : '';

  return (
    <Shell>
      <div className="barber-builder">
        {/* ── form column ── */}
        <div className="barber-builder-form">
          <div className="barber-builder-title-row">
            <div>
              <h1 className="font-display" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--ink)', margin: '0 0 4px' }}>
                {savedSlug ? t('Your barber card') : t('Build your barber card')}
              </h1>
              <p className="font-sans" style={{ color: 'var(--char)', margin: 0, lineHeight: 1.6 }}>
                {t('A free page for your clients — and a fitting room that shows them the cut on their own head.')}
              </p>
            </div>
            {savedSlug ? <SaveChip state={saveState} /> : null}
          </div>

          {/* ── Profile ── */}
          <Section title={t('Profile')} defaultOpen>
            <div className="barber-avatar-field">
              <button
                type="button"
                className={`barber-avatar-drop${avatarBusy ? ' is-busy' : ''}`}
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarBusy}
                aria-label={avatarPreview ? t('Replace your profile photo') : t('Add a profile photo')}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" />
                ) : (
                  <span className="barber-avatar-drop-empty" aria-hidden>
                    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                  </span>
                )}
                {avatarBusy ? <span className="barber-avatar-drop-busy" aria-hidden /> : null}
              </button>
              <div className="barber-avatar-meta">
                <span className="font-mono barber-builder-label">{t('Profile photo')}</span>
                <p className="font-sans">
                  {avatarBusy
                    ? t('Uploading…')
                    : avatarPreview
                      ? t('Looking sharp. Tap the photo to replace it.')
                      : t('Clients trust a face. Square crop, up to 8 MB.')}
                </p>
                <div className="barber-avatar-actions">
                  <button type="button" className="chip-suggest" onClick={() => avatarInputRef.current?.click()} disabled={avatarBusy}>
                    {avatarPreview ? t('Replace') : t('Upload')}
                  </button>
                  {avatarPreview && (
                    <button type="button" className="chip-suggest is-danger" onClick={handleRemoveAvatar} disabled={avatarBusy}>
                      {t('Remove')}
                    </button>
                  )}
                </div>
                {avatarError && <p role="alert" className="font-sans barber-avatar-error">{avatarError}</p>}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAvatarFile(file);
                  e.target.value = '';
                }}
              />
            </div>

            <div className="barber-banner-field">
              <button type="button" className="barber-banner-drop" onClick={() => bannerInputRef.current?.click()} disabled={bannerBusy}>
                {bannerPreview ? <img src={bannerPreview} alt="" /> : <span className="font-sans">{t('Add a shop banner')}</span>}
                <span className="barber-banner-edit font-mono">{bannerBusy ? t('Uploading…') : t('Edit banner')}</span>
              </button>
              <div className="barber-avatar-actions">
                <button type="button" className="chip-suggest" onClick={() => bannerInputRef.current?.click()} disabled={bannerBusy}>{bannerPreview ? t('Replace banner') : t('Upload banner')}</button>
                {bannerPreview ? <button type="button" className="chip-suggest is-danger" onClick={handleRemoveBanner}>{t('Remove')}</button> : null}
              </div>
              {bannerError ? <p role="alert" className="font-sans barber-avatar-error">{bannerError}</p> : null}
              <input ref={bannerInputRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleBannerFile(file); e.target.value = ''; }} />
            </div>

            <Field label={t('Your link')} hint={`${SITE_ORIGIN.replace(/^https?:\/\//, '')}/b/`}>
              <input
                className="barber-input font-mono"
                value={slug}
                onChange={(e) => {
                  slugTouched.current = true;
                  setSlug(e.target.value.toLowerCase());
                  markDirty();
                }}
                placeholder="marcus"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t('Your link')}
              />
              <SlugStatus slug={slug} check={slugCheck} available={availability?.available} error={availability?.error} />
            </Field>

            <Field label={t('Name')}>
              <input
                className="barber-input"
                value={displayName}
                onChange={(e) => edits(setDisplayName)(e.target.value)}
                placeholder="Marcus"
                maxLength={60}
                aria-label={t('Name')}
              />
            </Field>

            <Field label={t('Shop')}>
              <input
                className="barber-input"
                value={shopName}
                onChange={(e) => edits(setShopName)(e.target.value)}
                placeholder="Fade Theory"
                maxLength={60}
                aria-label={t('Shop')}
              />
            </Field>

            <Field label={t('Bio')} hint={`${bio.length}/240`}>
              <textarea
                className="barber-input"
                value={bio}
                onChange={(e) => edits(setBio)(e.target.value)}
                placeholder={t('Ten years on Telegraph Ave. Walk-ins welcome.')}
                maxLength={240}
                rows={2}
                style={{ resize: 'none' }}
                aria-label={t('Bio')}
              />
            </Field>
          </Section>

          {/* ── Business details ── */}
          <Section title={t('Business details')}>
            <Field label={t('Location')} hint={t('shown under your name')}>
              <input
                className="barber-input"
                value={location}
                onChange={(e) => edits(setLocation)(e.target.value)}
                placeholder={t('Telegraph Ave, Oakland')}
                maxLength={80}
                aria-label={t('Location')}
              />
            </Field>

            <Field label={t('Hours')}>
              <input
                className="barber-input"
                value={hours}
                onChange={(e) => edits(setHours)(e.target.value)}
                placeholder={t('Tue–Sat · 9–6')}
                maxLength={120}
                aria-label={t('Hours')}
              />
            </Field>

            <div className="barber-builder-section-head" style={{ marginTop: 4 }}>
              <span className="font-mono barber-builder-label">{t('Services & pricing')}</span>
              <span className="font-mono barber-builder-count">{services.length}/{MAX_SERVICES}</span>
            </div>
            {services.map((row, i) => (
              <div key={i} className="barber-service-row">
                <input
                  className="barber-input"
                  value={row.name}
                  onChange={(e) => updateService(i, { name: e.target.value })}
                  placeholder={t('Skin fade')}
                  maxLength={60}
                  aria-label={t('Service name')}
                />
                <input
                  className="barber-input"
                  value={row.price}
                  onChange={(e) => updateService(i, { price: e.target.value })}
                  placeholder="$40"
                  maxLength={20}
                  aria-label={t('Price')}
                />
                <button className="barber-icon-btn" onClick={() => removeService(i)} aria-label={t('Remove')} type="button">
                  ✕
                </button>
              </div>
            ))}
            {services.length < MAX_SERVICES && (
              <button
                type="button"
                className="chip-suggest"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setServices((prev) => [...prev, { name: '', price: '' }]);
                  markDirty();
                }}
              >
                + {t('Add a service')}
              </button>
            )}
          </Section>

          {/* ── Booking & links ── */}
          <Section title={t('Booking & links')}>
            <div className="barber-builder-section-head">
              <span className="font-mono barber-builder-label">{t('Links')}</span>
              <span className="font-mono barber-builder-count">{links.length}/{MAX_LINKS}</span>
            </div>
            {links.map((row, i) => (
              <div key={i} className="barber-link-row">
                <div className="barber-link-order" aria-hidden={links.length < 2}>
                  <button type="button" className="barber-order-btn" onClick={() => moveLink(i, -1)} disabled={i === 0} aria-label={t('Move up')}>↑</button>
                  <button type="button" className="barber-order-btn" onClick={() => moveLink(i, 1)} disabled={i === links.length - 1} aria-label={t('Move down')}>↓</button>
                </div>
                <select
                  className="barber-input barber-link-kind font-sans"
                  value={row.kind}
                  onChange={(e) => updateLink(i, { kind: e.target.value as LinkKind })}
                  aria-label={t('Link type')}
                >
                  {LINK_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{LINK_META[kind].label}</option>
                  ))}
                </select>
                <input
                  className="barber-input"
                  value={row.value}
                  onChange={(e) => updateLink(i, { value: e.target.value })}
                  placeholder={LINK_META[row.kind].placeholder}
                  aria-label={LINK_META[row.kind].hint}
                />
                <button className="barber-icon-btn" onClick={() => removeLink(i)} aria-label={t('Remove')} type="button">
                  ✕
                </button>
                {row.kind === 'custom' && (
                  <input
                    className="barber-input barber-link-custom-label"
                    value={row.label}
                    onChange={(e) => updateLink(i, { label: e.target.value })}
                    placeholder={t('Label (e.g. My portfolio)')}
                    aria-label={t('Link label')}
                  />
                )}
              </div>
            ))}
            {links.length < MAX_LINKS && (
              <div className="barber-add-links">
                {LINK_KINDS.map((kind) => (
                  <button key={kind} type="button" className="chip-suggest" onClick={() => addLink(kind)}>
                    + {LINK_META[kind].label}
                  </button>
                ))}
              </div>
            )}
          </Section>

          {/* ── Appointments: native time slots on the card ── */}
          <Section title={t('Appointments')}>
            <label className="barber-publish-toggle font-sans" style={{ alignSelf: 'flex-start' }}>
              <input
                type="checkbox"
                checked={bookingEnabled}
                onChange={(e) => edits(setBookingEnabled)(e.target.checked)}
              />
              {t('Let clients book times on my card')}
            </label>
            <p className="font-sans" style={{ fontSize: 12, color: 'var(--smoke)', margin: '-4px 0 0', lineHeight: 1.5 }}>
              {t('Clients pick a real open slot; you both get a confirmation with a calendar invite. No other app needed.')}
            </p>

            {bookingEnabled && (
              <>
                <div className="barber-booking-basics">
                  <Field label={t('Timezone')}>
                    <select
                      className="barber-input font-sans"
                      value={bookingTz}
                      onChange={(e) => edits(setBookingTz)(e.target.value)}
                      aria-label={t('Timezone')}
                    >
                      {timeZoneChoices(bookingTz).map((tz) => (
                        <option key={tz} value={tz}>{tz.replaceAll('_', ' ')}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('Slot length')}>
                    <select
                      className="barber-input font-sans"
                      value={bookingSlotMin}
                      onChange={(e) => edits(setBookingSlotMin)(Number(e.target.value))}
                      aria-label={t('Slot length')}
                    >
                      {SLOT_MINUTES_OPTIONS.map((min) => (
                        <option key={min} value={min}>{t('{n} minutes', { n: min })}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="barber-booking-days">
                  {bookingDays.map((row, day) => (
                    <div key={day} className={`barber-booking-day${row.on ? '' : ' is-off'}`}>
                      <label className="barber-booking-day-name font-sans">
                        <input
                          type="checkbox"
                          checked={row.on}
                          onChange={(e) => {
                            setBookingDays((prev) =>
                              prev.map((r, i) => (i === day ? { ...r, on: e.target.checked } : r)),
                            );
                            markDirty();
                          }}
                        />
                        {WEEKDAY_LABELS(t)[day]}
                      </label>
                      {row.on ? (
                        <div className="barber-booking-hours">
                          <input
                            className="barber-input"
                            type="time"
                            value={row.start}
                            onChange={(e) => {
                              setBookingDays((prev) =>
                                prev.map((r, i) => (i === day ? { ...r, start: e.target.value } : r)),
                              );
                              markDirty();
                            }}
                            aria-label={t('Opens')}
                          />
                          <span className="font-mono" aria-hidden>–</span>
                          <input
                            className="barber-input"
                            type="time"
                            value={row.end}
                            onChange={(e) => {
                              setBookingDays((prev) =>
                                prev.map((r, i) => (i === day ? { ...r, end: e.target.value } : r)),
                              );
                              markDirty();
                            }}
                            aria-label={t('Closes')}
                          />
                        </div>
                      ) : (
                        <span className="barber-booking-closed font-mono">{t('Closed')}</span>
                      )}
                    </div>
                  ))}
                </div>
                {!bookingCheck.ok && (
                  <p role="alert" className="font-sans" style={{ color: 'var(--cherry)', fontSize: 13, margin: 0 }}>
                    {t(bookingCheck.error)}
                  </p>
                )}
              </>
            )}
          </Section>

          {/* ── ShapeUp recommendations ── */}
          <Section title={t('Recommended cuts')}>
            <div className="barber-builder-section-head">
              <span className="font-mono barber-builder-label">{t('Cuts you do')}</span>
              <span className="font-mono barber-builder-count">{styles.length}/{MAX_STYLES}</span>
            </div>
            <p className="font-sans" style={{ fontSize: 13, color: 'var(--smoke)', margin: '0 0 10px' }}>
              {t('These lead your card as “Barber’s picks” — clients tap them to try them on.')}
            </p>
            <div className="barber-style-picker">
              {HAIRSTYLES.map((cut) => {
                const on = styles.includes(cut.slug);
                const full = !on && styles.length >= MAX_STYLES;
                return (
                  <button
                    key={cut.slug}
                    type="button"
                    className={`barber-style-pick${on ? ' is-on' : ''}`}
                    onClick={() => toggleStyle(cut.slug)}
                    disabled={full}
                    aria-pressed={on}
                    title={cut.label}
                  >
                    <img src={`/hair-previews/${cut.slug}.png`} alt="" loading="lazy" width={56} height={56} />
                    <span className="font-sans">{cut.label}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* ── Notifications ── */}
          <Section title={t('Notifications')}>
            <Field label={t('Notify me at')} hint={t('private — never shown on your card')}>
              <input
                className="barber-input"
                type="email"
                value={contactEmail}
                onChange={(e) => edits(setContactEmail)(e.target.value)}
                placeholder="marcus@fadetheory.com"
                maxLength={254}
                aria-label={t('Notify me at')}
              />
            </Field>
            <p className="font-sans" style={{ fontSize: 12, color: 'var(--smoke)', margin: '-6px 0 0', lineHeight: 1.5 }}>
              {t('When a client picks a cut on your card, we’ll email you the result and their contact info — so you know exactly what to do before they sit down.')}
            </p>
          </Section>

          {error && (
            <p role="alert" className="font-sans" style={{ color: 'var(--cherry)', fontSize: 14, margin: '4px 0 0' }}>
              {error}
            </p>
          )}

          <div className="barber-builder-actions">
            <label className="barber-publish-toggle font-sans">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => {
                  setPublished(e.target.checked);
                  markDirty();
                }}
              />
              {t('Live')}
            </label>
            <button className="btn-tomato" type="button" onClick={handleSave} disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }}>
              {saveState === 'saving' ? t('Saving…') : savedSlug ? t('Save changes') : t('Publish card')}
            </button>
          </div>

          {savedSlug && (
            <MirrorCardPanel url={publicUrl} displayName={displayName} shopName={shopName} slug={savedSlug} />
          )}

          {savedSlug && <InsightsPanel insights={mine?.insights} totals={mine?.totals} referralStats={referralStats} />}

          {savedSlug && bookingEnabled && <BookingsPanel timezone={bookingTz} />}

          {savedSlug && <ClientRequestsPanel />}
        </div>

        {/* ── live preview column ── */}
        <div className="barber-builder-preview">
          <div className="barber-preview-frame">
            <BarberCard page={previewData} preview />
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── small pieces ──
function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="barber-section" open={defaultOpen}>
      <summary className="barber-section-summary">
        <span className="font-display">{title}</span>
        <svg className="barber-section-chev" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="barber-section-body">{children}</div>
    </details>
  );
}

function SaveChip({ state }: { state: 'idle' | 'dirty' | 'saving' | 'saved' }) {
  const t = useT();
  const label =
    state === 'saving' ? t('Saving…') : state === 'dirty' ? t('Unsaved changes') : t('Saved');
  return (
    <span className={`barber-save-chip font-mono is-${state}`} role="status">
      {label}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="barber-field">
      <span className="barber-field-label font-mono">
        {label}
        {hint ? <span className="barber-field-hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function SlugStatus({
  slug,
  check,
  available,
  error,
}: {
  slug: string;
  check: ReturnType<typeof normalizeSlug>;
  available?: boolean;
  error?: string;
}) {
  const t = useT();
  if (!slug) return null;
  if (!check.ok) return <span className="barber-slug-status is-bad font-sans">{check.error}</span>;
  if (available === undefined) return <span className="barber-slug-status font-sans">{t('Checking…')}</span>;
  if (available) return <span className="barber-slug-status is-ok font-sans">✓ {t('Available')}</span>;
  return <span className="barber-slug-status is-bad font-sans">{error ?? t('That name is taken.')}</span>;
}

function MirrorCardPanel({
  url,
  displayName,
  shopName,
  slug,
}: {
  url: string;
  displayName: string;
  shopName: string;
  slug: string;
}) {
  const t = useT();
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    qrDataUrl(url).then((d) => alive && setQr(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);

  const download = useCallback(async () => {
    const canvas = canvasRef.current ?? document.createElement('canvas');
    await drawMirrorCard(canvas, { displayName, shopName: shopName || undefined, url });
    const link = document.createElement('a');
    link.download = `shapeup-mirror-${slug}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [displayName, shopName, url, slug]);

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [url]);

  return (
    <div className="barber-mirror-panel">
      <div className="barber-mirror-qr">
        {qr ? <img src={qr} alt={t('QR code for your card')} width={132} height={132} /> : null}
      </div>
      <div className="barber-mirror-body">
        <p className="font-display" style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
          {t('Your card is live')}
        </p>
        <button className="barber-mirror-url font-mono" type="button" onClick={copy}>
          {copied ? t('Copied!') : url.replace(/^https?:\/\//, '')}
        </button>
        <div className="barber-mirror-actions">
          <button className="btn-tomato" type="button" onClick={download}>
            {t('Download mirror card')}
          </button>
          <Link className="chip-suggest" href={`/b/${slug}`} target="_blank">
            {t('View card ↗')}
          </Link>
        </div>
        <p className="font-sans" style={{ fontSize: 12, color: 'var(--smoke)', margin: '2px 0 0', lineHeight: 1.5 }}>
          {t('Print it and tape it to your mirror. Clients scan it from the chair.')}
        </p>
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

// ── insights: is the card working? ──
interface WeekTotals {
  views: number;
  tryOns: number;
  linkClicks: number;
  bookingClicks: number;
  selfieStarts: number;
  previews: number;
}

function InsightsPanel({
  insights,
  totals,
  referralStats,
}: {
  insights?: { last7: WeekTotals; prev7: WeekTotals; topStyles: { slug: string; count: number }[] };
  totals?: { views: number; tryOns: number; linkClicks: number };
  referralStats?: { friendsJoined: number } | null;
}) {
  const t = useT();

  const last7 = insights?.last7;
  const prev7 = insights?.prev7;

  const stats = [
    { value: last7?.views ?? 0, prev: prev7?.views ?? 0, label: t('Scans'), total: totals?.views ?? 0 },
    { value: last7?.tryOns ?? 0, prev: prev7?.tryOns ?? 0, label: t('Try-ons'), total: totals?.tryOns ?? 0 },
    { value: last7?.previews ?? 0, prev: prev7?.previews ?? 0, label: t('Previews finished'), total: undefined },
    { value: last7?.bookingClicks ?? 0, prev: prev7?.bookingClicks ?? 0, label: t('Booking taps'), total: undefined },
  ];

  // A few plain-language reads on the numbers — insights, not a dashboard.
  const notes: string[] = [];
  if (last7) {
    const top = insights?.topStyles[0];
    const topCut = top ? hairstyleBySlug(top.slug) : undefined;
    if (topCut && top && top.count > 1) {
      notes.push(t('“{cut}” is your most-tried style.', { cut: topCut.label }));
    }
    if (last7.bookingClicks > 0) {
      notes.push(t('Your booking link got {n} taps this week.', { n: last7.bookingClicks }));
    }
    if (last7.selfieStarts >= 3 && last7.previews < last7.selfieStarts / 2) {
      notes.push(t('Clients often leave before finishing a preview — remind them it takes under a minute.'));
    }
    if (prev7 && prev7.views > 0 && last7.views > prev7.views) {
      notes.push(t('Scans are up from last week ({a} → {b}).', { a: prev7.views, b: last7.views }));
    }
  }
  if ((referralStats?.friendsJoined ?? 0) > 0) {
    notes.push(t('{n} clients joined ShapeUp through your card.', { n: referralStats!.friendsJoined }));
  }

  return (
    <section className="barber-insights" aria-label={t('Insights')}>
      <div className="barber-builder-section-head">
        <span className="font-mono barber-builder-label">{t('This week')}</span>
      </div>
      <div className="barber-stats">
        {stats.map((s) => {
          const delta = s.value - s.prev;
          return (
            <div key={s.label} className="barber-stat">
              <span className="barber-stat-value font-display">{s.value}</span>
              <span className="barber-stat-label font-mono">{s.label}</span>
              {delta !== 0 && (
                <span className={`barber-stat-delta font-mono ${delta > 0 ? 'is-up' : 'is-down'}`}>
                  {delta > 0 ? `+${delta}` : delta} {t('vs last week')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {insights && insights.topStyles.length > 0 && (
        <div className="barber-top-styles">
          <span className="font-mono barber-builder-label">{t('Most-tried styles')}</span>
          <ul>
            {insights.topStyles.slice(0, 5).map((row) => {
              const cut = hairstyleBySlug(row.slug);
              if (!cut) return null;
              return (
                <li key={row.slug} className="font-sans">
                  <img src={`/hair-previews/${row.slug}.png`} alt="" width={28} height={28} loading="lazy" />
                  <span>{cut.label}</span>
                  <span className="font-mono">{row.count}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="barber-insight-notes">
          {notes.map((note) => (
            <li key={note} className="font-sans">{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── upcoming appointments booked through the card ──
function BookingsPanel({ timezone }: { timezone: string }) {
  const t = useT();
  const bookings = useQuery(api.barberBooking.listMyBookings);
  const cancelBooking = useMutation(api.barberBooking.cancel);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cancel = async (id: string, clientName: string) => {
    if (!window.confirm(t('Cancel {name}’s appointment? They’ll be emailed that the time is off.', { name: clientName }))) return;
    setBusyId(id);
    try {
      await cancelBooking({ bookingId: id as Id<'barberBookings'> });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="barber-insights" aria-label={t('Upcoming appointments')}>
      <div className="barber-builder-section-head">
        <span className="font-mono barber-builder-label">{t('Upcoming appointments')}</span>
      </div>
      {!bookings || bookings.length === 0 ? (
        <p className="font-sans" style={{ fontSize: 13, color: 'var(--smoke)', margin: 0, lineHeight: 1.5 }}>
          {t('Nothing on the books yet — slots are live on your card.')}
        </p>
      ) : (
        <ul className="barber-bookings">
          {bookings.map((b) => (
            <li key={b.id} className="barber-booking-row">
              <div className="barber-booking-when font-mono">{formatEventTime(b.startMs, timezone)}</div>
              <div className="barber-booking-who font-sans">
                <strong>{b.clientName}</strong>
                {b.service ? <span> · {b.service}</span> : null}
                {(b.clientPhone || b.clientEmail) ? (
                  <span className="barber-booking-contact"> · {b.clientPhone ?? b.clientEmail}</span>
                ) : null}
                {b.note ? <span className="barber-booking-note">“{b.note}”</span> : null}
              </div>
              <button
                type="button"
                className="chip-suggest is-danger"
                onClick={() => void cancel(b.id, b.clientName)}
                disabled={busyId === b.id}
              >
                {busyId === b.id ? t('Cancelling…') : t('Cancel')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── the chair-side inbox: cuts clients sent through the card ──
function timeAgo(t: TFunction, thenMs: number): string {
  const mins = Math.max(1, Math.round((Date.now() - thenMs) / 60_000));
  if (mins < 60) return t('{n}m ago', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('{n}h ago', { n: hours });
  return t('{n}d ago', { n: Math.round(hours / 24) });
}

function ClientRequestsPanel() {
  const t = useT();
  const sends = useQuery(api.barberTryOn.listMySends);
  if (!sends || sends.length === 0) return null;

  return (
    <section className="barber-insights" aria-label={t('Client requests')}>
      <div className="barber-builder-section-head">
        <span className="font-mono barber-builder-label">{t('Client requests')}</span>
        <span className="font-mono barber-builder-count">{sends.length}</span>
      </div>
      <p className="font-sans" style={{ fontSize: 12, color: 'var(--smoke)', margin: '0 0 10px', lineHeight: 1.5 }}>
        {t('Cuts clients sent from your card — what they want before they sit down.')}
      </p>
      <ul className="barber-sends">
        {sends.map((s) => (
          <li key={s.id} className="barber-send-row">
            <img src={s.imageUrl} alt={t('Client preview: {cut}', { cut: s.cutLabel })} loading="lazy" width={64} height={64} />
            <div className="barber-send-body font-sans">
              <strong>{s.cutLabel}</strong>
              {s.clientRequest && s.clientRequest !== s.cutLabel ? (
                <span className="barber-send-req">“{s.clientRequest}”</span>
              ) : null}
              <span className="barber-send-meta font-mono">
                {[s.clientEmail ?? s.clientPhone, timeAgo(t, s.createdAt)].filter(Boolean).join(' · ')}
              </span>
            </div>
            {s.videoUrl ? (
              <a className="chip-suggest" href={s.videoUrl} target="_blank" rel="noopener noreferrer">
                {t('View 360°')}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
