// ============================================================
// recordSplatVideo — client-side encoder for the 360° splat clip
//
// Primary path: WebCodecs VideoEncoder (hardware H.264) + mp4-muxer → real .mp4.
//   Frames are *pushed* deterministically (exactly FRAMES frames), so the loop
//   is independent of wall-clock time.
// Fallback path: MediaRecorder on canvas.captureStream() → .webm. This is
//   realtime — the capture loop must pace itself at `fps` for it to work.
//
// Usage:
//   const enc = await createSplatEncoder({ canvas, width, height, fps });
//   enc.start();
//   for each rendered frame: enc.addFrame();
//   const { blob, ext } = await enc.finish();
// ============================================================

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export interface SplatEncoderResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  mime: string;
}

export interface SplatEncoder {
  /** True when the encoder records in realtime (webm fallback) and the capture
   *  loop must pace itself at `fps`. False for the frame-pushed WebCodecs path. */
  readonly realtime: boolean;
  /** Begin recording. */
  start(): void;
  /** Submit the canvas's current contents as the next frame. */
  addFrame(): void;
  /** Stop, encode, and resolve with the final blob. */
  finish(): Promise<SplatEncoderResult>;
  /** Abort without producing a file (cleanup on unmount / error). */
  cancel(): void;
}

export interface SplatEncoderOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
}

// H.264 needs even dimensions.
function evenDim(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function pickBitrate(width: number, height: number, fps: number): number {
  // ~0.12 bits per pixel per frame, capped so short clips stay reasonable.
  return Math.min(12_000_000, Math.round(width * height * fps * 0.12));
}

async function createWebCodecsEncoder(opts: SplatEncoderOptions): Promise<SplatEncoder | null> {
  if (typeof window === 'undefined' || typeof window.VideoEncoder === 'undefined') return null;

  const width = evenDim(opts.width);
  const height = evenDim(opts.height);
  const fps = opts.fps;
  const bitrate = pickBitrate(width, height, fps);

  // Probe a few codec levels (square renders can exceed level 3.1's frame limit).
  const candidates = ['avc1.42002a', 'avc1.420028', 'avc1.42001f'];
  let codec: string | null = null;
  for (const c of candidates) {
    try {
      const support = await window.VideoEncoder.isConfigSupported({ codec: c, width, height, bitrate, framerate: fps });
      if (support.supported) { codec = c; break; }
    } catch { /* try next */ }
  }
  if (!codec) return null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  });

  let encoderError: unknown = null;
  const encoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encoderError = e; },
  });
  encoder.configure({ codec, width, height, bitrate, framerate: fps });

  const frameDuration = 1_000_000 / fps; // microseconds
  let frameCount = 0;

  return {
    realtime: false,
    start() { /* nothing — frames are pushed */ },
    addFrame() {
      if (encoderError) return;
      const timestamp = Math.round(frameCount * frameDuration);
      const frame = new VideoFrame(opts.canvas, { timestamp, duration: Math.round(frameDuration) });
      encoder.encode(frame, { keyFrame: frameCount % fps === 0 });
      frame.close();
      frameCount++;
    },
    async finish() {
      await encoder.flush();
      if (encoderError) throw encoderError;
      muxer.finalize();
      const { buffer } = muxer.target;
      return { blob: new Blob([buffer], { type: 'video/mp4' }), ext: 'mp4', mime: 'video/mp4' };
    },
    cancel() { try { encoder.close(); } catch { /* already closed */ } },
  };
}

function pickWebmMime(): string {
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'video/webm';
}

function createMediaRecorderEncoder(opts: SplatEncoderOptions): SplatEncoder {
  const mime = pickWebmMime();
  const stream = opts.canvas.captureStream(opts.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: pickBitrate(opts.width, opts.height, opts.fps),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return {
    realtime: true,
    start() { recorder.start(); },
    addFrame() { /* captureStream samples the canvas on its own clock */ },
    finish() {
      return new Promise<SplatEncoderResult>((resolve) => {
        recorder.onstop = () => {
          resolve({ blob: new Blob(chunks, { type: mime }), ext: 'webm', mime });
        };
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      });
    },
    cancel() {
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* noop */ }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/** Build the best available encoder for this browser. */
export async function createSplatEncoder(opts: SplatEncoderOptions): Promise<SplatEncoder> {
  const webcodecs = await createWebCodecsEncoder(opts).catch(() => null);
  return webcodecs ?? createMediaRecorderEncoder(opts);
}
