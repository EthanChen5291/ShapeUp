// ============================================================
// useLLM — ETHAN's domain
//
// Sends a user prompt + current profile to the LLM API and
// returns the updated HairParams. Handles loading/error state.
//
// Usage:
//   const { editHair, loading, error } = useLLM(profile);
//   const updated = await editHair("Give me a messy taper fade");
// ============================================================

'use client';

import { useState, useCallback } from 'react';
import { UserHeadProfile, LLMEditResponse, HairParams } from '@/types';
import { EDIT_LOOP_SYSTEM_PROMPT } from '@/lib/llmPrompt';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';

interface UseLLMReturn {
  editHair: (prompt: string) => Promise<LLMEditResponse | null>;
  loading: boolean;
  error: string | null;
}

export function useLLM(profile: UserHeadProfile): UseLLMReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editHair = useCallback(
    async (prompt: string): Promise<LLMEditResponse | null> => {
      setLoading(true);
      setError(null);

      // Attach current profile as context so the LLM can do relative edits
      const currentProfilePayload = buildCurrentProfilePayload(profile);
      const userMessage = `
${prompt}

CURRENT_PROFILE: ${JSON.stringify(currentProfilePayload, null, 2)}
      `.trim();

      try {
        const res = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system: EDIT_LOOP_SYSTEM_PROMPT,
            message: userMessage,
          }),
        });

        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }

        const data = await res.json();

        // Validate & clamp returned values
        const params = clampParams(data.params);
        return { preset: data.preset, params };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [profile]
  );

  return { editHair, loading, error };
}

// Defensive clamping — never trust raw LLM output
function clampParams(raw: Partial<HairParams>): HairParams {
  const clamp = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' ? Math.min(max, Math.max(min, v)) : fallback;

  return {
    topLength:  clamp(raw?.topLength,  0, 2, 1.0),
    sideLength: clamp(raw?.sideLength, 0, 2, 1.0),
    backLength: clamp(raw?.backLength, 0, 2, 1.0),
    messiness:  clamp(raw?.messiness,  0, 1, 0.2),
    taper:      clamp(raw?.taper,      0, 1, 0.5),
    pc1: clamp(raw?.pc1, -3, 3, 0),
    pc2: clamp(raw?.pc2, -3, 3, 0),
    pc3: clamp(raw?.pc3, -3, 3, 0),
    pc4: clamp(raw?.pc4, -3, 3, 0),
    pc5: clamp(raw?.pc5, -3, 3, 0),
    pc6: clamp(raw?.pc6, -3, 3, 0),
  };
}
