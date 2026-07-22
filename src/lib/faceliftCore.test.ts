import { beforeEach, describe, expect, test, vi } from 'vitest';

const { uploadToS3Mock } = vi.hoisted(() => ({
  uploadToS3Mock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/facelift', () => ({
  getFaceliftHeaders: vi.fn(() => ({ 'X-ShapeUp-Facelift-Secret': 'test-secret' })),
  resolveFaceliftUpstreams: vi.fn().mockResolvedValue([
    { name: 'primary', url: 'https://worker.test' },
  ]),
}));

vi.mock('@/lib/s3', () => ({
  uploadToS3: uploadToS3Mock,
}));

import { runFaceliftCore } from './faceliftCore';

beforeEach(() => {
  uploadToS3Mock.mockClear();
  vi.unstubAllGlobals();
});

describe('runFaceliftCore durable video keys', () => {
  test('propagates a worker-owned durable turntable key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job_id: 'job-stored',
      splat_s3_key: 'facelifts/job-stored/output.splat',
      video_s3_key: 'facelifts/job-stored/turntable.mp4',
      elapsed_s: 12.5,
    }), { status: 200 })));

    await expect(runFaceliftCore({
      buffer: Buffer.from('image'),
      mimeType: 'image/jpeg',
    })).resolves.toEqual({
      jobId: 'job-stored',
      plyS3Key: null,
      splatS3Key: 'facelifts/job-stored/output.splat',
      videoS3Key: 'facelifts/job-stored/turntable.mp4',
      elapsedSeconds: 12.5,
    });
    expect(uploadToS3Mock).not.toHaveBeenCalled();
  });

  test('persists an inline turntable and returns its derived durable key', async () => {
    const video = Buffer.from('turntable');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job_id: 'job-inline-video',
      splat_s3_key: 'facelifts/job-inline-video/output.splat',
      video_b64: video.toString('base64'),
    }), { status: 200 })));

    const result = await runFaceliftCore({
      buffer: Buffer.from('image'),
      mimeType: 'image/jpeg',
    });
    expect(result.videoS3Key).toBe('facelifts/job-inline-video/turntable.mp4');
    expect(uploadToS3Mock).toHaveBeenCalledWith(
      'facelifts/job-inline-video/turntable.mp4',
      video,
      'video/mp4',
    );
  });
});
