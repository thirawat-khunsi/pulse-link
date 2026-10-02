import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClickBuffer,
  type ClickEvent,
  type ClickRow,
  type ClickWriter,
} from '../../src/modules/clicks/buffer.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function event(linkId: number, extra: Partial<ClickEvent> = {}): ClickEvent {
  return {
    linkId,
    clickedAt: new Date('2026-10-02T00:00:00Z'),
    source: 'click',
    userAgent: IPHONE,
    referer: undefined,
    isBot: false,
    counted: false,
    ...extra,
  };
}

/** Records batches; each write can be made to fail or hang. */
function fakeWriter() {
  const batches: ClickRow[][] = [];
  let behaviour: 'ok' | 'fail' | 'hang' = 'ok';
  let release: () => void = () => undefined;
  const write = vi.fn((rows: ClickRow[]) => {
    if (behaviour === 'fail') return Promise.reject(new Error('db down'));
    if (behaviour === 'hang') {
      return new Promise<void>((resolve) => {
        release = () => {
          batches.push(rows);
          resolve();
        };
      });
    }
    batches.push(rows);
    return Promise.resolve();
  });
  const writer: ClickWriter = { write };
  return {
    writer,
    write,
    batches,
    set: (b: typeof behaviour) => (behaviour = b),
    release: () => {
      release();
    },
  };
}

const ids = (batches: ClickRow[][]) => batches.map((b) => b.map((r) => r.linkId));

let buffer: ClickBuffer | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await buffer?.close();
  buffer = undefined;
});

describe('ClickBuffer', () => {
  it('enqueue is synchronous and does not write until a flush', () => {
    const w = fakeWriter();
    buffer = new ClickBuffer({ writer: w.writer, flushIntervalMs: 60_000 });
    buffer.enqueue(event(1));
    expect(buffer.size).toBe(1);
    expect(w.write).not.toHaveBeenCalled();
  });

  it('flushes on the interval and parses user agent and referrer at flush time', async () => {
    vi.useFakeTimers();
    const w = fakeWriter();
    buffer = new ClickBuffer({ writer: w.writer, flushIntervalMs: 1000 });
    buffer.enqueue(event(1, { source: 'qr', referer: 'https://www.facebook.com/x?y=1' }));
    await vi.advanceTimersByTimeAsync(999);
    expect(w.batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.batches).toEqual([
      [
        {
          linkId: 1,
          clickedAt: new Date('2026-10-02T00:00:00Z'),
          source: 'qr',
          device: 'mobile',
          browser: 'Mobile Safari',
          os: 'iOS',
          referrerHost: 'www.facebook.com',
          isBot: false,
          counted: false,
        },
      ],
    ]);
    expect(buffer.size).toBe(0);
  });

  it('flushes early once 100 events are pending', async () => {
    const w = fakeWriter();
    buffer = new ClickBuffer({ writer: w.writer, flushIntervalMs: 60_000 });
    for (let i = 0; i < 99; i++) buffer.enqueue(event(1));
    await new Promise((r) => setImmediate(r));
    expect(w.batches).toHaveLength(0);
    buffer.enqueue(event(1));
    await new Promise((r) => setImmediate(r));
    await buffer.flush();
    expect(w.batches.map((b) => b.length)).toEqual([100]);
  });

  it('keeps accepting events while a write hangs, and runs one flush at a time', async () => {
    const w = fakeWriter();
    buffer = new ClickBuffer({ writer: w.writer, flushIntervalMs: 60_000 });
    w.set('hang');
    buffer.enqueue(event(1));
    const first = buffer.flush();
    buffer.enqueue(event(2));
    expect(buffer.flush()).toBe(first); // shares the in-flight flush
    expect(w.write).toHaveBeenCalledTimes(1);
    expect(buffer.size).toBe(1);

    w.set('ok');
    w.release();
    await first;
    await buffer.flush();
    expect(ids(w.batches)).toEqual([[1], [2]]);
  });

  it('re-queues a failed batch ahead of newer events and drops the oldest beyond the cap', async () => {
    const w = fakeWriter();
    const logger = { error: vi.fn(), warn: vi.fn() };
    buffer = new ClickBuffer({ writer: w.writer, flushIntervalMs: 60_000, maxPending: 3, logger });
    w.set('fail');
    buffer.enqueue(event(1));
    buffer.enqueue(event(2));
    await buffer.flush();
    expect(buffer.size).toBe(2);

    buffer.enqueue(event(3));
    buffer.enqueue(event(4));
    await buffer.flush();
    expect(logger.warn).toHaveBeenCalledWith({ dropped: 1 }, expect.any(String));

    w.set('ok');
    await buffer.flush();
    expect(ids(w.batches)).toEqual([[2, 3, 4]]);
  });

  it('close() waits for the in-flight write and flushes everything left', async () => {
    const w = fakeWriter();
    buffer = new ClickBuffer({ writer: w.writer, flushIntervalMs: 60_000 });
    w.set('hang');
    buffer.enqueue(event(1));
    void buffer.flush();
    buffer.enqueue(event(2));

    const closing = buffer.close();
    w.set('ok');
    w.release();
    await closing;
    expect(ids(w.batches)).toEqual([[1], [2]]);
    expect(buffer.size).toBe(0);
  });

  it('close() gives up and logs when the database stays down', async () => {
    const w = fakeWriter();
    const logger = { error: vi.fn(), warn: vi.fn() };
    buffer = new ClickBuffer({ writer: w.writer, flushIntervalMs: 60_000, logger });
    w.set('fail');
    buffer.enqueue(event(1));
    await buffer.close();
    expect(logger.error).toHaveBeenCalledWith({ lost: 1, outcome: 'failed' }, expect.any(String));
  });

  it('close() stops waiting for a hung database after closeTimeoutMs', async () => {
    const w = fakeWriter();
    const logger = { error: vi.fn(), warn: vi.fn() };
    buffer = new ClickBuffer({
      writer: w.writer,
      flushIntervalMs: 60_000,
      closeTimeoutMs: 50,
      logger,
    });
    w.set('hang');
    buffer.enqueue(event(1));
    buffer.enqueue(event(2));
    void buffer.flush();
    buffer.enqueue(event(3));

    const startedAt = performance.now();
    await buffer.close();
    expect(performance.now() - startedAt).toBeLessThan(1000);
    expect(logger.error).toHaveBeenCalledWith({ lost: 3, outcome: 'timeout' }, expect.any(String));
    buffer = undefined; // already closed; the hung write is abandoned
  });

  it('bounds oversized headers kept in memory', async () => {
    const w = fakeWriter();
    buffer = new ClickBuffer({ writer: w.writer, flushIntervalMs: 60_000 });
    buffer.enqueue(event(1, { userAgent: `x/${'1'.repeat(5000)}` }));
    await buffer.flush();
    expect(w.batches[0]?.[0]?.browser).toBe('x');
  });
});
