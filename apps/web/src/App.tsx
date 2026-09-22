import type * as alphaTab from '@coderline/alphatab';
import {
  type ChangeEvent,
  type DragEvent,
  lazy,
  Suspense,
  useCallback,
  useRef,
  useState,
} from 'react';

import type {
  Gp8Input,
  ImportedScoreSummary,
} from './components/AlphaTabViewer';
import { AudioWorkspace } from './components/AudioWorkspace';
import { formatFileSize, getGp8FileError } from './features/gp8/gp8File';

const AlphaTabViewer = lazy(async () => {
  const module = await import('./components/AlphaTabViewer');
  return { default: module.AlphaTabViewer };
});

type ImportPhase = 'idle' | 'reading' | 'rendering' | 'ready' | 'error';

interface SelectedGp8File extends Gp8Input {
  name: string;
  size: number;
}

const phaseLabel: Record<ImportPhase, string> = {
  error: '读取失败',
  idle: '等待导入',
  reading: '正在读取',
  ready: '可播放',
  rendering: '正在渲染',
};

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="8.5" y="3" width="7" height="12" rx="3.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m8.5 6 9 6-9 6V6Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </svg>
  );
}

export function App() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const importGeneration = useRef(0);
  const [alphaTabApi, setAlphaTabApi] = useState<alphaTab.AlphaTabApi | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [file, setFile] = useState<SelectedGp8File | null>(null);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [score, setScore] = useState<ImportedScoreSummary | null>(null);

  const importFile = useCallback(async (candidate: File) => {
    const generation = ++importGeneration.current;
    const validationError = getGp8FileError(candidate);

    if (validationError) {
      setErrorMessage(validationError);
      setPhase('error');
      return;
    }

    setErrorMessage(null);
    setPhase('reading');
    setScore(null);

    try {
      const buffer = await candidate.arrayBuffer();
      if (generation !== importGeneration.current) return;
      setFile({
        buffer,
        id: crypto.randomUUID(),
        name: candidate.name,
        size: candidate.size,
      });
      setPhase('rendering');
    } catch {
      if (generation !== importGeneration.current) return;
      setErrorMessage('浏览器无法读取这个文件，请重新选择。');
      setPhase('error');
    }
  }, []);

  const handleInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0];

      if (selected) {
        void importFile(selected);
      }

      event.target.value = '';
    },
    [importFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragActive(false);
      const dropped = event.dataTransfer.files[0];

      if (dropped) {
        void importFile(dropped);
      }
    },
    [importFile],
  );

  const handleError = useCallback((message: string) => {
    setErrorMessage(message);
    setPhase('error');
  }, []);

  const handleRenderFinished = useCallback(() => setPhase('ready'), []);
  const handleRenderStarted = useCallback(() => setPhase('rendering'), []);
  const handleScoreLoaded = useCallback((summary: ImportedScoreSummary) => {
    setScore(summary);
  }, []);

  const showRecordingWorkspace = useCallback(() => {
    importGeneration.current++;
    alphaTabApi?.stop();
    setErrorMessage(null);
    setFile(null);
    setPhase('idle');
    setScore(null);

    window.requestAnimationFrame(() => {
      document
        .getElementById('live-session')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [alphaTabApi]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="TabRecord 首页">
          <span className="brand-mark" aria-hidden="true">
            TR
          </span>
          <span>TabRecord</span>
        </a>
      </header>

      <main className="workspace">
        <section className="workspace-heading">
          <div>
            <h1>{score?.title ?? '演奏时，TAB 就在生成'}</h1>
            <p className="subtitle">
              {score
                ? `${score.artist} · ${score.trackCount} 条轨道`
                : '上传音频或使用麦克风，将吉他单音旋律转成可修正的六线谱与 MIDI。也可以导入 Guitar Pro 8 乐谱，继续查看与播放。'}
            </p>
          </div>

          <div className="hero-actions">
            <button
              className="primary-button"
              type="button"
              onClick={showRecordingWorkspace}
            >
              <MicIcon />
              音频转 TAB
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              <UploadIcon />
              {file ? '更换 GP8' : '导入 GP8'}
            </button>
          </div>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".gp"
            onChange={handleInput}
          />
        </section>

        {file ? (
          <section className="score-card" aria-label="GP8 乐谱预览">
            <div className="score-toolbar">
              <div className="file-identity">
                <span className="file-icon" aria-hidden="true">
                  GP
                </span>
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatFileSize(file.size)} · 仅在本机读取</small>
                </span>
              </div>

              <div className="playback-actions">
                <span className={`phase phase-${phase}`}>
                  <span />
                  {phaseLabel[phase]}
                </span>
                <button
                  className="icon-button"
                  type="button"
                  disabled={phase !== 'ready' || !alphaTabApi}
                  onClick={() => alphaTabApi?.playPause()}
                >
                  <PlayIcon />
                  播放 / 暂停
                </button>
                <button
                  className="icon-button icon-button-quiet"
                  type="button"
                  disabled={phase !== 'ready' || !alphaTabApi}
                  onClick={() => alphaTabApi?.stop()}
                >
                  <StopIcon />
                  停止
                </button>
              </div>
            </div>

            {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

            <Suspense fallback={<div className="viewer-loading">正在加载乐谱引擎…</div>}>
              <AlphaTabViewer
                key={file.id}
                file={file}
                onApiReady={setAlphaTabApi}
                onError={handleError}
                onRenderFinished={handleRenderFinished}
                onRenderStarted={handleRenderStarted}
                onScoreLoaded={handleScoreLoaded}
              />
            </Suspense>
          </section>
        ) : (
          <section className="start-grid">
            <AudioWorkspace />

            <aside
              className={`import-card ${dragActive ? 'import-card-active' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <div className="import-icon">
                <UploadIcon />
              </div>
              <p className="eyebrow">CONTINUE A SCORE</p>
              <h2>继续已有乐谱</h2>
              <p>导入 Guitar Pro 8 `.gp` 文件，在同一页面模型中渲染、播放并继续编辑。</p>
              <button
                className="import-button"
                type="button"
                onClick={() => inputRef.current?.click()}
              >
                选择或拖入 GP8
              </button>
              <div className="privacy-note">
                <span aria-hidden="true">●</span>
                文件仅在当前浏览器读取
              </div>
              {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
            </aside>
          </section>
        )}

        <section className="milestone-strip" aria-label="当前里程碑">
          <div>
            <span>01</span>
            <p><strong>乐谱输入</strong>GP8 渲染与播放</p>
          </div>
          <div>
            <span>02</span>
            <p><strong>本地实验</strong>音频转 TAB 与 MIDI</p>
          </div>
          <div>
            <span>03</span>
            <p><strong>产品目标</strong>和弦识别与 GP8 写回</p>
          </div>
        </section>
      </main>
    </div>
  );
}
