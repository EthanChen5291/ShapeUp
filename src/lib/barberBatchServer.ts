import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import {
  type BarberBatchItemPatch,
  type BarberBatchPipelineDependencies,
} from '@/lib/barberBatchOrchestrator';
import { MAX_FACELIFT_IMAGE_BYTES, runFaceliftCore } from '@/lib/faceliftCore';
import { runHairEdit } from '@/lib/geminiHairEdit';
import { parseImageDataUrl } from '@/lib/imageDataUrl';

async function storeImageDataUrl(
  convex: ConvexHttpClient,
  imageDataUrl: string,
): Promise<Id<'_storage'>> {
  const parsed = parseImageDataUrl(imageDataUrl, { maxBytes: MAX_FACELIFT_IMAGE_BYTES });
  if (!parsed.ok) throw new Error(parsed.error);

  const uploadUrl = await convex.mutation(api.barberTryOn.generateUploadUrl, {});
  const bytes = new Uint8Array(parsed.buffer.length);
  bytes.set(parsed.buffer);
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': parsed.mimeType },
    body: new Blob([bytes], { type: parsed.mimeType }),
  });
  if (!response.ok) throw new Error(`Image storage returned HTTP ${response.status}`);
  const body = await response.json() as { storageId?: unknown };
  if (typeof body.storageId !== 'string' || !body.storageId) {
    throw new Error('Image storage did not return an id');
  }
  return body.storageId as Id<'_storage'>;
}

async function indexRenderResult(
  convex: ConvexHttpClient,
  result: Awaited<ReturnType<typeof runFaceliftCore>>,
): Promise<void> {
  try {
    await convex.mutation(api.facelifts.recordResult, {
      jobId: result.jobId,
      splatS3Key: result.splatS3Key,
      ...(result.plyS3Key ? { plyS3Key: result.plyS3Key } : {}),
    });
  } catch (error) {
    console.error('[barber-batch] durable render index update failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createBarberBatchPipelineDependencies(options: {
  convex: ConvexHttpClient;
  selfieUrl: string;
  requestUrl: string;
  requestHeaders: Headers;
}): BarberBatchPipelineDependencies {
  const { convex } = options;
  return {
    patchItem: async (itemId: string, patch: BarberBatchItemPatch) => {
      await convex.mutation(api.barberBatch.patchItem, {
        itemId: itemId as Id<'barberBatchItems'>,
        status: patch.status,
        ...(patch.imageStorageId
          ? { imageStorageId: patch.imageStorageId as Id<'_storage'> }
          : {}),
        ...(patch.splatS3Key ? { splatS3Key: patch.splatS3Key } : {}),
        ...(patch.videoS3Key ? { videoS3Key: patch.videoS3Key } : {}),
        ...(patch.error ? { error: patch.error } : {}),
        ...(patch.prompt ? { prompt: patch.prompt } : {}),
      });
    },
    edit: async (job) => {
      const result = await runHairEdit({
        imageUrl: options.selfieUrl,
        prompt: job.prompt,
        requestUrl: options.requestUrl,
        requestHeaders: options.requestHeaders,
        onEditComplete: async () => {
          await convex.mutation(api.imageEditUsage.record, {});
        },
      });
      return { imageDataUrl: result.newImageUrl };
    },
    storeImage: async (imageDataUrl) => String(await storeImageDataUrl(convex, imageDataUrl)),
    isOverBudget: async () => await convex.query(api.gpuUsage.isOverBudget, {}),
    render: async (imageDataUrl, job) => {
      const parsed = parseImageDataUrl(imageDataUrl, { maxBytes: MAX_FACELIFT_IMAGE_BYTES });
      if (!parsed.ok) throw new Error(parsed.error);
      const result = await runFaceliftCore({
        buffer: parsed.buffer,
        mimeType: parsed.mimeType,
        outputName: `barber-batch-${job.idx}`,
        needPly: false,
      });
      await indexRenderResult(convex, result);
      return {
        splatS3Key: result.splatS3Key,
        videoS3Key: result.videoS3Key,
        elapsedSeconds: result.elapsedSeconds,
      };
    },
    recordGpuSeconds: async (seconds) => {
      await convex.mutation(api.gpuUsage.record, { seconds });
    },
  };
}

/** Claim one queue row for the full batch and keep it live until release. */
export async function claimBarberBatchStation(
  convex: ConvexHttpClient,
  sessionId: string,
): Promise<() => Promise<void>> {
  const claim = await convex.mutation(api.renderStations.claim, { sessionId });
  const heartbeat = setInterval(() => {
    void convex.mutation(api.renderStations.heartbeat, { jobId: claim.jobId }).catch(() => {});
  }, 3000);
  return async () => {
    clearInterval(heartbeat);
    await convex.mutation(api.renderStations.release, { jobId: claim.jobId });
  };
}
