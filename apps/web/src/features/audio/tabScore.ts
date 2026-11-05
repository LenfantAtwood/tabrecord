import type { AudioNoteEvent } from './transcription';

export const TAB_SCORE_VERSION = 1;
export const TAB_PPQ = 480;
export const TAB_GRID_TICKS = TAB_PPQ / 4;
export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40] as const;
const BAR_TICKS = TAB_PPQ * 4;
export const MAX_TAB_SESSION_BYTES = 5 * 1024 * 1024;
const MAX_NOTES = 4000;
const MAX_FINGERING_EDITS = 20000;

export interface TabPosition {
  /** 1 is high E; 6 is low E. */
  string: number;
  fret: number;
}

export interface TabNote extends AudioNoteEvent {
  id: string;
  startTick: number;
  durationTicks: number;
  tab: TabPosition;
  alternatives: TabPosition[];
  state: 'provisional' | 'committed' | 'locked';
  source: 'audio';
}

export interface FingeringEdit {
  noteId: string;
  from: TabPosition;
  to: TabPosition;
}

export interface TabScore {
  schemaVersion: 1;
  title: string;
  bpm: number;
  timeSignature: [4, 4];
  ppq: 480;
  tuning: number[];
  maxFrets: 24;
  capo: 0;
  durationSeconds: number;
  notes: TabNote[];
  edits: FingeringEdit[];
}

export interface BuildTabScoreOptions {
  bpm: number;
  title?: string;
  durationSeconds?: number;
  state?: 'provisional' | 'committed';
}

/** All feasible positions, ordered by fret, then string. Audio cannot identify a unique one. */
export function getTabPositions(midi: number): TabPosition[] {
  if (!Number.isInteger(midi)) return [];
  return STANDARD_TUNING.flatMap((open, index) => {
    const fret = midi - open;
    return fret >= 0 && fret <= 24 ? [{ string: index + 1, fret }] : [];
  }).sort((a, b) => a.fret - b.fret || a.string - b.string);
}

function positionCost(position: TabPosition): number {
  return position.fret * 0.08;
}

function transitionCost(from: TabPosition, to: TabPosition): number {
  // Open strings do not force the fretting hand to shift to the nut.
  const shift = from.fret === 0 || to.fret === 0 ? 0 : Math.abs(from.fret - to.fret);
  return shift * 0.65 + Math.abs(from.string - to.string) * 0.45;
}

function choosePositions(candidates: TabPosition[][]): TabPosition[] {
  if (candidates.length === 0) return [];
  const costs: number[][] = [];
  const parents: number[][] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    costs.push([]);
    parents.push([]);
    for (const current of candidates[index]!) {
      let best = positionCost(current);
      let parent = 0;
      if (index > 0) {
        best = Infinity;
        candidates[index - 1]!.forEach((previous, previousIndex) => {
          const cost = costs[index - 1]![previousIndex]! + transitionCost(previous, current)
            + positionCost(current);
          if (cost < best) {
            best = cost;
            parent = previousIndex;
          }
        });
      }
      costs[index]!.push(best);
      parents[index]!.push(parent);
    }
  }
  const last = costs[costs.length - 1]!;
  let selected = last.indexOf(Math.min(...last));
  const result: TabPosition[] = new Array(candidates.length);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    result[index] = { ...candidates[index]![selected]! };
    selected = parents[index]![selected]!;
  }
  return result;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validAudioNote(note: AudioNoteEvent): boolean {
  return boundedNumber(note.startSeconds, 0, 120) && boundedNumber(note.endSeconds, 0, 120)
    && note.endSeconds > note.startSeconds && Number.isInteger(note.midi)
    && getTabPositions(note.midi).length > 0 && boundedNumber(note.confidence, 0, 1)
    && Number.isInteger(note.velocity) && boundedNumber(note.velocity, 1, 127);
}

export function buildTabScore(audioNotes: AudioNoteEvent[], options: BuildTabScoreOptions): TabScore {
  if (!Number.isInteger(options.bpm) || !boundedNumber(options.bpm, 40, 240)) {
    throw new Error('BPM 必须是 40–240 之间的整数。');
  }
  if (audioNotes.length > MAX_NOTES || audioNotes.some((note) => !validAudioNote(note))) {
    throw new Error('音符数据无效；仅支持标准六弦 0–24 品、120 秒以内的单音片段。');
  }
  const sorted = [...audioNotes].sort((a, b) => a.startSeconds - b.startSeconds);
  const durationSeconds = options.durationSeconds ?? sorted.at(-1)?.endSeconds ?? 0;
  if (!boundedNumber(durationSeconds, 0, 120) || sorted.some((note) => note.endSeconds > durationSeconds)) {
    throw new Error('会话时长与音符数据不一致。');
  }
  const candidates = sorted.map((note) => getTabPositions(note.midi));
  const positions = choosePositions(candidates);
  let endTick = 0;
  const notes = sorted.map((note, index): TabNote => {
    const startTick = Math.max(endTick, Math.round(note.startSeconds * options.bpm / 60 * 4) * TAB_GRID_TICKS);
    endTick = Math.max(startTick + TAB_GRID_TICKS,
      Math.round(note.endSeconds * options.bpm / 60 * 4) * TAB_GRID_TICKS);
    return {
      ...note,
      id: `note-${index + 1}`,
      startTick,
      durationTicks: endTick - startTick,
      tab: positions[index]!,
      alternatives: candidates[index]!,
      state: options.state ?? 'committed',
      source: 'audio',
    };
  });
  return {
    schemaVersion: TAB_SCORE_VERSION,
    title: (options.title ?? 'Audio → TAB').slice(0, 200),
    bpm: options.bpm,
    timeSignature: [4, 4],
    ppq: TAB_PPQ,
    tuning: [...STANDARD_TUNING],
    maxFrets: 24,
    capo: 0,
    durationSeconds,
    notes,
    edits: [],
  };
}

function equalPosition(a: TabPosition, b: TabPosition): boolean {
  return a.string === b.string && a.fret === b.fret;
}

export function setNotePosition(score: TabScore, noteId: string, position: TabPosition): TabScore {
  const target = score.notes.find((note) => note.id === noteId);
  if (!target || !getTabPositions(target.midi).some((candidate) => equalPosition(candidate, position))) {
    throw new Error('弦品必须对应当前音高，并位于标准六弦 0–24 品内。');
  }
  if (equalPosition(target.tab, position)) return score;
  if (score.edits.length >= MAX_FINGERING_EDITS) {
    throw new Error('当前会话已达到 20,000 次弦品修改上限。现有结果仍可保存或导出；请开始新会话后继续修改。');
  }
  return {
    ...score,
    notes: score.notes.map((note) => note.id === noteId
      ? { ...note, tab: { ...position }, state: 'locked' } : note),
    edits: [...score.edits, { noteId, from: { ...target.tab }, to: { ...position } }],
  };
}

/** Total notation time includes trailing silence and completes the final 4/4 bar. */
export function getScoreEndTick(score: TabScore): number {
  const noteEnd = score.notes.at(-1);
  const end = Math.max(noteEnd ? noteEnd.startTick + noteEnd.durationTicks : 0,
    Math.round(score.durationSeconds * score.bpm / 60 * 4) * TAB_GRID_TICKS);
  return Math.max(BAR_TICKS, Math.ceil(end / BAR_TICKS) * BAR_TICKS);
}

function safeTexTitle(title: string): string {
  return Array.from(title, (character) => character.charCodeAt(0) < 32 || character === '"'
    || character === '\\' ? ' ' : character).join('').slice(0, 200);
}

/** alphaTab-specific notation is kept at this adapter boundary. */
export function toAlphaTex(score: TabScore): string {
  const bars: string[][] = [[]];
  let tick = 0;
  function append(until: number, note?: TabNote) {
    let isContinuation = false;
    while (tick < until) {
      const remaining = Math.min(until - tick, BAR_TICKS - tick % BAR_TICKS);
      const ticks = [1920, 960, 480, 240, 120].find((value) => value <= remaining) ?? TAB_GRID_TICKS;
      const duration = BAR_TICKS / ticks;
      const content = note ? `${isContinuation ? '-' : note.tab.fret}.${note.tab.string}` : 'r';
      const dynamics = note && !isContinuation
        ? ` {dy ${['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'][Math.min(7, Math.floor(note.velocity / 16))]}}`
        : '';
      bars[bars.length - 1]!.push(`${content}.${duration}${dynamics}`);
      tick += ticks;
      isContinuation = true;
      if (tick % BAR_TICKS === 0) bars.push([]);
    }
  }
  for (const note of score.notes) {
    append(note.startTick);
    append(note.startTick + note.durationTicks, note);
  }
  append(getScoreEndTick(score));
  return `\\title "${safeTexTitle(score.title)}"\n\\artist "TabRecord · 本地单音实验"\n\\tempo ${score.bpm}\n\\instrument 25\n\\tuning (E4 B3 G3 D3 A2 E2)\n.\n\\ts 4 4\n${bars.filter((bar) => bar.length).map((bar) => bar.join(' ')).join(' |\n')}`;
}

function variableLength(value: number): number[] {
  const result = [value & 0x7f];
  while ((value = Math.floor(value / 128)) > 0) result.unshift((value & 0x7f) | 0x80);
  return result;
}

function chunk(name: string, bytes: number[]): number[] {
  return [...Array.from(name, (character) => character.charCodeAt(0)),
    (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255,
    (bytes.length >>> 8) & 255, bytes.length & 255, ...bytes];
}

/** Standard MIDI File Type 1, conductor + acoustic steel-string guitar, exact snapshot timing. */
export function exportMidi(score: TabScore): Uint8Array {
  const microseconds = Math.round(60_000_000 / score.bpm);
  const conductor = [0, 0xff, 0x51, 3, (microseconds >>> 16) & 255,
    (microseconds >>> 8) & 255, microseconds & 255,
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
    ...variableLength(getScoreEndTick(score)), 0xff, 0x2f, 0];
  const track = [0, 0xc0, 25];
  let lastTick = 0;
  for (const note of score.notes) {
    track.push(...variableLength(note.startTick - lastTick), 0x90, note.midi, note.velocity);
    track.push(...variableLength(note.durationTicks), 0x80, note.midi, 0);
    lastTick = note.startTick + note.durationTicks;
  }
  track.push(...variableLength(getScoreEndTick(score) - lastTick), 0xff, 0x2f, 0);
  return new Uint8Array([
    ...chunk('MThd', [0, 1, 0, 2, (TAB_PPQ >>> 8) & 255, TAB_PPQ & 255]),
    ...chunk('MTrk', conductor), ...chunk('MTrk', track),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPosition(value: unknown, midi?: number): value is TabPosition {
  return isRecord(value) && Number.isInteger(value.string) && boundedNumber(value.string, 1, 6)
    && Number.isInteger(value.fret) && boundedNumber(value.fret, 0, 24)
    && (midi === undefined || STANDARD_TUNING[value.string - 1]! + value.fret === midi);
}

/** Structural + semantic validation at the untrusted, versioned JSON boundary. */
export function parseTabSession(json: string): TabScore {
  if (json.length > MAX_TAB_SESSION_BYTES || new TextEncoder().encode(json).byteLength > MAX_TAB_SESSION_BYTES) {
    throw new Error('会话文件不能超过 5 MB。');
  }
  const value: unknown = JSON.parse(json);
  const fail = () => { throw new Error('会话格式无效或版本不受支持；仅支持 TabRecord 单音会话 v1。'); };
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.title !== 'string'
    || value.title.length > 200 || !Number.isInteger(value.bpm) || !boundedNumber(value.bpm, 40, 240)
    || value.ppq !== TAB_PPQ || JSON.stringify(value.timeSignature) !== '[4,4]'
    || JSON.stringify(value.tuning) !== JSON.stringify(STANDARD_TUNING)
    || value.maxFrets !== 24 || value.capo !== 0 || !boundedNumber(value.durationSeconds, 0, 120)
    || !Array.isArray(value.notes) || value.notes.length > MAX_NOTES
    || !Array.isArray(value.edits) || value.edits.length > MAX_FINGERING_EDITS) return fail();
  let endTick = 0;
  let startSeconds = 0;
  const ids = new Set<string>();
  for (const item of value.notes) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 100 || ids.has(item.id)
      || !validAudioNote(item as unknown as AudioNoteEvent)
      || (item.startSeconds as number) < startSeconds || (item.endSeconds as number) > value.durationSeconds
      || !Number.isInteger(item.startTick) || !boundedNumber(item.startTick, endTick, 1_000_000)
      || item.startTick % TAB_GRID_TICKS !== 0 || !Number.isInteger(item.durationTicks)
      || !boundedNumber(item.durationTicks, TAB_GRID_TICKS, 1_000_000)
      || item.durationTicks % TAB_GRID_TICKS !== 0 || !isPosition(item.tab, item.midi as number)
      || !Array.isArray(item.alternatives)
      || JSON.stringify(item.alternatives) !== JSON.stringify(getTabPositions(item.midi as number))
      || !['provisional', 'committed', 'locked'].includes(item.state as string)
      || item.source !== 'audio') return fail();
    const expectedStart = Math.max(endTick,
      Math.round((item.startSeconds as number) * value.bpm / 60 * 4) * TAB_GRID_TICKS);
    const expectedEnd = Math.max(expectedStart + TAB_GRID_TICKS,
      Math.round((item.endSeconds as number) * value.bpm / 60 * 4) * TAB_GRID_TICKS);
    if (item.startTick !== expectedStart || item.durationTicks !== expectedEnd - expectedStart) return fail();
    ids.add(item.id);
    startSeconds = item.startSeconds as number;
    endTick = item.startTick + item.durationTicks;
  }
  const notesById = new Map((value.notes as TabNote[]).map((note) => [note.id, note]));
  const lastEdits = new Map<string, TabPosition>();
  for (const edit of value.edits) {
    if (!isRecord(edit) || typeof edit.noteId !== 'string' || !ids.has(edit.noteId)) return fail();
    const note = notesById.get(edit.noteId)!;
    if (!isPosition(edit.from, note.midi) || !isPosition(edit.to, note.midi)
      || note.state !== 'locked') return fail();
    const previous = lastEdits.get(edit.noteId);
    if (previous && !equalPosition(previous, edit.from)) return fail();
    lastEdits.set(edit.noteId, edit.to);
  }
  for (const note of notesById.values()) {
    const edited = lastEdits.get(note.id);
    if ((note.state === 'locked' && !edited) || (edited && !equalPosition(edited, note.tab))) return fail();
  }
  // Return only defined schema fields, dropping arbitrary imported object properties.
  const score = value as unknown as TabScore;
  return {
    schemaVersion: 1, title: score.title, bpm: score.bpm, timeSignature: [4, 4], ppq: TAB_PPQ,
    tuning: [...STANDARD_TUNING], maxFrets: 24, capo: 0, durationSeconds: score.durationSeconds,
    notes: score.notes.map((note) => ({
      id: note.id, startSeconds: note.startSeconds, endSeconds: note.endSeconds,
      midi: note.midi, confidence: note.confidence, velocity: note.velocity,
      startTick: note.startTick, durationTicks: note.durationTicks,
      tab: { string: note.tab.string, fret: note.tab.fret }, alternatives: getTabPositions(note.midi),
      state: note.state, source: 'audio',
    })),
    edits: score.edits.map((edit) => ({ noteId: edit.noteId,
      from: { string: edit.from.string, fret: edit.from.fret }, to: { string: edit.to.string, fret: edit.to.fret } })),
  };
}

export function serializeTabSession(score: TabScore): string {
  const validated = parseTabSession(JSON.stringify(score));
  const pretty = JSON.stringify(validated, null, 2);
  // Whitespace must not make a valid saved session too large for our own importer.
  return new TextEncoder().encode(pretty).byteLength <= MAX_TAB_SESSION_BYTES
    ? pretty : JSON.stringify(validated);
}
