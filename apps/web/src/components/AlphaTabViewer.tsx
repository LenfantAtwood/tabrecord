import * as alphaTab from '@coderline/alphatab';
import { useEffect, useRef } from 'react';

export interface ImportedScoreSummary {
  artist: string;
  title: string;
  trackCount: number;
}

export interface Gp8Input {
  buffer: ArrayBuffer;
  id: string;
}

interface AlphaTabViewerProps {
  file: Gp8Input;
  onApiReady: (api: alphaTab.AlphaTabApi | null) => void;
  onError: (message: string) => void;
  onRenderFinished: () => void;
  onRenderStarted: () => void;
  onScoreLoaded: (score: ImportedScoreSummary) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'alphaTab 无法读取这个 GP8 文件。';
}

export function AlphaTabViewer({
  file,
  onApiReady,
  onError,
  onRenderFinished,
  onRenderStarted,
  onScoreLoaded,
}: AlphaTabViewerProps) {
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const viewport = viewportRef.current;

    if (!host || !viewport) {
      return;
    }

    const api = new alphaTab.AlphaTabApi(host, {
      core: {
        fontDirectory: '/font/',
      },
      player: {
        enablePlayer: true,
        scrollElement: viewport,
        soundFont: '/soundfont/sonivox.sf2',
      },
    });

    api.error.on((error) => onError(getErrorMessage(error)));
    api.renderStarted.on(() => onRenderStarted());
    api.renderFinished.on(() => onRenderFinished());
    api.scoreLoaded.on((score) => {
      onScoreLoaded({
        artist: score.artist || '未知艺术家',
        title: score.title || '未命名乐谱',
        trackCount: score.tracks.length,
      });
    });

    apiRef.current = api;
    onApiReady(api);

    return () => {
      onApiReady(null);
      apiRef.current = null;
      api.destroy();
    };
  }, [onApiReady, onError, onRenderFinished, onRenderStarted, onScoreLoaded]);

  useEffect(() => {
    const api = apiRef.current;

    if (!api) {
      return;
    }

    try {
      const accepted = api.load(file.buffer.slice(0));

      if (!accepted) {
        onError('alphaTab 不支持这个文件；请确认它由 Guitar Pro 8 保存。');
      }
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }, [file, onError]);

  return (
    <div className="score-viewport" ref={viewportRef}>
      <div className="alphatab-host" ref={hostRef} />
    </div>
  );
}
