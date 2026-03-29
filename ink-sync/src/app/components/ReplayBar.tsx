'use client';

import { useEffect, useRef, useState, useCallback, MutableRefObject } from 'react';
import { DrawElement } from './DrawingCanvas';

export interface ReplayEntry {
  elements: DrawElement[];
}

interface ReplayBarProps {
  entries: ReplayEntry[];
  onFrameChange: (elements: ReplayEntry['elements']) => void;
  onExit: () => void;
  imperativePanRef: MutableRefObject<((x: number, y: number) => void) | null>;
  imperativeZoomRef: MutableRefObject<((scale: number, cx?: number, cy?: number) => void) | null>;
  viewportWidth: number;
  viewportHeight: number;
  currentScale: number;
  currentPan: { x: number; y: number };
  initialScale: number;
  initialPan: { x: number; y: number };
}

const SPEEDS = [0.5, 1, 2, 4, 8];
const BASE_INTERVAL_MS = 400;
const EXPORT_FPS = 30;
const FIT_PADDING = 80;

export default function ReplayBar({
  entries,
  onFrameChange,
  onExit,
  imperativePanRef,
  imperativeZoomRef,
  viewportWidth,
  viewportHeight,
  currentScale,
  currentPan,
  initialScale,
  initialPan,
}: ReplayBarProps) {
  const [playing, setPlaying] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [hudHidden, setHudHidden] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const initialFrameEmitted = useRef(false);
  const playingRef = useRef(false);
  const frameIdxRef = useRef(0);
  const speedRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentScaleRef = useRef(currentScale);
  const currentPanRef = useRef(currentPan);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { frameIdxRef.current = frameIdx; }, [frameIdx]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { currentScaleRef.current = currentScale; }, [currentScale]);
  useEffect(() => { currentPanRef.current = currentPan; }, [currentPan]);

  // ── Auto-zoom: fit elements in view if they drift outside the viewport ─────

  const fitElementsInView = useCallback((elements: DrawElement[], instant = false) => {
    if (!elements.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      const pts = el.type === 'pen'
        ? (el.points ?? [])
        : [{ x: el.x1, y: el.y1 }, { x: el.x2 ?? el.x1, y: el.y2 ?? el.y1 }];
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
    }

    const worldW = maxX - minX || 1;
    const worldH = maxY - minY || 1;
    const availW = viewportWidth - FIT_PADDING * 2;
    const availH = viewportHeight - FIT_PADDING * 2;
    const targetScale = Math.min(availW / worldW, availH / worldH, 4);

    const pan = currentPanRef.current;
    const sc = currentScaleRef.current;
    const outOfView =
      minX * sc + pan.x < FIT_PADDING ||
      minY * sc + pan.y < FIT_PADDING ||
      maxX * sc + pan.x > viewportWidth - FIT_PADDING ||
      maxY * sc + pan.y > viewportHeight - FIT_PADDING;

    if (!outOfView) return;

    const worldCX = (minX + maxX) / 2;
    const worldCY = (minY + maxY) / 2;
    const targetPanX = viewportWidth / 2 - worldCX * targetScale;
    const targetPanY = viewportHeight / 2 - worldCY * targetScale;

    if (instant) {
      imperativeZoomRef.current?.(targetScale, viewportWidth / 2, viewportHeight / 2);
      imperativePanRef.current?.(targetPanX, targetPanY);
      return;
    }

    const startScale = currentScaleRef.current;
    const startPX = currentPanRef.current.x;
    const startPY = currentPanRef.current.y;
    const duration = 350;
    const t0 = performance.now();

    const animate = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      imperativeZoomRef.current?.(
        startScale + (targetScale - startScale) * e,
        viewportWidth / 2,
        viewportHeight / 2,
      );
      imperativePanRef.current?.(
        startPX + (targetPanX - startPX) * e,
        startPY + (targetPanY - startPY) * e,
      );
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [viewportWidth, viewportHeight, imperativePanRef, imperativeZoomRef]);

  // ── Emit frame — restore zoom on first frame, auto-fit on subsequent ───────

  useEffect(() => {
    const entry = entries[frameIdx];
    if (!entry) return;
    onFrameChange(entry.elements);

    if (!initialFrameEmitted.current) {
      initialFrameEmitted.current = true;
      // Restore exactly the zoom & pan the user had before entering replay
      imperativeZoomRef.current?.(initialScale, viewportWidth / 2, viewportHeight / 2);
      imperativePanRef.current?.(initialPan.x, initialPan.y);
      return;
    }

    fitElementsInView(entry.elements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIdx, entries]);

  // ── Playback timer ─────────────────────────────────────────────────────────

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!playingRef.current) return;
      const next = frameIdxRef.current + 1;
      if (next >= entries.length) { setPlaying(false); return; }
      frameIdxRef.current = next;
      setFrameIdx(next);
      scheduleNext();
    }, BASE_INTERVAL_MS / speedRef.current);
  }, [entries.length]);

  useEffect(() => {
    if (playing) scheduleNext();
    else if (timerRef.current) clearTimeout(timerRef.current);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, scheduleNext]);

  // ── Controls ───────────────────────────────────────────────────────────────

  const goTo = (idx: number) => {
    setPlaying(false);
    frameIdxRef.current = idx;
    setFrameIdx(idx);
  };

  const handlePlayPause = () => {
    if (frameIdx >= entries.length - 1) { goTo(0); setPlaying(true); }
    else setPlaying(p => !p);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => goTo(Number(e.target.value));

  // ── Video export — matches current playback speed ──────────────────────────

  const handleExport = useCallback(async () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) { alert('Canvas not found.'); return; }
    if (typeof MediaRecorder === 'undefined') {
      alert('Your browser does not support video recording. Please use Chrome or Edge.');
      return;
    }

    const mp4Type = 'video/mp4;codecs=avc1';
    const mimeType = MediaRecorder.isTypeSupported(mp4Type) ? mp4Type : 'video/webm;codecs=vp9';
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const exportIntervalMs = BASE_INTERVAL_MS / speedRef.current;

    setExporting(true);
    setExportProgress(0);
    setPlaying(false);

    const allEls = entries.flatMap(e => e.elements);
    fitElementsInView(allEls, true);
    await new Promise(r => setTimeout(r, 500));

    const stream = canvas.captureStream(EXPORT_FPS);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = ev => { if (ev.data.size > 0) chunks.push(ev.data); };
    recorder.start();

    for (let i = 0; i < entries.length; i++) {
      frameIdxRef.current = i;
      setFrameIdx(i);
      setExportProgress(Math.round((i / Math.max(entries.length - 1, 1)) * 100));
      onFrameChange(entries[i].elements);
      fitElementsInView(entries[i].elements, true);
      await new Promise(r => setTimeout(r, exportIntervalMs));
    }

    await new Promise(r => setTimeout(r, 800));
    recorder.stop();
    await new Promise<void>(res => { recorder.onstop = () => res(); });

    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inksync-replay.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    setExporting(false);
    setExportProgress(0);
  }, [entries, fitElementsInView, onFrameChange]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const progress = entries.length > 1 ? frameIdx / (entries.length - 1) : 0;
  const atStart = frameIdx === 0;
  const atEnd = frameIdx >= entries.length - 1;

  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 34, height: 34, borderRadius: 10,
    border: '1.5px solid var(--canvas-grid)',
    background: 'transparent', cursor: 'pointer',
    color: 'var(--ink)', transition: 'all 0.12s', flexShrink: 0,
  };

  return (
    <>
      {/* Accent border around viewport */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 190, pointerEvents: 'none',
        border: '3px solid var(--accent)', boxSizing: 'border-box',
        boxShadow: 'inset 0 0 40px rgba(108,99,255,0.12)',
      }} />

      {/* REPLAY badge */}
      {!hudHidden && (
        <div style={{
          position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 14px', background: 'var(--accent)', color: 'white',
          borderRadius: 100, fontFamily: 'DM Mono, monospace', fontSize: 11,
          fontWeight: 600, letterSpacing: '0.1em',
          boxShadow: '0 4px 20px rgba(108,99,255,0.4)',
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="4" stroke="white" strokeWidth="1.4"/>
            <path d="M4 3.5v3l2.5-1.5L4 3.5z" fill="white"/>
          </svg>
          REPLAY MODE
        </div>
      )}

      {/* Floating action buttons — always visible */}
      <div style={{
        position: 'fixed',
        bottom: hudHidden ? 24 : 136,
        right: 24, zIndex: 210,
        display: 'flex', gap: 6,
        transition: 'bottom 0.2s',
      }}>
        <button
          onClick={() => setHudHidden(h => !h)}
          title={hudHidden ? 'Show controls' : 'Hide controls'}
          style={{ ...btnBase, boxShadow: '0 2px 12px rgba(0,0,0,0.1)', background: 'var(--paper)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--canvas-grid)'; e.currentTarget.style.color = 'var(--ink)'; }}
        >
          {hudHidden ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="9" width="12" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M4 9V7M7 9V5M10 9V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="9" width="12" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2"/>
              <path d="M4 9V7M7 9V5M10 9V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.4"/>
            </svg>
          )}
        </button>

        <button
          onClick={onExit}
          title="Exit replay"
          style={{
            ...btnBase,
            border: '1.5px solid var(--danger)',
            color: 'var(--danger)',
            background: 'var(--paper)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger)'; e.currentTarget.style.color = 'white'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--paper)'; e.currentTarget.style.color = 'var(--danger)'; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Main controls bar */}
      {!hudHidden && (
        <div style={{
          position: 'fixed',
          bottom: 32,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 200,
          background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
          borderRadius: 20,
          boxShadow: '0 12px 48px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
          fontFamily: 'DM Mono, monospace',
          padding: '14px 20px',
          display: 'flex', flexDirection: 'column', gap: 12,
          minWidth: 540,
          opacity: exporting ? 0.7 : 1,
          pointerEvents: exporting ? 'none' : 'auto',
          transition: 'opacity 0.2s',
        }}>
          <style>{`
            .replay-scrubber {
              -webkit-appearance: none; appearance: none;
              width: 100%; height: 4px; border-radius: 2px;
              background: linear-gradient(to right,
                var(--accent) 0%, var(--accent) ${progress * 100}%,
                var(--canvas-grid) ${progress * 100}%, var(--canvas-grid) 100%);
              outline: none; cursor: pointer;
            }
            .replay-scrubber::-webkit-slider-thumb {
              -webkit-appearance: none;
              width: 16px; height: 16px; border-radius: 50%;
              background: var(--accent); border: 3px solid var(--paper);
              box-shadow: 0 0 0 2px var(--accent), 0 2px 8px rgba(108,99,255,0.4);
              cursor: grab; transition: transform 0.1s;
            }
            .replay-scrubber::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.2); }
            .rbtn { display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;border:1.5px solid var(--canvas-grid);background:transparent;cursor:pointer;color:var(--ink);transition:all 0.12s;flex-shrink:0; }
            .rbtn:hover:not(:disabled) { background:var(--chalk);border-color:var(--ink); }
            .rbtn:disabled { opacity:0.3;cursor:not-allowed; }
            .rbtn.primary { width:40px;height:40px;border-radius:12px;background:var(--accent);border-color:var(--accent);color:white;box-shadow:0 4px 16px rgba(108,99,255,0.35); }
            .rbtn.primary:hover:not(:disabled) { filter:brightness(1.1); }
            .rspeed { font-size:11px;font-weight:600;padding:5px 10px;border-radius:8px;border:1.5px solid var(--canvas-grid);background:var(--chalk);color:var(--accent);cursor:pointer;transition:all 0.12s;white-space:nowrap; }
            .rspeed:hover { border-color:var(--accent); }
          `}</style>

          {exporting && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, color: 'var(--accent)', whiteSpace: 'nowrap', minWidth: 100 }}>
                Exporting… {exportProgress}%
              </span>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--canvas-grid)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: 'var(--accent)',
                  width: `${exportProgress}%`, transition: 'width 0.15s',
                }} />
              </div>
            </div>
          )}

          {/* Scrubber */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 24, textAlign: 'right', flexShrink: 0 }}>
              {frameIdx}
            </span>
            <input
              type="range" className="replay-scrubber"
              min={0} max={entries.length - 1} step={1} value={frameIdx}
              onChange={handleScrub}
            />
            <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 24, flexShrink: 0 }}>
              {entries.length - 1}
            </span>
          </div>

          {/* Buttons row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 80 }}>
              stroke {frameIdx + 1} / {entries.length}
            </span>

            <div style={{ flex: 1 }} />

            <button className="rbtn" onClick={() => goTo(0)} disabled={atStart} title="Rewind to start">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 2v9M2 6.5L8.5 2v9L2 6.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <button className="rbtn" onClick={() => goTo(Math.max(0, frameIdx - 1))} disabled={atStart} title="Previous stroke">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M8.5 2.5L3.5 6.5l5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <button className="rbtn primary" onClick={handlePlayPause} title={playing ? 'Pause' : 'Play'}>
              {playing
                ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="2" width="3.5" height="10" rx="1" fill="white"/><rect x="8" y="2" width="3.5" height="10" rx="1" fill="white"/></svg>
                : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 2.5l8 4.5-8 4.5V2.5z" fill="white"/></svg>
              }
            </button>

            <button className="rbtn" onClick={() => goTo(Math.min(entries.length - 1, frameIdx + 1))} disabled={atEnd} title="Next stroke">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M4.5 2.5l5 4-5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <button className="rbtn" onClick={() => goTo(entries.length - 1)} disabled={atEnd} title="Skip to end">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M11 2v9M11 6.5L4.5 2v9L11 6.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <div style={{ flex: 1 }} />

            {/* Speed picker */}
            <div style={{ position: 'relative' }}>
              <button className="rspeed" onClick={() => setSpeedMenuOpen(o => !o)}>
                {speed}×
              </button>
              {speedMenuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 1 }} onClick={() => setSpeedMenuOpen(false)} />
                  <div style={{
                    position: 'absolute', bottom: 'calc(100% + 6px)', right: 0,
                    background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
                    borderRadius: 12, overflow: 'hidden',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 2,
                  }}>
                    {SPEEDS.map(s => (
                      <button key={s}
                        onClick={() => { setSpeed(s); speedRef.current = s; setSpeedMenuOpen(false); }}
                        style={{
                          display: 'block', width: '100%', padding: '7px 18px', border: 'none',
                          background: speed === s ? 'var(--chalk)' : 'transparent',
                          color: speed === s ? 'var(--accent)' : 'var(--ink)',
                          fontFamily: 'DM Mono, monospace', fontSize: 12,
                          fontWeight: speed === s ? 600 : 400,
                          cursor: 'pointer', textAlign: 'right', transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { if (speed !== s) e.currentTarget.style.background = 'var(--chalk)'; }}
                        onMouseLeave={e => { if (speed !== s) e.currentTarget.style.background = 'transparent'; }}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div style={{ width: 1, height: 20, background: 'var(--canvas-grid)', flexShrink: 0 }} />

            <button
              className="rbtn"
              onClick={handleExport}
              disabled={exporting}
              title={`Export replay at current speed (${speed}×)`}
              style={{ width: 'auto', padding: '0 12px', gap: 6, fontSize: 10, fontWeight: 600 }}
              onMouseEnter={e => { if (!exporting) { e.currentTarget.style.background = 'var(--chalk)'; e.currentTarget.style.borderColor = 'var(--ink)'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--canvas-grid)'; }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v7M3.5 5.5L6 8l2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <rect x="1" y="9.5" width="10" height="1.5" rx="0.75" fill="currentColor"/>
              </svg>
              {exporting ? `${exportProgress}%` : 'export'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}