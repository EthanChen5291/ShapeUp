'use client';

import { useEffect, useState } from 'react';

/**
 * Mobile-support mechanism for this app.
 *
 * The codebase styles almost everything with inline `style={{}}` objects, so
 * Tailwind `md:`/`sm:` breakpoint prefixes do NOT reach most of the UI. Instead,
 * components read a boolean from `useIsMobile()` and merge a mobile-only style
 * object onto the existing desktop style object:
 *
 *   style={{ ...desktopStyle, ...(isMobile ? mobileStyle : {}) }}
 *
 * The desktop branch stays byte-identical to today, so desktop never changes.
 *
 * SSR note: server render and the first client render both report `false`
 * (desktop), matching the server HTML and avoiding hydration mismatches. The
 * real value is applied in an effect right after mount.
 */

/** Shared mobile breakpoint. Below this width (inclusive) we are "mobile". */
export const MOBILE_BREAKPOINT = 768;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);

    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** True when the viewport is at or below the mobile breakpoint. */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  return useMediaQuery(`(max-width: ${breakpoint}px)`);
}
