import { describe, expect, it } from 'vitest';

import { MAX_AUDIO_DURATION_SECONDS, transcribeAudio } from './transcription';

interface SyntheticNote {
  midi: number;
  start: number;
  duration: number;
  amplitude?: number;
}

/** Deterministic fixture v1: additive, plucked harmonics; no recorded media. */
function guitarFixture(notes: SyntheticNote[], sampleRate: number, duration: number): Float32Array {
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  for (const note of notes) {
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    const start = Math.round(note.start * sampleRate);
    const count = Math.round(note.duration * sampleRate);
    for (let i = 0; i < count && start + i < samples.length; i += 1) {
      const time = i / sampleRate;
      const envelope = Math.min(1, time / 0.004, (note.duration - time) / 0.008) * Math.exp(-time * 3);
      const phase = 2 * Math.PI * frequency * time;
      const waveform = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase);
      samples[start + i] = (samples[start + i] ?? 0) + (note.amplitude ?? 0.4) * envelope * waveform;
    }
  }
  return samples;
}

describe('transcribeAudio experimental monophonic baseline', () => {
  it.each([8_000, 44_100, 48_000, 96_000])('keeps low E pitch and original timing at %i Hz', (sampleRate) => {
    const events = transcribeAudio(
      guitarFixture([{ midi: 40, start: 0.23, duration: 0.64 }], sampleRate, 1.1), sampleRate,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.midi).toBe(40);
    expect(Math.abs((events[0]?.startSeconds ?? -1) - 0.23)).toBeLessThanOrEqual(0.04);
    expect(Math.abs((events[0]?.endSeconds ?? -1) - 0.87)).toBeLessThanOrEqual(0.04);
    expect(events[0]?.confidence).toBeGreaterThan(0.8);
    expect(events[0]?.velocity).toBeGreaterThanOrEqual(1);
    expect(events[0]?.velocity).toBeLessThanOrEqual(127);
  });

  it('transcribes open strings and the top guitar frets in order', () => {
    const pitches = [40, 45, 50, 55, 59, 64, 76, 88];
    const notes = pitches.map((midi, index) => ({ midi, start: index * 0.3, duration: 0.23 }));
    const events = transcribeAudio(guitarFixture(notes, 48_000, 2.4), 48_000);
    expect(events.map((event) => event.midi)).toEqual(pitches);
    for (let i = 0; i < events.length; i += 1) {
      expect(Math.abs((events[i]?.startSeconds ?? -1) - i * 0.3)).toBeLessThanOrEqual(0.04);
    }
  });

  it('preserves repeated pitches separated by short silences', () => {
    const notes = [0.1, 0.43, 0.76].map((start) => ({ midi: 57, start, duration: 0.3 }));
    const events = transcribeAudio(guitarFixture(notes, 44_100, 1.2), 44_100);
    expect(events.map((event) => event.midi)).toEqual([57, 57, 57]);
    expect(events[1]?.startSeconds).toBeCloseTo(0.43, 1);
    expect(events[2]?.startSeconds).toBeCloseTo(0.76, 1);
  });

  it('separates a fresh pick at the same pitch without a silent gap', () => {
    const notes = [{ midi: 52, start: 0, duration: 0.65 }, { midi: 52, start: 0.65, duration: 0.55 }];
    const events = transcribeAudio(guitarFixture(notes, 48_000, 1.2), 48_000);
    expect(events.map((event) => event.midi)).toEqual([52, 52]);
    expect(Math.abs((events[1]?.startSeconds ?? -1) - 0.65)).toBeLessThanOrEqual(0.04);
  });

  it('does not invent notes for silence, DC, or deterministic broadband noise', () => {
    expect(transcribeAudio(new Float32Array(48_000), 48_000)).toEqual([]);
    expect(transcribeAudio(new Float32Array(48_000).fill(0.4), 48_000)).toEqual([]);
    let seed = 407;
    const noise = Float32Array.from({ length: 48_000 }, () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return (seed / 0x1_0000_0000 - 0.5) * 0.4;
    });
    expect(transcribeAudio(noise, 48_000)).toEqual([]);
  });

  it('does not turn a brief click into a held note', () => {
    const audio = new Float32Array(48_000);
    audio[12_000] = 1;
    expect(transcribeAudio(audio, 48_000)).toEqual([]);
  });

  it('rejects unsupported pitches instead of folding them into the guitar range', () => {
    for (const midi of [36, 37, 38, 39, 89, 90, 91, 92, 93, 94, 95, 96]) {
      const audio = guitarFixture([{ midi, start: 0.1, duration: 0.4 }], 48_000, 0.6);
      expect(transcribeAudio(audio, 48_000), `out-of-range MIDI ${midi}`).toEqual([]);
    }
  });

  it('keeps the fundamental when the second harmonic is louder', () => {
    const audio = Float32Array.from({ length: 24_000 }, (_, i) => {
      const phase = 2 * Math.PI * (440 * 2 ** ((52 - 69) / 12)) * i / 48_000;
      return 0.08 * Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.04 * Math.sin(3 * phase);
    });
    expect(transcribeAudio(audio, 48_000).map((event) => event.midi)).toEqual([52]);
  });

  it('keeps note changes ordered and non-overlapping without rests', () => {
    const notes = [45, 47, 48, 50].map((midi, index) => ({ midi, start: index * 0.3, duration: 0.3 }));
    const events = transcribeAudio(guitarFixture(notes, 44_100, 1.2), 44_100);
    expect(events.map((event) => event.midi)).toEqual([45, 47, 48, 50]);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]?.startSeconds).toBeGreaterThanOrEqual(events[i - 1]?.endSeconds ?? 0);
      expect(Math.abs((events[i]?.startSeconds ?? -1) - i * 0.3)).toBeLessThanOrEqual(0.04);
    }
  });

  it('ends the last held note at the available recording boundary', () => {
    const audio = guitarFixture([{ midi: 64, start: 0, duration: 1 }], 44_100, 0.41);
    const events = transcribeAudio(audio, 44_100);
    expect(events).toHaveLength(1);
    expect(events[0]?.startSeconds).toBe(0);
    expect(events[0]?.endSeconds).toBeCloseTo(0.41, 2);
  });

  it('rejects malformed PCM and enforces resource limits before processing', () => {
    expect(transcribeAudio(new Float32Array(), 48_000)).toEqual([]);
    expect(() => transcribeAudio(new Float32Array([NaN]), 48_000)).toThrow('无效');
    expect(() => transcribeAudio(new Float32Array([Infinity]), 48_000)).toThrow('无效');
    expect(() => transcribeAudio(new Float32Array(10), 0)).toThrow('采样率');
    expect(() => transcribeAudio(new Float32Array(10), NaN)).toThrow('采样率');
    expect(() => transcribeAudio(new Float32Array(10), 48_000, { minMidi: 20 })).toThrow('音高');
    expect(() => transcribeAudio(new Float32Array(8_000 * MAX_AUDIO_DURATION_SECONDS + 1), 8_000)).toThrow('超过');
    expect(() => transcribeAudio(new Float32Array(100), 8_000, { maxDurationSeconds: 0.01 })).toThrow('超过');
  });
});
