// Per-project persistence for the prompt-suggestion gender toggle. Each project
// keeps its own choice, so switching projects (or refreshing) restores the
// gender that was last active for that project.

export type Gender = 'mens' | 'womens';

export const GENDER_STORAGE_PREFIX = 'shapeup-gender:';

export function genderStorageKey(projectId: string): string {
  return `${GENDER_STORAGE_PREFIX}${projectId}`;
}

// Reads the stored choice for a project, defaulting to 'mens'. Tolerates a
// missing projectId, a non-browser environment, and unavailable/blocked
// localStorage (private mode, quota) — all fall back to the default.
export function loadGender(
  projectId?: string,
  storage?: Pick<Storage, 'getItem'>,
): Gender {
  const store = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!projectId || !store) return 'mens';
  try {
    return store.getItem(genderStorageKey(projectId)) === 'womens' ? 'womens' : 'mens';
  } catch {
    return 'mens';
  }
}

// Persists the choice for a project. No-op (never throws) when projectId is
// missing or storage is unavailable.
export function saveGender(
  gender: Gender,
  projectId?: string,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const store = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!projectId || !store) return;
  try {
    store.setItem(genderStorageKey(projectId), gender);
  } catch {
    // non-fatal
  }
}
