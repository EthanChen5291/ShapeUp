'use client';

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useAuth } from "@clerk/nextjs";

let convex: ConvexReactClient | undefined;
function getConvex(): ConvexReactClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  if (!convex) convex = new ConvexReactClient(url);
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
  const client = getConvex();
  if (!client) return <>{children}</>;
  return (
    <ConvexProviderWithAuth client={client} useAuth={useConvexClerkAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
