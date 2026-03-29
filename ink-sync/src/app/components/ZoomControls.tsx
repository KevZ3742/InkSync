'use client';

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function snapToLevel(scale: number, dir: 1 | -1): number {
  if (dir === 1) {
    return ZOOM_LEVELS.find(l => l > scale + 0.01) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  } else {
    return [...ZOOM_LEVELS].reverse().find(l => l < scale - 0.01) ?? ZOOM_LEVELS[0];
  }
}

export { snapToLevel };

export default function ZoomControls({ scale, onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  const pct = Math.round(scale * 100);

  const btnStyle = (disabled = false): React.CSSProperties => ({
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    color: disabled ? 'var(--muted)' : 'var(--ink)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 7,
    fontSize: 16,
    fontFamily: 'DM Mono, monospace',
    transition: 'all 0.12s',
    opacity: disabled ? 0.35 : 1,
    flexShrink: 0,
  });

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(calc(-50% - 0px))',
        // Shift slightly left to account for toolbar width — sits just above the toolbar
        marginBottom: 72,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '4px 6px',
        background: 'var(--paper)',
        border: '1.5px solid var(--canvas-grid)',
        borderRadius: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        fontFamily: 'DM Mono, monospace',
        animation: 'slideUp 0.3s ease forwards',
      }}
    >
      {/* Zoom out */}
      <button
        style={btnStyle(scale <= 0.1)}
        onClick={onZoomOut}
        title="Zoom out (Ctrl + −)"
        onMouseEnter={e => { if (scale > 0.1) (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M3.5 5.5h4M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Percentage — click to reset */}
      <button
        onClick={onReset}
        title="Reset zoom to 100% (Ctrl + 0)"
        style={{
          ...btnStyle(),
          width: 'auto',
          padding: '0 8px',
          fontSize: 11,
          fontWeight: scale === 1 ? 400 : 600,
          color: scale === 1 ? 'var(--muted)' : 'var(--accent)',
          letterSpacing: '0.02em',
          minWidth: 44,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {pct}%
      </button>

      {/* Zoom in */}
      <button
        style={btnStyle(scale >= 4)}
        onClick={onZoomIn}
        title="Zoom in (Ctrl + =)"
        onMouseEnter={e => { if (scale < 4) (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M3.5 5.5h4M5.5 3.5v4M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}