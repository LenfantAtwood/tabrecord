import { transcribeAudio } from './transcription';

self.onmessage = ({ data }: MessageEvent<unknown>) => {
  try {
    if (!data || typeof data !== 'object' || !('samples' in data) ||
      !('sampleRate' in data) || !(data.samples instanceof Float32Array) ||
      typeof data.sampleRate !== 'number') throw new Error('无效的音频任务。');
    const started = performance.now();
    const notes = transcribeAudio(data.samples, data.sampleRate);
    self.postMessage({ notes, elapsedMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '音频分析失败。' });
  }
};
