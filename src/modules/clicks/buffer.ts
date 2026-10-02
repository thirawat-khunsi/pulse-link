import type { FastifyBaseLogger } from 'fastify';
import { parseUserAgent, referrerHost } from './useragent.js';

/** What the redirect knows at request time. Parsing is deferred to flush to keep the hot path cheap. */
export interface ClickEvent {
  linkId: number;
  clickedAt: Date;
  source: 'click' | 'qr';
  userAgent: string | undefined;
  referer: string | undefined;
  isBot: boolean;
  /** click_count was already incremented by the atomic max_clicks UPDATE. */
  counted: boolean;
}

/** The only thing the redirect module depends on. */
export interface ClickSink {
  enqueue(event: ClickEvent): void;
}

/** A row ready for the clicks table. */
export interface ClickRow {
  linkId: number;
  clickedAt: Date;
  source: 'click' | 'qr';
  device: string;
  browser: string | null;
  os: string | null;
  referrerHost: string | null;
  isBot: boolean;
  counted: boolean;
}

export interface ClickWriter {
  write(rows: ClickRow[]): Promise<void>;
}

export interface ClickBufferOptions {
  writer: ClickWriter;
  flushIntervalMs: number;
  /** Flush early once this many events are pending (SPEC §2). */
  batchSize?: number;
  /** Upper bound kept while the database is unreachable; oldest events are dropped beyond it (D-008). */
  maxPending?: number;
  /** How long close() may wait for the database before giving up (default 5000). */
  closeTimeoutMs?: number;
  logger?: Pick<FastifyBaseLogger, 'error' | 'warn'>;
}

// Bound memory per event: headers are attacker-controlled.
const MAX_HEADER_LENGTH = 1024;

/**
 * In-memory click buffer. `enqueue` is synchronous and never touches the database, so the
 * redirect is never delayed by click logging. Events are written in batches by `flush`.
 */
export class ClickBuffer implements ClickSink {
  private pending: ClickEvent[] = [];
  private inFlight: Promise<void> | null = null;
  private inFlightSize = 0;
  private earlyFlushScheduled = false;
  private readonly timer: NodeJS.Timeout;
  private readonly batchSize: number;
  private readonly maxPending: number;

  constructor(private readonly options: ClickBufferOptions) {
    this.batchSize = options.batchSize ?? 100;
    this.maxPending = options.maxPending ?? 10_000;
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs);
    // Never keep the process alive just for the timer; shutdown flushes explicitly.
    this.timer.unref();
  }

  get size(): number {
    return this.pending.length;
  }

  enqueue(event: ClickEvent): void {
    this.pending.push({
      ...event,
      userAgent: event.userAgent?.slice(0, MAX_HEADER_LENGTH),
      referer: event.referer?.slice(0, MAX_HEADER_LENGTH),
    });
    if (this.pending.length >= this.batchSize && !this.earlyFlushScheduled) {
      this.earlyFlushScheduled = true;
      setImmediate(() => {
        this.earlyFlushScheduled = false;
        void this.flush();
      });
    }
  }

  /** Write everything pending. Concurrent calls share the in-flight flush. Never rejects. */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.pending.length === 0) return Promise.resolve();
    this.inFlight = this.writeBatch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Stop the timer and flush until empty (graceful shutdown). Gives up, logging what is lost,
   * when a flush fails or the database does not answer within closeTimeoutMs, so a hung
   * database can never block process exit.
   */
  async close(): Promise<void> {
    clearInterval(this.timer);
    let timeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timeout = setTimeout(() => {
        resolve('timeout');
      }, this.options.closeTimeoutMs ?? 5000);
    });
    try {
      const outcome = await Promise.race([this.drain(), timedOut]);
      const lost = this.pending.length + (outcome === 'timeout' ? this.inFlightSize : 0);
      if (lost > 0)
        this.options.logger?.error({ lost, outcome }, 'click buffer not flushed on close');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async drain(): Promise<'drained' | 'failed'> {
    if (this.inFlight) await this.inFlight;
    while (this.pending.length > 0) {
      const before = this.pending.length;
      await this.flush();
      if (this.pending.length >= before) return 'failed';
    }
    return 'drained';
  }

  private async writeBatch(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    this.inFlightSize = batch.length;
    try {
      await this.options.writer.write(batch.map(toRow));
    } catch (err) {
      this.options.logger?.error(err, 'click flush failed; will retry');
      // Put the batch back in front of anything enqueued meanwhile, keeping the newest events.
      const merged = batch.concat(this.pending);
      const dropped = Math.max(merged.length - this.maxPending, 0);
      if (dropped > 0) {
        this.options.logger?.warn({ dropped }, 'click buffer full; dropping oldest events');
      }
      this.pending = merged.slice(dropped);
    } finally {
      this.inFlightSize = 0;
    }
  }
}

function toRow(event: ClickEvent): ClickRow {
  const client = parseUserAgent(event.userAgent, event.isBot);
  return {
    linkId: event.linkId,
    clickedAt: event.clickedAt,
    source: event.source,
    device: client.device,
    browser: client.browser,
    os: client.os,
    referrerHost: referrerHost(event.referer),
    isBot: event.isBot,
    counted: event.counted,
  };
}
