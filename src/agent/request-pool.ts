interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class RequestPool {
  private maxConcurrent: number;
  private activeCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queue: QueuedRequest<any>[] = [];

  constructor(maxConcurrent = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  async enqueue<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ execute, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.activeCount++;
      item
        .execute()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.activeCount--;
          this.drain();
        });
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.activeCount;
  }
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number }).status;
      const isRetryable = status === 429 || (status !== undefined && status >= 500);
      if (!isRetryable || attempt === retries) throw lastError;

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * delay * 0.5;
      await new Promise((r) => setTimeout(r, delay + jitter));
    }
  }
  throw lastError;
}

export const requestPool = new RequestPool(
  Number(process.env.AGENT_MAX_CONCURRENT ?? 10),
);
