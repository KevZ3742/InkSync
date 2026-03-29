'use client';

import { useEffect, useRef, useCallback, useState, MutableRefObject } from 'react';
import { recognizeShape, buildShapeElement } from '../utils/shapeRecognition';

export type ElementType = 'pen' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text';

export interface DrawElement {
  id: string;
  type: ElementType;
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  points?: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
  text?: string;
  roughness?: number;
  opacity?: number;
}

interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface DrawingCanvasProps {
  elements: DrawElement[];
  onElementsChange: (elements: DrawElement[]) => void;
  onElementsSilentUpdate: (elements: DrawElement[]) => void;
  activeTool: ElementType | 'select' | 'eraser' | 'pan';
  activeColor: string;
  strokeWidth: number;
  remoteCursors: RemoteCursor[];
  onCursorMove: (x: number, y: number) => void;
  onCursorLeave: () => void;
  onSelectionChange?: (ids: Set<string>) => void;
  onPanOffsetChange?: (x: number, y: number) => void;
  onScaleChange?: (scale: number) => void;
  imperativePanRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
  imperativeZoomRef?: React.MutableRefObject<((scale: number, cx?: number, cy?: number) => void) | null>;
  smartShapeEnabled?: boolean;
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
interface Bounds { x: number; y: number; w: number; h: number; }

// ── Shape snap flash animation ─────────────────────────────────────────────────
interface SnapFlash {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  startTime: number;
}

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
  e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
  sw: 'nesw-resize', w: 'ew-resize',
};

const HS = 7;
const HH = 10;
const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

export default function DrawingCanvas({
  elements,
  onElementsChange,
  onElementsSilentUpdate,
  activeTool,
  activeColor,
  strokeWidth,
  remoteCursors,
  onCursorMove,
  onCursorLeave,
  onSelectionChange,
  onPanOffsetChange,
  onScaleChange,
  imperativePanRef,
  imperativeZoomRef,
  smartShapeEnabled = true,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentElement, setCurrentElement] = useState<DrawElement | null>(null);
  const idCounter = useRef(0);
  const genId = () => `el_${Date.now()}_${idCounter.current++}`;

  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);

  // ── Snap flash state ─────────────────────────────────────────────────────────
  const [snapFlashes, setSnapFlashes] = useState<SnapFlash[]>([]);
  const snapFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSnapFlash = useCallback((el: DrawElement) => {
    let x: number, y: number, w: number, h: number;
    if (el.type === 'line' || el.type === 'arrow') {
      const x2 = el.x2 ?? el.x1, y2 = el.y2 ?? el.y1;
      x = Math.min(el.x1, x2) - 20;
      y = Math.min(el.y1, y2) - 20;
      w = Math.abs(x2 - el.x1) + 40;
      h = Math.abs(y2 - el.y1) + 40;
    } else {
      const x2 = el.x2 ?? el.x1, y2 = el.y2 ?? el.y1;
      x = Math.min(el.x1, x2) - 12;
      y = Math.min(el.y1, y2) - 12;
      w = Math.abs(x2 - el.x1) + 24;
      h = Math.abs(y2 - el.y1) + 24;
    }

    const flash: SnapFlash = {
      id: `flash_${Date.now()}`,
      x, y, w, h,
      type: el.type,
      startTime: Date.now(),
    };

    setSnapFlashes(prev => [...prev, flash]);
    setTimeout(() => {
      setSnapFlashes(prev => prev.filter(f => f.id !== flash.id));
    }, 600);
  }, []);

  const updatePan = useCallback((x: number, y: number) => {
    const next = { x, y };
    setPanOffset(next);
    panOffsetRef.current = next;
    onPanOffsetChange?.(x, y);
  }, [onPanOffsetChange]);

  const updateScale = useCallback((newScale: number, centerX?: number, centerY?: number) => {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    const canvas = canvasRef.current;
    const cx = centerX ?? (canvas ? canvas.offsetWidth / 2 : 0);
    const cy = centerY ?? (canvas ? canvas.offsetHeight / 2 : 0);
    const oldScale = scaleRef.current;
    const scaleDelta = clamped / oldScale;
    const newPanX = cx - scaleDelta * (cx - panOffsetRef.current.x);
    const newPanY = cy - scaleDelta * (cy - panOffsetRef.current.y);
    scaleRef.current = clamped;
    setScale(clamped);
    panOffsetRef.current = { x: newPanX, y: newPanY };
    setPanOffset({ x: newPanX, y: newPanY });
    onPanOffsetChange?.(newPanX, newPanY);
    onScaleChange?.(clamped);
  }, [onPanOffsetChange, onScaleChange]);

  useEffect(() => {
    if (imperativePanRef) imperativePanRef.current = updatePan;
    return () => { if (imperativePanRef) imperativePanRef.current = null; };
  }, [imperativePanRef, updatePan]);

  useEffect(() => {
    if (imperativeZoomRef) imperativeZoomRef.current = updateScale;
    return () => { if (imperativeZoomRef) imperativeZoomRef.current = null; };
  }, [imperativeZoomRef, updateScale]);

  useEffect(() => { panOffsetRef.current = panOffset; }, [panOffset]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);

  const [marquee, setMarquee] = useState<Bounds | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const isMarqueeRef = useRef(false);

  const isMoveRef = useRef(false);
  const moveStart = useRef<{ x: number; y: number } | null>(null);
  const moveSnapshot = useRef<DrawElement[]>([]);

  const isResizeRef = useRef(false);
  const resizeHandle = useRef<HandleId | null>(null);
  const resizeStart = useRef<{ x: number; y: number } | null>(null);
  const resizeSnapshot = useRef<DrawElement[]>([]);
  const resizeOrigBounds = useRef<Bounds | null>(null);

  const [dragCursor, setDragCursor] = useState<string | null>(null);

  const [textInput, setTextInput] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const textRef = useRef<HTMLInputElement>(null);

  const elementsRef = useRef(elements);
  useEffect(() => { elementsRef.current = elements; }, [elements]);

  useEffect(() => {
    if (activeTool !== 'select') {
      setSelectedIds(new Set());
      setMarquee(null);
    }
  }, [activeTool]);

  const getCanvasPos = useCallback((e: MouseEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      x: (sx - panOffsetRef.current.x) / scaleRef.current,
      y: (sy - panOffsetRef.current.y) / scaleRef.current,
    };
  }, []);

  // ── Geometry helpers ──────────────────────────────────────────────────────

  function getSelectionBounds(ids: Set<string>, els: DrawElement[]): Bounds | null {
    const allBounds = els.filter(e => ids.has(e.id)).map(getElementBounds).filter(Boolean) as Bounds[];
    if (!allBounds.length) return null;
    const x = Math.min(...allBounds.map(b => b.x));
    const y = Math.min(...allBounds.map(b => b.y));
    const x2 = Math.max(...allBounds.map(b => b.x + b.w));
    const y2 = Math.max(...allBounds.map(b => b.y + b.h));
    return { x, y, w: x2 - x, h: y2 - y };
  }

  function getHandlePos(b: Bounds, h: HandleId): { x: number; y: number } {
    switch (h) {
      case 'nw': return { x: b.x,           y: b.y };
      case 'n':  return { x: b.x + b.w / 2, y: b.y };
      case 'ne': return { x: b.x + b.w,     y: b.y };
      case 'e':  return { x: b.x + b.w,     y: b.y + b.h / 2 };
      case 'se': return { x: b.x + b.w,     y: b.y + b.h };
      case 's':  return { x: b.x + b.w / 2, y: b.y + b.h };
      case 'sw': return { x: b.x,           y: b.y + b.h };
      case 'w':  return { x: b.x,           y: b.y + b.h / 2 };
    }
  }

  function hitTestHandles(pos: { x: number; y: number }, b: Bounds): HandleId | null {
    const all: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const h of all) {
      const hp = getHandlePos(b, h);
      if (Math.abs(pos.x - hp.x) <= HH && Math.abs(pos.y - hp.y) <= HH) return h;
    }
    return null;
  }

  function computeNewBounds(orig: Bounds, handle: HandleId, dx: number, dy: number): Bounds {
    let { x, y, w, h } = orig;
    switch (handle) {
      case 'nw': x += dx; y += dy; w -= dx; h -= dy; break;
      case 'n':            y += dy;           h -= dy; break;
      case 'ne':      y += dy; w += dx; h -= dy; break;
      case 'e':                w += dx;              break;
      case 'se':               w += dx; h += dy; break;
      case 's':                          h += dy; break;
      case 'sw': x += dx;      w -= dx; h += dy; break;
      case 'w':  x += dx;      w -= dx;          break;
    }
    if (w < 4) { if (handle.includes('w')) x = orig.x + orig.w - 4; w = 4; }
    if (h < 4) { if (handle.includes('n')) y = orig.y + orig.h - 4; h = 4; }
    return { x, y, w, h };
  }

  function transformElement(el: DrawElement, origB: Bounds, newB: Bounds): DrawElement {
    const sx = origB.w > 0 ? newB.w / origB.w : 1;
    const sy = origB.h > 0 ? newB.h / origB.h : 1;
    const mx = (x: number) => newB.x + (x - origB.x) * sx;
    const my = (y: number) => newB.y + (y - origB.y) * sy;
    switch (el.type) {
      case 'pen':
        return { ...el, points: (el.points ?? []).map(p => ({ x: mx(p.x), y: my(p.y) })) };
      case 'line': case 'arrow': case 'rect': case 'ellipse':
        return { ...el, x1: mx(el.x1), y1: my(el.y1), x2: mx(el.x2 ?? el.x1), y2: my(el.y2 ?? el.y1) };
      case 'text':
        return { ...el, x1: mx(el.x1), y1: my(el.y1) };
      default: return el;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(scale, scale);

    const allEls = currentElement ? [...elements, currentElement] : elements;

    for (const el of allEls) {
      ctx.save();
      ctx.globalAlpha = el.opacity ?? 1;
      ctx.strokeStyle = el.color;
      ctx.fillStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawElement(ctx, el);
      ctx.restore();
    }

    for (const el of elements) {
      if (!selectedIds.has(el.id)) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(108,99,255,0.4)';
      ctx.lineWidth = el.strokeWidth + 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.4;
      drawElementStroke(ctx, el);
      ctx.restore();
    }

    if (marquee && (Math.abs(marquee.w) > 2 || Math.abs(marquee.h) > 2)) {
      ctx.save();
      ctx.strokeStyle = 'rgba(108,99,255,0.85)';
      ctx.fillStyle = 'rgba(108,99,255,0.06)';
      ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([6 / scale, 3 / scale]);
      const bx = marquee.w < 0 ? marquee.x + marquee.w : marquee.x;
      const by = marquee.h < 0 ? marquee.y + marquee.h : marquee.y;
      ctx.fillRect(bx, by, Math.abs(marquee.w), Math.abs(marquee.h));
      ctx.strokeRect(bx, by, Math.abs(marquee.w), Math.abs(marquee.h));
      ctx.restore();
    }

    if (selectedIds.size > 0) {
      const sb = getSelectionBounds(selectedIds, elements);
      if (sb) {
        const pad = 12 / scale;
        const pb: Bounds = { x: sb.x - pad, y: sb.y - pad, w: sb.w + pad * 2, h: sb.h + pad * 2 };

        ctx.save();
        ctx.strokeStyle = 'rgba(108,99,255,0.85)';
        ctx.fillStyle = 'rgba(108,99,255,0.03)';
        ctx.lineWidth = 1.5 / scale;
        ctx.setLineDash([5 / scale, 3 / scale]);
        ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
        ctx.strokeRect(pb.x, pb.y, pb.w, pb.h);
        ctx.restore();

        const handles: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        const hSize = HS / scale;
        for (const h of handles) {
          const hp = getHandlePos(pb, h);
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = 'rgb(108,99,255)';
          ctx.lineWidth = 2 / scale;
          ctx.setLineDash([]);
          ctx.shadowColor = 'rgba(108,99,255,0.3)';
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.roundRect(hp.x - hSize, hp.y - hSize, hSize * 2, hSize * 2, 3 / scale);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }, [elements, currentElement, panOffset, scale, selectedIds, marquee]);

  // ── Wheel zoom ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      updateScale(scaleRef.current * delta, cx, cy);
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [updateScale]);

  // ── Middle mouse pan ───────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      setIsPanning(true);
      setDragCursor('grabbing');
      panStart.current = { x: e.clientX - panOffsetRef.current.x, y: e.clientY - panOffsetRef.current.y };
    };
    const onMove = (e: MouseEvent) => {
      if (!isPanning) return;
      updatePan(e.clientX - panStart.current.x, e.clientY - panStart.current.y);
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 1) return;
      setIsPanning(false);
      setDragCursor(null);
    };
    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning, updatePan]);

  // ── Delete key ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.size > 0) {
        onElementsChange(elementsRef.current.filter(el => !selectedIdsRef.current.has(el.id)));
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onElementsChange]);

  // ── Mouse down ─────────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) return;
    if (e.button === 2) return;

    if (activeTool === 'pan') {
      setIsPanning(true);
      setDragCursor('grabbing');
      panStart.current = { x: e.clientX - panOffsetRef.current.x, y: e.clientY - panOffsetRef.current.y };
      return;
    }

    const pos = getCanvasPos(e);

    if (activeTool === 'text') {
      const rect = canvasRef.current!.getBoundingClientRect();
      setTextInput({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
      setTimeout(() => textRef.current?.focus(), 50);
      return;
    }

    if (activeTool === 'eraser') {
      const hit = findElementAt(pos.x, pos.y, elements);
      if (hit) onElementsChange(elements.filter(el => el.id !== hit.id));
      return;
    }

    if (activeTool === 'select') {
      const curIds = selectedIdsRef.current;

      if (curIds.size > 0) {
        const sb = getSelectionBounds(curIds, elements);
        if (sb) {
          const pad = 12 / scaleRef.current;
          const pb: Bounds = { x: sb.x - pad, y: sb.y - pad, w: sb.w + pad * 2, h: sb.h + pad * 2 };
          const handle = hitTestHandles(pos, pb);
          if (handle) {
            isResizeRef.current = true;
            resizeHandle.current = handle;
            resizeStart.current = pos;
            resizeOrigBounds.current = pb;
            resizeSnapshot.current = elements.filter(el => curIds.has(el.id));
            setDragCursor(HANDLE_CURSORS[handle]);
            return;
          }
        }
      }

      const hit = findElementAt(pos.x, pos.y, elements);

      if (hit && curIds.has(hit.id)) {
        isMoveRef.current = true;
        moveStart.current = pos;
        moveSnapshot.current = elements.filter(el => curIds.has(el.id));
        setDragCursor('move');
        return;
      }

      if (hit) {
        const newIds = e.shiftKey
          ? new Set([...curIds, hit.id])
          : new Set([hit.id]);
        setSelectedIds(newIds);
        isMoveRef.current = true;
        moveStart.current = pos;
        moveSnapshot.current = elements.filter(el => newIds.has(el.id));
        setDragCursor('move');
        return;
      }

      if (!e.shiftKey) setSelectedIds(new Set());
      isMarqueeRef.current = true;
      marqueeStart.current = pos;
      setMarquee({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }

    setIsDrawing(true);
    const newEl: DrawElement = {
      id: genId(),
      type: activeTool as ElementType,
      x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y,
      color: activeColor, strokeWidth,
      points: activeTool === 'pen' ? [pos] : undefined,
    };
    setCurrentElement(newEl);
  }, [activeTool, activeColor, strokeWidth, elements, onElementsChange, getCanvasPos]);

  // ── Mouse move ─────────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) onCursorMove(e.clientX - rect.left, e.clientY - rect.top);

    if (activeTool === 'pan' && isPanning) {
      updatePan(e.clientX - panStart.current.x, e.clientY - panStart.current.y);
      return;
    }

    const pos = getCanvasPos(e);

    if (isResizeRef.current && resizeHandle.current && resizeStart.current && resizeOrigBounds.current) {
      const dx = pos.x - resizeStart.current.x;
      const dy = pos.y - resizeStart.current.y;
      const newBounds = computeNewBounds(resizeOrigBounds.current, resizeHandle.current, dx, dy);
      const updated = elements.map(el => {
        const snap = resizeSnapshot.current.find(s => s.id === el.id);
        return snap ? transformElement(snap, resizeOrigBounds.current!, newBounds) : el;
      });
      onElementsSilentUpdate(updated);
      return;
    }

    if (isMoveRef.current && moveStart.current) {
      const dx = pos.x - moveStart.current.x;
      const dy = pos.y - moveStart.current.y;
      const updated = elements.map(el => {
        const snap = moveSnapshot.current.find(s => s.id === el.id);
        return snap ? moveElement(snap, dx, dy) : el;
      });
      onElementsSilentUpdate(updated);
      return;
    }

    if (isMarqueeRef.current && marqueeStart.current) {
      setMarquee({ x: marqueeStart.current.x, y: marqueeStart.current.y, w: pos.x - marqueeStart.current.x, h: pos.y - marqueeStart.current.y });
      return;
    }

    if (!isDrawing || !currentElement) return;
    setCurrentElement(prev => {
      if (!prev) return null;
      if (prev.type === 'pen') return { ...prev, points: [...(prev.points ?? []), pos] };
      return { ...prev, x2: pos.x, y2: pos.y };
    });
  }, [activeTool, isPanning, isDrawing, currentElement, getCanvasPos, onCursorMove, elements, onElementsSilentUpdate, updatePan]);

  // ── Mouse up — with shape recognition ─────────────────────────────────────

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) return;
    setDragCursor(null);

    if (activeTool === 'pan') { setIsPanning(false); return; }

    if (isResizeRef.current) {
      isResizeRef.current = false;
      resizeHandle.current = null;
      resizeStart.current = null;
      resizeOrigBounds.current = null;
      resizeSnapshot.current = [];
      onElementsChange(elements);
      return;
    }

    if (isMoveRef.current) {
      isMoveRef.current = false;
      moveStart.current = null;
      moveSnapshot.current = [];
      onElementsChange(elements);
      return;
    }

    if (isMarqueeRef.current && marquee) {
      const bx = marquee.w < 0 ? marquee.x + marquee.w : marquee.x;
      const by = marquee.h < 0 ? marquee.y + marquee.h : marquee.y;
      const bw = Math.abs(marquee.w), bh = Math.abs(marquee.h);
      if (bw > 4 || bh > 4) {
        const hits = elements.filter(el => isElementInBox(el, bx, by, bw, bh));
        setSelectedIds(prev => {
          const next = new Set(prev);
          hits.forEach(el => next.add(el.id));
          return next;
        });
      }
      isMarqueeRef.current = false;
      marqueeStart.current = null;
      setMarquee(null);
      return;
    }

    if (!isDrawing || !currentElement) return;
    setIsDrawing(false);

    const hasSize = currentElement.type === 'pen'
      ? (currentElement.points?.length ?? 0) > 2
      : Math.abs((currentElement.x2 ?? 0) - currentElement.x1) > 2 || Math.abs((currentElement.y2 ?? 0) - currentElement.y1) > 2;

    if (!hasSize) {
      setCurrentElement(null);
      return;
    }

    // ── Smart shape recognition (pen strokes only) ───────────────────────────
    let finalElement = currentElement;

    if (smartShapeEnabled && currentElement.type === 'pen' && (currentElement.points?.length ?? 0) >= 8) {
      const recognized = recognizeShape(currentElement as Parameters<typeof recognizeShape>[0]);
      if (recognized) {
        finalElement = buildShapeElement(recognized, currentElement as Parameters<typeof buildShapeElement>[1]) as DrawElement;
        // Trigger visual flash feedback
        triggerSnapFlash(finalElement);
      }
    }

    onElementsChange([...elements, finalElement]);
    setCurrentElement(null);
  }, [activeTool, isDrawing, currentElement, elements, onElementsChange, marquee, smartShapeEnabled, triggerSnapFlash]);

  // ── Text submit ────────────────────────────────────────────────────────────

  const handleTextSubmit = useCallback((text: string) => {
    if (!text.trim()) { setTextInput(t => ({ ...t, visible: false })); return; }
    const worldX = (textInput.x - panOffset.x) / scale;
    const worldY = (textInput.y - panOffset.y) / scale;
    const newEl: DrawElement = {
      id: genId(),
      type: 'text',
      x1: worldX,
      y1: worldY,
      color: activeColor, strokeWidth, text,
    };
    onElementsChange([...elements, newEl]);
    setTextInput(t => ({ ...t, visible: false }));
  }, [textInput, panOffset, scale, activeColor, strokeWidth, elements, onElementsChange]);

  const getCursor = () => {
    if (dragCursor) return dragCursor;
    if (activeTool === 'pan') return 'grab';
    if (activeTool === 'eraser') return 'cell';
    if (activeTool === 'text') return 'text';
    if (activeTool === 'select') return 'default';
    return 'crosshair';
  };

  // ── Compute snap flash screen positions ────────────────────────────────────
  const flashesInScreenSpace = snapFlashes.map(f => ({
    ...f,
    sx: f.x * scale + panOffset.x,
    sy: f.y * scale + panOffset.y,
    sw: f.w * scale,
    sh: f.h * scale,
    age: (Date.now() - f.startTime) / 600,
  }));

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{
        backgroundColor: 'var(--canvas)',
        backgroundImage: 'radial-gradient(circle, var(--dot-color) 1px, transparent 1px)',
        backgroundSize: `${24 * scale}px ${24 * scale}px`,
        backgroundPosition: `${panOffset.x % (24 * scale)}px ${panOffset.y % (24 * scale)}px`,
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: getCursor() }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp({ button: 0 } as React.MouseEvent);
          onCursorLeave();
        }}
      />

      {/* ── Snap flash overlays ─────────────────────────────────────────────── */}
      {snapFlashes.map(flash => {
        const sx = flash.x * scale + panOffset.x;
        const sy = flash.y * scale + panOffset.y;
        const sw = flash.w * scale;
        const sh = flash.h * scale;
        return (
          <div
            key={flash.id}
            style={{
              position: 'absolute',
              left: sx,
              top: sy,
              width: sw,
              height: sh,
              pointerEvents: 'none',
              zIndex: 50,
            }}
          >
            {/* Animated ring */}
            <div style={{
              position: 'absolute',
              inset: -6,
              borderRadius: flash.type === 'ellipse' ? '50%' : 8,
              border: '2px solid var(--accent)',
              animation: 'snapRing 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards',
              pointerEvents: 'none',
            }} />
            {/* Label badge */}
            <div style={{
              position: 'absolute',
              top: -28,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--accent)',
              color: 'white',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.12em',
              padding: '3px 8px',
              borderRadius: 100,
              whiteSpace: 'nowrap',
              fontFamily: 'DM Mono, monospace',
              animation: 'snapLabel 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards',
              pointerEvents: 'none',
            }}>
              {flash.type === 'arrow' ? '→ ARROW' :
               flash.type === 'line'  ? '╱ LINE'  :
               flash.type === 'rect'  ? '□ RECT'  :
               flash.type === 'ellipse' ? '○ ELLIPSE' : flash.type.toUpperCase()}
            </div>
          </div>
        );
      })}

      {/* Snap flash keyframes */}
      <style>{`
        @keyframes snapRing {
          0%   { opacity: 1; transform: scale(0.85); }
          60%  { opacity: 0.9; transform: scale(1.06); }
          100% { opacity: 0; transform: scale(1.12); }
        }
        @keyframes snapLabel {
          0%   { opacity: 0; transform: translateX(-50%) translateY(6px); }
          20%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          70%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-4px); }
        }
      `}</style>

      {textInput.visible && (
        <input
          ref={textRef}
          className="absolute bg-transparent outline-none font-mono"
          style={{
            left: textInput.x, top: textInput.y - 16,
            color: activeColor,
            fontSize: Math.max(14, strokeWidth * 6) * scale,
            borderBottom: `2px solid ${activeColor}`,
            minWidth: 120,
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') handleTextSubmit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setTextInput(t => ({ ...t, visible: false }));
          }}
          onBlur={e => handleTextSubmit(e.target.value)}
          placeholder="Type here..."
        />
      )}

      {selectedIds.size > 0 && !isResizeRef.current && !isMoveRef.current && (
        <div style={{
          position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--accent)', color: 'white', fontSize: 11,
          padding: '4px 14px', borderRadius: 100, pointerEvents: 'none',
          fontFamily: 'DM Mono, monospace',
        }}>
          {selectedIds.size} selected · drag to move · handles to resize · ⌫ delete
        </div>
      )}

      {remoteCursors.map(c => (
        <div
          key={c.userId}
          className="cursor-label animate-fade-in"
          style={{ left: c.x + panOffset.x, top: c.y + panOffset.y, background: c.color, color: '#fff' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }}>
            <path d="M1 1L9 5L5.5 6.5L4 10L1 1Z" fill="white" />
          </svg>
          {c.name}
        </div>
      ))}
    </div>
  );
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function drawElement(ctx: CanvasRenderingContext2D, el: DrawElement) {
  switch (el.type) {
    case 'pen':
      if (el.points && el.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          const p = el.points[i - 1], c = el.points[i];
          ctx.quadraticCurveTo(p.x, p.y, (p.x + c.x) / 2, (p.y + c.y) / 2);
        }
        ctx.stroke();
      }
      break;
    case 'line':
      ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2 ?? el.x1, el.y2 ?? el.y1); ctx.stroke();
      break;
    case 'arrow': {
      const x2 = el.x2 ?? el.x1, y2 = el.y2 ?? el.y1;
      ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(x2, y2); ctx.stroke();
      const a = Math.atan2(y2 - el.y1, x2 - el.x1), len = 14 + el.strokeWidth * 2;
      ctx.beginPath();
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(a - 0.4), y2 - len * Math.sin(a - 0.4));
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(a + 0.4), y2 - len * Math.sin(a + 0.4));
      ctx.stroke();
      break;
    }
    case 'rect': {
      const w = (el.x2 ?? el.x1) - el.x1, h = (el.y2 ?? el.y1) - el.y1;
      ctx.beginPath(); ctx.roundRect(el.x1, el.y1, w, h, 4); ctx.stroke();
      break;
    }
    case 'ellipse': {
      const cx = (el.x1 + (el.x2 ?? el.x1)) / 2, cy = (el.y1 + (el.y2 ?? el.y1)) / 2;
      const rx = Math.abs((el.x2 ?? el.x1) - el.x1) / 2, ry = Math.abs((el.y2 ?? el.y1) - el.y1) / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx || 1, ry || 1, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'text':
      if (el.text) {
        ctx.font = `${Math.max(14, el.strokeWidth * 6)}px 'DM Mono', monospace`;
        ctx.fillText(el.text, el.x1, el.y1);
      }
      break;
  }
}

function drawElementStroke(ctx: CanvasRenderingContext2D, el: DrawElement) {
  switch (el.type) {
    case 'pen':
      if (el.points && el.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          const p = el.points[i - 1], c = el.points[i];
          ctx.quadraticCurveTo(p.x, p.y, (p.x + c.x) / 2, (p.y + c.y) / 2);
        }
        ctx.stroke();
      }
      break;
    case 'line': case 'arrow':
      ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2 ?? el.x1, el.y2 ?? el.y1); ctx.stroke();
      break;
    case 'rect': {
      const w = (el.x2 ?? el.x1) - el.x1, h = (el.y2 ?? el.y1) - el.y1;
      ctx.beginPath(); ctx.roundRect(el.x1, el.y1, w, h, 4); ctx.stroke();
      break;
    }
    case 'ellipse': {
      const cx = (el.x1 + (el.x2 ?? el.x1)) / 2, cy = (el.y1 + (el.y2 ?? el.y1)) / 2;
      const rx = Math.abs((el.x2 ?? el.x1) - el.x1) / 2, ry = Math.abs((el.y2 ?? el.y1) - el.y1) / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx || 1, ry || 1, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
  }
}

// ── Pure geometry ─────────────────────────────────────────────────────────────

function getElementBounds(el: DrawElement): Bounds | null {
  switch (el.type) {
    case 'pen': {
      if (!el.points?.length) return null;
      const xs = el.points.map(p => p.x), ys = el.points.map(p => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(Math.max(...xs) - Math.min(...xs), 1), h: Math.max(Math.max(...ys) - Math.min(...ys), 1) };
    }
    case 'line': case 'arrow': case 'rect': case 'ellipse': {
      const x2 = el.x2 ?? el.x1, y2 = el.y2 ?? el.y1;
      return { x: Math.min(el.x1, x2), y: Math.min(el.y1, y2), w: Math.max(Math.abs(x2 - el.x1), 1), h: Math.max(Math.abs(y2 - el.y1), 1) };
    }
    case 'text': return { x: el.x1 - 4, y: el.y1 - 20, w: 100, h: 28 };
    default: return null;
  }
}

function moveElement(el: DrawElement, dx: number, dy: number): DrawElement {
  switch (el.type) {
    case 'pen': return { ...el, points: (el.points ?? []).map(p => ({ x: p.x + dx, y: p.y + dy })) };
    case 'line': case 'arrow': case 'rect': case 'ellipse':
      return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: (el.x2 ?? el.x1) + dx, y2: (el.y2 ?? el.y1) + dy };
    case 'text': return { ...el, x1: el.x1 + dx, y1: el.y1 + dy };
    default: return el;
  }
}

function isElementInBox(el: DrawElement, bx: number, by: number, bw: number, bh: number): boolean {
  const b = getElementBounds(el);
  if (!b) return false;
  return b.x < bx + bw && b.x + b.w > bx && b.y < by + bh && b.y + b.h > by;
}

function findElementAt(x: number, y: number, elements: DrawElement[]): DrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (isNearElement(x, y, elements[i])) return elements[i];
  }
  return null;
}

function isNearElement(x: number, y: number, el: DrawElement): boolean {
  const t = Math.max(8, el.strokeWidth * 2);
  switch (el.type) {
    case 'pen': return (el.points ?? []).some(p => dist(x, y, p.x, p.y) < t);
    case 'line': case 'arrow': return distToSegment(x, y, el.x1, el.y1, el.x2 ?? el.x1, el.y2 ?? el.y1) < t;
    case 'rect': {
      const x2 = el.x2 ?? el.x1, y2 = el.y2 ?? el.y1;
      return x >= Math.min(el.x1, x2) - t && x <= Math.max(el.x1, x2) + t && y >= Math.min(el.y1, y2) - t && y <= Math.max(el.y1, y2) + t;
    }
    case 'ellipse': {
      const cx = (el.x1 + (el.x2 ?? el.x1)) / 2, cy = (el.y1 + (el.y2 ?? el.y1)) / 2;
      return dist(x, y, cx, cy) < Math.max(Math.abs((el.x2 ?? el.x1) - el.x1), Math.abs((el.y2 ?? el.y1) - el.y1)) / 2 + t;
    }
    case 'text': return dist(x, y, el.x1, el.y1) < 50;
    default: return false;
  }
}

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  if (!dx && !dy) return dist(px, py, x1, y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}