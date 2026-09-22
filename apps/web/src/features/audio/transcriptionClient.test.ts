import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranscriptionClient } from './transcriptionClient';

function workerEnvironment() {
  const worker = {
    postMessage: vi.fn(), terminate: vi.fn(),
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    onerror: undefined as (() => void) | undefined,
  };
  vi.stubGlobal('Worker', vi.fn(function () { return worker; }));
  return worker;
}

afterEach(() => vi.unstubAllGlobals());

describe('TranscriptionClient', () => {
  it('transfers the PCM buffer and resolves valid worker output', async () => {
    const worker = workerEnvironment();
    const client = new TranscriptionClient();
    const samples = new Float32Array([0, 0.5]);
    const pending = client.analyze(samples, 24000);
    expect(worker.postMessage).toHaveBeenCalledWith({ samples, sampleRate: 24000 }, [samples.buffer]);
    worker.onmessage?.({ data: { notes: [], elapsedMs: 12 } });
    await expect(pending).resolves.toEqual({ notes: [], elapsedMs: 12 });
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports analysis failures returned by the worker', async () => {
    const worker = workerEnvironment();
    const client = new TranscriptionClient();
    const pending = client.analyze(new Float32Array(1), 24000);
    worker.onmessage?.({ data: { error: '音频超过分析上限。' } });
    await expect(pending).rejects.toThrow('音频超过分析上限');
    client.dispose();
  });

  it('rejects an invalid worker result', async () => {
    const worker = workerEnvironment();
    const client = new TranscriptionClient();
    const pending = client.analyze(new Float32Array(1), 24000);
    worker.onmessage?.({ data: { notes: [], elapsedMs: Number.NaN } });
    await expect(pending).rejects.toThrow('无效结果');
    client.dispose();
  });

  it('rejects a worker crash instead of keeping the analysis pending', async () => {
    const worker = workerEnvironment();
    const client = new TranscriptionClient();
    const pending = client.analyze(new Float32Array(1), 24000);
    worker.onerror?.();
    await expect(pending).rejects.toThrow('线程失败');
    client.dispose();
  });

  it('cancels a pending job and ignores its late result', async () => {
    const worker = workerEnvironment();
    const client = new TranscriptionClient();
    const pending = client.analyze(new Float32Array(1), 24000);
    client.dispose();
    worker.onmessage?.({ data: { notes: [], elapsedMs: 1 } });
    await expect(pending).rejects.toThrow('已取消');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects a concurrent analysis without stealing the first job result', async () => {
    const worker = workerEnvironment();
    const client = new TranscriptionClient();
    const first = client.analyze(new Float32Array(1), 24000);
    await expect(client.analyze(new Float32Array(1), 24000)).rejects.toThrow('正在分析');
    expect(worker.postMessage).toHaveBeenCalledOnce();
    worker.onmessage?.({ data: { notes: [], elapsedMs: 5 } });
    await expect(first).resolves.toEqual({ notes: [], elapsedMs: 5 });
    client.dispose();
  });

  it('rejects analysis on a disposed client instead of waiting on a terminated worker', async () => {
    const worker = workerEnvironment();
    const client = new TranscriptionClient();
    client.dispose();
    await expect(client.analyze(new Float32Array(1), 24000)).rejects.toThrow('已关闭');
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it.each([null, undefined, { notes: [null], elapsedMs: 2 }, {
    notes: [{ startSeconds: 0, endSeconds: 1, midi: 20, velocity: 60, confidence: 0.9 }], elapsedMs: 2,
  }])('rejects a malformed worker message (%j)', async (data) => {
    const worker = workerEnvironment();
    const client = new TranscriptionClient();
    const pending = client.analyze(new Float32Array(1), 24000);
    expect(() => worker.onmessage?.({ data })).not.toThrow();
    await expect(pending).rejects.toThrow('无效结果');
    client.dispose();
  });
});
