import { beforeEach, describe, expect, test, vi } from 'vitest';

// Capture the model id the analyzer asks the SDK for. This is the whole point
// of the test: `gemini-3.1-flash` does not exist and 404s every call, so guard
// against ever passing a bogus/broken vision model again.
const { getGenerativeModelMock, generateContentMock } = vi.hoisted(() => ({
  getGenerativeModelMock: vi.fn(),
  generateContentMock: vi.fn(),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(config: { model: string }) {
      return getGenerativeModelMock(config);
    }
  },
  HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH' },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
}));

vi.mock('sharp', () => ({
  default: () => ({
    rotate: () => ({
      resize: () => ({
        jpeg: () => ({
          toBuffer: async () => Buffer.from('jpeg-bytes'),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/urlSafety', () => ({
  isSafeImageSource: () => true,
}));

// Known valid generateContent-capable Gemini models (verified against the live
// ListModels response for this project's key). The analyzer must use one.
const VALID_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
]);

import { analyzeBarberSelfie } from './barberBatchAnalyzer';

beforeEach(() => {
  getGenerativeModelMock.mockReset();
  generateContentMock.mockReset();
  getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });
  generateContentMock.mockResolvedValue({
    response: { text: () => JSON.stringify({ ok: false, reason: 'Face is out of frame' }) },
  });
  process.env.GEMINI_API_KEY = 'test-key';
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(Buffer.from('image-bytes'), { status: 200 })),
  );
});

describe('analyzeBarberSelfie model wiring', () => {
  test('requests a real, generateContent-capable Gemini model (never gemini-3.1-flash)', async () => {
    await analyzeBarberSelfie({
      selfieUrl: 'https://cdn.test/selfie.jpg',
      offersPerms: false,
      requestUrl: 'https://app.test/api/barber-batch',
      requestHeaders: new Headers(),
    });

    expect(getGenerativeModelMock).toHaveBeenCalledTimes(1);
    const model = getGenerativeModelMock.mock.calls[0][0].model as string;
    expect(model).not.toBe('gemini-3.1-flash');
    expect(VALID_MODELS.has(model)).toBe(true);
  });

  test('returns the parsed gate rejection from the vision response', async () => {
    const analysis = await analyzeBarberSelfie({
      selfieUrl: 'https://cdn.test/selfie.jpg',
      offersPerms: false,
      requestUrl: 'https://app.test/api/barber-batch',
      requestHeaders: new Headers(),
    });

    expect(analysis).toEqual({ ok: false, reason: 'Face is out of frame' });
  });
});
