import type * as alphaTab from '@coderline/alphatab';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { decodeAudioFile, startMicrophone, type MicrophoneCapture } from '../features/audio/audioInput';
import { buildTabScore, exportMidi, getTabPositions, MAX_TAB_SESSION_BYTES, parseTabSession, serializeTabSession, setNotePosition, toAlphaTex, type TabScore } from '../features/audio/tabScore';
import { MAX_AUDIO_DURATION_SECONDS } from '../features/audio/transcription';
import { TranscriptionClient } from '../features/audio/transcriptionClient';

const Viewer = lazy(async () => ({ default: (await import('./AlphaTabViewer')).AlphaTabViewer }));
type Phase = 'idle' | 'requesting' | 'recording' | 'analyzing' | 'ready' | 'error';
const labels: Record<Phase, string> = {
  idle: '等待音频', requesting: '等待麦克风权限', recording: '正在录音 · 暂定结果',
  analyzing: '正在分析音频', ready: '转录完成 · 可修正弦品', error: '请检查输入',
};

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function joinChunks(chunks: Float32Array[]) {
  const samples = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
  return samples;
}

const ignoreSummary = () => {};

export function AudioWorkspace() {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [bpm, setBpm] = useState(120);
  const [score, setScore] = useState<TabScore | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [api, setApi] = useState<alphaTab.AlphaTabApi | null>(null);
  const [rendered, setRendered] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sessionInput = useRef<HTMLInputElement>(null);
  const capture = useRef<MicrophoneCapture | null>(null);
  const microphoneAbort = useRef<AbortController | null>(null);
  const worker = useRef<TranscriptionClient | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const generation = useRef(0);
  const previewBusy = useRef(false);
  const finishRef = useRef<() => Promise<void>>(async () => {});
  const busy = phase === 'requesting' || phase === 'recording' || phase === 'analyzing';

  useEffect(() => () => {
    generation.current++;
    microphoneAbort.current?.abort();
    capture.current?.dispose();
    worker.current?.dispose();
  }, []);

  const reset = useCallback(() => {
    generation.current++;
    microphoneAbort.current?.abort();
    capture.current?.dispose();
    capture.current = null;
    worker.current?.dispose();
    worker.current = null;
    chunks.current = [];
    previewBusy.current = false;
    setPhase('idle');
    setScore(null);
    setMessage(null);
    setSeconds(0);
    setLevel(0);
    setElapsedMs(null);
    setRendered(false);
    api?.stop();
  }, [api]);

  const fail = useCallback((error: unknown) => {
    setMessage(error instanceof Error ? error.message : '音频处理失败，请重试。');
    setPhase('error');
    setLevel(0);
  }, []);

  const analyze = useCallback(async (samples: Float32Array, sampleRate: number, title: string, id: number) => {
    worker.current?.dispose();
    const client = new TranscriptionClient();
    worker.current = client;
    const durationSeconds = samples.length / sampleRate;
    try {
      const result = await client.analyze(samples, sampleRate);
      if (id !== generation.current) return;
      setScore(buildTabScore(result.notes, { bpm, title, durationSeconds, state: 'committed' }));
      setElapsedMs(result.elapsedMs);
      setSeconds(durationSeconds);
      setPhase('ready');
      setMessage(result.notes.length ? null : '没有识别到稳定的吉他单音。请提高输入音量，使用清晰的单音演奏，再试一次。');
    } catch (error) {
      if (id === generation.current) fail(error);
    } finally {
      client.dispose();
      if (worker.current === client) worker.current = null;
    }
  }, [bpm, fail]);

  const loadAudio = async (file: File) => {
    reset();
    const id = generation.current;
    setPhase('analyzing');
    try {
      const decoded = await decodeAudioFile(file);
      if (id !== generation.current) return;
      await analyze(decoded.samples, decoded.sampleRate, file.name, id);
    } catch (error) {
      if (id === generation.current) fail(error);
    }
  };

  const finish = useCallback(async () => {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    const id = ++generation.current;
    worker.current?.dispose();
    setPhase('analyzing');
    setLevel(0);
    try {
      await current.stop();
      if (id !== generation.current) return;
      const samples = joinChunks(chunks.current);
      chunks.current = [];
      await analyze(samples, current.sampleRate, '吉他录音', id);
    } catch (error) {
      if (id === generation.current) fail(error);
    } finally {
      current.dispose();
    }
  }, [analyze, fail]);

  useEffect(() => { finishRef.current = finish; }, [finish]);

  const record = async () => {
    reset();
    setPhase('requesting');
    const id = generation.current;
    let sampleCount = 0;
    let lastPreview = 0;
    const controller = new AbortController();
    microphoneAbort.current = controller;
    try {
      const current = await startMicrophone((samples, sampleRate) => {
        // Include the final flushed block even after finish advances generation.
        chunks.current.push(samples);
        sampleCount += samples.length;
        if (id !== generation.current) return;
        const durationSeconds = sampleCount / sampleRate;
        setSeconds(durationSeconds);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        setLevel(Math.min(1, rms * 5));
        if (durationSeconds - lastPreview < 2 || previewBusy.current) return;
        lastPreview = durationSeconds;
        previewBusy.current = true;
        const client = worker.current ?? new TranscriptionClient();
        worker.current = client;
        void client.analyze(joinChunks(chunks.current), sampleRate).then((result) => {
          if (id !== generation.current) return;
          setScore(buildTabScore(result.notes, { bpm, title: '吉他录音 · 暂定', durationSeconds, state: 'provisional' }));
          setElapsedMs(result.elapsedMs);
        }).catch((error: unknown) => {
          if (id === generation.current) setMessage(error instanceof Error ? error.message : '预览暂时不可用，停止后将重新分析。');
        }).finally(() => { if (id === generation.current) previewBusy.current = false; });
      }, () => { void finishRef.current(); }, (error) => {
        if (id !== generation.current) return;
        generation.current++;
        worker.current?.dispose();
        capture.current = null;
        chunks.current = [];
        setScore(null);
        fail(new Error(error));
      }, controller.signal);
      if (id !== generation.current) { current.dispose(); return; }
      capture.current = current;
      setPhase('recording');
    } catch (error) {
      if (id === generation.current) fail(error);
    }
  };

  useEffect(() => {
    if (phase !== 'recording') return;
    const handleVisibility = () => {
      if (document.hidden) {
        setMessage('页面进入后台，已停止录音并分析当前片段。');
        void finishRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [phase]);

  const loadSession = async (file: File) => {
    reset();
    const id = generation.current;
    try {
      if (file.size > MAX_TAB_SESSION_BYTES) throw new Error('会话文件不能超过 5 MB。');
      const restored = parseTabSession(await file.text());
      if (id !== generation.current) return;
      setScore(restored);
      setBpm(restored.bpm);
      setSeconds(restored.durationSeconds);
      setPhase('ready');
    } catch (error) { if (id === generation.current) fail(error); }
  };

  const onRenderStart = useCallback(() => setRendered(false), []);
  const onRenderDone = useCallback(() => setRendered(true), []);
  const onViewerError = useCallback((error: string) => { setRendered(false); setMessage(error); }, []);
  const scoreAction = (action: () => void) => {
    try { action(); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : '无法完成操作，请重试。'); }
  };
  const tex = score?.notes.length ? toAlphaTex(score) : null;

  return (
    <section className="audio-workspace" id="live-session" aria-label="音频转 TAB">
      <div className="audio-heading">
        <div><p className="eyebrow">AUDIO → TAB</p><h2>把一段旋律变成六线谱</h2></div>
        <span className="experimental-badge">实验性 · 单音</span>
      </div>
      <p className="audio-description">适合清晰的单把吉他旋律。标准调弦 E A D G B E，固定 4/4 拍，按十六分音符量化。和弦、扫弦、伴奏混音暂不支持；弦品是可修正的建议。</p>
      <label className="experiment-toggle"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => { setEnabled(event.target.checked); if (!event.target.checked) reset(); }} />启用本地音频转录实验</label>
      {enabled && <>
        <div className="audio-controls">
          <label className="bpm-input">BPM<input type="number" min={40} max={240} step={1} value={bpm} disabled={busy || !!score} onChange={(event) => setBpm(Math.max(40, Math.min(240, Math.round(Number(event.target.value) || 120))))} /></label>
          <button className="primary-button" disabled={busy} onClick={() => fileInput.current?.click()}>选择音频文件</button>
          {phase === 'recording'
            ? <button className="stop-recording" onClick={() => { void finish(); }}>停止并生成 TAB</button>
            : <button className="secondary-button" disabled={busy} onClick={() => { void record(); }}>开始麦克风录音</button>}
          <button className="text-button" disabled={busy} onClick={() => sessionInput.current?.click()}>恢复会话</button>
          {(busy || score || phase === 'error') && <button className="text-button" onClick={reset}>{busy ? '取消' : '清空 / 新会话'}</button>}
        </div>
        <input ref={fileInput} className="visually-hidden" type="file" accept=".wav,.mp3,.m4a,.aac,.ogg,.flac,.webm,audio/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadAudio(file); }} />
        <input ref={sessionInput} className="visually-hidden" type="file" accept=".json,.tabrecord.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadSession(file); }} />
        <p className="audio-help">最长 {MAX_AUDIO_DURATION_SECONDS} 秒，文件不超过 25 MB。音频仅在浏览器内处理；麦克风只在点击录音后开启。</p>
        <div className="audio-status" role="status" aria-live="polite">
          <strong>{labels[phase]}</strong><span>{seconds.toFixed(1)} 秒 · {score?.notes.length ?? 0} 个音符</span>
          {elapsedMs !== null && <span>最近分析 {(elapsedMs / 1000).toFixed(2)} 秒{phase === 'recording' && elapsedMs > 2000 ? ' · 分析有延迟' : ''}</span>}
        </div>
        {phase === 'recording' && <><meter className="audio-meter" min={0} max={1} value={level} aria-label="麦克风输入音量" /><p className="audio-help">录音中结果每约 2 秒尝试更新，停止后统一确认。请保持页面在前台。</p></>}
        {message && <div className="error-banner" role="alert">{message}</div>}
        {score && score.notes.length > 0 && <>
          <div className="score-toolbar audio-score-toolbar">
            <strong>{score.title}</strong>
            <div className="playback-actions">
              <button className="icon-button" disabled={!rendered || !api || busy} onClick={() => api?.playPause()}>播放 / 暂停</button>
              <button className="icon-button icon-button-quiet" disabled={!api || busy} onClick={() => api?.stop()}>停止播放</button>
              <button className="icon-button" disabled={busy} onClick={() => scoreAction(() => download(exportMidi(score).slice().buffer, 'tabrecord.mid', 'audio/midi'))}>导出 MIDI</button>
              <button className="icon-button icon-button-quiet" disabled={busy} onClick={() => scoreAction(() => download(serializeTabSession(score), 'session.tabrecord.json', 'application/json'))}>保存会话</button>
            </div>
          </div>
          {tex && <Suspense fallback={<div className="viewer-loading">正在加载乐谱引擎…</div>}><Viewer tex={tex} onApiReady={setApi} onError={onViewerError} onRenderStarted={onRenderStart} onRenderFinished={onRenderDone} onScoreLoaded={ignoreSummary} /></Suspense>}
          <details className="note-editor"><summary>查看音符与修正弦品（{score.notes.length}）</summary>
            <p className="audio-help">原始时间保留在会话中。修正后锁定弦品；录音期间暂定结果不可编辑。</p>
            <div className="note-table-scroll"><table><thead><tr><th>音符</th><th>原始时间</th><th>置信度</th><th>弦 / 品</th><th>状态</th></tr></thead><tbody>
              {score.notes.map((note, index) => <tr key={note.id}><td>{index + 1} · MIDI {note.midi}</td><td>{note.startSeconds.toFixed(2)}–{note.endSeconds.toFixed(2)} s</td><td>{Math.round(note.confidence * 100)}%</td><td>
                <select aria-label={`音符 ${index + 1} 的弦品`} disabled={busy} value={`${note.tab.string}:${note.tab.fret}`} onChange={(event) => {
                  const [string, fret] = event.target.value.split(':').map(Number);
                  api?.stop();
                  if (string !== undefined && fret !== undefined) scoreAction(() => setScore(setNotePosition(score, note.id, { string, fret })));
                }}>{getTabPositions(note.midi).map((position) => <option key={position.string} value={`${position.string}:${position.fret}`}>{position.string} 弦 / {position.fret} 品</option>)}</select>
              </td><td>{note.state === 'locked' ? '已修正' : note.state === 'provisional' ? '暂定' : '已确认'}</td></tr>)}
            </tbody></table></div>
          </details>
        </>}
      </>}
    </section>
  );
}
