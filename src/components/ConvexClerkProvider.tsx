'use client';

import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";
import { useAuth } from "@clerk/nextjs";

let convex: ConvexReactClient | undefined;
function getConvex(): ConvexReactClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  if (!convex) convex = new ConvexReactClient(url);
  return convex;
}

export function ConvexClerkProvider({ children }: { children: React.ReactNode }) {
  const client = getConvex();
  if (!client) return <>{children}</>;
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
