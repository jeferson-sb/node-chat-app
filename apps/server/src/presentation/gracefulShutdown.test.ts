import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGracefulShutdown } from './gracefulShutdown.ts';

type SignalHandler = () => void | Promise<void>;

const createMockProcess = (): {
  process: Pick<NodeJS.Process, 'on' | 'exit'>;
  emit: (signal: string) => Promise<void>;
  exit: ReturnType<typeof vi.fn>;
} => {
  const handlers = new Map<string, SignalHandler>();
  const exit = vi.fn<(code?: number) => never>();

  const process: Pick<NodeJS.Process, 'on' | 'exit'> = {
    on: vi.fn((signal: string, handler: SignalHandler) => {
      handlers.set(signal, handler);
      return process as unknown as NodeJS.Process;
    }),
    exit: exit as never,
  };

  const emit = async (signal: string): Promise<void> => {
    await handlers.get(signal)?.();
  };

  return { process, emit, exit };
};

describe('registerGracefulShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls close() and exits 0 on SIGTERM', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const { process, emit, exit } = createMockProcess();

    registerGracefulShutdown(close, { process });
    await emit('SIGTERM');

    expect(close).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('calls close() and exits 0 on SIGINT', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const { process, emit, exit } = createMockProcess();

    registerGracefulShutdown(close, { process });
    await emit('SIGINT');

    expect(close).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 if close() rejects', async () => {
    const close = vi.fn().mockRejectedValue(new Error('boom'));
    const { process, emit, exit } = createMockProcess();

    registerGracefulShutdown(close, { process });
    await emit('SIGTERM');

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit 1 if close() takes longer than forceExitAfterMs', async () => {
    let resolveClose: () => void = () => {};
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    const { process, emit, exit } = createMockProcess();

    registerGracefulShutdown(close, { process, forceExitAfterMs: 1000 });
    const shutdownPromise = emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);

    expect(exit).toHaveBeenCalledWith(1);

    resolveClose();
    await shutdownPromise;
  });

  it('ignores a second signal received while already shutting down', async () => {
    let resolveClose: () => void = () => {};
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    const { process, emit, exit } = createMockProcess();

    registerGracefulShutdown(close, { process });
    const first = emit('SIGTERM');
    await emit('SIGINT');

    expect(close).toHaveBeenCalledTimes(1);

    resolveClose();
    await first;
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
