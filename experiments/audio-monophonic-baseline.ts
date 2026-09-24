/**
 * Reproducible synthetic smoke test; run from the repository root with:
 * node --experimental-strip-types experiments/audio-monophonic-baseline.ts
 *
 * No third-party libraries, recorded media, datasets, or model weights.
 * This measures Node CPU time, not capture-to-screen browser latency.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { transcribeAudio, type AudioNoteEvent } from '../apps/web/src/features/audio/transcription.ts';

interface SyntheticNote {
  midi: number;
  start: number;
  duration: number;
}

const SAMPLE_RATE = 48_000;
const RUNS = 7;
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceUrl = new URL('../apps/web/src/features/audio/transcription.ts', import.meta.url);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pcmHash = (samples: Float32Array) => sha256(new Uint8Array(samples.buffer));
const frequencyForMidi = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function gitOutput(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unavailable';
  }
}

/** Same v1 equations as transcription.test.ts; start/end are rounded to samples. */
function guitarFixture(notes: SyntheticNote[], duration: number): Float32Array {
  const samples = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  for (const note of notes) {
    const start = Math.round(note.start * SAMPLE_RATE);
    const count = Math.round(note.duration * SAMPLE_RATE);
    for (let i = 0; i < count && start + i < samples.length; i += 1) {
      const time = i / SAMPLE_RATE;
      const envelope = Math.min(1, time / 0.004, (note.duration - time) / 0.008) * Math.exp(-time * 3);
      const phase = 2 * Math.PI * frequencyForMidi(note.midi) * time;
      const waveform = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase);
      samples[start + i] = (samples[start + i] ?? 0) + 0.4 * envelope * waveform;
    }
  }
  return samples;
}

function compareNotes(expected: SyntheticNote[], actual: AudioNoteEvent[]) {
  const tolerance = 0.04;
  const correctPitchCount = expected.filter((note, i) => note.midi === actual[i]?.midi).length;
  const onsetErrors = expected.map((note, i) => actual[i] ? actual[i]!.startSeconds - note.start : null);
  const offsetErrors = expected.map((note, i) => actual[i] ? actual[i]!.endSeconds - note.start - note.duration : null);
  const withinTolerance = (errors: Array<number | null>) => errors.every((error) => error !== null && Math.abs(error) <= tolerance + 1e-8);
  return {
    expectedCount: expected.length,
    detectedCount: actual.length,
    correctPitchCount,
    toleranceSeconds: tolerance,
    onsetErrorsSeconds: onsetErrors,
    offsetErrorsSeconds: offsetErrors,
    pass: actual.length === expected.length && correctPitchCount === expected.length &&
      withinTolerance(onsetErrors) && withinTolerance(offsetErrors),
    notes: actual,
  };
}

const pitches = [40, 45, 50, 55, 59, 64, 76, 88];
const melodyNotes = pitches.map((midi, i) => ({ midi, start: i * 0.3, duration: 0.23 }));
const melody = guitarFixture(melodyNotes, 2.4);
const melodyResult = compareNotes(melodyNotes, transcribeAudio(melody, SAMPLE_RATE));
const repeatedNotes = [0.1, 0.43, 0.76].map((start) => ({ midi: 57, start, duration: 0.3 }));
const repeated = guitarFixture(repeatedNotes, 1.2);
const repeatedResult = compareNotes(repeatedNotes, transcribeAudio(repeated, SAMPLE_RATE));
const silence = new Float32Array(SAMPLE_RATE);
let randomState = 407;
const noise = Float32Array.from({ length: SAMPLE_RATE }, () => {
  randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
  return (randomState / 0x1_0000_0000 - 0.5) * 0.4;
});
const silenceNotes = transcribeAudio(silence, SAMPLE_RATE);
const noiseNotes = transcribeAudio(noise, SAMPLE_RATE);

function benchmark(duration: number) {
  // All frames remain voiced: no silent region allows inference to be skipped.
  const samples = Float32Array.from({ length: duration * SAMPLE_RATE }, (_, i) => {
    const phase = 2 * Math.PI * frequencyForMidi(40) * i / SAMPLE_RATE;
    return 0.4 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
  });
  transcribeAudio(samples, SAMPLE_RATE);
  const timings: number[] = [];
  let result: AudioNoteEvent[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    result = transcribeAudio(samples, SAMPLE_RATE);
    timings.push(performance.now() - start);
  }
  const ordered = [...timings].sort((a, b) => a - b);
  const round = (value: number) => Number(value.toFixed(2));
  return {
    durationSeconds: duration,
    pcmFloat32Sha256: pcmHash(samples),
    runsMs: timings.map(round),
    p50Ms: round(ordered[Math.ceil(RUNS * 0.5) - 1]!),
    p95Ms: round(ordered[Math.ceil(RUNS * 0.95) - 1]!),
    detectedCount: result.length,
    pass: result.length === 1 && result[0]?.midi === 40 && result[0]?.startSeconds === 0 && result[0]?.endSeconds === duration,
  };
}

const benchmarks = [benchmark(2), benchmark(120)];
const report = {
  experiment: 'TAB-407 synthetic-monophonic-v1',
  generatedAtUtc: new Date().toISOString(),
  revision: {
    head: gitOutput(['rev-parse', 'HEAD']),
    sourceWorkingTreeStatus: gitOutput(['status', '--porcelain', '--', 'apps/web/src/features/audio/transcription.ts']),
    transcriptionSourceSha256: sha256(readFileSync(sourceUrl)),
    scriptSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    lockfileSha256: sha256(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url))),
  },
  environment: { node: process.version, os: os.type(), release: os.release(), arch: process.arch, cpu: os.cpus()[0]?.model },
  config: {
    sourceSampleRate: SAMPLE_RATE, analysisSampleRate: 12_000, hopSeconds: 0.01,
    windowSeconds: 0.064, minMidi: 40, maxMidi: 88, minNoteDurationSeconds: 0.08,
    maxDurationSeconds: 120, noiseSeed: 407, benchmarkWarmups: 1, benchmarkTrials: RUNS,
    quantileMethod: 'nearest rank; seven-trial p95 is the maximum, not a latency guarantee',
  },
  fixtures: {
    melody: { pcmFloat32Sha256: pcmHash(melody), ...melodyResult },
    repeated: { pcmFloat32Sha256: pcmHash(repeated), ...repeatedResult },
    silence: { pcmFloat32Sha256: pcmHash(silence), detectedCount: silenceNotes.length, pass: silenceNotes.length === 0 },
    noise: { pcmFloat32Sha256: pcmHash(noise), detectedCount: noiseNotes.length, pass: noiseNotes.length === 0 },
  },
  benchmarks,
};

console.log(JSON.stringify(report, null, 2));
if (!melodyResult.pass || !repeatedResult.pass || silenceNotes.length || noiseNotes.length || benchmarks.some((run) => !run.pass)) {
  process.exitCode = 1;
}
