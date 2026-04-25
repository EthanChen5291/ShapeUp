'use client';

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useAuth } from "@clerk/nextjs";

// Lazily initialized so module evaluation during SSR doesn't throw when
// NEXT_PUBLIC_CONVEX_URL is not inlined at build time.
let convex: ConvexReactClient | undefined;
function getConvex() {
  if (!convex) convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  return convex;
}

function useConvexClerkAuth() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  return {
    isLoading: !isLoaded,
    isAuthenticated: isSignedIn ?? false,
    fetchAccessToken: async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      return getToken({ template: "convex", skipCache: forceRefreshToken });
    },
  };
}

export function ConvexClerkProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithAuth client={getConvex()} useAuth={useConvexClerkAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
