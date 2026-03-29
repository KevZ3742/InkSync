'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DrawElement } from './DrawingCanvas';

interface ImportExportMenuProps {
  elements: DrawElement[];
  onImport: (elements: DrawElement[]) => void;
  getCanvasBlob: () => Promise<Blob | null>;
  getSVGString: () => string;
}

const VERSION = '1';

function elementsToSVG(elements: DrawElement[]): string {
  if (!elements.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"></svg>';

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const pts: { x: number; y: number }[] = el.type === 'pen'
      ? (el.points ?? [])
      : [{ x: el.x1, y: el.y1 }, { x: el.x2 ?? el.x1, y: el.y2 ?? el.y1 }];
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  const pad = 40;
  const W = Math.max(maxX - minX + pad * 2, 100);
  const H = Math.max(maxY - minY + pad * 2, 100);
  const ox = -minX + pad;
  const oy = -minY + pad;

  const svgEls = elements.map(el => {
    const color = el.color;
    const sw = el.strokeWidth;
    const op = el.opacity ?? 1;
    const base = `stroke="${color}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"`;

    switch (el.type) {
      case 'pen': {
        if (!el.points?.length) return '';
        const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x + ox},${p.y + oy}`).join(' ');
        return `<path d="${d}" ${base}/>`;
      }
      case 'line':
        return `<line x1="${el.x1 + ox}" y1="${el.y1 + oy}" x2="${(el.x2 ?? el.x1) + ox}" y2="${(el.y2 ?? el.y1) + oy}" ${base}/>`;
      case 'arrow': {
        const x2 = (el.x2 ?? el.x1) + ox, y2 = (el.y2 ?? el.y1) + oy;
        const x1 = el.x1 + ox, y1 = el.y1 + oy;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const len = 14 + sw * 2;
        const ax1 = x2 - len * Math.cos(angle - 0.4);
        const ay1 = y2 - len * Math.sin(angle - 0.4);
        const ax2 = x2 - len * Math.cos(angle + 0.4);
        const ay2 = y2 - len * Math.sin(angle + 0.4);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${base}/>
<line x1="${x2}" y1="${y2}" x2="${ax1}" y2="${ay1}" ${base}/>
<line x1="${x2}" y1="${y2}" x2="${ax2}" y2="${ay2}" ${base}/>`;
      }
      case 'rect': {
        const rx = Math.min(el.x1, el.x2 ?? el.x1) + ox;
        const ry = Math.min(el.y1, el.y2 ?? el.y1) + oy;
        const rw = Math.abs((el.x2 ?? el.x1) - el.x1);
        const rh = Math.abs((el.y2 ?? el.y1) - el.y1);
        return `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="4" ${base}/>`;
      }
      case 'ellipse': {
        const cx = ((el.x1 + (el.x2 ?? el.x1)) / 2) + ox;
        const cy = ((el.y1 + (el.y2 ?? el.y1)) / 2) + oy;
        const rx = Math.abs((el.x2 ?? el.x1) - el.x1) / 2;
        const ry = Math.abs((el.y2 ?? el.y1) - el.y1) / 2;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${Math.max(rx, 1)}" ry="${Math.max(ry, 1)}" ${base}/>`;
      }
      case 'text': {
        const fs = Math.max(14, sw * 6);
        return `<text x="${el.x1 + ox}" y="${el.y1 + oy}" font-family="monospace" font-size="${fs}" fill="${color}" opacity="${op}">${(el.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`;
      }
      default: return '';
    }
  }).filter(Boolean).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${svgEls}
</svg>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(text: string, filename: string, mime: string) {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export default function ImportExportMenu({ elements, onImport, getCanvasBlob, getSVGString }: ImportExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmImport, setConfirmImport] = useState<DrawElement[] | null>(null);
  const [importError, setImportError] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const timestamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExportJSON = () => {
    const data = JSON.stringify({ version: VERSION, elements }, null, 2);
    downloadText(data, `inksync_${timestamp()}.json`, 'application/json');
    setOpen(false);
  };

  const handleExportPNG = async () => {
    setExporting('PNG');
    setOpen(false);
    const blob = await getCanvasBlob();
    setExporting(null);
    if (blob) downloadBlob(blob, `inksync_${timestamp()}.png`);
  };

  const handleExportSVG = () => {
    const svg = elementsToSVG(elements);
    downloadText(svg, `inksync_${timestamp()}.svg`, 'image/svg+xml');
    setOpen(false);
  };

  // ── Import ─────────────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportError('');

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(parsed?.elements)) throw new Error('Invalid format');
        setConfirmImport(parsed.elements as DrawElement[]);
        setOpen(false);
      } catch {
        setImportError('Invalid file — make sure it\'s an ink·sync JSON export.');
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = () => {
    if (!confirmImport) return;
    onImport(confirmImport);
    setConfirmImport(null);
  };

  // ── Shared styles ──────────────────────────────────────────────────────────

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 9,
    width: '100%', padding: '7px 10px', borderRadius: 8,
    border: 'none', background: 'transparent',
    cursor: 'pointer', textAlign: 'left',
    color: 'var(--ink)', fontSize: 12,
    fontFamily: 'DM Mono, monospace',
    transition: 'background 0.12s',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      {/* Trigger button */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(o => !o)}
          className="toolbar"
          style={{
            padding: '7px 13px', cursor: 'pointer', gap: 6,
            display: 'flex', alignItems: 'center',
            borderColor: open ? 'var(--accent)' : 'var(--canvas-grid)',
            background: open ? 'var(--chalk)' : 'var(--paper)',
            transition: 'all 0.15s', fontSize: 11,
            color: 'var(--muted)', fontFamily: 'DM Mono, monospace',
          }}
        >
          <span style={{ color: open ? 'var(--accent)' : 'var(--muted)' }}>⇅</span>
          <span>import · export</span>
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none"
            style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            <path d="M1.5 3l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Dropdown */}
        {open && (
          <>
            {/* Backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 98 }}
              onClick={() => setOpen(false)}
            />
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', left: 0,
              background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
              borderRadius: 14, padding: 6, minWidth: 200,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
              zIndex: 99,
              animation: 'slideUp 0.15s ease',
            }}>
              {/* Export section */}
              <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--muted)', padding: '4px 10px 6px' }}>
                EXPORT
              </div>

              {(['JSON', 'PNG', 'SVG'] as const).map(fmt => {
                const icons: Record<string, string> = {
                  JSON: '{ }',
                  PNG:  '🖼',
                  SVG:  '◈',
                };
                const descs: Record<string, string> = {
                  JSON: 'Full fidelity · re-importable',
                  PNG:  'Flat image',
                  SVG:  'Vector',
                };
                const handlers: Record<string, () => void> = {
                  JSON: handleExportJSON,
                  PNG:  handleExportPNG,
                  SVG:  handleExportSVG,
                };
                return (
                  <button
                    key={fmt}
                    style={itemStyle}
                    onClick={handlers[fmt]}
                    disabled={elements.length === 0}
                    onMouseEnter={e => { if (elements.length > 0) (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{
                      width: 26, height: 26, borderRadius: 6,
                      background: 'var(--chalk)', border: '1px solid var(--canvas-grid)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, flexShrink: 0,
                      opacity: elements.length === 0 ? 0.4 : 1,
                    }}>{exporting === fmt ? '…' : icons[fmt]}</span>
                    <div style={{ opacity: elements.length === 0 ? 0.4 : 1 }}>
                      <div style={{ fontWeight: 500 }}>Export {fmt}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{descs[fmt]}</div>
                    </div>
                  </button>
                );
              })}

              <div style={{ height: 1, background: 'var(--canvas-grid)', margin: '4px 8px' }} />

              {/* Import section */}
              <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--muted)', padding: '4px 10px 6px' }}>
                IMPORT
              </div>

              <button
                style={itemStyle}
                onClick={() => fileInputRef.current?.click()}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: 'var(--chalk)', border: '1px solid var(--canvas-grid)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, flexShrink: 0,
                }}>↑</span>
                <div>
                  <div style={{ fontWeight: 500 }}>Import JSON</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>Load a saved drawing</div>
                </div>
              </button>

              {importError && (
                <div style={{ fontSize: 10, color: 'var(--danger)', padding: '4px 10px' }}>{importError}</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Confirm import dialog — portaled to body so fixed positioning is always viewport-relative */}
      {confirmImport && typeof window !== 'undefined' && createPortal((
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.15s ease',
        }}>
          <div style={{
            background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
            borderRadius: 16, padding: 28, maxWidth: 360, width: '90%',
            boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
            fontFamily: 'DM Mono, monospace',
            animation: 'slideUp 0.2s ease',
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
              Replace canvas?
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
              This will replace everything on the canvas with{' '}
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{confirmImport.length} element{confirmImport.length !== 1 ? 's' : ''}</span>{' '}
              from the imported file. This action can be undone.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleConfirmImport}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
                  background: 'var(--ink)', color: 'var(--canvas)',
                  fontFamily: 'DM Mono, monospace', fontSize: 12,
                  fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--ink)'; }}
              >
                Replace canvas
              </button>
              <button
                onClick={() => setConfirmImport(null)}
                style={{
                  padding: '9px 16px', borderRadius: 9,
                  border: '1.5px solid var(--canvas-grid)',
                  background: 'transparent', color: 'var(--muted)',
                  fontFamily: 'DM Mono, monospace', fontSize: 12,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--ink)'; e.currentTarget.style.color = 'var(--ink)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--canvas-grid)'; e.currentTarget.style.color = 'var(--muted)'; }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}