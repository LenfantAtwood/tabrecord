import workletUrl from './capture.worklet.js?url&no-inline';
import { MAX_AUDIO_DURATION_SECONDS } from './transcription';

export const MAX_AUDIO_FILE_BYTES = 25 * 1024 * 1024;

export function getAudioFileError(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i.test(file.name)) {
    return '请选择 WAV、MP3、M4A、AAC、OGG、FLAC 或 WebM 音频。';
  }
  if (!file.size) return '这个音频文件是空的。';
  if (file.size > MAX_AUDIO_FILE_BYTES) return '音频文件不能超过 25 MB。';
  return null;
}

export async function decodeAudioFile(file: File) {
  const error = getAudioFileError(file);
  if (error) throw new Error(error);
  if (typeof AudioContext === 'undefined') throw new Error('浏览器不支持 Web Audio，请使用最新版浏览器。');
  const context = new AudioContext({ sampleRate: 24000 });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > MAX_AUDIO_DURATION_SECONDS) {
      throw new Error(`请使用不超过 ${MAX_AUDIO_DURATION_SECONDS} 秒的音频片段。`);
    }
    const samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! + source[i]! / buffer.numberOfChannels;
    }
    return { samples, sampleRate: buffer.sampleRate };
  } catch (error) {
    if (error instanceof DOMException) throw new Error('浏览器无法解码此音频，请尝试 WAV 或 MP3。', { cause: error });
    throw error;
  } finally {
    await context.close();
  }
}

export interface MicrophoneCapture {
  sampleRate: number;
  stop: () => Promise<void>;
  dispose: () => void;
}

export async function startMicrophone(
  onChunk: (samples: Float32Array, sampleRate: number) => void,
  onLimit: () => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
): Promise<MicrophoneCapture> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('麦克风需要 HTTPS 或 localhost；也可以选择本地音频文件。');
  }
  if (typeof AudioContext === 'undefined') throw new Error('浏览器不支持 Web Audio，请使用最新版浏览器。');
  // Resume inside the click's user activation, before awaiting the permission prompt.
  const context = new AudioContext();
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let closed = false;
  let stopped = false;
  let requestedStop = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let resolveStop: (() => void) | undefined;
  let rejectStop: ((error: Error) => void) | undefined;
  let stopping: Promise<void> | undefined;
  const dispose = () => {
    closed = true;
    clearTimeout(timeout);
    source?.disconnect();
    worklet?.disconnect();
    worklet?.port.close();
    stream?.getTracks().forEach((track) => track.stop());
    if (context.state !== 'closed') void context.close().catch(() => {});
    resolveStop?.();
    signal?.removeEventListener('abort', dispose);
  };
  signal?.addEventListener('abort', dispose, { once: true });
  try {
    if (signal?.aborted) throw new Error('已取消录音。');
    await context.resume();
    if (signal?.aborted) throw new Error('已取消录音。');
    if (!context.audioWorklet) throw new Error('浏览器不支持 AudioWorklet，请使用最新版 Chrome、Edge 或 Safari，或上传音频。');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (signal?.aborted) throw new Error('已取消录音。');
    await context.audioWorklet.addModule(workletUrl);
    if (signal?.aborted) throw new Error('已取消录音。');
    source = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, 'tabrecord-capture', {
      processorOptions: { maxSeconds: MAX_AUDIO_DURATION_SECONDS },
    });
    worklet.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (closed || !data || typeof data !== 'object' || !('type' in data)) return;
      if (data.type === 'chunk' && 'samples' in data && data.samples instanceof Float32Array) {
        onChunk(data.samples, context.sampleRate);
      } else if (data.type === 'stopped') {
        stopped = true;
        resolveStop?.();
        if (!requestedStop) onLimit();
        dispose();
      }
    };
    worklet.onprocessorerror = () => {
      if (closed) return;
      rejectStop?.(new Error('音频采集失败，无法完整读取尾部音频。'));
      onError('音频采集发生错误，录制已停止。请重新录制或上传文件。');
      dispose();
    };
    stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
      if (closed || requestedStop) return;
      onError('麦克风已断开，录制已停止。请重新连接设备。');
      dispose();
    }));
    context.onstatechange = () => {
      if (!closed && !requestedStop && context.state === 'suspended') {
        onError('浏览器暂停了音频采集，请保持页面在前台并重新录制。');
        dispose();
      }
    };
    source.connect(worklet);
    worklet.connect(context.destination);
    return {
      sampleRate: context.sampleRate,
      dispose,
      stop() {
        if (stopped || closed) return Promise.resolve();
        if (stopping) return stopping;
        requestedStop = true;
        stopping = new Promise<void>((resolve, reject) => {
          resolveStop = resolve;
          rejectStop = reject;
          timeout = setTimeout(() => {
            rejectStop?.(new Error('音频尾部未能完整读取，请重新录制。'));
            dispose();
          }, 3000);
          worklet?.port.postMessage('stop');
        });
        return stopping;
      },
    };
  } catch (error) {
    dispose();
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('未获得麦克风权限。请在浏览器中允许访问，或选择音频文件。', { cause: error });
    }
    if (error instanceof DOMException && error.name === 'NotFoundError') throw new Error('没有找到麦克风。请连接输入设备或上传音频。', { cause: error });
    throw error;
  }
}
