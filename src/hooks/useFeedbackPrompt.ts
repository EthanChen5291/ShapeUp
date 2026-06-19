'use client';

// ============================================================
// useFeedbackPrompt — decides *when* to surface FeedbackToast
// ============================================================
// Rules:
//   • Only at success moments (Nth completed edit, or a save/export).
//   • Never twice in one session (sessionStorage guard).
//   • Respects the server cooldown (getFeedbackState.eligible).
//   • Never on error — callers only signal on success.
//   • New accounts (never submitted feedback) are prompted on their very
//     first edit — and the initial model render counts as that first edit —
//     so we capture an early impression instead of waiting for the 3rd edit.

import { useCallback, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';

const EDITS_BEFORE_PROMPT = 3; // completed edits this session (established users)
const NEW_ACCOUNT_EDITS_BEFORE_PROMPT = 1; // new accounts: prompt on the first edit/render
const SESSION_KEY = 'shapeup:feedbackShown';

export function useFeedbackPrompt() {
  const state = useQuery(api.feedback.getFeedbackState);
  const [open, setOpen] = useState(false);
  const editCountRef = useRef(0);

  // Server state is loaded once the query resolves; until then we can't tell a
  // new account from an established one, so callers should wait on this.
  const isReady = state != null;
  // "New account" = has never submitted feedback. These users get prompted on
  // their first edit (the initial render counts) instead of waiting for the 3rd.
  const isNewAccount = isReady && state.lastSubmittedAt == null;

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
    const threshold = isNewAccount ? NEW_ACCOUNT_EDITS_BEFORE_PROMPT : EDITS_BEFORE_PROMPT;
    if (editCountRef.current >= threshold) tryOpen();
  }, [tryOpen, isNewAccount]);

  // The initial 3D model render. For new accounts it counts as the first edit
  // so the prompt can surface as soon as something shows; no-op otherwise.
  const registerInitialRender = useCallback(() => {
    if (!isNewAccount) return;
    registerEdit();
  }, [isNewAccount, registerEdit]);

  // A higher-intent success moment (save / export) — prompt right away.
  const registerMilestone = useCallback(() => {
    tryOpen();
  }, [tryOpen]);

  const close = useCallback(() => setOpen(false), []);

  return { open, close, registerEdit, registerInitialRender, registerMilestone, isReady, editCount: editCountRef.current };
}
