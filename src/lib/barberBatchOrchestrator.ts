import type { BarberBatchAnalysis, BarberBatchStyle } from '@/lib/barberBatchAnalysis';

export const BARBER_BATCH_EDIT_CONCURRENCY = 4;
export const BARBER_BATCH_RENDER_CONCURRENCY = 4;
export const BARBER_BATCH_BUDGET_ERROR =
  'The monthly 3D rendering limit has been reached. Please try again next month.';
const MAX_COMBINED_PROMPT_CHARS = 500;

const EDIT_ERROR = "This style couldn't be edited. Try it again.";
const RENDER_ERROR = "The 3D render didn't finish. Try this style again.";

export function combineBarberBatchPrompt(basePrompt: string, extraPrompt?: string): string {
  const base = basePrompt
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const extra = extraPrompt
    ?.replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!extra) return base.slice(0, MAX_COMBINED_PROMPT_CHARS);
  const suffix = ` Final touches: ${extra}`;
  return `${base.slice(0, Math.max(0, MAX_COMBINED_PROMPT_CHARS - suffix.length)).trim()}${suffix}`;
}

export type BarberBatchJob = BarberBatchStyle & {
  itemId: string;
  persistPrompt?: boolean;
};

export type BarberBatchItemPatch = {
  status: 'editing' | 'rendering' | 'done' | 'failed';
  imageStorageId?: string;
  splatS3Key?: string;
  videoS3Key?: string;
  error?: string;
  prompt?: string;
};

export type BarberBatchEditResult = {
  imageDataUrl: string;
};

export type BarberBatchRenderResult = {
  splatS3Key: string;
  videoS3Key: string | null;
  elapsedSeconds: number | null;
};

export type BarberBatchPipelineDependencies = {
  patchItem: (itemId: string, patch: BarberBatchItemPatch) => Promise<void>;
  edit: (job: BarberBatchJob) => Promise<BarberBatchEditResult>;
  storeImage: (imageDataUrl: string, job: BarberBatchJob) => Promise<string>;
  isOverBudget: () => Promise<boolean>;
  render: (imageDataUrl: string, job: BarberBatchJob) => Promise<BarberBatchRenderResult>;
  recordGpuSeconds: (seconds: number) => Promise<void>;
};

export type BarberBatchOrchestratorDependencies = BarberBatchPipelineDependencies & {
  analyze: () => Promise<BarberBatchAnalysis>;
  consumeEntitlement: () => Promise<void>;
  createBatch: () => Promise<string>;
  setAnalysis: (
    batchId: string,
    analysis: Extract<BarberBatchAnalysis, { ok: true }>,
  ) => Promise<Array<{ idx: number; itemId: string }>>;
  claimStation: (batchId: string) => Promise<() => Promise<void>>;
  finishBatch: (batchId: string) => Promise<'ready' | 'failed'>;
};

type ItemOutcome = { itemId: string; status: 'done' | 'failed'; error?: string };

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const advance = () => {
    while (active < concurrency && queue.length > 0) {
      active += 1;
      queue.shift()?.();
    }
  };

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void task().then(resolve, reject).finally(() => {
          active -= 1;
          advance();
        });
      });
      advance();
    });
  };
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  visit: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        await visit(values[index]);
      }
    },
  );
  await Promise.all(workers);
}

async function markFailed(
  dependencies: BarberBatchPipelineDependencies,
  job: BarberBatchJob,
  error: string,
): Promise<ItemOutcome> {
  await dependencies.patchItem(job.itemId, { status: 'failed', error });
  return { itemId: job.itemId, status: 'failed', error };
}

/** Run independent edit and render queues so each completed edit renders immediately. */
export async function runBarberBatchPipeline(
  jobs: BarberBatchJob[],
  dependencies: BarberBatchPipelineDependencies,
  options: { editConcurrency?: number; renderConcurrency?: number } = {},
): Promise<ItemOutcome[]> {
  const editConcurrency = options.editConcurrency ?? BARBER_BATCH_EDIT_CONCURRENCY;
  const renderConcurrency = options.renderConcurrency ?? BARBER_BATCH_RENDER_CONCURRENCY;
  const limitRender = createLimiter(renderConcurrency);
  const renderTasks: Array<Promise<void>> = [];
  const outcomes = new Map<string, ItemOutcome>();
  let budgetExhausted = false;

  await mapWithConcurrency(jobs, editConcurrency, async (job) => {
    try {
      await dependencies.patchItem(job.itemId, {
        status: 'editing',
        ...(job.persistPrompt ? { prompt: job.prompt } : {}),
      });
      const edit = await dependencies.edit(job);
      const imageStorageId = await dependencies.storeImage(edit.imageDataUrl, job);
      await dependencies.patchItem(job.itemId, {
        status: 'rendering',
        imageStorageId,
      });

      const renderTask = limitRender(async () => {
        try {
          let overBudget = budgetExhausted;
          if (!overBudget) {
            try {
              overBudget = await dependencies.isOverBudget();
            } catch {
              overBudget = false;
            }
          }
          if (overBudget) {
            budgetExhausted = true;
            outcomes.set(job.itemId, await markFailed(dependencies, job, BARBER_BATCH_BUDGET_ERROR));
            return;
          }

          const render = await dependencies.render(edit.imageDataUrl, job);
          // The splat is the durable product; the turntable video is an
          // enhancement the render upstream may not produce. Tiles fall back
          // to the stored 2D edit when videoS3Key is absent.
          if (!render.splatS3Key) {
            outcomes.set(job.itemId, await markFailed(dependencies, job, RENDER_ERROR));
            return;
          }
          if (render.elapsedSeconds !== null && render.elapsedSeconds > 0) {
            try {
              await dependencies.recordGpuSeconds(render.elapsedSeconds);
            } catch {
              // Accounting is visibility/guardrail data; the durable render remains valid.
            }
          }
          await dependencies.patchItem(job.itemId, {
            status: 'done',
            splatS3Key: render.splatS3Key,
            ...(render.videoS3Key ? { videoS3Key: render.videoS3Key } : {}),
          });
          outcomes.set(job.itemId, { itemId: job.itemId, status: 'done' });
        } catch {
          outcomes.set(job.itemId, await markFailed(dependencies, job, RENDER_ERROR));
        }
      });
      renderTasks.push(renderTask);
    } catch {
      outcomes.set(job.itemId, await markFailed(dependencies, job, EDIT_ERROR));
    }
  });

  await Promise.all(renderTasks);
  return jobs.map((job) => outcomes.get(job.itemId) ?? {
    itemId: job.itemId,
    status: 'failed' as const,
    error: EDIT_ERROR,
  });
}

export type BarberBatchOrchestratorResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      batchId: string;
      status: 'ready' | 'failed';
      items: ItemOutcome[];
    };

/** Gate, consume once, create, then run the durable eight-item pipeline. */
export async function orchestrateBarberBatch(
  dependencies: BarberBatchOrchestratorDependencies,
): Promise<BarberBatchOrchestratorResult> {
  const analysis = await dependencies.analyze();
  if (!analysis.ok) return { ok: false, reason: analysis.reason };

  await dependencies.consumeEntitlement();
  const batchId = await dependencies.createBatch();
  const itemRefs = await dependencies.setAnalysis(batchId, analysis);
  const jobs = itemRefs
    .sort((left, right) => left.idx - right.idx)
    .map(({ idx, itemId }) => {
      const style = analysis.items.find((candidate) => candidate.idx === idx);
      if (!style) throw new Error(`Missing analyzed style ${idx}`);
      return { ...style, itemId };
    });

  let releaseStation = async () => {};
  try {
    releaseStation = await dependencies.claimStation(batchId);
  } catch {
    // Queue visibility is best-effort and must not strand an accepted entitlement.
  }

  let items: ItemOutcome[];
  try {
    items = await runBarberBatchPipeline(jobs, dependencies);
  } finally {
    await releaseStation().catch(() => {});
  }
  const status = await dependencies.finishBatch(batchId);
  return { ok: true, batchId, status, items };
}
