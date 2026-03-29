'use client';

import { useEffect, useRef, useState, useCallback, MutableRefObject } from 'react';
import { DrawElement } from './DrawingCanvas';

interface SummaryPanelProps {
  elements: DrawElement[];
  initialScreenX: number;
  initialScreenY: number;
  panOffsetRef: MutableRefObject<{ x: number; y: number }>;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onLocate: () => void;
}

interface Summary {
  title: string;
  description: string;
  points: string[];
}

const PANEL_WIDTH = 300;
const PANEL_MAX_HEIGHT = 380;

export default function SummaryPanel({
  elements,
  initialScreenX,
  initialScreenY,
  panOffsetRef,
  zIndex,
  onFocus,
  onClose,
  onLocate,
}: SummaryPanelProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Store position in canvas-space so it moves with the canvas when panning.
  // Convert initial screen coords to canvas-space once on mount.
  const [canvasPos, setCanvasPos] = useState(() => {
    const pan = panOffsetRef.current;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    // Pick a good initial screen position then convert to canvas-space
    const sx = initialScreenX + PANEL_WIDTH + 16 > vw
      ? initialScreenX - PANEL_WIDTH - 8
      : initialScreenX + 8;
    const sy = initialScreenY + PANEL_MAX_HEIGHT > vh
      ? Math.max(8, vh - PANEL_MAX_HEIGHT - 8)
      : Math.max(8, initialScreenY);
    return { x: sx - pan.x, y: sy - pan.y };
  });
  const canvasPosRef = useRef(canvasPos);
  canvasPosRef.current = canvasPos;

  // Force re-render when pan changes so screen position updates
  const [, tick] = useState(0);
  useEffect(() => {
    let raf: number;
    let lastX = panOffsetRef.current.x;
    let lastY = panOffsetRef.current.y;
    const loop = () => {
      const { x, y } = panOffsetRef.current;
      if (x !== lastX || y !== lastY) {
        lastX = x; lastY = y;
        tick(n => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [panOffsetRef]);

  // Convert canvas-space to screen for rendering
  const pan = panOffsetRef.current;
  const rawScreenX = canvasPos.x + pan.x;
  const rawScreenY = canvasPos.y + pan.y;

  // Clamp to viewport
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(rawScreenX, vw - PANEL_WIDTH - 8));
  const top  = Math.max(8, Math.min(rawScreenY, vh - (minimized ? 44 : PANEL_MAX_HEIGHT) - 8));

  // Drag — moves canvas-space position
  const isDragging = useRef(false);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    onFocus();
    isDragging.current = true;
    const startMx = e.clientX;
    const startMy = e.clientY;
    const startCx = canvasPosRef.current.x;
    const startCy = canvasPosRef.current.y;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      // Mouse delta is in screen-space; canvas-space delta is the same
      // (pan doesn't change during drag, so 1:1 mapping)
      const next = {
        x: startCx + ev.clientX - startMx,
        y: startCy + ev.clientY - startMy,
      };
      canvasPosRef.current = next;
      setCanvasPos({ ...next });
    };

    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onFocus]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onLocate();
  }, [onLocate]);

  // Fetch summary on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/summarize-drawing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (!cancelled) setSummary(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const handleCopy = () => {
    if (!summary) return;
    const text = `${summary.title}\n\n${summary.description}\n\n${summary.points.map(p => `• ${p}`).join('\n')}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const grabStyle: React.CSSProperties = {
    cursor: 'grab',
    userSelect: 'none',
  };

  // ── Minimized pill ────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <div
        onMouseDown={e => { onFocus(); handleDragStart(e); }}
        onDoubleClick={handleDoubleClick}
        style={{
          position: 'fixed', left, top, zIndex,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 8px',
          background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
          borderRadius: 100,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          fontFamily: 'DM Mono, monospace',
          animation: 'summaryIn 0.15s ease forwards',
          maxWidth: PANEL_WIDTH,
          ...grabStyle,
        }}
      >
        <style>{`
          @keyframes summaryIn {
            from { opacity: 0; transform: translateY(4px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>

        <span style={{
          width: 18, height: 18, borderRadius: '50%',
          background: 'var(--accent)', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, flexShrink: 0, pointerEvents: 'none',
        }}>✦</span>

        <span style={{
          fontSize: 11, color: 'var(--ink)', fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: 160, pointerEvents: 'none',
        }}>
          {summary ? summary.title : error ? 'Error' : 'Summarizing...'}
        </span>

        <div style={{ display: 'flex', gap: 3 }} onMouseDown={e => e.stopPropagation()}>
          <button
            onClick={() => setMinimized(false)}
            title="Expand"
            style={{
              width: 20, height: 20, borderRadius: '50%', border: 'none',
              background: 'var(--chalk)', cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)', fontSize: 10, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--ink)'; e.currentTarget.style.color = 'white'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--chalk)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >↑</button>

          <button
            onClick={onClose}
            title="Close"
            style={{
              width: 20, height: 20, borderRadius: '50%', border: 'none',
              background: 'var(--chalk)', cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)', fontSize: 13, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger)'; e.currentTarget.style.color = 'white'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--chalk)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >×</button>
        </div>
      </div>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────────
  return (
    <div
      onMouseDown={() => onFocus()}
      style={{
        position: 'fixed', left, top, width: PANEL_WIDTH, zIndex,
        background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)',
        fontFamily: 'DM Mono, monospace',
        animation: 'summaryIn 0.2s ease forwards',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes summaryIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .skeleton {
          background: linear-gradient(90deg, var(--chalk) 25%, var(--canvas-grid) 50%, var(--chalk) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.4s ease infinite;
          border-radius: 6px;
        }
      `}</style>

      {/* Draggable header */}
      <div
        onMouseDown={handleDragStart}
        onDoubleClick={handleDoubleClick}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 10px 10px 14px',
          borderBottom: '1px solid var(--canvas-grid)',
          ...grabStyle,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, pointerEvents: 'none' }}>
          <span style={{
            width: 20, height: 20, borderRadius: 5,
            background: 'var(--accent)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, flexShrink: 0,
          }}>✦</span>
          <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--muted)' }}>
            SUMMARY · {elements.length} ELEMENTS
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4 }} onMouseDown={e => e.stopPropagation()}>
          <button
            onClick={() => setMinimized(true)}
            title="Minimize"
            style={{
              width: 24, height: 24, borderRadius: 6, border: 'none',
              background: 'transparent', cursor: 'pointer', color: 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--chalk)'; e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
          >−</button>
          <button
            onClick={onClose}
            title="Close"
            style={{
              width: 24, height: 24, borderRadius: 6, border: 'none',
              background: 'transparent', cursor: 'pointer', color: 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,107,107,0.1)'; e.currentTarget.style.color = 'var(--danger)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
          >×</button>
        </div>
      </div>

      <div style={{
        fontSize: 9, color: 'var(--muted)', textAlign: 'center',
        padding: '4px 0 0', letterSpacing: '0.06em', opacity: 0.7,
      }}>
        double-click header to locate on canvas
      </div>

      {/* Body */}
      <div style={{ padding: '10px 14px 10px' }}>
        {!summary && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skeleton" style={{ height: 18, width: '60%' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="skeleton" style={{ height: 12, width: '100%' }} />
              <div className="skeleton" style={{ height: 12, width: '85%' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {[90, 75, 80].map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="skeleton" style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0 }} />
                  <div className="skeleton" style={{ height: 11, width: `${w}%` }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
            Couldn't summarize. Try again.
          </div>
        )}

        {summary && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
              {summary.title}
            </div>
            <div style={{
              fontSize: 11, color: 'var(--muted)', lineHeight: 1.6,
              paddingBottom: 10, borderBottom: '1px solid var(--canvas-grid)',
            }}>
              {summary.description}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {summary.points.map((point, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--accent)', flexShrink: 0, marginTop: 5,
                  }} />
                  <span style={{ fontSize: 11, color: 'var(--ink)', lineHeight: 1.5 }}>{point}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {summary && (
        <div style={{ padding: '4px 14px 12px' }}>
          <button
            onClick={handleCopy}
            style={{
              width: '100%', padding: '7px 0', borderRadius: 8,
              border: `1.5px solid ${copied ? 'var(--success)' : 'var(--canvas-grid)'}`,
              background: copied ? 'rgba(78,205,196,0.1)' : 'transparent',
              color: copied ? 'var(--success)' : 'var(--muted)',
              fontFamily: 'DM Mono, monospace', fontSize: 11,
              cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => { if (!copied) { e.currentTarget.style.borderColor = 'var(--ink)'; e.currentTarget.style.color = 'var(--ink)'; } }}
            onMouseLeave={e => { if (!copied) { e.currentTarget.style.borderColor = 'var(--canvas-grid)'; e.currentTarget.style.color = 'var(--muted)'; } }}
          >
            {copied
              ? <><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> copied!</>
              : <><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="4" y="1" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M1 4.5V10a1 1 0 001 1h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> copy as text</>
            }
          </button>
        </div>
      )}
    </div>
  );
}