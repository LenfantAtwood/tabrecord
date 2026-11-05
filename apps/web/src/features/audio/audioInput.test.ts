import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeAudioFile,
  getAudioFileError,
  MAX_AUDIO_FILE_BYTES,
  startMicrophone,
} from './audioInput';
import captureSource from './capture.worklet.js?raw';
import { MAX_AUDIO_DURATION_SECONDS } from './transcription';

function browserAudio() {
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const worklet = {
    port: { postMessage: vi.fn(), close: vi.fn(), onmessage: undefined as ((event: { data: unknown }) => void) | undefined },
    connect: vi.fn(), disconnect: vi.fn(), onprocessorerror: undefined as (() => void) | undefined,
  };
  const context = {
    state: 'running', sampleRate: 48000, destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn().mockReturnValue(source),
    decodeAudioData: vi.fn(),
    onstatechange: undefined as (() => void) | undefined,
  };
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
  vi.stubGlobal('AudioWorkletNode', vi.fn(function () { return worklet; }));
  return { context, worklet, stream, track, source, getUserMedia };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('audio file input', () => {
  it('accepts supported extensions and rejects empty, oversized and non-audio files', () => {
    expect(getAudioFileError({ name: 'riff.WAV', size: MAX_AUDIO_FILE_BYTES })).toBeNull();
    expect(getAudioFileError({ name: 'riff.mp3', size: 0 })).toContain('空');
    expect(getAudioFileError({ name: 'riff.wav', size: MAX_AUDIO_FILE_BYTES + 1 })).toContain('25 MB');
    expect(getAudioFileError({ name: 'score.gp', size: 10 })).toContain('音频');
  });

  it('averages stereo channels and preserves the actual decoder sample rate', async () => {
    const { context } = browserAudio();
    context.decodeAudioData.mockResolvedValue({
      duration: 1, length: 3, numberOfChannels: 2, sampleRate: 32000,
      getChannelData: (channel: number) => channel ? new Float32Array([0, -1, 1]) : new Float32Array([1, 1, 0]),
    });
    const decoded = await decodeAudioFile(new File(['audio'], 'riff.wav'));
    expect(Array.from(decoded.samples)).toEqual([0.5, 0, 0.5]);
    expect(decoded.sampleRate).toBe(32000);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('rejects clips over the duration limit and closes the decoder', async () => {
    const { context } = browserAudio();
    context.decodeAudioData.mockResolvedValue({ duration: MAX_AUDIO_DURATION_SECONDS + 0.01 });
    await expect(decodeAudioFile(new File(['audio'], 'riff.wav'))).rejects.toThrow(`${MAX_AUDIO_DURATION_SECONDS} 秒`);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('returns a recoverable decode error and releases its context', async () => {
    const { context } = browserAudio();
    context.decodeAudioData.mockRejectedValue(new DOMException('Invalid encoding', 'EncodingError'));
    await expect(decodeAudioFile(new File(['bad audio'], 'riff.wav'))).rejects.toThrow('无法解码');
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('explains unavailable Web Audio instead of throwing a reference error', async () => {
    browserAudio();
    vi.stubGlobal('AudioContext', undefined);
    await expect(decodeAudioFile(new File(['audio'], 'riff.wav'))).rejects.toThrow('Web Audio');
    await expect(startMicrophone(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow('Web Audio');
  });
});

describe('microphone lifecycle', () => {
  it('explains denied permission and closes the audio context', async () => {
    const { context, getUserMedia } = browserAudio();
    getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    await expect(startMicrophone(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow('麦克风权限');
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('rejects insecure or missing microphone APIs before requesting permission', async () => {
    const { getUserMedia } = browserAudio();
    vi.stubGlobal('window', { isSecureContext: false });
    await expect(startMicrophone(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow('HTTPS');
    expect(getUserMedia).not.toHaveBeenCalled();
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {});
    await expect(startMicrophone(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow('HTTPS');
  });

  it('reports missing AudioWorklet support before opening the microphone', async () => {
    const { context, getUserMedia } = browserAudio();
    Object.assign(context, { audioWorklet: undefined });
    await expect(startMicrophone(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow('AudioWorklet');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('releases an acquired microphone when worklet loading fails', async () => {
    const { context, track } = browserAudio();
    context.audioWorklet.addModule.mockRejectedValue(new Error('Worklet could not load'));
    await expect(startMicrophone(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow('Worklet could not load');
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('waits for the final chunk before completing stop, then releases all resources', async () => {
    const { worklet, track, source, context } = browserAudio();
    const onChunk = vi.fn();
    const onLimit = vi.fn();
    const capture = await startMicrophone(onChunk, onLimit, vi.fn());
    const completed = vi.fn();
    const pending = capture.stop();
    expect(capture.stop()).toBe(pending);
    void pending.then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(worklet.port.postMessage).toHaveBeenCalledWith('stop');
    const tail = new Float32Array([0.2, 0.3]);
    worklet.port.onmessage?.({ data: { type: 'chunk', samples: tail } });
    worklet.port.onmessage?.({ data: { type: 'stopped' } });
    await pending;
    expect(onChunk).toHaveBeenCalledWith(tail, 48000);
    expect(onLimit).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(worklet.disconnect).toHaveBeenCalledOnce();
    expect(worklet.port.close).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    worklet.port.onmessage?.({ data: { type: 'chunk', samples: tail } });
    expect(onChunk).toHaveBeenCalledOnce();
  });

  it('notifies the UI and releases the microphone when the worklet reaches its limit', async () => {
    const { worklet, track } = browserAudio();
    const onLimit = vi.fn();
    await startMicrophone(vi.fn(), onLimit, vi.fn());
    worklet.port.onmessage?.({ data: { type: 'stopped' } });
    expect(onLimit).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('rejects stop rather than silently losing its tail when the worklet does not respond', async () => {
    vi.useFakeTimers();
    const { track } = browserAudio();
    const capture = await startMicrophone(vi.fn(), vi.fn(), vi.fn());
    const pending = expect(capture.stop()).rejects.toThrow('尾部');
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('surfaces a disconnected device and prevents subsequent chunks', async () => {
    const { worklet, track } = browserAudio();
    const onError = vi.fn();
    const onChunk = vi.fn();
    await startMicrophone(onChunk, vi.fn(), onError);
    const ended = track.addEventListener.mock.calls.find(([event]) => event === 'ended')?.[1] as (() => void);
    ended();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('断开'));
    worklet.port.onmessage?.({ data: { type: 'chunk', samples: new Float32Array(1) } });
    expect(onChunk).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('rejects a manual stop when its processor crashes before the tail is acknowledged', async () => {
    const { worklet, track } = browserAudio();
    const onError = vi.fn();
    const capture = await startMicrophone(vi.fn(), vi.fn(), onError);
    const pending = capture.stop();
    worklet.onprocessorerror?.();
    await expect(pending).rejects.toThrow('尾部');
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('采集发生错误'));
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('stops a stream granted after the user has already cancelled permission', async () => {
    const { getUserMedia, stream, track, context } = browserAudio();
    let grant: ((value: unknown) => void) | undefined;
    getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    const controller = new AbortController();
    const pending = startMicrophone(vi.fn(), vi.fn(), vi.fn(), controller.signal);
    const rejected = expect(pending).rejects.toThrow('取消');
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    controller.abort();
    grant?.(stream);
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.audioWorklet.addModule).not.toHaveBeenCalled();
  });

  it('releases a running microphone when its owning view aborts', async () => {
    const { worklet, track } = browserAudio();
    const onChunk = vi.fn();
    const controller = new AbortController();
    await startMicrophone(onChunk, vi.fn(), vi.fn(), controller.signal);
    controller.abort();
    worklet.port.onmessage?.({ data: { type: 'chunk', samples: new Float32Array(1) } });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('does not request microphone access when the signal was already aborted', async () => {
    const { getUserMedia, context } = browserAudio();
    await expect(startMicrophone(vi.fn(), vi.fn(), vi.fn(), AbortSignal.abort())).rejects.toThrow('取消');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('does not open a late permission prompt after cancellation during audio context startup', async () => {
    const { getUserMedia, context } = browserAudio();
    let resumed: (() => void) | undefined;
    context.resume.mockImplementation(() => new Promise<void>((resolve) => { resumed = resolve; }));
    const controller = new AbortController();
    const pending = startMicrophone(vi.fn(), vi.fn(), vi.fn(), controller.signal);
    const rejected = expect(pending).rejects.toThrow('取消');
    controller.abort();
    resumed?.();
    await rejected;
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

interface WorkletProcessor {
  port: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage?: (message: { data: string }) => void;
  };
  process: (inputs: Float32Array[][]) => boolean;
}

function captureProcessor(maxSeconds: number): WorkletProcessor {
  let Processor: new (options: { processorOptions: { maxSeconds: number } }) => WorkletProcessor;
  // Execute the actual worklet source with its three browser-provided globals.
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', captureSource)(
    class { port = { postMessage: vi.fn(), onmessage: undefined }; },
    8000,
    (_name: string, constructor: typeof Processor) => { Processor = constructor; },
  );
  return new Processor!({ processorOptions: { maxSeconds } });
}

describe('capture worklet', () => {
  it('flushes a short recording exactly once before the stopped acknowledgement', () => {
    const processor = captureProcessor(120);
    processor.process([[new Float32Array([0, 0.5, 1]), new Float32Array([1, 0.5, 0])]]);
    processor.port.onmessage?.({ data: 'stop' });
    processor.port.onmessage?.({ data: 'stop' });
    const messages = processor.port.postMessage.mock.calls.map(([message]) => message);
    expect(messages).toEqual([
      { type: 'chunk', samples: new Float32Array([0.5, 0.5, 0.5]) },
      { type: 'stopped' },
    ]);
    expect(processor.process([[new Float32Array(128)]])).toBe(false);
  });

  it('stops at the exact sample limit without keeping the remainder of an input block', () => {
    const processor = captureProcessor(0.001);
    expect(processor.process([[new Float32Array(128).fill(0.25)]])).toBe(false);
    const messages = processor.port.postMessage.mock.calls.map(([message]) => message);
    expect(messages).toEqual([
      { type: 'chunk', samples: new Float32Array(8).fill(0.25) },
      { type: 'stopped' },
    ]);
  });
});
