'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import dynamic from 'next/dynamic';
import Landing from './components/Landing';
import Header from './components/Header';
import Toolbar from './components/Toolbar';
import ContextMenu from './components/ContextMenu';
import SummaryPanel from './components/SummaryPanel';
import ChatPanel from './components/ChatPanel';
import Minimap from './components/Minimap';
import ReplayBar, { ReplayEntry } from './components/ReplayBar';

const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
function snapToLevel(scale: number, dir: 1 | -1): number {
  if (dir === 1) return ZOOM_LEVELS.find(l => l > scale + 0.01) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  return [...ZOOM_LEVELS].reverse().find(l => l < scale - 0.01) ?? ZOOM_LEVELS[0];
}
import { DrawElement } from './components/DrawingCanvas';
import { useSocket } from './hooks/useSocket';

const DrawingCanvas = dynamic(() => import('./components/DrawingCanvas'), { ssr: false });

type Tool = 'select' | 'pan' | 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser';

const USER_ID = typeof window !== 'undefined'
  ? (sessionStorage.getItem('ink-sync-uid') || (() => {
      const id = uuidv4();
      sessionStorage.setItem('ink-sync-uid', id);
      return id;
    })())
  : uuidv4();

interface ContextMenuState {
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
}

export default function Page() {
  const [session, setSession] = useState<{ roomCode: string; userName: string } | null>(null);
  const [elements, setElements] = useState<DrawElement[]>([]);
  const [past, setPast] = useState<DrawElement[][]>([]);
  const [future, setFuture] = useState<DrawElement[][]>([]);
  const [clipboard, setClipboard] = useState<DrawElement[]>([]);
  const [activeTool, setActiveTool] = useState<Tool>('pen');
  const [activeColor, setActiveColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [isDark, setIsDark] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [summaryPanels, setSummaryPanels] = useState<{
    id: string;
    elements: DrawElement[];
    screenX: number;
    screenY: number;
    zIndex: number;
  }[]>([]);

  const [smartShapeEnabled, setSmartShapeEnabled] = useState(false);

  // ── Replay ─────────────────────────────────────────────────────────────────
  const replayLogRef = useRef<ReplayEntry[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayElements, setReplayElements] = useState<DrawElement[]>([]);
  const preReplayElements = useRef<DrawElement[]>([]);
  const preReplayScale = useRef(1);
  const preReplayPan = useRef({ x: 0, y: 0 });
  const [replayLogLen, setReplayLogLen] = useState(0);

  // Zoom + pan state
  const [currentScale, setCurrentScale] = useState(1);
  const [currentPan, setCurrentPan] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ w: 1200, h: 800 });

  const topZIndex = useRef(1000);
  const imperativePanRef = useRef<((x: number, y: number) => void) | null>(null);
  const imperativeZoomRef = useRef<((scale: number, cx?: number, cy?: number) => void) | null>(null);
  const elementsSendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panOffsetRef = useRef({ x: 0, y: 0 });

  const elementsRef = useRef(elements);
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const clipboardRef = useRef(clipboard);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const scaleRef = useRef(1);

  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { pastRef.current = past; }, [past]);
  useEffect(() => { futureRef.current = future; }, [future]);
  useEffect(() => { clipboardRef.current = clipboard; }, [clipboard]);
  useEffect(() => { scaleRef.current = currentScale; }, [currentScale]);

  useEffect(() => {
    const update = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const handleSelectionChange = useCallback((ids: Set<string>) => {
    selectedIdsRef.current = ids;
  }, []);

  // ── Theme ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem('ink-sync-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved ? saved === 'dark' : prefersDark;
    setIsDark(dark);
    if (dark) { document.documentElement.classList.add('dark'); setActiveColor('#ffffff'); }
    else { setActiveColor('#000000'); }
  }, []);

  const handleToggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('ink-sync-theme', next ? 'dark' : 'light');
      setActiveColor(next ? '#ffffff' : '#000000');
      return next;
    });
  }, []);

  // ── Socket ─────────────────────────────────────────────────────────────────

  const handleRemoteElements = useCallback((els: DrawElement[]) => setElements(els), []);

  const {
    connected, users, remoteCursors, chatMessages,
    sendElements, sendCursorMove, sendCursorLeave,
    sendChatMessage, sendChatReaction,
  } = useSocket(session?.roomCode ?? null, session?.userName ?? null, USER_ID, handleRemoteElements);

  const broadcastElements = useCallback((els: DrawElement[]) => {
    if (elementsSendTimer.current) clearTimeout(elementsSendTimer.current);
    elementsSendTimer.current = setTimeout(() => sendElements(els), 30);
  }, [sendElements]);

  // ── History ────────────────────────────────────────────────────────────────

  const commit = useCallback((next: DrawElement[]) => {
    replayLogRef.current = [...replayLogRef.current, { elements: next }];
    setReplayLogLen(l => l + 1);
    setPast(p => [...p, elementsRef.current]);
    setFuture([]);
    setElements(next);
    broadcastElements(next);
  }, [broadcastElements]);

  const handleElementsSilentUpdate = useCallback((els: DrawElement[]) => {
    setElements(els); broadcastElements(els);
  }, [broadcastElements]);

  const handleElementsChange = useCallback((els: DrawElement[]) => commit(els), [commit]);

  const handleUndo = useCallback(() => {
    const p = pastRef.current;
    if (!p.length) return;
    const prev = p[p.length - 1];
    setPast(p.slice(0, -1));
    setFuture(f => [elementsRef.current, ...f]);
    setElements(prev);
    broadcastElements(prev);
  }, [broadcastElements]);

  const handleRedo = useCallback(() => {
    const f = futureRef.current;
    if (!f.length) return;
    const next = f[0];
    setFuture(f.slice(1));
    setPast(p => [...p, elementsRef.current]);
    setElements(next);
    broadcastElements(next);
  }, [broadcastElements]);

  const handleClear = useCallback(() => commit([]), [commit]);

  // ── Zoom ───────────────────────────────────────────────────────────────────

  const handleZoomIn = useCallback(() => imperativeZoomRef.current?.(snapToLevel(scaleRef.current, 1)), []);
  const handleZoomOut = useCallback(() => imperativeZoomRef.current?.(snapToLevel(scaleRef.current, -1)), []);
  const handleZoomReset = useCallback(() => imperativeZoomRef.current?.(1), []);

  // ── Color ──────────────────────────────────────────────────────────────────

  const handleColorChange = useCallback((color: string) => {
    setActiveColor(color);
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    commit(elementsRef.current.map(el => ids.has(el.id) ? { ...el, color } : el));
  }, [commit]);

  // ── Import / Export ────────────────────────────────────────────────────────

  const handleImport = useCallback((els: DrawElement[]) => commit(els), [commit]);

  const getCanvasBlob = useCallback((): Promise<Blob | null> => new Promise(resolve => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) { resolve(null); return; }
    canvas.toBlob(blob => resolve(blob), 'image/png');
  }), []);

  // ── Copy / Paste ───────────────────────────────────────────────────────────

  const handleCopy = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    setClipboard(elementsRef.current.filter(el => ids.has(el.id)));
  }, []);

  const handlePaste = useCallback(() => {
    const buf = clipboardRef.current;
    if (!buf.length) return;
    const offset = 20;
    const pasted = buf.map(el => {
      const newId = `el_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      switch (el.type) {
        case 'pen': return { ...el, id: newId, points: (el.points ?? []).map(p => ({ x: p.x + offset, y: p.y + offset })) };
        case 'text': return { ...el, id: newId, x1: el.x1 + offset, y1: el.y1 + offset };
        default: return { ...el, id: newId, x1: el.x1 + offset, y1: el.y1 + offset, x2: (el.x2 ?? el.x1) + offset, y2: (el.y2 ?? el.y1) + offset };
      }
    });
    setClipboard(pasted);
    commit([...elementsRef.current, ...pasted]);
  }, [commit]);

  const handleDuplicate = useCallback(() => { handleCopy(); setTimeout(() => handlePaste(), 0); }, [handleCopy, handlePaste]);

  // ── Context menu ───────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isReplaying) return;
    e.preventDefault();
    const canvas = (e.currentTarget as HTMLElement).querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    const canvasX = rect ? (e.clientX - rect.left - panOffsetRef.current.x) / scaleRef.current : e.clientX;
    const canvasY = rect ? (e.clientY - rect.top - panOffsetRef.current.y) / scaleRef.current : e.clientY;
    setContextMenu({ screenX: e.clientX, screenY: e.clientY, canvasX, canvasY });
  }, [isReplaying]);

  const handleAIStream = useCallback((els: DrawElement[]) => { setElements(els); broadcastElements(els); }, [broadcastElements]);
  const handleAIGenerated = useCallback((els: DrawElement[]) => commit(els), [commit]);

  const handleSummarize = useCallback((els: DrawElement[], screenX: number, screenY: number) => {
    topZIndex.current += 1;
    setSummaryPanels(prev => [...prev, { id: `summary_${Date.now()}`, elements: els, screenX, screenY, zIndex: topZIndex.current }]);
  }, []);

  const handlePanelFocus = useCallback((id: string) => {
    topZIndex.current += 1;
    setSummaryPanels(prev => prev.map(p => p.id === id ? { ...p, zIndex: topZIndex.current } : p));
  }, []);

  const handlePanelClose = useCallback((id: string) => setSummaryPanels(prev => prev.filter(p => p.id !== id)), []);

  const handlePanelLocate = useCallback((els: DrawElement[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of els) {
      const pts = el.type === 'pen' ? (el.points ?? []) : [{ x: el.x1, y: el.y1 }, { x: el.x2 ?? el.x1, y: el.y2 ?? el.y1 }];
      for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const s = scaleRef.current;
    const targetX = window.innerWidth / 2 - cx * s;
    const targetY = window.innerHeight / 2 - cy * s;
    const startX = panOffsetRef.current.x, startY = panOffsetRef.current.y;
    const duration = 420, startTime = performance.now();
    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const x = startX + (targetX - startX) * e, y = startY + (targetY - startY) * e;
      imperativePanRef.current?.(x, y);
      panOffsetRef.current = { x, y }; setCurrentPan({ x, y });
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, []);

  const handleMinimapNavigate = useCallback((panX: number, panY: number) => {
    imperativePanRef.current?.(panX, panY);
    panOffsetRef.current = { x: panX, y: panY };
    setCurrentPan({ x: panX, y: panY });
  }, []);

  // ── Replay ─────────────────────────────────────────────────────────────────

  const handleStartReplay = useCallback(() => {
    if (replayLogRef.current.length < 2) return;
    // Snapshot everything before entering replay so we can restore it on exit
    preReplayElements.current = elementsRef.current;
    preReplayScale.current = scaleRef.current;
    preReplayPan.current = { ...panOffsetRef.current };
    setReplayElements([]);
    setIsReplaying(true);
  }, []);

  const handleExitReplay = useCallback(() => {
    setIsReplaying(false);
    setElements(preReplayElements.current);
    // Restore zoom & pan after the state flush
    setTimeout(() => {
      imperativeZoomRef.current?.(preReplayScale.current, window.innerWidth / 2, window.innerHeight / 2);
      imperativePanRef.current?.(preReplayPan.current.x, preReplayPan.current.y);
    }, 0);
  }, []);

  const handleReplayFrame = useCallback((els: ReplayEntry['elements']) => setReplayElements(els), []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape' && isReplaying) { handleExitReplay(); return; }
      if (isReplaying) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        const map: Record<string, Tool> = { v: 'select', h: 'pan', p: 'pen', l: 'line', a: 'arrow', r: 'rect', e: 'ellipse', t: 'text', x: 'eraser' };
        if (map[e.key]) { setActiveTool(map[e.key]); return; }
        if (e.key === 's') { setSmartShapeEnabled(prev => !prev); return; }
      }
      if (mod) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
        if (e.key === 'z' && e.shiftKey)  { e.preventDefault(); handleRedo(); return; }
        if (e.key === 'y')                 { e.preventDefault(); handleRedo(); return; }
        if (e.key === 'c')                 { e.preventDefault(); handleCopy(); return; }
        if (e.key === 'v')                 { e.preventDefault(); handlePaste(); return; }
        if (e.key === 'd')                 { e.preventDefault(); handleDuplicate(); return; }
        if (e.key === '=' || e.key === '+') { e.preventDefault(); handleZoomIn(); return; }
        if (e.key === '-')                   { e.preventDefault(); handleZoomOut(); return; }
        if (e.key === '0')                   { e.preventDefault(); handleZoomReset(); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isReplaying, handleExitReplay, handleUndo, handleRedo, handleCopy, handlePaste, handleDuplicate, handleZoomIn, handleZoomOut, handleZoomReset]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!session) {
    return (
      <>
        <button className="theme-toggle" onClick={handleToggleTheme} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ position: 'fixed', top: 20, right: 20, zIndex: 100 }}>
          {isDark
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          }
        </button>
        <Landing onJoin={(roomCode, userName) => setSession({ roomCode, userName })} />
      </>
    );
  }

  const canReplay = replayLogLen >= 2;

  return (
    <div className="w-screen h-screen relative overflow-hidden" onContextMenu={handleContextMenu}>
      <Header
        roomCode={session.roomCode} users={users} myName={session.userName}
        onLeave={() => { setSession(null); setElements([]); setPast([]); setFuture([]); replayLogRef.current = []; setReplayLogLen(0); }}
        isDark={isDark} onToggleTheme={handleToggleTheme}
        elements={elements} onImport={handleImport} getCanvasBlob={getCanvasBlob}
      />

      {/* Replay trigger button — fixed so it's always viewport-centered */}
      {!isReplaying && canReplay && (
        <button
          onClick={handleStartReplay}
          title="Watch replay of this drawing session"
          style={{
            position: 'fixed',
            top: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px',
            background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)', borderRadius: 100,
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)', cursor: 'pointer',
            fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--muted)',
            transition: 'all 0.15s', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(108,99,255,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--canvas-grid)'; e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M4.5 3.5v4l3-2-3-2z" fill="currentColor"/>
          </svg>
          replay · {replayLogLen} strokes
        </button>
      )}

      <DrawingCanvas
        elements={isReplaying ? replayElements : elements}
        onElementsChange={isReplaying ? () => {} : handleElementsChange}
        onElementsSilentUpdate={isReplaying ? () => {} : handleElementsSilentUpdate}
        activeTool={isReplaying ? 'pan' : activeTool}
        activeColor={activeColor} strokeWidth={strokeWidth}
        remoteCursors={isReplaying ? [] : remoteCursors}
        onCursorMove={isReplaying ? () => {} : sendCursorMove}
        onCursorLeave={isReplaying ? () => {} : sendCursorLeave}
        onSelectionChange={handleSelectionChange}
        onPanOffsetChange={(x, y) => { panOffsetRef.current = { x, y }; setCurrentPan({ x, y }); }}
        onScaleChange={(s) => { scaleRef.current = s; setCurrentScale(s); }}
        imperativePanRef={imperativePanRef}
        imperativeZoomRef={imperativeZoomRef}
        smartShapeEnabled={!isReplaying && smartShapeEnabled}
      />

      {!isReplaying && (
        <Toolbar
          activeTool={activeTool} onToolChange={t => setActiveTool(t as Tool)}
          activeColor={activeColor} onColorChange={handleColorChange}
          strokeWidth={strokeWidth} onStrokeWidthChange={setStrokeWidth}
          onClear={handleClear} onUndo={handleUndo} onRedo={handleRedo}
          canUndo={past.length > 0} canRedo={future.length > 0}
          smartShapeEnabled={smartShapeEnabled} onSmartShapeToggle={() => setSmartShapeEnabled(prev => !prev)}
        />
      )}

      {!isReplaying && (
        <Minimap
          elements={elements} panOffset={currentPan} scale={currentScale}
          viewportWidth={viewportSize.w} viewportHeight={viewportSize.h}
          onNavigate={handleMinimapNavigate}
          onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onZoomReset={handleZoomReset}
        />
      )}

      {contextMenu && !isReplaying && (
        <ContextMenu
          x={contextMenu.screenX} y={contextMenu.screenY}
          canvasX={contextMenu.canvasX} canvasY={contextMenu.canvasY}
          mode={selectedIdsRef.current.size > 0 ? 'selection' : 'ai'}
          selectedIds={selectedIdsRef.current}
          onClose={() => setContextMenu(null)}
          onElementsChange={handleElementsChange}
          onElementsGenerated={handleAIGenerated}
          onElementsStream={handleAIStream}
          onSummarize={handleSummarize}
          currentElements={elements}
        />
      )}

      {summaryPanels.map(panel => (
        <SummaryPanel
          key={panel.id} elements={panel.elements}
          initialScreenX={panel.screenX} initialScreenY={panel.screenY}
          panOffsetRef={panOffsetRef} zIndex={panel.zIndex}
          onFocus={() => handlePanelFocus(panel.id)}
          onClose={() => handlePanelClose(panel.id)}
          onLocate={() => handlePanelLocate(panel.elements)}
        />
      ))}

      {!isReplaying && (
        <ChatPanel
          messages={chatMessages} currentUserId={USER_ID} currentUserName={session.userName}
          users={users} onSendMessage={sendChatMessage} onAddReaction={sendChatReaction}
        />
      )}

      {isReplaying && (
        <ReplayBar
          entries={replayLogRef.current}
          onFrameChange={handleReplayFrame}
          onExit={handleExitReplay}
          imperativePanRef={imperativePanRef}
          imperativeZoomRef={imperativeZoomRef}
          viewportWidth={viewportSize.w}
          viewportHeight={viewportSize.h}
          currentScale={currentScale}
          currentPan={currentPan}
          initialScale={preReplayScale.current}
          initialPan={preReplayPan.current}
        />
      )}

      {session && !isReplaying && (
        <div key={smartShapeEnabled ? 'on' : 'off'} style={{
          position: 'fixed', bottom: 160, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--accent)', color: 'white', fontSize: 11, padding: '5px 14px',
          borderRadius: 100, fontFamily: 'DM Mono, monospace', pointerEvents: 'none',
          zIndex: 200, animation: 'toastIn 2s ease forwards', whiteSpace: 'nowrap',
        }}>
          {smartShapeEnabled ? '✦ Smart shapes ON' : '✦ Smart shapes OFF'}
        </div>
      )}

      {session && !connected && !isReplaying && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 pill animate-fade-in"
          style={{ background: 'var(--danger)', color: 'white', fontSize: 11 }}>
          <span>●</span> Connecting...
        </div>
      )}

      <style>{`
        @keyframes toastIn {
          0%   { opacity: 0; transform: translateX(-50%) translateY(8px); }
          15%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          70%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-4px); }
        }
      `}</style>
    </div>
  );
}