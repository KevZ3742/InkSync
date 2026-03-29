'use client';

import { useState } from 'react';

interface LandingProps {
  onJoin: (roomCode: string, userName: string) => void;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function Landing({ onJoin }: LandingProps) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [error, setError] = useState('');

  const handleCreate = () => {
    if (!name.trim()) { setError('Enter your name first'); return; }
    const code = generateRoomCode();
    onJoin(code, name.trim());
  };

  const handleJoin = () => {
    if (!name.trim()) { setError('Enter your name'); return; }
    if (roomCode.trim().length < 4) { setError('Enter a valid room code'); return; }
    onJoin(roomCode.trim().toUpperCase(), name.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center canvas-bg" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>

      {/* Floating background image */}
      <style>{`
        @keyframes floatRock {
          0%   { transform: translateX(-50%) rotate(-1.5deg) translateY(0px); }
          25%  { transform: translateX(-50%) rotate(0deg) translateY(-10px); }
          50%  { transform: translateX(-50%) rotate(1.5deg) translateY(0px); }
          75%  { transform: translateX(-50%) rotate(0deg) translateY(10px); }
          100% { transform: translateX(-50%) rotate(-1.5deg) translateY(0px); }
        }
      `}</style>
      <img
        src="/background_light.png"
        alt=""
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: '3%',
          left: '50%',
          width: '100vw',
          height: 'auto',
          zIndex: 0,
          pointerEvents: 'none',
          animation: 'floatRock 8s ease-in-out infinite',
          transformOrigin: 'center center',
          opacity: 0.9,
        }}
      />

      {/* Landing card — above background */}
        <div className="landing-card" style={{ position: 'relative', zIndex: 1 }}>
          {/* Logo */}
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <div className="font-serif" style={{ fontSize: 42, fontStyle: 'italic', lineHeight: 1, marginBottom: 8 }}>
              ink<span style={{ color: 'var(--accent)' }}>sync</span>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
              draw together, in real time
            </p>
          </div>

          {/* Name input — always shown */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              YOUR NAME
            </label>
            <input
              className="room-input"
              placeholder="Enter your name..."
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && mode === 'create') handleCreate();
                if (e.key === 'Enter' && mode === 'join') handleJoin();
              }}
              style={{ textTransform: 'none', letterSpacing: 'normal' }}
              autoFocus
            />
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>
              {error}
            </div>
          )}

          {mode === 'choose' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
              <button className="btn-primary" onClick={() => { if (!name.trim()) { setError('Enter your name first'); return; } setMode('create'); }}>
                ✦ Create new room
              </button>
              <div className="divider">or</div>
              <button className="btn-secondary" onClick={() => { if (!name.trim()) { setError('Enter your name first'); return; } setMode('join'); }}>
                Join existing room
              </button>
            </div>
          )}

          {mode === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'slideUp 0.2s ease' }}>
              <button className="btn-primary" onClick={handleCreate}>
                ✦ Create & enter room
              </button>
              <button className="btn-secondary" onClick={() => setMode('choose')}>
                ← Back
              </button>
            </div>
          )}

          {mode === 'join' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'slideUp 0.2s ease' }}>
              <div>
                <label style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  ROOM CODE
                </label>
                <input
                  className="room-input"
                  placeholder="ENTER CODE"
                  value={roomCode}
                  onChange={e => { setRoomCode(e.target.value.toUpperCase().slice(0, 8)); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  autoFocus
                  maxLength={8}
                />
              </div>
              <button className="btn-primary" onClick={handleJoin}>
                → Join room
              </button>
              <button className="btn-secondary" onClick={() => setMode('choose')}>
                ← Back
              </button>
            </div>
          )}

          {/* Footer hints */}
          <div style={{ marginTop: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 11, lineHeight: 1.8 }}>
            <div>pen · shapes · arrows · text · eraser</div>
            <div>real-time sync with up to 50 people</div>
          </div>
        </div>
    </div>
  );
}