import type { AudioNoteEvent } from './transcription';

export interface TranscriptionResult { notes: AudioNoteEvent[]; elapsedMs: number }

export class TranscriptionClient {
  private worker = new Worker(new URL('./transcription.worker.ts', import.meta.url), { type: 'module' });
  private rejectPending: ((error: Error) => void) | undefined;
  private disposed = false;

  analyze(samples: Float32Array, sampleRate: number): Promise<TranscriptionResult> {
    if (this.disposed) return Promise.reject(new Error('音频分析已关闭。'));
    if (this.rejectPending) return Promise.reject(new Error('已有音频正在分析。'));
    return new Promise((resolve, reject) => {
      this.rejectPending = reject;
      this.worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        this.rejectPending = undefined;
        if (!data || typeof data !== 'object') { reject(new Error('转录返回无效结果。')); return; }
        if ('error' in data && typeof data.error === 'string') { reject(new Error(data.error)); return; }
        if (!('notes' in data) || !('elapsedMs' in data) || !Array.isArray(data.notes) ||
          typeof data.elapsedMs !== 'number' || !Number.isFinite(data.elapsedMs) ||
          !data.notes.every((note: unknown) => {
            if (!note || typeof note !== 'object') return false;
            const n = note as AudioNoteEvent;
            return Number.isFinite(n.startSeconds) && Number.isFinite(n.endSeconds) &&
              n.startSeconds >= 0 && n.endSeconds > n.startSeconds && n.endSeconds <= 120 &&
              Number.isInteger(n.midi) && n.midi >= 40 && n.midi <= 88 &&
              Number.isFinite(n.confidence) && n.confidence >= 0 && n.confidence <= 1 &&
              Number.isInteger(n.velocity) && n.velocity >= 1 && n.velocity <= 127;
          })) reject(new Error('转录返回无效结果。'));
        else resolve({ notes: data.notes as AudioNoteEvent[], elapsedMs: data.elapsedMs });
      };
      this.worker.onerror = () => {
        this.rejectPending = undefined;
        reject(new Error('音频分析线程失败，请重试。'));
      };
      this.worker.postMessage({ samples, sampleRate }, [samples.buffer]);
    });
  }

  dispose() {
    this.disposed = true;
    this.worker.terminate();
    this.rejectPending?.(new Error('已取消音频分析。'));
    this.rejectPending = undefined;
  }
}
