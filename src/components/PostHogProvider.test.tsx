// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// --- Mock posthog ---
const posthogMock = {
  __loaded: true,
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
};
vi.mock('posthog-js', () => ({ default: posthogMock }));
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePostHog: () => posthogMock,
}));

// --- Mock Clerk (mutable so each test sets auth state) ---
let authState: { isSignedIn: boolean; isLoaded: boolean } = { isSignedIn: false, isLoaded: true };
let userState: { id: string; fullName: string | null; primaryEmailAddress?: { emailAddress: string } } | null = null;
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => authState,
  useUser: () => ({ user: userState }),
}));

// --- Mock next/navigation ---
let pathname = '/dashboard';
const searchParams = new URLSearchParams('');
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

// Provider reads the key at module load; set it before import.
vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');

// Import after env + mocks are registered.
const { PostHogProvider } = await import('./PostHogProvider');

beforeEach(() => {
  vi.clearAllMocks();
  authState = { isSignedIn: false, isLoaded: true };
  userState = null;
  pathname = '/dashboard';
});

afterEach(() => cleanup());

describe('PostHogProvider', () => {
  it('renders children', () => {
    render(<PostHogProvider><span>child</span></PostHogProvider>);
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('captures a pageview for the current path', () => {
    render(<PostHogProvider><span>child</span></PostHogProvider>);
    expect(posthogMock.capture).toHaveBeenCalledWith(
      '$pageview',
      expect.objectContaining({ $current_url: expect.stringContaining('/dashboard') }),
    );
  });

  it('identifies the user when signed in', () => {
    authState = { isSignedIn: true, isLoaded: true };
    userState = { id: 'user_123', fullName: 'Ada Lovelace', primaryEmailAddress: { emailAddress: 'ada@ex.com' } };
    render(<PostHogProvider><span>child</span></PostHogProvider>);
    expect(posthogMock.identify).toHaveBeenCalledWith('user_123', {
      email: 'ada@ex.com',
      name: 'Ada Lovelace',
    });
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });

  it('resets when signed out', () => {
    authState = { isSignedIn: false, isLoaded: true };
    render(<PostHogProvider><span>child</span></PostHogProvider>);
    expect(posthogMock.reset).toHaveBeenCalled();
    expect(posthogMock.identify).not.toHaveBeenCalled();
  });

  it('waits for Clerk to load before identifying', () => {
    authState = { isSignedIn: false, isLoaded: false };
    render(<PostHogProvider><span>child</span></PostHogProvider>);
    expect(posthogMock.identify).not.toHaveBeenCalled();
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });
});
