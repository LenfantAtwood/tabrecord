import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';

import type { AudioNoteEvent } from './transcription';
import {
  buildTabScore, exportMidi, getScoreEndTick, getTabPositions, parseTabSession,
  MAX_TAB_SESSION_BYTES, serializeTabSession, setNotePosition, STANDARD_TUNING, toAlphaTex,
} from './tabScore';

function audioNote(midi: number, startSeconds = 0, endSeconds = 0.5, velocity = 95): AudioNoteEvent {
  return { midi, startSeconds, endSeconds, velocity, confidence: 0.93 };
}

function parseTex(tex: string) {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

/** Independent SMF reader for verifying encoded event times, lengths and payloads. */
function readMidi(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  expect(tag(0)).toBe('MThd');
  expect(view.getUint32(4)).toBe(6);
  const tracks: Array<Array<{ tick: number; status: number; data: number[] }>> = [];
  let offset = 14;
  while (offset < bytes.length) {
    expect(tag(offset)).toBe('MTrk');
    const end = offset + 8 + view.getUint32(offset + 4);
    offset += 8;
    let tick = 0;
    const events: typeof tracks[number] = [];
    function readVariable() {
      let value = 0;
      let byte: number;
      do {
        byte = bytes[offset++]!;
        value = value * 128 + (byte & 0x7f);
      } while (byte & 0x80);
      return value;
    }
    while (offset < end) {
      tick += readVariable();
      const status = bytes[offset++]!;
      if (status === 0xff) {
        const type = bytes[offset++]!;
        const length = readVariable();
        const data = [...bytes.slice(offset, offset + length)];
        offset += length;
        events.push({ tick, status: 0xff00 | type, data });
      } else {
        const length = (status & 0xf0) === 0xc0 ? 1 : 2;
        const data = [...bytes.slice(offset, offset + length)];
        offset += length;
        events.push({ tick, status, data });
      }
    }
    expect(offset).toBe(end);
    tracks.push(events);
  }
  expect(tracks).toHaveLength(view.getUint16(10));
  return { format: view.getUint16(8), ppq: view.getUint16(12), tracks };
}

describe('standard six-string fingering', () => {
  it('covers every playable pitch and never invents a string/fret', () => {
    for (let midi = 40; midi <= 88; midi += 1) {
      const positions = getTabPositions(midi);
      expect(positions.length).toBeGreaterThan(0);
      positions.forEach((position) => {
        expect(STANDARD_TUNING[position.string - 1]! + position.fret).toBe(midi);
        expect(position.fret).toBeGreaterThanOrEqual(0);
        expect(position.fret).toBeLessThanOrEqual(24);
      });
    }
    expect(getTabPositions(39)).toEqual([]);
    expect(getTabPositions(89)).toEqual([]);
    expect(getTabPositions(64.5)).toEqual([]);
    expect(getTabPositions(40)).toEqual([{ string: 6, fret: 0 }]);
    expect(getTabPositions(88)).toEqual([{ string: 1, fret: 24 }]);
  });

  it('keeps a chromatic low-register phrase on one string', () => {
    const score = buildTabScore([40, 41, 42, 43, 44].map((pitch, index) =>
      audioNote(pitch, index / 2, (index + 1) / 2)), { bpm: 120 });
    expect(score.notes.map((note) => note.tab)).toEqual([0, 1, 2, 3, 4].map((fret) => ({ string: 6, fret })));
  });

  it('uses the whole phrase to avoid unnecessary open-string crossings', () => {
    const score = buildTabScore([59, 55, 59].map((pitch, index) =>
      audioNote(pitch, index / 2, (index + 1) / 2)), { bpm: 120 });
    // A per-note lowest-fret decoder would choose strings 2, 3, 2.
    expect(score.notes.map((note) => note.tab)).toEqual([
      { string: 3, fret: 4 }, { string: 3, fret: 0 }, { string: 3, fret: 4 },
    ]);
  });

  it('locks only valid manual choices and preserves the previous snapshot', () => {
    const score = buildTabScore([audioNote(64)], { bpm: 120 });
    const edited = setNotePosition(score, 'note-1', { string: 2, fret: 5 });
    expect(edited.notes[0]?.state).toBe('locked');
    expect(edited.edits).toEqual([{ noteId: 'note-1', from: { string: 1, fret: 0 }, to: { string: 2, fret: 5 } }]);
    expect(score.notes[0]?.state).toBe('committed');
    expect(() => setNotePosition(score, 'note-1', { string: 2, fret: 6 })).toThrow();
    expect(() => setNotePosition(score, 'missing', { string: 1, fret: 0 })).toThrow();
  });

  it('refuses an edit beyond the history limit while preserving a saveable score', () => {
    const score = buildTabScore([audioNote(64)], { bpm: 120 });
    score.notes[0]!.state = 'locked';
    const positions = [{ string: 1, fret: 0 }, { string: 2, fret: 5 }];
    score.edits = Array.from({ length: 20000 }, (_, index) => ({ noteId: 'note-1',
      from: positions[index % 2]!, to: positions[(index + 1) % 2]!,
    }));
    const before = serializeTabSession(score);
    expect(() => setNotePosition(score, 'note-1', { string: 2, fret: 5 })).toThrow('20,000 次弦品修改上限');
    expect(setNotePosition(score, 'note-1', { string: 1, fret: 0 })).toBe(score);
    expect(serializeTabSession(score)).toBe(before);
    const restored = parseTabSession(before);
    expect(restored.edits).toHaveLength(20000);
    expect(exportMidi(restored)).toEqual(exportMidi(score));
  });
});

describe('quantized canonical score and alphaTab adapter', () => {
  it('preserves raw seconds and resolves sixteenth-grid collisions without overlapping notes', () => {
    const notes = [audioNote(64, 0.01, 0.06), audioNote(65, 0.065, 0.13)];
    const score = buildTabScore(notes, { bpm: 120 });
    expect(score.notes.map((note) => [note.startTick, note.durationTicks])).toEqual([[0, 120], [120, 120]]);
    expect(score.notes.map((note) => [note.startSeconds, note.endSeconds])).toEqual([[0.01, 0.06], [0.065, 0.13]]);
  });

  it('renders silence as full rests, including trailing silence', () => {
    const score = buildTabScore([], { bpm: 120, durationSeconds: 5 });
    const rendered = parseTex(toAlphaTex(score));
    expect(rendered.masterBars).toHaveLength(3);
    const beats = rendered.tracks[0]!.staves[0]!.bars.flatMap((bar) => bar.voices[0]!.beats);
    expect(beats.every((beat) => beat.isRest)).toBe(true);
    expect(beats.reduce((sum, beat) => sum + beat.playbackDuration / 2, 0)).toBe(5760);
    expect(readMidi(exportMidi(score)).tracks[1]?.filter((event) => event.status === 0x90)).toEqual([]);
  });

  it('parses all pitch extremes with the installed alphaTab and preserves standard tuning', () => {
    const score = buildTabScore([40, 45, 50, 55, 59, 64, 88].map((pitch, index) =>
      audioNote(pitch, index / 2, (index + 1) / 2)), { bpm: 120 });
    const rendered = parseTex(toAlphaTex(score));
    const notes = rendered.tracks[0]!.staves[0]!.bars.flatMap((bar) =>
      bar.voices[0]!.beats.flatMap((beat) => beat.notes));
    expect(notes.map((note) => note.realValue)).toEqual([40, 45, 50, 55, 59, 64, 88]);
    expect(rendered.tracks[0]!.staves[0]!.tuning).toEqual([...STANDARD_TUNING]);
    expect(rendered.tempo).toBe(120);
  });

  it('fills leading/gap rests and ties a sustained note across the bar without retriggering', () => {
    const score = buildTabScore([audioNote(64, 1.5, 2.75), audioNote(67, 3, 3.5)], { bpm: 120 });
    const rendered = parseTex(toAlphaTex(score));
    const bars = rendered.tracks[0]!.staves[0]!.bars;
    expect(bars).toHaveLength(2);
    expect(rendered.masterBars.every((bar) => bar.calculateDuration() === 3840)).toBe(true);
    const beats = bars.flatMap((bar) => bar.voices[0]!.beats);
    const notes = beats.flatMap((beat) => beat.notes);
    expect(notes.filter((note) => !note.isTieDestination).map((note) => note.realValue)).toEqual([64, 67]);
    const continuation = bars[1]!.voices[0]!.beats[0]!.notes[0]!;
    expect(continuation.isTieDestination).toBe(true);
    expect(continuation.tieOrigin?.realValue).toBe(64);
    // alphaTab uses 960 PPQ internally; our canonical/MIDI contract uses 480.
    expect(beats.filter((beat) => beat.notes.length > 0 && !beat.notes[0]!.isTieDestination)
      .map((beat) => beat.absolutePlaybackStart / 2)).toEqual(score.notes.map((note) => note.startTick));
    expect(beats.filter((beat) => beat.notes[0]?.realValue === 64)
      .reduce((sum, beat) => sum + beat.playbackDuration / 2, 0)).toBe(score.notes[0]?.durationTicks);
  });

  it('rejects malformed input instead of folding an unsupported pitch', () => {
    expect(() => buildTabScore([audioNote(39)], { bpm: 120 })).toThrow();
    expect(() => buildTabScore([audioNote(64, 1, 0)], { bpm: 120 })).toThrow();
    expect(() => buildTabScore([audioNote(64)], { bpm: NaN })).toThrow();
    expect(() => buildTabScore([audioNote(64)], { bpm: 120, durationSeconds: 0.1 })).toThrow();
  });
});

describe('MIDI Type 1 export', () => {
  it('roundtrips exact snapshot pitch, note-on/off ticks, velocity, tempo and meter', () => {
    const score = buildTabScore([audioNote(64, 1, 3, 95), audioNote(67, 3.125, 3.5, 127)], { bpm: 120 });
    const midi = readMidi(exportMidi(score));
    expect(midi.format).toBe(1);
    expect(midi.ppq).toBe(480);
    expect(midi.tracks).toHaveLength(2);
    expect(midi.tracks[0]).toEqual([
      { tick: 0, status: 0xff51, data: [7, 161, 32] },
      { tick: 0, status: 0xff58, data: [4, 2, 24, 8] },
      { tick: 3840, status: 0xff2f, data: [] },
    ]);
    expect(midi.tracks[1]).toEqual([
      { tick: 0, status: 0xc0, data: [25] },
      { tick: 960, status: 0x90, data: [64, 95] },
      { tick: 2880, status: 0x80, data: [64, 0] },
      { tick: 3000, status: 0x90, data: [67, 127] },
      { tick: 3360, status: 0x80, data: [67, 0] },
      { tick: 3840, status: 0xff2f, data: [] },
    ]);
    expect(getScoreEndTick(score)).toBe(3840);
  });

  it('orders same-tick note-off before the next note-on', () => {
    const score = buildTabScore([audioNote(64, 0, 0.5), audioNote(64, 0.5, 1)], { bpm: 120 });
    expect(readMidi(exportMidi(score)).tracks[1]?.filter((event) => event.tick === 480)
      .map((event) => event.status)).toEqual([0x80, 0x90]);
  });
});

describe('versioned JSON session boundary', () => {
  it('restores raw events, selected fingering, locked state and edit history', () => {
    const score = setNotePosition(buildTabScore([audioNote(64)], { bpm: 96, title: '练习' }),
      'note-1', { string: 2, fret: 5 });
    const restored = parseTabSession(serializeTabSession(score));
    expect(restored).toEqual(score);
    expect(toAlphaTex(restored)).toBe(toAlphaTex(score));
    expect(exportMidi(restored)).toEqual(exportMidi(score));
  });

  it('rejects unknown versions, unsafe timing, incorrect pitch/fret and duplicate IDs', () => {
    const score = buildTabScore([audioNote(64)], { bpm: 120 });
    expect(() => parseTabSession(JSON.stringify({ ...score, schemaVersion: 2 }))).toThrow();
    expect(() => parseTabSession(JSON.stringify({ ...score, notes: [score.notes[0], score.notes[0]] }))).toThrow();
    expect(() => parseTabSession(JSON.stringify({ ...score, notes: [{ ...score.notes[0], durationTicks: -120 }] }))).toThrow();
    expect(() => parseTabSession(JSON.stringify({ ...score, notes: [{ ...score.notes[0], tab: { string: 1, fret: 1 } }] }))).toThrow();
    expect(() => parseTabSession(JSON.stringify({ ...score, notes: [{ ...score.notes[0], endSeconds: 121 }] }))).toThrow();
    expect(() => parseTabSession(JSON.stringify({ ...score, notes: [{ ...score.notes[0], startTick: 960000 }] }))).toThrow();
  });

  it('rejects edit history which disagrees with the selected locked fingering', () => {
    const score = setNotePosition(buildTabScore([audioNote(64)], { bpm: 120 }),
      'note-1', { string: 2, fret: 5 });
    expect(() => parseTabSession(JSON.stringify({ ...score, edits: [] }))).toThrow();
    expect(() => parseTabSession(JSON.stringify({ ...score,
      notes: [{ ...score.notes[0], tab: { string: 1, fret: 0 } }],
    }))).toThrow();
  });

  it('keeps imported titles from injecting alphaTex commands', () => {
    const score = buildTabScore([audioNote(64)], { bpm: 120, title: 'x"\n\\tempo 240\n"' });
    expect(parseTex(toAlphaTex(score)).tempo).toBe(120);
  });

  it('can restore its own export even when pretty-printing would exceed the file limit', () => {
    const score = buildTabScore(Array.from({ length: 4000 }, (_, index) =>
      audioNote(64, index / 40, index / 40 + 0.01)), { bpm: 120 });
    score.notes[0]!.state = 'locked';
    const positions = [{ string: 1, fret: 0 }, { string: 2, fret: 5 }];
    score.edits = Array.from({ length: 20000 }, (_, index) => ({ noteId: 'note-1',
      from: positions[index % 2]!, to: positions[(index + 1) % 2]!,
    }));
    expect(new TextEncoder().encode(JSON.stringify(score, null, 2)).byteLength).toBeGreaterThan(MAX_TAB_SESSION_BYTES);
    const json = serializeTabSession(score);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(MAX_TAB_SESSION_BYTES);
    const restored = parseTabSession(json);
    expect(restored.notes).toHaveLength(4000);
    expect(restored.edits).toHaveLength(20000);
  });
});
