// Firebase removed — replaced by Convex
// This file is kept as a stub to avoid breaking any remaining imports during migration.

export function getDb(): never {
  throw new Error('Firebase has been removed. Use Convex instead.');
}

export function getBucket(): never {
  throw new Error('Firebase has been removed. Use Convex instead.');
}

export const FieldValue = {
  serverTimestamp: () => null,
  arrayUnion: (..._items: unknown[]) => _items,
};

export async function uploadAndGetUrl(): Promise<string> {
  throw new Error('Firebase has been removed. Use Convex storage instead.');
}
