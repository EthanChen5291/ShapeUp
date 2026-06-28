'use client';

// ─── Lightweight i18n ───
// Retrofit-friendly translation for an app full of inline English strings.
//
// `t("English source")` returns the Spanish translation from the central
// dictionary when the active language is `es`, otherwise it returns the
// English source verbatim. Strings that haven't been added to the dictionary
// fall through to English — so wrapping a string is always safe, and coverage
// can grow incrementally without ever crashing or showing a blank key.
//
// Usage:
//   const t = useT();
//   <span>{t('Settings')}</span>
//   <span>{t('You have {n} cuts left', { n: 3 })}</span>

import { useCallback } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { es } from './es';

export type Lang = 'en' | 'es';

const DICTIONARIES: Record<string, Record<string, string>> = { es };

export type TFunction = (en: string, vars?: Record<string, string | number>) => string;

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  let out = s;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

// Disambiguation: the same English word can need different translations in
// different places (e.g. "Saved" the button state vs "Saved" the section
// title). Callers pass `t('Saved##title')`; the dictionary keys on the full
// `Saved##title` string, while the English fallback drops everything from
// `##` onward so untranslated text still reads naturally.
function stripContext(key: string): string {
  const i = key.indexOf('##');
  return i === -1 ? key : key.slice(0, i);
}

/**
 * Translate using the active app language (from SettingsContext).
 * Re-renders automatically when the user switches languages because it reads
 * `language` from the settings context.
 */
export function useT(): TFunction {
  const { language } = useSettings();
  return useCallback(
    (en, vars) => {
      const dict = DICTIONARIES[language];
      const translated = dict?.[en] ?? stripContext(en);
      return interpolate(translated, vars);
    },
    [language],
  );
}

/** Translate outside of React (e.g. in plain helpers). */
export function translate(language: string, en: string, vars?: Record<string, string | number>): string {
  const dict = DICTIONARIES[language];
  return interpolate(dict?.[en] ?? stripContext(en), vars);
}
