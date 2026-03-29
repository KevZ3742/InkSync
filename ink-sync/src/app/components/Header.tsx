'use client';

import { useState, useRef, useEffect } from 'react';
import ImportExportMenu from './ImportExportMenu';
import { DrawElement } from './DrawingCanvas';

interface HeaderProps {
  roomCode: string;
  users: { id: string; name: string; color: string }[];
  myName: string;
  onLeave: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  elements: DrawElement[];
  onImport: (elements: DrawElement[]) => void;
  getCanvasBlob: () => Promise<Blob | null>;
}

export default function Header({
  roomCode, users, myName, onLeave, isDark, onToggleTheme,
  elements, onImport, getCanvasBlob,
}: HeaderProps) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const uniqueUsers = Array.from(new Map(users.map(u => [u.id, u])).values());

  useEffect(() => {
    if (!usersOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setUsersOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [usersOpen]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const getSVGString = () => ''; // SVG export is handled inside ImportExportMenu

  const SunIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );

  const MoonIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );

  return (
    <div
      className="absolute top-4 left-0 right-0 z-10 animate-slide-up pointer-events-none"
      style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '0 20px', gap: 12 }}
    >
      {/* Left: Logo + Import/Export */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 10 }}>
        <div className="toolbar pointer-events-auto" style={{ padding: '9px 18px' }}>
          <span className="font-serif" style={{ fontSize: 18, fontStyle: 'italic', color: 'var(--ink)' }}>
            ink<span style={{ color: 'var(--accent)' }}>sync</span>
          </span>
        </div>

        <div className="pointer-events-auto">
          <ImportExportMenu
            elements={elements}
            onImport={onImport}
            getCanvasBlob={getCanvasBlob}
            getSVGString={getSVGString}
          />
        </div>
      </div>

      {/* Center: Room code pill */}
      <div
        className="toolbar pointer-events-auto"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px 7px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
      >
        <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', flexShrink: 0 }}>ROOM</span>
        <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--canvas-grid)', flexShrink: 0 }} />
        <span style={{
          fontWeight: 600, fontSize: 14, letterSpacing: '0.2em', color: 'var(--ink)',
          filter: revealed ? 'none' : 'blur(6px)',
          userSelect: revealed ? 'text' : 'none',
          transition: 'filter 0.3s ease',
          minWidth: 76, textAlign: 'center',
        }}>
          {roomCode}
        </span>

        <button
          onClick={() => setRevealed(r => !r)}
          title={revealed ? 'Hide room code' : 'Reveal room code'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 7,
            border: '1.5px solid var(--canvas-grid)',
            background: revealed ? 'var(--chalk)' : 'transparent',
            color: revealed ? 'var(--ink)' : 'var(--muted)',
            cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ink)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--canvas-grid)'; (e.currentTarget as HTMLElement).style.color = revealed ? 'var(--ink)' : 'var(--muted)'; }}
        >
          {revealed ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          )}
        </button>

        <button
          onClick={handleCopy}
          title="Copy room code"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', borderRadius: 8,
            border: '1.5px solid var(--canvas-grid)',
            background: copied ? 'var(--ink)' : 'var(--chalk)',
            color: copied ? 'var(--canvas)' : 'var(--muted)',
            cursor: 'pointer', fontFamily: 'DM Mono, monospace', fontSize: 11,
            transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
          }}
          onMouseEnter={e => { if (!copied) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ink)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; } }}
          onMouseLeave={e => { if (!copied) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--canvas-grid)'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; } }}
        >
          {copied ? (
            <><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>copied!</>
          ) : (
            <><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="4" y="1" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M1 4.5V10a1 1 0 001 1h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>copy</>
          )}
        </button>
      </div>

      {/* Right: theme + users + leave */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>

        <button className="theme-toggle pointer-events-auto" onClick={onToggleTheme} title={isDark ? 'Light mode' : 'Dark mode'}>
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>

        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setUsersOpen(o => !o)}
            className="toolbar pointer-events-auto"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 12px', cursor: 'pointer',
              borderColor: usersOpen ? 'var(--accent)' : 'var(--canvas-grid)',
              background: usersOpen ? 'var(--chalk)' : 'var(--paper)',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {uniqueUsers.slice(0, 4).map((user, i) => (
                <div key={user.id} style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: user.color, border: '2px solid var(--paper)',
                  marginLeft: i > 0 ? -7 : 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, color: 'white',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  zIndex: uniqueUsers.length - i, position: 'relative', flexShrink: 0,
                }}>
                  {user.name[0]?.toUpperCase()}
                </div>
              ))}
              {uniqueUsers.length > 4 && (
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'var(--muted)', border: '2px solid var(--paper)',
                  marginLeft: -7, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 9, color: 'white',
                  position: 'relative', zIndex: 0, flexShrink: 0,
                }}>
                  +{uniqueUsers.length - 4}
                </div>
              )}
            </div>

            <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {uniqueUsers.length} online
            </span>

            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
              style={{ color: 'var(--muted)', transition: 'transform 0.2s ease', transform: usersOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
            >
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {usersOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
              borderRadius: 14, padding: '6px',
              minWidth: 210,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
              animation: 'slideUp 0.15s ease',
              zIndex: 50,
            }}>
              <div style={{
                fontSize: 9, letterSpacing: '0.12em', color: 'var(--muted)',
                padding: '6px 10px 8px', borderBottom: '1px solid var(--canvas-grid)',
                marginBottom: 4,
              }}>
                IN THIS ROOM · {uniqueUsers.length}
              </div>

              {uniqueUsers.map(user => (
                <div
                  key={user.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 9,
                    transition: 'background 0.1s', cursor: 'default',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--chalk)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: user.color, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 600, color: 'white',
                    textShadow: '0 1px 3px rgba(0,0,0,0.25)',
                  }}>
                    {user.name[0]?.toUpperCase()}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 500, color: 'var(--ink)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {user.name}
                    </span>
                    {user.name === myName && (
                      <span style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.1em', fontWeight: 600 }}>
                        YOU
                      </span>
                    )}
                  </div>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: 'var(--success)', flexShrink: 0,
                    boxShadow: '0 0 0 2px var(--paper)',
                  }} />
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          className="pointer-events-auto"
          onClick={onLeave}
          style={{
            padding: '9px 16px', fontSize: 11, color: 'var(--muted)',
            cursor: 'pointer', border: '1.5px solid var(--canvas-grid)',
            background: 'var(--paper)', borderRadius: 14,
            fontFamily: 'DM Mono, monospace', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--danger)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--danger)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--canvas-grid)'; }}
        >
          leave room
        </button>
      </div>
    </div>
  );
}