'use client';

// ============================================================
// useFeedbackPrompt — decides *when* to surface FeedbackToast
// ============================================================
// Rules:
//   • Only at success moments (Nth completed edit, or a save/export).
//   • Never twice in one session (sessionStorage guard).
//   • Respects the server cooldown (getFeedbackState.eligible).
//   • Never on error — callers only signal on success.

import { useCallback, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';

const EDITS_BEFORE_PROMPT = 3; // completed edits this session
const SESSION_KEY = 'shapeup:feedbackShown';

export function useFeedbackPrompt() {
  const state = useQuery(api.feedback.getFeedbackState);
  const [open, setOpen] = useState(false);
  const editCountRef = useRef(0);

  const alreadyShownThisSession = useCallback(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }, []);

  const tryOpen = useCallback(() => {
    if (open) return;
    if (!state?.eligible) return; // server cooldown / unauthenticated
    if (alreadyShownThisSession()) return;
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(true);
  }, [open, state?.eligible, alreadyShownThisSession]);

  // A hairstyle edit finished successfully.
  const registerEdit = useCallback(() => {
    editCountRef.current += 1;
    if (editCountRef.current >= EDITS_BEFORE_PROMPT) tryOpen();
  }, [tryOpen]);

  // A higher-intent success moment (save / export) — prompt right away.
  const registerMilestone = useCallback(() => {
    tryOpen();
  }, [tryOpen]);

  const close = useCallback(() => setOpen(false), []);

  return { open, close, registerEdit, registerMilestone, editCount: editCountRef.current };
}
