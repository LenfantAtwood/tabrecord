/** Experimental, monophonic YIN baseline. It does not separate chords or backing tracks. */
export interface AudioNoteEvent {
  startSeconds: number;
  endSeconds: number;
  midi: number;
  confidence: number;
  /** Relative MIDI velocity, in the inclusive range 1–127. */
  velocity: number;
}

export interface TranscriptionOptions {
  minMidi?: number;
  maxMidi?: number;
  minNoteDurationSeconds?: number;
  maxDurationSeconds?: number;
}

export const MAX_AUDIO_DURATION_SECONDS = 120;

const ANALYSIS_SAMPLE_RATE = 12_000;
const HOP_SECONDS = 0.01;
const WINDOW_SECONDS = 0.064;
const YIN_THRESHOLD = 0.15;
const MIN_CONFIDENCE = 0.8;

interface PitchFrame {
  midi: number | null;
  confidence: number;
  rms: number;
}

interface NoteRun {
  start: number;
  end: number;
  midi: number;
}

const frequencyForMidi = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/**
 * Convert decoded mono PCM to timed note candidates, relative to sample zero.
 *
 * Run in a Worker: inference is synchronous and bounded to two minutes. Silence
 * returns an empty array. Invalid input throws instead of silently truncating it.
 * Input must be normalized PCM; no audio or features leave the browser.
 *
 * Pitch estimation follows the cumulative mean normalized difference in YIN:
 * https://pubmed.ncbi.nlm.nih.gov/12002874/ (de Cheveigné & Kawahara, 2002).
 * Timing and reattack segmentation are heuristic and require user review.
 */
export function transcribeAudio(
  samples: Float32Array,
  sampleRate: number,
  options: TranscriptionOptions = {},
): AudioNoteEvent[] {
  const minMidi = options.minMidi ?? 40;
  const maxMidi = options.maxMidi ?? 88;
  const minDuration = options.minNoteDurationSeconds ?? 0.08;
  const maxDuration = options.maxDurationSeconds ?? MAX_AUDIO_DURATION_SECONDS;
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new RangeError('音频采样率必须介于 8,000 和 192,000 Hz。');
  }
  if (
    !Number.isInteger(minMidi) || !Number.isInteger(maxMidi) ||
    minMidi < 36 || maxMidi > 96 || minMidi > maxMidi
  ) {
    throw new RangeError('音高范围必须是 C2–C7 内递增的 MIDI 整数。');
  }
  if (!Number.isFinite(minDuration) || minDuration < 0.03 || minDuration > 1) {
    throw new RangeError('最短音符时长必须介于 0.03 和 1 秒。');
  }
  if (!Number.isFinite(maxDuration) || maxDuration <= 0 || maxDuration > MAX_AUDIO_DURATION_SECONDS) {
    throw new RangeError(`音频分析上限必须介于 0 和 ${MAX_AUDIO_DURATION_SECONDS} 秒。`);
  }
  if (samples.length / sampleRate > maxDuration) {
    throw new RangeError(`音频不能超过 ${maxDuration} 秒，请先截取需要转换的片段。`);
  }
  if (samples.length === 0) return [];

  const analysisRate = Math.min(sampleRate, ANALYSIS_SAMPLE_RATE);
  const signal = resample(samples, sampleRate, analysisRate);
  const hop = Math.round(analysisRate * HOP_SECONDS);
  const window = Math.round(analysisRate * WINDOW_SECONDS);
  // Half a semitone of margin includes notes at either endpoint before rounding.
  const maxLag = Math.ceil(analysisRate / frequencyForMidi(minMidi - 0.5));
  const differences = new Float64Array(maxLag + 1);
  const frames: PitchFrame[] = [];
  let peakRms = 0;
  for (let offset = 0; offset < signal.length; offset += hop) {
    const end = Math.min(offset + hop, signal.length);
    let squareSum = 0;
    for (let i = offset; i < end; i += 1) squareSum += signal[i]! ** 2;
    const rms = Math.sqrt(squareSum / (end - offset));
    peakRms = Math.max(peakRms, rms);
    frames.push({ rms, midi: null, confidence: 0 });
  }
  // An absolute floor rejects digital noise; the relative floor follows gain.
  const silenceThreshold = Math.max(0.0002, peakRms * 0.015);
  if (peakRms <= silenceThreshold) return [];

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    if (frame.rms <= silenceThreshold) continue;
    const center = i * hop + hop / 2;
    const start = Math.max(0, Math.floor(center - window / 2));
    const end = Math.min(signal.length, Math.floor(center + window / 2));
    const pitch = detectPitch(signal, start, end, maxLag, differences, analysisRate);
    if (pitch && pitch.midi >= minMidi && pitch.midi <= maxMidi) {
      frame.midi = pitch.midi;
      frame.confidence = pitch.confidence;
    }
  }

  smoothFrames(frames, silenceThreshold);
  const runs = collectRuns(frames, silenceThreshold);
  const events: AudioNoteEvent[] = [];
  for (const run of runs) {
    // A new pick at the same pitch can have no intervening silent frame.
    const boundaries = [run.start, ...findReattacks(frames, run, peakRms, hop / analysisRate), run.end];
    for (let part = 0; part < boundaries.length - 1; part += 1) {
      const start = boundaries[part]!;
      const end = boundaries[part + 1]!;
      const startSeconds = start * hop / analysisRate;
      const endSeconds = Math.min(end * hop / analysisRate, samples.length / sampleRate);
      if (endSeconds - startSeconds + 1e-8 < minDuration) continue;
      let confidenceSum = 0;
      let voicedFrames = 0;
      let noteRms = 0;
      for (let i = start; i < end; i += 1) {
        noteRms = Math.max(noteRms, frames[i]!.rms);
        if (frames[i]!.midi === run.midi) {
          confidenceSum += frames[i]!.confidence;
          voicedFrames += 1;
        }
      }
      if (voicedFrames < 3) continue;
      const event: AudioNoteEvent = {
        startSeconds,
        endSeconds,
        midi: run.midi,
        confidence: Math.min(1, confidenceSum / voicedFrames),
        velocity: Math.max(1, Math.min(127, Math.round(127 * Math.sqrt(noteRms / peakRms)))),
      };
      const previous = events.at(-1);
      if (previous && previous.endSeconds > event.startSeconds) {
        const boundary = (previous.endSeconds + event.startSeconds) / 2;
        previous.endSeconds = boundary;
        event.startSeconds = boundary;
      }
      events.push(event);
    }
  }
  return events;
}

/** Area-averaging resampler: bounded work, with a box low-pass before decimation. */
function resample(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  let mean = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (!Number.isFinite(samples[i]!)) throw new Error('音频包含无效采样值。');
    mean += samples[i]!;
  }
  mean /= samples.length;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.ceil(samples.length / ratio));
  for (let i = 0; i < output.length; i += 1) {
    const start = i * ratio;
    const end = Math.min((i + 1) * ratio, samples.length);
    let sum = 0;
    for (let source = Math.floor(start); source < Math.ceil(end); source += 1) {
      const weight = Math.min(source + 1, end) - Math.max(source, start);
      sum += (samples[source]! - mean) * weight;
    }
    output[i] = sum / (end - start);
  }
  return output;
}

function detectPitch(
  signal: Float32Array,
  start: number,
  end: number,
  maxLag: number,
  differences: Float64Array,
  sampleRate: number,
): { midi: number; confidence: number } | null {
  const comparisonLength = end - start - maxLag;
  if (comparisonLength < maxLag) return null;
  differences[0]! = 1;
  let cumulative = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let difference = 0;
    for (let i = start; i < start + comparisonLength; i += 1) {
      const delta = signal[i]! - signal[i + lag]!;
      difference += delta * delta;
    }
    cumulative += difference;
    differences[lag]! = cumulative > 0 ? difference * lag / cumulative : 1;
  }

  let bestLag = -1;
  let minimum = 1;
  // Search from the shortest period so an out-of-range high note is rejected by
  // the caller instead of being misidentified as a lower subharmonic.
  for (let lag = 2; lag < maxLag; lag += 1) {
    if (differences[lag]! < minimum) {
      minimum = differences[lag]!;
      bestLag = lag;
    }
    if (
      differences[lag]! <= differences[lag - 1]! &&
      differences[lag]! <= differences[lag + 1]! &&
      interpolatedMinimum(differences, lag, maxLag) < YIN_THRESHOLD
    ) {
      bestLag = lag;
      break;
    }
  }
  if (bestLag < 0 || interpolatedMinimum(differences, bestLag, maxLag) > 1 - MIN_CONFIDENCE) return null;

  // A loud second harmonic can create an earlier shallow dip. Only prefer the
  // octave below when its periodicity is substantially stronger.
  const doubled = bestLag * 2;
  const bestMinimum = interpolatedMinimum(differences, bestLag, maxLag);
  // At very short periods, sampling alone makes the first dip shallower; octave
  // correction there would fold high notes into the supported guitar range.
  if (bestLag >= 16 && bestMinimum > 0.025 && doubled + 1 < maxLag) {
    let octaveLag = doubled;
    for (let lag = doubled - 1; lag <= doubled + 1; lag += 1) {
      if (differences[lag]! < differences[octaveLag]!) octaveLag = lag;
    }
    if (interpolatedMinimum(differences, octaveLag, maxLag) < bestMinimum * 0.25) bestLag = octaveLag;
  }

  let period = bestLag;
  if (bestLag > 0 && bestLag < maxLag) {
    const left = differences[bestLag - 1]!;
    const middle = differences[bestLag]!;
    const right = differences[bestLag + 1]!;
    const curvature = left - 2 * middle + right;
    if (curvature > 0) period += Math.max(-1, Math.min(1, (left - right) / (2 * curvature)));
  }
  return {
    midi: Math.round(69 + 12 * Math.log2(sampleRate / period / 440)),
    confidence: Math.max(0, 1 - interpolatedMinimum(differences, bestLag, maxLag)),
  };
}

function interpolatedMinimum(differences: Float64Array, lag: number, maxLag: number): number {
  const middle = differences[lag]!;
  if (lag === 0 || lag === maxLag) return middle;
  const left = differences[lag - 1]!;
  const right = differences[lag + 1]!;
  const curvature = left - 2 * middle + right;
  return curvature > 0 ? Math.max(0, middle - (left - right) ** 2 / (8 * curvature)) : middle;
}

function smoothFrames(frames: PitchFrame[], silenceThreshold: number): void {
  const original = frames.map((frame) => frame.midi);
  for (let i = 1; i + 1 < frames.length; i += 1) {
    const previous = original[i - 1]!;
    if (previous !== null && previous !== original[i]! && previous === original[i + 1]! && frames[i]!.rms > silenceThreshold) {
      frames[i]!.midi = previous;
      frames[i]!.confidence = Math.min(frames[i - 1]!.confidence, frames[i + 1]!.confidence);
    }
  }
}

function collectRuns(frames: PitchFrame[], silenceThreshold: number): NoteRun[] {
  const runs: NoteRun[] = [];
  for (let i = 0; i < frames.length;) {
    const midi = frames[i]!.midi;
    if (midi === null) {
      i += 1;
      continue;
    }
    const voicedStart = i;
    while (i < frames.length && frames[i]!.midi === midi) i += 1;
    let start = voicedStart;
    let end = i;
    // Restore at most 20 ms of attack/release rejected by a mixed YIN window.
    for (let extension = 0; extension < 2 && start > 0; extension += 1) {
      if (frames[start - 1]!.midi !== null || frames[start - 1]!.rms <= silenceThreshold) break;
      start -= 1;
    }
    for (let extension = 0; extension < 2 && end < frames.length; extension += 1) {
      if (frames[end]!.midi !== null || frames[end]!.rms <= silenceThreshold) break;
      end += 1;
    }
    runs.push({ start, end, midi });
  }
  return runs;
}

function findReattacks(frames: PitchFrame[], run: NoteRun, peakRms: number, hopSeconds: number): number[] {
  const boundaries: number[] = [];
  const separation = Math.ceil(0.08 / hopSeconds);
  let lastAttack = run.start;
  for (let i = run.start + separation; i < run.end - separation; i += 1) {
    const before = (frames[i - 2]!.rms + frames[i - 1]!.rms) / 2;
    const after = (frames[i]!.rms + frames[i + 1]!.rms) / 2;
    if (i - lastAttack >= separation && after > before * 1.9 && after - before > peakRms * 0.08) {
      boundaries.push(i);
      lastAttack = i;
    }
  }
  return boundaries;
}
