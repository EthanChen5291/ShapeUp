import fs from 'fs/promises';
import path from 'path';
import { getFaceliftHeaders, resolveFaceliftUpstreams } from '@/lib/facelift';
import { sanitizeOutputName } from '@/lib/imageDataUrl';
import { uploadToS3 } from '@/lib/s3';

export const MAX_FACELIFT_IMAGE_BYTES = 6 * 1024 * 1024;

const SH_C0 = 0.28209479177387814;
const MAX_PLY_BYTES = 80 * 1024 * 1024;
const MAX_VIDEO_BYTES = 120 * 1024 * 1024;

const PLY_SIZES: Record<string, number> = {
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
};

const ASSET_KEY_RE = /^facelifts\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

type UpstreamResult =
  | {
      ok: true;
      kind: 'stored';
      jobId: string;
      plyKey: string | null;
      splatKey: string;
      videoKey: string | null;
      videoBuffer: Buffer | null;
      elapsedSeconds: number | null;
    }
  | {
      ok: true;
      kind: 'base64';
      plyBuffer: Buffer;
      videoBuffer: Buffer | null;
      elapsedSeconds: number | null;
    }
  | { ok: false; reason: string };

export type FaceliftCoreOptions = {
  buffer: Buffer;
  mimeType: string;
  outputName?: string;
  needPly?: boolean;
};

export type FaceliftCoreResult = {
  jobId: string;
  plyS3Key: string | null;
  splatS3Key: string;
  videoS3Key: string | null;
  elapsedSeconds: number | null;
};

export class FaceliftCoreError extends Error {
  constructor(
    readonly code: 'upstream_unavailable' | 'malformed_ply',
    readonly publicMessage: string,
    options?: { cause?: unknown },
  ) {
    super(publicMessage, options);
    this.name = 'FaceliftCoreError';
  }
}

function plyToSplat(plyBuffer: Buffer): Buffer {
  const endMarker = Buffer.from('end_header\n');
  const headerEnd = plyBuffer.indexOf(endMarker);
  if (headerEnd === -1) throw new Error('Invalid PLY: no end_header');
  const dataOffset = headerEnd + endMarker.length;
  const header = plyBuffer.subarray(0, headerEnd).toString('ascii');
  const countMatch = header.match(/element vertex (\d+)/);
  if (!countMatch) throw new Error('No vertex count in PLY');
  const vertexCount = Number.parseInt(countMatch[1], 10);

  const propertyLines = [...header.matchAll(/^property (\S+) (\S+)$/gm)];
  const propertyOffset: Record<string, number> = {};
  let stride = 0;
  for (const [, type, name] of propertyLines) {
    propertyOffset[name] = stride;
    stride += PLY_SIZES[type] ?? 4;
  }
  const floatAt = (index: number, name: string) =>
    plyBuffer.readFloatLE(dataOffset + index * stride + propertyOffset[name]);

  const x = new Float32Array(vertexCount);
  const y = new Float32Array(vertexCount);
  const z = new Float32Array(vertexCount);
  const red = new Float32Array(vertexCount);
  const green = new Float32Array(vertexCount);
  const blue = new Float32Array(vertexCount);
  const alpha = new Float32Array(vertexCount);
  const scaleX = new Float32Array(vertexCount);
  const scaleY = new Float32Array(vertexCount);
  const scaleZ = new Float32Array(vertexCount);
  const rotation = [
    new Float32Array(vertexCount),
    new Float32Array(vertexCount),
    new Float32Array(vertexCount),
    new Float32Array(vertexCount),
  ];

  for (let index = 0; index < vertexCount; index += 1) {
    x[index] = floatAt(index, 'x');
    y[index] = floatAt(index, 'y');
    z[index] = floatAt(index, 'z');
    red[index] = Math.min(1, Math.max(0, 0.5 + SH_C0 * floatAt(index, 'f_dc_0')));
    green[index] = Math.min(1, Math.max(0, 0.5 + SH_C0 * floatAt(index, 'f_dc_1')));
    blue[index] = Math.min(1, Math.max(0, 0.5 + SH_C0 * floatAt(index, 'f_dc_2')));
    alpha[index] = 1 / (1 + Math.exp(-floatAt(index, 'opacity')));
    scaleX[index] = Math.exp(floatAt(index, 'scale_0'));
    scaleY[index] = Math.exp(floatAt(index, 'scale_1'));
    scaleZ[index] = Math.exp(floatAt(index, 'scale_2'));
    const q0 = floatAt(index, 'rot_0');
    const q1 = floatAt(index, 'rot_1');
    const q2 = floatAt(index, 'rot_2');
    const q3 = floatAt(index, 'rot_3');
    const length = Math.max(1e-8, Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3));
    rotation[0][index] = q0 / length;
    rotation[1][index] = q1 / length;
    rotation[2][index] = q2 / length;
    rotation[3][index] = q3 / length;
  }

  const order = Array.from({ length: vertexCount }, (_, index) => index)
    .sort((left, right) => alpha[right] - alpha[left]);
  const output = Buffer.allocUnsafe(vertexCount * 32);
  for (let index = 0; index < vertexCount; index += 1) {
    const sourceIndex = order[index];
    const offset = index * 32;
    output.writeFloatLE(x[sourceIndex], offset);
    output.writeFloatLE(y[sourceIndex], offset + 4);
    output.writeFloatLE(z[sourceIndex], offset + 8);
    output.writeFloatLE(scaleX[sourceIndex], offset + 12);
    output.writeFloatLE(scaleY[sourceIndex], offset + 16);
    output.writeFloatLE(scaleZ[sourceIndex], offset + 20);
    output.writeUInt8(Math.round(red[sourceIndex] * 255), offset + 24);
    output.writeUInt8(Math.round(green[sourceIndex] * 255), offset + 25);
    output.writeUInt8(Math.round(blue[sourceIndex] * 255), offset + 26);
    output.writeUInt8(Math.round(alpha[sourceIndex] * 255), offset + 27);
    for (let component = 0; component < 4; component += 1) {
      output.writeUInt8(
        Math.min(255, Math.max(0, Math.round(rotation[component][sourceIndex] * 128 + 128))),
        offset + 28 + component,
      );
    }
  }
  return output;
}

function decodeBoundedBase64(value: unknown, maxBytes: number): Buffer | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length > Math.ceil((maxBytes * 4) / 3) + 128) return null;
  const buffer = Buffer.from(value, 'base64');
  return buffer.length > 0 && buffer.length <= maxBytes ? buffer : null;
}

function isValidAssetKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && ASSET_KEY_RE.test(value);
}

async function callUpstream(url: string, form: FormData): Promise<UpstreamResult> {
  let response: Response;
  try {
    response = await fetch(`${url}/process_image`, {
      method: 'POST',
      headers: getFaceliftHeaders(),
      body: form,
      signal: AbortSignal.timeout(600_000),
    });
  } catch (error) {
    return {
      ok: false,
      reason: `network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, reason: `HTTP ${response.status}: ${text}` };
  }

  let data: {
    job_id?: unknown;
    ply_s3_key?: unknown;
    splat_s3_key?: unknown;
    video_s3_key?: unknown;
    ply_b64?: unknown;
    video_b64?: unknown;
    elapsed_s?: unknown;
  };
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: 'malformed JSON' };
  }
  const elapsedSeconds = typeof data.elapsed_s === 'number' && data.elapsed_s > 0
    ? data.elapsed_s
    : null;

  if (data.splat_s3_key !== undefined || data.ply_s3_key !== undefined) {
    if (!isValidAssetKey(data.splat_s3_key)) {
      return { ok: false, reason: 'missing or invalid splat_s3_key' };
    }
    let plyKey: string | null = null;
    if (data.ply_s3_key !== undefined && data.ply_s3_key !== null) {
      if (!isValidAssetKey(data.ply_s3_key)) {
        return { ok: false, reason: 'invalid ply_s3_key' };
      }
      plyKey = data.ply_s3_key;
    }
    let videoKey: string | null = null;
    if (data.video_s3_key !== undefined && data.video_s3_key !== null) {
      if (!isValidAssetKey(data.video_s3_key)) {
        return { ok: false, reason: 'invalid video_s3_key' };
      }
      videoKey = data.video_s3_key;
    }
    let videoBuffer: Buffer | null = null;
    if (!videoKey && data.video_b64) {
      videoBuffer = decodeBoundedBase64(data.video_b64, MAX_VIDEO_BYTES);
      if (!videoBuffer) return { ok: false, reason: 'invalid video_b64' };
    }
    return {
      ok: true,
      kind: 'stored',
      jobId: typeof data.job_id === 'string' && data.job_id ? data.job_id : crypto.randomUUID(),
      plyKey,
      splatKey: data.splat_s3_key,
      videoKey,
      videoBuffer,
      elapsedSeconds,
    };
  }

  const plyBuffer = decodeBoundedBase64(data.ply_b64, MAX_PLY_BYTES);
  if (!plyBuffer) return { ok: false, reason: 'missing or invalid ply_s3_key / ply_b64' };
  let videoBuffer: Buffer | null = null;
  if (data.video_b64) {
    videoBuffer = decodeBoundedBase64(data.video_b64, MAX_VIDEO_BYTES);
    if (!videoBuffer) return { ok: false, reason: 'invalid video_b64' };
  }
  return { ok: true, kind: 'base64', plyBuffer, videoBuffer, elapsedSeconds };
}

/** Call the render worker and persist every returned durable media artifact. */
export async function runFaceliftCore(options: FaceliftCoreOptions): Promise<FaceliftCoreResult> {
  const needPly = options.needPly ?? false;
  const extension = options.mimeType === 'image/png'
    ? 'png'
    : options.mimeType === 'image/webp'
      ? 'webp'
      : 'jpg';
  const bytes = new Uint8Array(options.buffer.length);
  bytes.set(options.buffer);
  const imageBlob = new Blob([bytes], { type: options.mimeType });
  const buildForm = () => {
    const form = new FormData();
    form.append('image', imageBlob, `face.${extension}`);
    form.append('need_ply', needPly ? 'true' : 'false');
    return form;
  };

  const upstreams = await resolveFaceliftUpstreams();
  let result: Extract<UpstreamResult, { ok: true }> | null = null;
  const failures: string[] = [];
  for (const { name, url } of upstreams) {
    const attempt = await callUpstream(url, buildForm());
    if (attempt.ok) {
      result = attempt;
      break;
    }
    failures.push(`${name}: ${attempt.reason}`);
  }
  if (!result) {
    const detail = failures.join('; ') || 'no upstream configured';
    throw new FaceliftCoreError(
      'upstream_unavailable',
      `FaceLift server unavailable (${detail})`,
    );
  }

  let jobId: string;
  let plyS3Key: string | null = null;
  let splatS3Key: string;
  let videoS3Key: string | null = null;
  if (result.kind === 'stored') {
    jobId = result.jobId;
    plyS3Key = result.plyKey;
    splatS3Key = result.splatKey;
    videoS3Key = result.videoKey;
    if (!videoS3Key && result.videoBuffer) {
      videoS3Key = `facelifts/${jobId}/turntable.mp4`;
      await uploadToS3(videoS3Key, result.videoBuffer, 'video/mp4');
    }
  } else {
    let splatBuffer: Buffer;
    try {
      splatBuffer = plyToSplat(result.plyBuffer);
    } catch (error) {
      throw new FaceliftCoreError(
        'malformed_ply',
        'FaceLift server returned malformed PLY data',
        { cause: error },
      );
    }
    jobId = crypto.randomUUID();
    splatS3Key = `facelifts/${jobId}/output.splat`;
    plyS3Key = needPly ? `facelifts/${jobId}/output.ply` : null;
    videoS3Key = result.videoBuffer ? `facelifts/${jobId}/turntable.mp4` : null;
    await Promise.all([
      uploadToS3(splatS3Key, splatBuffer, 'application/octet-stream'),
      ...(plyS3Key
        ? [uploadToS3(plyS3Key, result.plyBuffer, 'application/octet-stream')]
        : []),
      ...(result.videoBuffer && videoS3Key
        ? [uploadToS3(videoS3Key, result.videoBuffer, 'video/mp4')]
        : []),
    ]);

    try {
      const publicDirectory = path.join(process.cwd(), 'public');
      const outputName = sanitizeOutputName(options.outputName, 'edit-output');
      await Promise.all([
        fs.writeFile(path.join(publicDirectory, `${outputName}.splat`), splatBuffer),
        ...(needPly
          ? [fs.writeFile(path.join(publicDirectory, `${outputName}.ply`), result.plyBuffer)]
          : []),
      ]);
    } catch (error) {
      console.warn('[facelift-core] local preview write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    jobId,
    plyS3Key,
    splatS3Key,
    videoS3Key,
    elapsedSeconds: result.elapsedSeconds,
  };
}
