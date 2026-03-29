'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { DrawElement } from './DrawingCanvas';

interface ContextMenuProps {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  mode: 'selection' | 'ai';
  selectedIds: Set<string>;
  onClose: () => void;
  onElementsChange: (elements: DrawElement[]) => void;
  onElementsGenerated: (elements: DrawElement[]) => void;
  onElementsStream: (elements: DrawElement[]) => void;
  onSummarize: (elements: DrawElement[], screenX: number, screenY: number) => void;
  currentElements: DrawElement[];
}

type AIState = 'menu' | 'input' | 'generating';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSelectionCenter(ids: Set<string>, els: DrawElement[]) {
  const selected = els.filter(e => ids.has(e.id));
  if (!selected.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of selected) {
    const pts: { x: number; y: number }[] = [];
    if (el.type === 'pen') pts.push(...(el.points ?? []));
    else {
      pts.push({ x: el.x1, y: el.y1 });
      if (el.x2 !== undefined && el.y2 !== undefined) pts.push({ x: el.x2, y: el.y2 });
    }
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function flipElement(el: DrawElement, axis: 'h' | 'v', cx: number, cy: number): DrawElement {
  const fx = (x: number) => axis === 'h' ? 2 * cx - x : x;
  const fy = (y: number) => axis === 'v' ? 2 * cy - y : y;
  switch (el.type) {
    case 'pen':
      return { ...el, points: (el.points ?? []).map(p => ({ x: fx(p.x), y: fy(p.y) })) };
    case 'text':
      return { ...el, x1: fx(el.x1), y1: fy(el.y1) };
    default: {
      const nx1 = fx(el.x1), ny1 = fy(el.y1);
      const nx2 = fx(el.x2 ?? el.x1), ny2 = fy(el.y2 ?? el.y1);
      return { ...el, x1: Math.min(nx1, nx2), y1: Math.min(ny1, ny2), x2: Math.max(nx1, nx2), y2: Math.max(ny1, ny2) };
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContextMenu({
  x, y, canvasX, canvasY,
  mode, selectedIds,
  onClose,
  onElementsChange,
  onElementsGenerated,
  onElementsStream,
  onSummarize,
  currentElements,
}: ContextMenuProps) {
  const [aiState, setAIState] = useState<AIState>('menu');
  const [prompt, setPrompt] = useState('');
  const [aiError, setAIError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const generatedRef = useRef<DrawElement[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const idCounterRef = useRef(0);

  useEffect(() => {
    if (aiState === 'input') setTimeout(() => inputRef.current?.focus(), 30);
  }, [aiState]);

  const cancelRef = useRef(() => {});
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) cancelRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelRef.current(); };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const menuWidth = 230;
  const menuMaxHeight = 220;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const posX = x + menuWidth > vw ? x - menuWidth : x;
  const posY = y + menuMaxHeight > vh ? y - menuMaxHeight : y;

  // ── Selection actions ─────────────────────────────────────────────────────

  const handleFlip = useCallback((axis: 'h' | 'v') => {
    const center = getSelectionCenter(selectedIds, currentElements);
    if (!center) return;
    const next = currentElements.map(el =>
      selectedIds.has(el.id) ? flipElement(el, axis, center.cx, center.cy) : el
    );
    onElementsChange(next);
    onClose();
  }, [selectedIds, currentElements, onElementsChange, onClose]);

  const handleDelete = useCallback(() => {
    onElementsChange(currentElements.filter(el => !selectedIds.has(el.id)));
    onClose();
  }, [selectedIds, currentElements, onElementsChange, onClose]);

  const handleSummarize = useCallback(() => {
    const selected = currentElements.filter(el => selectedIds.has(el.id));
    if (!selected.length) return;
    onSummarize(selected, x, y);
    onClose();
  }, [selectedIds, currentElements, onSummarize, x, y, onClose]);

  // ── AI draw ────────────────────────────────────────────────────────────────

  const handleAIStop = useCallback((closeMenu = false) => {
    if (readerRef.current) { readerRef.current.cancel(); readerRef.current = null; }
    if (generatedRef.current.length > 0) {
      onElementsGenerated([...currentElements, ...generatedRef.current]);
      generatedRef.current = [];
    }
    if (closeMenu) onClose();
    else setAIState('input');
  }, [currentElements, onElementsGenerated, onClose]);

  cancelRef.current = () => {
    if (aiState === 'generating') handleAIStop(true);
    else onClose();
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setAIError('');
    setAIState('generating');
    generatedRef.current = [];

    try {
      const res = await fetch('/api/generate-drawing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, originX: canvasX, originY: canvasY }),
      });
      if (!res.ok || !res.body) throw new Error('API request failed');

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      readerRef.current = reader;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let extracted = true;
        while (extracted) {
          extracted = false;
          const start = buffer.indexOf('{');
          if (start === -1) break;
          let depth = 0, end = -1;
          for (let i = start; i < buffer.length; i++) {
            if (buffer[i] === '{') depth++;
            else if (buffer[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end === -1) break;
          const objStr = buffer.slice(start, end + 1);
          buffer = buffer.slice(end + 1);
          extracted = true;
          try {
            const el = JSON.parse(objStr) as DrawElement;
            el.id = `ai_${Date.now()}_${idCounterRef.current++}`;
            generatedRef.current = [...generatedRef.current, el];
            onElementsStream([...currentElements, ...generatedRef.current]);
          } catch { /* skip */ }
        }
      }

      if (generatedRef.current.length > 0) {
        onElementsGenerated([...currentElements, ...generatedRef.current]);
        generatedRef.current = [];
      }
      readerRef.current = null;
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error(err);
      setAIError('Something went wrong. Try again.');
      setAIState('input');
    }
  }, [prompt, canvasX, canvasY, currentElements, onElementsGenerated, onElementsStream, onClose]);

  // ── Shared styles ──────────────────────────────────────────────────────────

  const menuItemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', padding: '8px 12px', borderRadius: 9,
    border: 'none', background: 'transparent',
    cursor: 'pointer', textAlign: 'left',
    color: 'var(--ink)', fontSize: 12,
    fontFamily: 'DM Mono, monospace',
    transition: 'background 0.12s',
  };

  const iconBox = (bg = 'var(--chalk)', color = 'var(--ink)'): React.CSSProperties => ({
    width: 24, height: 24, borderRadius: 6, background: bg, color,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, flexShrink: 0,
    border: bg === 'var(--chalk)' ? '1px solid var(--canvas-grid)' : 'none',
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left: posX, top: posY, zIndex: 9999,
        background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
        borderRadius: 14, minWidth: menuWidth, overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        animation: 'contextMenuIn 0.15s ease forwards',
        fontFamily: 'DM Mono, monospace',
      }}
    >
      <style>{`
        @keyframes contextMenuIn {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.2); }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 0 0 var(--accent-glow); border-color: var(--accent); }
          50%       { box-shadow: 0 0 0 3px var(--accent-glow); border-color: var(--accent); }
        }
        .ctx-item:hover { background: var(--chalk) !important; }
        .ctx-danger:hover { background: rgba(255,107,107,0.08) !important; }
      `}</style>

      {/* ══ SELECTION — menu ══ */}
      {mode === 'selection' && (
        <div style={{ padding: 6 }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.12em', color: 'var(--muted)',
            padding: '5px 10px 7px', borderBottom: '1px solid var(--canvas-grid)', marginBottom: 4,
          }}>
            {selectedIds.size} SELECTED
          </div>

          {/* Flip H */}
          <button className="ctx-item" style={menuItemStyle} onClick={() => handleFlip('h')}>
            <span style={iconBox()}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M6.5 2v9M2 6.5l2.5-2.5v5L2 6.5zM11 6.5L8.5 4v5L11 6.5z"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <span style={{ fontSize: 12 }}>Flip Horizontal</span>
          </button>

          {/* Flip V */}
          <button className="ctx-item" style={menuItemStyle} onClick={() => handleFlip('v')}>
            <span style={iconBox()}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 6.5h9M6.5 2L4 4.5h5L6.5 2zM6.5 11L4 8.5h5L6.5 11z"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <span style={{ fontSize: 12 }}>Flip Vertical</span>
          </button>

          <div style={{ height: 1, background: 'var(--canvas-grid)', margin: '4px 10px' }} />

          {/* Summarize */}
          <button className="ctx-item" style={menuItemStyle} onClick={handleSummarize}>
            <span style={iconBox('var(--accent)', 'white')}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1.5 3h9M1.5 6h6M1.5 9h7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
            <div>
              <div style={{ fontWeight: 500, fontSize: 12 }}>Summarize</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>Describe this drawing</div>
            </div>
          </button>

          <div style={{ height: 1, background: 'var(--canvas-grid)', margin: '4px 10px' }} />

          {/* Delete */}
          <button className="ctx-item ctx-danger" style={menuItemStyle} onClick={handleDelete}>
            <span style={iconBox('rgba(255,107,107,0.12)', 'var(--danger)')}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 3h8M5 3V2h2v1M4.5 3v6.5M7.5 3v6.5M3 3l.5 7h5l.5-7"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>Delete</span>
          </button>
        </div>
      )}

      {/* ══ AI — menu ══ */}
      {mode === 'ai' && aiState === 'menu' && (
        <div style={{ padding: 6 }}>
          <button className="ctx-item" style={menuItemStyle} onClick={() => setAIState('input')}>
            <span style={iconBox('var(--accent)', 'white')}>✦</span>
            <div>
              <div style={{ fontWeight: 500 }}>Draw with AI</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>Describe what to draw</div>
            </div>
          </button>
        </div>
      )}

      {/* ══ AI — input ══ */}
      {mode === 'ai' && aiState === 'input' && (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            paddingBottom: 8, borderBottom: '1px solid var(--canvas-grid)',
          }}>
            <span style={iconBox('var(--accent)', 'white')}>✦</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)' }}>Draw with AI</span>
          </div>

          <input
            ref={inputRef}
            value={prompt}
            onChange={e => { setPrompt(e.target.value); setAIError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); if (e.key === 'Escape') onClose(); }}
            placeholder="a simple flow chart..."
            style={{
              background: 'var(--chalk)', border: '1.5px solid var(--canvas-grid)',
              borderRadius: 8, padding: '7px 10px',
              fontFamily: 'DM Mono, monospace', fontSize: 12,
              color: 'var(--ink)', outline: 'none', width: '100%',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.target.style.borderColor = 'var(--canvas-grid)')}
          />

          {aiError && <div style={{ fontSize: 10, color: 'var(--danger)', paddingLeft: 2 }}>{aiError}</div>}

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 8, border: 'none',
                background: prompt.trim() ? 'var(--ink)' : 'var(--canvas-grid)',
                color: prompt.trim() ? 'var(--canvas)' : 'var(--muted)',
                fontFamily: 'DM Mono, monospace', fontSize: 11,
                cursor: prompt.trim() ? 'pointer' : 'default',
                transition: 'all 0.15s', fontWeight: 500,
              }}
            >
              Generate ↵
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '7px 12px', borderRadius: 8,
                border: '1.5px solid var(--canvas-grid)',
                background: 'transparent', color: 'var(--muted)',
                fontFamily: 'DM Mono, monospace', fontSize: 11,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--ink)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--canvas-grid)')}
            >
              Esc
            </button>
          </div>
        </div>
      )}

      {/* ══ AI — generating ══ */}
      {mode === 'ai' && aiState === 'generating' && (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            paddingBottom: 8, borderBottom: '1px solid var(--canvas-grid)',
          }}>
            <span style={iconBox('var(--accent)', 'white')}>✦</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)' }}>Drawing...</span>
          </div>

          <div style={{
            background: 'var(--chalk)', border: '1.5px solid var(--accent)',
            borderRadius: 8, padding: '7px 10px',
            fontSize: 12, color: 'var(--muted)', fontFamily: 'DM Mono, monospace',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            animation: 'pulseGlow 1.5s ease infinite',
          }}>
            {prompt}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)',
                animation: `pulseDot 1.2s ease ${i * 0.2}s infinite`,
              }} />
            ))}
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>generating elements</span>
          </div>

          <button
            onClick={() => handleAIStop(true)}
            style={{
              width: '100%', padding: '7px 0', borderRadius: 8,
              border: '1.5px solid var(--danger)', background: 'transparent',
              color: 'var(--danger)', fontFamily: 'DM Mono, monospace',
              fontSize: 11, cursor: 'pointer', transition: 'all 0.15s', fontWeight: 500,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger)'; e.currentTarget.style.color = 'white'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--danger)'; }}
          >
            ■ Stop
          </button>
        </div>
      )}
    </div>
  );
}