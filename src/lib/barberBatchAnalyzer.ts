import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import sharp from 'sharp';
import { isSafeImageSource } from '@/lib/urlSafety';
import {
  buildBarberAnalysisPrompt,
  parseBarberBatchAnalysis,
  type BarberBatchAnalysis,
} from '@/lib/barberBatchAnalysis';

// Must be a real generateContent-capable vision model. `gemini-3.1-flash` does
// NOT exist (the 3.1 line only ships -flash-lite / -flash-image / -tts); using
// it 404s every analysis call. gemini-2.5-flash is the proven baseline used
// elsewhere in this repo and supports vision + JSON responses.
const ANALYSIS_MODEL = 'gemini-2.5-flash';
const MAX_IMAGE_EDGE = 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const JPEG_QUALITY = 90;

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export class BarberAnalysisError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    options?: { cause?: unknown },
  ) {
    super(publicMessage, options);
    this.name = 'BarberAnalysisError';
  }
}

type AnalyzeOptions = {
  selfieUrl: string;
  offersPerms: boolean;
  requestUrl: string;
  requestHeaders: Headers;
};

async function loadSelfie(options: AnalyzeOptions) {
  if (!isSafeImageSource(options.selfieUrl)) {
    throw new BarberAnalysisError(400, 'selfieUrl is not allowed');
  }

  const internal = options.selfieUrl.startsWith('/');
  const fetchUrl = internal
    ? `${new URL(options.requestUrl).origin}${options.selfieUrl}`
    : options.selfieUrl;
  const headers: Record<string, string> = {};
  if (internal) {
    const cookie = options.requestHeaders.get('cookie');
    const authorization = options.requestHeaders.get('authorization');
    if (cookie) headers.cookie = cookie;
    if (authorization) headers.authorization = authorization;
  }

  let response: Response;
  try {
    response = await fetch(fetchUrl, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new BarberAnalysisError(502, 'Could not load the selfie. Please upload it again.', {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new BarberAnalysisError(502, 'Could not load the selfie. Please upload it again.');
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new BarberAnalysisError(400, 'The selfie is too large. Please upload a smaller photo.');
  }

  try {
    const jpeg = await sharp(Buffer.from(bytes))
      .rotate()
      .resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return { mimeType: 'image/jpeg', data: jpeg.toString('base64') };
  } catch (error) {
    throw new BarberAnalysisError(400, 'The selfie could not be read. Please upload another photo.', {
      cause: error,
    });
  }
}

/** Run the hard selfie gate, hair analysis, and eight-style proposal in one vision call. */
export async function analyzeBarberSelfie(options: AnalyzeOptions): Promise<BarberBatchAnalysis> {
  const selfie = await loadSelfie(options);
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = client.getGenerativeModel({
    model: ANALYSIS_MODEL,
    systemInstruction: buildBarberAnalysisPrompt(options.offersPerms),
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
    safetySettings,
  });

  let raw: string;
  try {
    const result = await model.generateContent([
      'Analyze this source selfie. Preserve the gate-first order in the system instruction.',
      { inlineData: selfie },
    ]);
    raw = result.response.text();
  } catch (error) {
    throw new BarberAnalysisError(
      502,
      'The selfie analysis did not finish. Please try again.',
      { cause: error },
    );
  }

  const analysis = parseBarberBatchAnalysis(raw);
  if (!analysis) {
    throw new BarberAnalysisError(
      502,
      'The selfie analysis returned an invalid response. Please try again.',
    );
  }
  return analysis;
}
