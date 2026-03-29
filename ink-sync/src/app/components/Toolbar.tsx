'use client';

import { ElementType } from './DrawingCanvas';

type Tool = ElementType | 'select' | 'eraser' | 'pan';

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  activeColor: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (w: number) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  smartShapeEnabled: boolean;
  onSmartShapeToggle: () => void;
}

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select (V)', icon: '↖' },
  { id: 'pan',    label: 'Pan (H)',    icon: '✋' },
  { id: 'pen',    label: 'Pen (P)',    icon: '✏️' },
  { id: 'line',   label: 'Line (L)',   icon: '╱' },
  { id: 'arrow',  label: 'Arrow (A)',  icon: '→' },
  { id: 'rect',   label: 'Rectangle (R)', icon: '□' },
  { id: 'ellipse',label: 'Ellipse (E)',icon: '○' },
  { id: 'text',   label: 'Text (T)',   icon: 'T' },
  { id: 'eraser', label: 'Eraser (X)', icon: '⌫' },
];

const COLORS = [
  '#000000', '#ffffff',
  '#1a1a2e', '#6c63ff', '#FF6B6B', '#4ECDC4',
  '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD',
  '#F97316', '#10B981', '#EC4899', '#8B5CF6',
];

export default function Toolbar({
  activeTool, onToolChange,
  activeColor, onColorChange,
  strokeWidth, onStrokeWidthChange,
  onClear, onUndo, onRedo, canUndo, canRedo,
  smartShapeEnabled, onSmartShapeToggle,
}: ToolbarProps) {
  return (
    <div className="absolute left-1/2 bottom-6 -translate-x-1/2 z-10 flex flex-col items-center gap-3 animate-slide-up">

      {/* Color + stroke row */}
      <div className="toolbar flex-col gap-3" style={{ padding: '12px 16px' }}>
        <div className="flex gap-2 items-center flex-wrap justify-center" style={{ maxWidth: 300 }}>
          {COLORS.map(c => (
            <button
              key={c}
              className={`color-swatch ${activeColor === c ? 'active' : ''}`}
              style={{
                background: c,
                border: c === '#ffffff' ? '1.5px solid var(--canvas-grid)' : undefined,
              }}
              title={c}
              onClick={() => onColorChange(c)}
            />
          ))}
          <label
            className="color-swatch flex items-center justify-center text-xs"
            style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', cursor: 'pointer' }}
            title="Custom color"
          >
            <input type="color" className="opacity-0 absolute w-0 h-0" onChange={e => onColorChange(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>STROKE</span>
          <input
            type="range" min={1} max={24} step={1}
            value={strokeWidth}
            onChange={e => onStrokeWidthChange(+e.target.value)}
            style={{ flex: 1 }}
          />
          <div style={{
            width: strokeWidth * 2 + 8,
            height: strokeWidth * 2 + 8,
            borderRadius: '50%',
            background: activeColor,
            minWidth: 10,
            flexShrink: 0,
            border: activeColor === '#ffffff' ? '1.5px solid var(--canvas-grid)' : undefined,
          }} />
        </div>
      </div>

      {/* Main tools */}
      <div className="toolbar">
        {TOOLS.map((tool, i) => {
          const sep = i === 2 || i === 7;
          return (
            <div key={tool.id} className="flex items-center">
              {sep && <div className="toolbar-sep" />}
              <button
                className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
                title={tool.label}
                onClick={() => onToolChange(tool.id)}
                style={{ fontSize: tool.icon.length > 1 ? 16 : 18 }}
              >
                {tool.icon}
              </button>
            </div>
          );
        })}

        <div className="toolbar-sep" />

        {/* Undo */}
        <button
          className={`tool-btn ${!canUndo ? 'opacity-30' : ''}`}
          title="Undo (Ctrl+Z)"
          onClick={onUndo}
          disabled={!canUndo}
          style={{ fontSize: 16 }}
        >
          ↩
        </button>

        {/* Redo */}
        <button
          className={`tool-btn ${!canRedo ? 'opacity-30' : ''}`}
          title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
          onClick={onRedo}
          disabled={!canRedo}
          style={{ fontSize: 16 }}
        >
          ↪
        </button>

        <div className="toolbar-sep" />

        {/* Smart Shape toggle */}
        <button
          className={`tool-btn ${smartShapeEnabled ? 'active' : ''}`}
          title={smartShapeEnabled ? 'Smart shapes ON — click to disable' : 'Smart shapes OFF — click to enable'}
          onClick={onSmartShapeToggle}
          style={{
            fontSize: 15,
            position: 'relative',
            // Override active bg so it uses accent glow instead of ink
            background: smartShapeEnabled ? 'var(--accent)' : 'transparent',
            borderColor: smartShapeEnabled ? 'var(--accent)' : 'transparent',
            color: smartShapeEnabled ? 'white' : 'var(--muted)',
            boxShadow: smartShapeEnabled ? '2px 2px 0 rgba(108,99,255,0.3)' : 'none',
          }}
        >
          {/* Magic wand icon */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 14L9 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            <path d="M9 7L11 2L13 7L8 5L13 5L11 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="3.5" cy="3.5" r="0.8" fill="currentColor" opacity="0.6"/>
            <circle cx="13.5" cy="10.5" r="0.8" fill="currentColor" opacity="0.6"/>
            <circle cx="6" cy="2" r="0.6" fill="currentColor" opacity="0.5"/>
            <circle cx="14" cy="7" r="0.6" fill="currentColor" opacity="0.5"/>
          </svg>

          {/* Indicator dot */}
          {smartShapeEnabled && (
            <span style={{
              position: 'absolute',
              top: 4, right: 4,
              width: 5, height: 5,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.9)',
              animation: 'pulse 2s ease infinite',
            }} />
          )}
        </button>

        <div className="toolbar-sep" />

        {/* Clear */}
        <button
          className="tool-btn"
          title="Clear canvas"
          onClick={onClear}
          style={{ fontSize: 14 }}
        >
          🗑
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}