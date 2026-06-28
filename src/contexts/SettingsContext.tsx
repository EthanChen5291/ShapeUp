'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';

export type Theme = 'light' | 'dark' | 'system';
export type RenderQuality = 'performance' | 'balanced' | 'high';

interface Settings {
  theme: Theme;
  renderQuality: RenderQuality;
  language: string;
  aiTrainingOptOut: boolean;
}

interface SettingsContextValue extends Settings {
  updateTheme: (t: Theme) => void;
  updateRenderQuality: (q: RenderQuality) => void;
  updateLanguage: (l: string) => void;
  updateAiTrainingOptOut: (v: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  theme: 'light',
  renderQuality: 'balanced',
  language: 'en',
  aiTrainingOptOut: false,
  updateTheme: () => {},
  updateRenderQuality: () => {},
  updateLanguage: () => {},
  updateAiTrainingOptOut: () => {},
});

function readLocalSettings(): Partial<Settings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('shapeup_settings');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalSettings(patch: Partial<Settings>) {
  if (typeof window === 'undefined') return;
  try {
    const current = readLocalSettings();
    localStorage.setItem('shapeup_settings', JSON.stringify({ ...current, ...patch }));
  } catch { /* ignore */ }
}

// Public marketing surfaces always render in the warm light palette — dark mode
// is an in-app preference and must never bleed onto the landing page (a returning
// signed-out user can still have `theme: 'dark'` persisted in localStorage).
const LIGHT_ONLY_ROUTES = new Set(['/']);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const userQuery = useQuery(api.users.getMe);
  const updateSettingsMutation = useMutation(api.users.updateSettings);
  const isLoggedIn = userQuery !== null && userQuery !== undefined;

  const local = useMemo(() => readLocalSettings(), []);

  const [theme, setTheme] = useState<Theme>(local.theme ?? 'light');
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(local.renderQuality ?? 'balanced');
  const [language, setLanguage] = useState<string>(local.language ?? 'en');
  const [aiTrainingOptOut, setAiTrainingOptOut] = useState<boolean>(local.aiTrainingOptOut ?? false);

  const hydratedFromConvex = useRef(false);
  useEffect(() => {
    if (!userQuery || hydratedFromConvex.current) return;
    hydratedFromConvex.current = true;
    if (userQuery.theme) setTheme(userQuery.theme);
    if (userQuery.renderQuality) setRenderQuality(userQuery.renderQuality);
    if (userQuery.language) setLanguage(userQuery.language);
    if (userQuery.aiTrainingOptOut != null) setAiTrainingOptOut(userQuery.aiTrainingOptOut);
  }, [userQuery]);

  // Reflect the chosen language on <html lang> for a11y / browser hints.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language || 'en';
  }, [language]);

  // Apply theme to <html>
  useEffect(() => {
    const apply = (dark: boolean) => {
      document.documentElement.classList.toggle('dark', dark);
    };
    // Marketing routes are always light, whatever the stored preference.
    if (LIGHT_ONLY_ROUTES.has(pathname)) { apply(false); return; }
    if (theme === 'dark') { apply(true); return; }
    if (theme === 'light') { apply(false); return; }
    // system
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, pathname]);

  const persist = (patch: Partial<Settings>) => {
    writeLocalSettings(patch);
    if (isLoggedIn) updateSettingsMutation(patch as Parameters<typeof updateSettingsMutation>[0]).catch(() => {});
  };

  const updateTheme = (t: Theme) => { setTheme(t); persist({ theme: t }); };
  const updateRenderQuality = (q: RenderQuality) => { setRenderQuality(q); persist({ renderQuality: q }); };
  const updateLanguage = (l: string) => { setLanguage(l); persist({ language: l }); };
  const updateAiTrainingOptOut = (v: boolean) => { setAiTrainingOptOut(v); persist({ aiTrainingOptOut: v }); };

  const value = useMemo(() => ({
    theme, renderQuality, language, aiTrainingOptOut,
    updateTheme, updateRenderQuality, updateLanguage, updateAiTrainingOptOut,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme, renderQuality, language, aiTrainingOptOut]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
