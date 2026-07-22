import { describe, expect, test, vi } from 'vitest';
import type { BarberBatchAnalysis } from './barberBatchAnalysis';
import {
  BARBER_BATCH_BUDGET_ERROR,
  orchestrateBarberBatch,
  runBarberBatchPipeline,
  type BarberBatchJob,
  type BarberBatchItemPatch,
  type BarberBatchOrchestratorDependencies,
  type BarberBatchPipelineDependencies,
} from './barberBatchOrchestrator';

const analysis: Extract<BarberBatchAnalysis, { ok: true }> = {
  ok: true,
  hairProfile: {
    curlClass: '2B',
    lengthInches: { top: 4, sides: 2, back: 2 },
    density: 'med',
    hairline: { state: 'intact' },
    growthPatterns: ['crown whorl'],
    faceShape: 'oval',
  },
  items: Array.from({ length: 8 }, (_, idx) => ({
    idx,
    title: `Style ${idx}`,
    prompt: `Create style ${idx}`,
    why: `Works for ${idx}`,
  })),
};

const jobs: BarberBatchJob[] = analysis.items.map((item) => ({
  ...item,
  itemId: `item-${item.idx}`,
}));

function pipelineDependencies(
  overrides: Partial<BarberBatchPipelineDependencies> = {},
): BarberBatchPipelineDependencies {
  return {
    patchItem: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn(async (job: BarberBatchJob) => ({ imageDataUrl: `data:image/png;base64,${job.idx}` })),
    storeImage: vi.fn(async (_image, job) => `storage-${job.idx}`),
    isOverBudget: vi.fn().mockResolvedValue(false),
    render: vi.fn(async (_image, job) => ({
      splatS3Key: `facelifts/job-${job.idx}/output.splat`,
      videoS3Key: `facelifts/job-${job.idx}/turntable.mp4`,
      elapsedSeconds: 12,
    })),
    recordGpuSeconds: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function orchestratorDependencies(
  overrides: Partial<BarberBatchOrchestratorDependencies> = {},
): BarberBatchOrchestratorDependencies {
  return {
    ...pipelineDependencies(),
    analyze: vi.fn().mockResolvedValue(analysis),
    consumeEntitlement: vi.fn().mockResolvedValue(undefined),
    createBatch: vi.fn().mockResolvedValue('batch-1'),
    setAnalysis: vi.fn().mockResolvedValue(
      analysis.items.map((item) => ({ idx: item.idx, itemId: `item-${item.idx}` })),
    ),
    claimStation: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
    finishBatch: vi.fn().mockResolvedValue('ready'),
    ...overrides,
  };
}

describe('barber batch orchestration', () => {
  test('pipelines render N before edit N+4 finishes', async () => {
    const events: string[] = [];
    const dependencies = pipelineDependencies({
      edit: vi.fn(async (job) => {
        events.push(`edit:${job.idx}:start`);
        if (job.idx >= 4) await new Promise((resolve) => setTimeout(resolve, 15));
        events.push(`edit:${job.idx}:end`);
        return { imageDataUrl: `data:image/png;base64,${job.idx}` };
      }),
      render: vi.fn(async (_image, job) => {
        events.push(`render:${job.idx}:start`);
        return {
          splatS3Key: `facelifts/job-${job.idx}/output.splat`,
          videoS3Key: `facelifts/job-${job.idx}/turntable.mp4`,
          elapsedSeconds: 10,
        };
      }),
    });

    await runBarberBatchPipeline(jobs, dependencies);
    expect(events.indexOf('render:0:start')).toBeGreaterThan(-1);
    expect(events.indexOf('render:0:start')).toBeLessThan(events.indexOf('edit:4:end'));
  });

  test('settles partial failures without stopping successful items', async () => {
    const patches: Array<{ itemId: string; patch: BarberBatchItemPatch }> = [];
    const dependencies = orchestratorDependencies({
      patchItem: vi.fn(async (itemId, patch) => {
        patches.push({ itemId, patch });
      }),
      edit: vi.fn(async (job) => {
        if (job.idx === 1) throw new Error('edit failed');
        return { imageDataUrl: `data:image/png;base64,${job.idx}` };
      }),
      render: vi.fn(async (_image, job) => {
        if (job.idx === 2) throw new Error('render failed');
        return {
          splatS3Key: `facelifts/job-${job.idx}/output.splat`,
          videoS3Key: `facelifts/job-${job.idx}/turntable.mp4`,
          elapsedSeconds: 10,
        };
      }),
    });

    const result = await orchestrateBarberBatch(dependencies);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected completed batch');
    expect(result.items.filter((item) => item.status === 'done')).toHaveLength(6);
    expect(result.items.filter((item) => item.status === 'failed')).toHaveLength(2);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'item-0', patch: expect.objectContaining({ status: 'done' }) }),
      expect.objectContaining({ itemId: 'item-1', patch: expect.objectContaining({ status: 'failed' }) }),
      expect.objectContaining({ itemId: 'item-2', patch: expect.objectContaining({ status: 'failed' }) }),
    ]));
    expect(dependencies.finishBatch).toHaveBeenCalledOnce();
  });

  test('a render with a splat but no turntable video still completes the item', async () => {
    const patches: Array<{ itemId: string; patch: BarberBatchItemPatch }> = [];
    const dependencies = pipelineDependencies({
      patchItem: vi.fn(async (itemId, patch) => {
        patches.push({ itemId, patch });
      }),
      render: vi.fn(async (_image, job) => ({
        splatS3Key: `facelifts/job-${job.idx}/output.splat`,
        videoS3Key: null,
        elapsedSeconds: 10,
      })),
    });

    const outcomes = await runBarberBatchPipeline(jobs, dependencies);
    expect(outcomes.every((outcome) => outcome.status === 'done')).toBe(true);
    const donePatches = patches.filter(({ patch }) => patch.status === 'done');
    expect(donePatches).toHaveLength(jobs.length);
    for (const { patch } of donePatches) {
      expect(patch.splatS3Key).toMatch(/^facelifts\//);
      expect(patch).not.toHaveProperty('videoS3Key');
    }
  });

  test('consumes the entitlement exactly once and only after a passing gate', async () => {
    const accepted = orchestratorDependencies();
    await orchestrateBarberBatch(accepted);
    expect(accepted.consumeEntitlement).toHaveBeenCalledOnce();
    expect(accepted.analyze).toHaveBeenCalledOnce();
    expect(accepted.createBatch).toHaveBeenCalledOnce();

    const rejected = orchestratorDependencies({
      analyze: vi.fn().mockResolvedValue({ ok: false, reason: 'Show both temples.' }),
    });
    await expect(orchestrateBarberBatch(rejected)).resolves.toEqual({
      ok: false,
      reason: 'Show both temples.',
    });
    expect(rejected.consumeEntitlement).not.toHaveBeenCalled();
    expect(rejected.createBatch).not.toHaveBeenCalled();
  });

  test('fails every remaining item with a friendly message when the budget is exhausted', async () => {
    const patches: Array<{ itemId: string; patch: BarberBatchItemPatch }> = [];
    const render = vi.fn();
    const dependencies = pipelineDependencies({
      isOverBudget: vi.fn().mockResolvedValue(true),
      render,
      patchItem: vi.fn(async (itemId, patch) => {
        patches.push({ itemId, patch });
      }),
    });

    const result = await runBarberBatchPipeline(jobs, dependencies);
    expect(result).toHaveLength(8);
    expect(result.every((item) => item.status === 'failed' && item.error === BARBER_BATCH_BUDGET_ERROR)).toBe(true);
    expect(render).not.toHaveBeenCalled();
    expect(patches.filter(({ patch }) => patch.status === 'failed')).toHaveLength(8);
  });
});
