import { HairParams, LLMEditResponse } from '@/types';

export const MAX_PROMPT_LENGTH = 500;
export const MAX_SUMMARY_PAYLOAD_LENGTH = 12_000;
export const USER_INSTRUCTION_OPEN = '<user_instruction>';
export const USER_INSTRUCTION_CLOSE = '</user_instruction>';

const PRESETS = new Set(['buzz', 'pompadour', 'undercut', 'taper_fade', 'afro', 'waves', 'default']);

const PARAM_RANGES: Record<keyof HairParams, { min: number; max: number }> = {
  topLength: { min: 0, max: 2 },
  sideLength: { min: 0, max: 2 },
  backLength: { min: 0, max: 2 },
  messiness: { min: 0, max: 1 },
  taper: { min: 0, max: 1 },
  pc1: { min: -3, max: 3 },
  pc2: { min: -3, max: 3 },
  pc3: { min: -3, max: 3 },
  pc4: { min: -3, max: 3 },
  pc5: { min: -3, max: 3 },
  pc6: { min: -3, max: 3 },
};

const REQUIRED_MODEL_PARAMS: Array<keyof HairParams> = ['topLength', 'sideLength', 'backLength', 'messiness', 'taper'];
const OPTIONAL_MODEL_PARAMS: Array<keyof HairParams> = ['pc1', 'pc2', 'pc3', 'pc4', 'pc5', 'pc6'];

export function sanitizeUserInstruction(input: string): string {
  return input
    .replaceAll(USER_INSTRUCTION_OPEN, '[removed delimiter]')
    .replaceAll(USER_INSTRUCTION_CLOSE, '[removed delimiter]')
    .trim();
}

export function buildDelimitedEditMessage(instruction: string, currentProfilePayload: unknown): string {
  const safeInstruction = sanitizeUserInstruction(instruction);
  return [
    `${USER_INSTRUCTION_OPEN}`,
    safeInstruction,
    `${USER_INSTRUCTION_CLOSE}`,
    '',
    'CURRENT_PROFILE:',
    JSON.stringify(currentProfilePayload, null, 2),
  ].join('\n');
}

export function validatePromptLength(instruction: unknown): string | null {
  if (typeof instruction !== 'string' || instruction.trim().length === 0) return 'Prompt is required';
  if (instruction.length > MAX_PROMPT_LENGTH) return `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`;
  return null;
}

function validateNumber(value: unknown, key: keyof HairParams): value is number {
  const range = PARAM_RANGES[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
}

export function validateLLMEditResponse(value: unknown): { ok: true; data: LLMEditResponse } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'response_not_object' };
  const candidate = value as { preset?: unknown; params?: unknown };
  if (candidate.preset !== undefined && (typeof candidate.preset !== 'string' || !PRESETS.has(candidate.preset))) {
    return { ok: false, reason: 'invalid_preset' };
  }
  if (!candidate.params || typeof candidate.params !== 'object') return { ok: false, reason: 'missing_params' };

  const rawParams = candidate.params as Record<string, unknown>;
  const params: HairParams = {
    topLength: 1,
    sideLength: 1,
    backLength: 1,
    messiness: 0.2,
    taper: 0.5,
    pc1: 0,
    pc2: 0,
    pc3: 0,
    pc4: 0,
    pc5: 0,
    pc6: 0,
  };
  for (const key of REQUIRED_MODEL_PARAMS) {
    if (!validateNumber(rawParams[key], key)) return { ok: false, reason: `invalid_${key}` };
    params[key] = rawParams[key] as number;
  }
  for (const key of OPTIONAL_MODEL_PARAMS) {
    if (rawParams[key] === undefined) continue;
    if (!validateNumber(rawParams[key], key)) return { ok: false, reason: `invalid_${key}` };
    params[key] = rawParams[key] as number;
  }

  return {
    ok: true,
    data: {
      preset: candidate.preset as LLMEditResponse['preset'],
      params,
    },
  };
}

export function stripMarkdownJsonFences(text: string): string {
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}
