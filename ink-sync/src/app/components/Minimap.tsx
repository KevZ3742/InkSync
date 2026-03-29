'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { DrawElement } from './DrawingCanvas';

interface MinimapProps {
  elements: DrawElement[];
  panOffset: { x: number; y: number };
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
  onNavigate: (panX: number, panY: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

const MINIMAP_W = 260;
const MINIMAP_H = 170;
const PADDING = 20;

function getWorldBounds(elements: DrawElement[]) {
  if (!elements.length) return { minX: -400, minY: -300, maxX: 400, maxY: 300 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const pts: { x: number; y: number }[] =
      el.type === 'pen'
        ? (el.points ?? [])
        : [{ x: el.x1, y: el.y1 }, { x: el.x2 ?? el.x1, y: el.y2 ?? el.y1 }];
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const pw = (maxX - minX) * 0.1 + PADDING;
  const ph = (maxY - minY) * 0.1 + PADDING;
  return { minX: minX - pw, minY: minY - ph, maxX: maxX + pw, maxY: maxY + ph };
}

export default function Minimap({
  elements,
  panOffset,
  scale,
  viewportWidth,
  viewportHeight,
  onNavigate,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const worldBounds = getWorldBounds(
    elements.length > 0
      ? elements
      : [{ id: '_', type: 'line' as const, x1: -viewportWidth / 2, y1: -viewportHeight / 2, x2: viewportWidth / 2, y2: viewportHeight / 2, color: '', strokeWidth: 0 }]
  );

  const worldW = worldBounds.maxX - worldBounds.minX;
  const worldH = worldBounds.maxY - worldBounds.minY;
  const mmScale = Math.min(MINIMAP_W / worldW, MINIMAP_H / worldH);
  const mmW = worldW * mmScale;
  const mmH = worldH * mmScale;
  const mmOriginX = (MINIMAP_W - mmW) / 2;
  const mmOriginY = (MINIMAP_H - mmH) / 2;

  const toMM = useCallback((wx: number, wy: number) => ({
    x: mmOriginX + (wx - worldBounds.minX) * mmScale,
    y: mmOriginY + (wy - worldBounds.minY) * mmScale,
  }), [mmOriginX, mmOriginY, mmScale, worldBounds.minX, worldBounds.minY]);

  const fromMM = useCallback((mx: number, my: number) => ({
    wx: worldBounds.minX + (mx - mmOriginX) / mmScale,
    wy: worldBounds.minY + (my - mmOriginY) / mmScale,
  }), [mmOriginX, mmOriginY, mmScale, worldBounds.minX, worldBounds.minY]);

  // ── Canvas render ─────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isCollapsed) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_W * dpr;
    canvas.height = MINIMAP_H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#fafaf7';
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    ctx.save();
    for (const el of elements) {
      if (!el.color) continue;
      ctx.strokeStyle = el.color;
      ctx.fillStyle = el.color;
      ctx.lineWidth = Math.max(0.5, el.strokeWidth * mmScale * 0.5);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = el.opacity ?? 1;

      switch (el.type) {
        case 'pen': {
          const pts = el.points ?? [];
          if (pts.length < 2) break;
          ctx.beginPath();
          const p0 = toMM(pts[0].x, pts[0].y);
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < pts.length; i++) {
            const pp = toMM(pts[i - 1].x, pts[i - 1].y);
            const pc = toMM(pts[i].x, pts[i].y);
            ctx.quadraticCurveTo(pp.x, pp.y, (pp.x + pc.x) / 2, (pp.y + pc.y) / 2);
          }
          ctx.stroke();
          break;
        }
        case 'line':
        case 'arrow': {
          const a = toMM(el.x1, el.y1);
          const b = toMM(el.x2 ?? el.x1, el.y2 ?? el.y1);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          break;
        }
        case 'rect': {
          const tl = toMM(Math.min(el.x1, el.x2 ?? el.x1), Math.min(el.y1, el.y2 ?? el.y1));
          const br = toMM(Math.max(el.x1, el.x2 ?? el.x1), Math.max(el.y1, el.y2 ?? el.y1));
          ctx.beginPath();
          ctx.roundRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y, 1);
          ctx.stroke();
          break;
        }
        case 'ellipse': {
          const cx = (el.x1 + (el.x2 ?? el.x1)) / 2;
          const cy = (el.y1 + (el.y2 ?? el.y1)) / 2;
          const rx = Math.abs((el.x2 ?? el.x1) - el.x1) / 2;
          const ry = Math.abs((el.y2 ?? el.y1) - el.y1) / 2;
          const c = toMM(cx, cy);
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, Math.max(rx * mmScale, 1), Math.max(ry * mmScale, 1), 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'text': {
          if (!el.text) break;
          const p = toMM(el.x1, el.y1);
          ctx.font = `${Math.max(4, el.strokeWidth * 6 * mmScale)}px monospace`;
          ctx.globalAlpha = (el.opacity ?? 1) * 0.8;
          ctx.fillText(el.text.slice(0, 10), p.x, p.y);
          break;
        }
      }
    }
    ctx.restore();

    // Viewport rectangle
    const vpWorldX = -panOffset.x / scale;
    const vpWorldY = -panOffset.y / scale;
    const vpWorldW = viewportWidth / scale;
    const vpWorldH = viewportHeight / scale;
    const vpMM = toMM(vpWorldX, vpWorldY);
    const vpMMW = vpWorldW * mmScale;
    const vpMMH = vpWorldH * mmScale;
    const clampedX = Math.max(0, vpMM.x);
    const clampedY = Math.max(0, vpMM.y);
    const clampedW = Math.min(vpMMW - (clampedX - vpMM.x), MINIMAP_W - clampedX);
    const clampedH = Math.min(vpMMH - (clampedY - vpMM.y), MINIMAP_H - clampedY);

    ctx.save();
    ctx.fillStyle = 'rgba(108,99,255,0.08)';
    ctx.fillRect(clampedX, clampedY, clampedW, clampedH);
    ctx.strokeStyle = 'rgba(108,99,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(clampedX, clampedY, clampedW, clampedH);
    ctx.restore();

  }, [elements, panOffset, scale, viewportWidth, viewportHeight, isCollapsed, toMM, mmScale]);

  // ── Navigation ────────────────────────────────────────────────────────────

  const navigate = useCallback((mx: number, my: number) => {
    const { wx, wy } = fromMM(mx, my);
    onNavigate(-(wx * scale) + viewportWidth / 2, -(wy * scale) + viewportHeight / 2);
  }, [fromMM, scale, viewportWidth, viewportHeight, onNavigate]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    setIsDragging(true);
    navigate(e.clientX - rect.left, e.clientY - rect.top);
  }, [navigate]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    e.preventDefault();
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    navigate(e.clientX - rect.left, e.clientY - rect.top);
  }, [isDragging, navigate]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  // ── Zoom display ──────────────────────────────────────────────────────────
  const pct = Math.round(scale * 100);
  const atOne = Math.abs(scale - 1) < 0.01;

  const zoomBtnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--ink)',
    transition: 'background 0.12s',
    flexShrink: 0,
    width: 32,
    height: 30,
    borderRadius: 0,
  };

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: 24,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        fontFamily: 'DM Mono, monospace',
        animation: 'slideUp 0.3s ease forwards',
        width: MINIMAP_W,
      }}
    >
      {/* Header */}
      <div
        onClick={() => setIsCollapsed(c => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          background: 'var(--paper)',
          border: '1.5px solid var(--canvas-grid)',
          borderRadius: '10px 10px 0 0',
          cursor: 'pointer',
          transition: 'border-color 0.15s',
          userSelect: 'none',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--canvas-grid)'; }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ color: 'var(--accent)', flexShrink: 0 }}>
          <rect x="0.75" y="0.75" width="3.5" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="6.75" y="0.75" width="3.5" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="0.75" y="6.75" width="3.5" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="6.75" y="6.75" width="3.5" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--muted)', flex: 1 }}>MINIMAP</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ color: 'var(--muted)', transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Minimap canvas */}
      {!isCollapsed && (
        <div style={{
          width: MINIMAP_W,
          height: MINIMAP_H,
          background: 'var(--paper)',
          border: '1.5px solid var(--canvas-grid)',
          borderTop: 'none',
          overflow: 'hidden',
          cursor: isDragging ? 'grabbing' : 'crosshair',
          position: 'relative',
        }}>
          <canvas
            ref={canvasRef}
            width={MINIMAP_W}
            height={MINIMAP_H}
            style={{ display: 'block', width: MINIMAP_W, height: MINIMAP_H }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
          {elements.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 4, right: 5,
              fontSize: 9, color: 'var(--muted)', pointerEvents: 'none', letterSpacing: '0.05em',
            }}>
              {elements.length} el
            </div>
          )}
          {elements.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <span style={{ fontSize: 10, color: 'var(--muted)', opacity: 0.45 }}>empty canvas</span>
            </div>
          )}
        </div>
      )}

      {/* Zoom bar — always visible, fused to bottom */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--paper)',
        border: '1.5px solid var(--canvas-grid)',
        borderTop: 'none',
        borderRadius: '0 0 10px 10px',
        overflow: 'hidden',
      }}>
        {/* Zoom out */}
        <button
          onClick={e => { e.stopPropagation(); onZoomOut(); }}
          disabled={scale <= 0.1}
          title="Zoom out (Ctrl −)"
          style={{
            ...zoomBtnBase,
            opacity: scale <= 0.1 ? 0.3 : 1,
            cursor: scale <= 0.1 ? 'not-allowed' : 'pointer',
            borderRight: '1px solid var(--canvas-grid)',
          }}
          onMouseEnter={e => { if (scale > 0.1) (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M3 4.5h3M7.5 7.5l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>

        {/* % reset button */}
        <button
          onClick={e => { e.stopPropagation(); onZoomReset(); }}
          title="Reset to 100% (Ctrl 0)"
          style={{
            flex: 1,
            height: 30,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'DM Mono, monospace',
            fontSize: 11,
            fontWeight: atOne ? 400 : 600,
            color: atOne ? 'var(--muted)' : 'var(--accent)',
            letterSpacing: '0.03em',
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {pct}%
        </button>

        {/* Zoom in */}
        <button
          onClick={e => { e.stopPropagation(); onZoomIn(); }}
          disabled={scale >= 4}
          title="Zoom in (Ctrl =)"
          style={{
            ...zoomBtnBase,
            opacity: scale >= 4 ? 0.3 : 1,
            cursor: scale >= 4 ? 'not-allowed' : 'pointer',
            borderLeft: '1px solid var(--canvas-grid)',
          }}
          onMouseEnter={e => { if (scale < 4) (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M3 4.5h3M4.5 3v3M7.5 7.5l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}