// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { assertAlive, getConfig, type EdContext, type QueuedMutation } from './context';
import { randomUUID } from './env';
import { EdApiError, EdAuthError } from './errors';
import type { FetchOptions } from './fetch';

const MAX_FLUSH_ATTEMPTS = 5;
const MAX_ENTRY_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function runOp<T>(ctx: EdContext, op: () => Promise<T> | T): Promise<T> {
  const next = ctx.queueOpChain.then(op);
  ctx.queueOpChain = next.catch(() => {});
  return next;
}

async function ensureQueueLoaded(ctx: EdContext): Promise<void> {
  if (ctx.queueLoaded) return;
  ctx.queueLoaded = true;
  const storage = getConfig(ctx).storage;
  if (!storage) return;
  try {
    const saved = await storage.get('ed_offline_queue');
    if (saved) {
      const loaded = JSON.parse(saved);
      ctx.queue = [...loaded, ...ctx.queue];
    }
  } catch {}
}

function enqueueWrite(ctx: EdContext, data: string): Promise<void> {
  const storage = getConfig(ctx).storage;
  const next = ctx.queueWriteChain.then(async () => {
    try {
      await storage?.set('ed_offline_queue', data);
    } catch {}
  });
  ctx.queueWriteChain = next;
  return next;
}

export async function pushToQueue(
  ctx: EdContext,
  endpoint: string,
  options: Record<string, unknown>,
): Promise<void> {
  assertAlive(ctx);
  const storage = getConfig(ctx).storage;

  const mutation: QueuedMutation = {
    id: randomUUID(),
    endpoint,
    options,
    timestamp: Date.now(),
    attempts: 0,
  };
  ctx.queue.push(mutation);

  if (storage) {
    await runOp(ctx, async () => {
      await ensureQueueLoaded(ctx);
      const snapshot = JSON.stringify(ctx.queue);
      await enqueueWrite(ctx, snapshot);
    });
  }
}

export async function flushQueue(ctx: EdContext): Promise<void> {
  assertAlive(ctx);
  if (ctx.queueFlushPromise) {
    return ctx.queueFlushPromise;
  }

  ctx.queueFlushPromise = (async () => {
    try {
      const storage = getConfig(ctx).storage;
      if (storage) {
        await ensureQueueLoaded(ctx);
      }

      if (ctx.queue.length === 0) return;

      const { edFetch } = await import('./fetch');
      const remainingQueue: QueuedMutation[] = [];
      const now = Date.now();

      for (const mutation of ctx.queue) {
        if (now - (mutation.timestamp ?? now) > MAX_ENTRY_AGE_MS) continue;
        try {
          await edFetch(ctx, mutation.endpoint, {
            ...mutation.options,
            skipQueue: true,
          } as unknown as FetchOptions);
        } catch (error) {
          if (error instanceof EdApiError && !(error instanceof EdAuthError)) continue;
          mutation.attempts = (mutation.attempts ?? 0) + 1;
          if (mutation.attempts >= MAX_FLUSH_ATTEMPTS) continue;
          remainingQueue.push(mutation);
        }
      }

      ctx.queue = remainingQueue;
      if (storage) {
        const snapshot = JSON.stringify(ctx.queue);
        await enqueueWrite(ctx, snapshot);
      }
    } finally {
      ctx.queueFlushPromise = null;
    }
  })();

  return ctx.queueFlushPromise;
}

/** Register the `online` listener that flushes the queue. No-op where unsupported. */
export function ensureOnlineFlushListener(ctx: EdContext): void {
  if (ctx.onlineHandler) return;
  try {
    const add = (globalThis as any)?.addEventListener;
    if (typeof add !== 'function') return;
    const handler = () => {
      try {
        if (!ctx.destroyed && getConfig(ctx).offlineQueue) void flushQueue(ctx).catch(() => {});
      } catch {}
    };
    ctx.onlineHandler = handler;
    add.call(globalThis, 'online', handler);
  } catch {}
}

export function removeOnlineFlushListener(ctx: EdContext): void {
  if (!ctx.onlineHandler) return;
  try {
    const remove = (globalThis as any)?.removeEventListener;
    if (typeof remove === 'function') remove.call(globalThis, 'online', ctx.onlineHandler);
  } catch {}
  ctx.onlineHandler = null;
}
