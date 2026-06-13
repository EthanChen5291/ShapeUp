'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

interface NavLoadingContextValue {
  startLoading: () => void;
  stopLoading: () => void;
}

const NavLoadingContext = createContext<NavLoadingContextValue>({
  startLoading: () => {},
  stopLoading: () => {},
});

export function useNavLoading() {
  return useContext(NavLoadingContext);
}

export function NavLoadingProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startLoading = useCallback(() => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  }, []);

  const stopLoading = useCallback(() => {
    setVisible(false);
    stopTimerRef.current = setTimeout(() => setMounted(false), 420);
  }, []);

  const r = 20;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * 0.75;

  return (
    <NavLoadingContext.Provider value={{ startLoading, stopLoading }}>
      {children}
      {mounted && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{
            background: 'rgba(32,22,14,0.55)',
            backdropFilter: 'blur(2px)',
            opacity: visible ? 1 : 0,
            transition: 'opacity 380ms ease',
            pointerEvents: visible ? 'auto' : 'none',
          }}
        >
          <div style={{ width: 48, height: 48, animation: 'spin 1.1s linear infinite' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r={r} stroke="rgba(255,248,234,0.15)" strokeWidth="3" />
              <circle
                cx="24" cy="24" r={r}
                stroke="var(--butter)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashoffset}
                transform="rotate(-90, 24, 24)"
              />
            </svg>
          </div>
        </div>
      )}
    </NavLoadingContext.Provider>
  );
}
