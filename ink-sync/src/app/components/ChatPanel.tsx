'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  text: string;
  timestamp: number;
  reactions: Record<string, string[]>;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUserId: string;
  currentUserName: string;
  users: { id: string; name: string; color: string }[];
  onSendMessage: (text: string) => void;
  onAddReaction: (messageId: string, emoji: string) => void;
}

const EMOJI_PICKER = ['👍', '❤️', '😂', '😮', '🔥', '✅'];
const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 420;

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderText(text: string, users: { id: string; name: string; color: string }[]) {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const matched = users.find(u => u.name.toLowerCase() === part.slice(1).toLowerCase());
      if (matched) {
        return (
          <span key={i} style={{
            color: matched.color, fontWeight: 600,
            background: `${matched.color}18`, borderRadius: 3, padding: '0 2px',
          }}>{part}</span>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ChatPanel({
  messages, currentUserId, currentUserName, users, onSendMessage, onAddReaction,
}: ChatPanelProps) {
  const [minimized, setMinimized] = useState(true);
  const [input, setInput] = useState('');
  const [unread, setUnread] = useState(0);
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSeenCount = useRef(0);
  // Prevents the document mousedown listener from immediately closing the picker
  // on the same event that opened it.
  const justOpenedEmojiRef = useRef(false);

  // ── Unread tracking ───────────────────────────────────────────────────────

  useEffect(() => {
    if (minimized) {
      const newMsgs = messages.length - lastSeenCount.current;
      if (newMsgs > 0) setUnread(prev => prev + newMsgs);
      lastSeenCount.current = messages.length;
    } else {
      setUnread(0);
      lastSeenCount.current = messages.length;
    }
  }, [messages, minimized]);

  useEffect(() => {
    if (!minimized) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, minimized]);

  const handleOpen = () => {
    setMinimized(false);
    setUnread(0);
    lastSeenCount.current = messages.length;
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      inputRef.current?.focus();
    }, 50);
  };

  // ── Emoji picker close on outside click ───────────────────────────────────

  useEffect(() => {
    if (!showEmojiFor) return;
    const handler = () => {
      if (justOpenedEmojiRef.current) {
        justOpenedEmojiRef.current = false;
        return;
      }
      setShowEmojiFor(null);
      setEmojiPickerPos(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiFor]);

  // ── @mention autocomplete ─────────────────────────────────────────────────

  const mentionCandidates = mentionQuery !== null
    ? users.filter(u => u.id !== currentUserId && u.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : [];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    const cursor = e.target.selectionStart ?? val.length;
    const match = val.slice(0, cursor).match(/@(\w*)$/);
    if (match) { setMentionQuery(match[1]); setMentionIndex(0); }
    else setMentionQuery(null);
  };

  const insertMention = (name: string) => {
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const replaced = input.slice(0, cursor).replace(/@(\w*)$/, `@${name} `);
    setInput(replaced + input.slice(cursor));
    setMentionQuery(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown')  { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionCandidates.length); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && mentionCandidates.length > 0)) {
        e.preventDefault(); insertMention(mentionCandidates[mentionIndex].name); return;
      }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') setMinimized(true);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput('');
    setMentionQuery(null);
  };

  // ── Minimized pill ────────────────────────────────────────────────────────

  if (minimized) {
    return (
      <button
        onClick={handleOpen}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 200,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px',
          background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
          borderRadius: 100,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          cursor: 'pointer', fontFamily: 'DM Mono, monospace',
          transition: 'all 0.15s', color: 'var(--ink)',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(108,99,255,0.15)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--canvas-grid)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)'; }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--accent)', flexShrink: 0 }}>
          <path d="M7 1C3.69 1 1 3.24 1 6c0 1.5.7 2.84 1.83 3.78L2.5 13l3.1-1.55A6.7 6.7 0 0 0 7 11.5c3.31 0 6-2.24 6-5s-2.69-5-6-5z"
            stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
        </svg>
        <span style={{ fontSize: 12, fontWeight: 500 }}>chat</span>
        {unread > 0 && (
          <span style={{
            background: 'var(--accent)', color: 'white', borderRadius: 100,
            fontSize: 10, fontWeight: 600, padding: '1px 6px',
            minWidth: 18, textAlign: 'center',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────────

  return (
    <>
      {/* Fixed emoji picker — rendered outside the scroll container so it never clips */}
      {showEmojiFor && emojiPickerPos && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: emojiPickerPos.x,
            top: emojiPickerPos.y - 52,
            transform: 'translateX(-50%)',
            background: 'var(--paper)',
            border: '1.5px solid var(--canvas-grid)',
            borderRadius: 10, padding: '5px 8px',
            display: 'flex', gap: 2,
            boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
            zIndex: 300,
            whiteSpace: 'nowrap',
          }}
        >
          {EMOJI_PICKER.map(emoji => (
            <button
              key={emoji}
              onMouseDown={e => {
                e.stopPropagation();
                onAddReaction(showEmojiFor, emoji);
                setShowEmojiFor(null);
                setEmojiPickerPos(null);
              }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, padding: '3px 4px', borderRadius: 6,
                transition: 'transform 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 200,
        width: PANEL_WIDTH,
        background: 'var(--paper)', border: '1.5px solid var(--canvas-grid)',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)',
        fontFamily: 'DM Mono, monospace',
        display: 'flex', flexDirection: 'column',
        animation: 'chatIn 0.18s ease forwards',
        overflow: 'visible',
      }}>
        <style>{`
          @keyframes chatIn {
            from { opacity: 0; transform: translateY(10px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
          .chat-msg:hover .chat-react-btn { opacity: 1 !important; }
        `}</style>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 10px 10px 14px',
          borderBottom: '1px solid var(--canvas-grid)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--accent)' }}>
              <path d="M7 1C3.69 1 1 3.24 1 6c0 1.5.7 2.84 1.83 3.78L2.5 13l3.1-1.55A6.7 6.7 0 0 0 7 11.5c3.31 0 6-2.24 6-5s-2.69-5-6-5z"
                stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--muted)' }}>CHAT</span>
            <span style={{ fontSize: 10, color: 'var(--canvas-grid)' }}>·</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{users.length} online</span>
          </div>
          <button
            onClick={() => setMinimized(true)}
            style={{
              width: 24, height: 24, borderRadius: 6, border: 'none',
              background: 'transparent', cursor: 'pointer', color: 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--chalk)'; e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
          >−</button>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '8px 10px',
          display: 'flex', flexDirection: 'column', gap: 2,
          maxHeight: PANEL_HEIGHT - 110, minHeight: 200,
        }}>
          {messages.length === 0 && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)', fontSize: 11, gap: 8, padding: '32px 0',
            }}>
              <svg width="28" height="28" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.3 }}>
                <path d="M7 1C3.69 1 1 3.24 1 6c0 1.5.7 2.84 1.83 3.78L2.5 13l3.1-1.55A6.7 6.7 0 0 0 7 11.5c3.31 0 6-2.24 6-5s-2.69-5-6-5z"
                  stroke="var(--muted)" strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
              <span>No messages yet</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>Say something!</span>
            </div>
          )}

          {messages.map((msg, idx) => {
            const isOwn = msg.userId === currentUserId;
            const prevMsg = messages[idx - 1];
            const showAvatar = !prevMsg || prevMsg.userId !== msg.userId;
            const reactionEntries = Object.entries(msg.reactions).filter(([, uids]) => uids.length > 0);

            return (
              <div
                key={msg.id}
                className="chat-msg"
                style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: isOwn ? 'flex-end' : 'flex-start',
                  marginTop: showAvatar && idx > 0 ? 8 : 1,
                }}
              >
                {showAvatar && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                    paddingLeft: isOwn ? 0 : 4, paddingRight: isOwn ? 4 : 0,
                    flexDirection: isOwn ? 'row-reverse' : 'row',
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: msg.userColor, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 600, color: 'white',
                    }}>{msg.userName[0]?.toUpperCase()}</div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>
                      {isOwn ? 'you' : msg.userName}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.6 }}>
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                )}

                {/* Bubble + react button */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  flexDirection: isOwn ? 'row-reverse' : 'row',
                  maxWidth: '88%',
                }}>
                  <div style={{
                    padding: '6px 10px',
                    background: isOwn ? 'var(--accent)' : 'var(--chalk)',
                    color: isOwn ? 'white' : 'var(--ink)',
                    borderRadius: isOwn ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    fontSize: 12, lineHeight: 1.5, wordBreak: 'break-word',
                    border: isOwn ? 'none' : '1px solid var(--canvas-grid)',
                  }}>
                    {renderText(msg.text, users)}
                  </div>

                  <button
                    className="chat-react-btn"
                    onMouseDown={e => {
                      e.stopPropagation();
                      if (showEmojiFor === msg.id) {
                        setShowEmojiFor(null);
                        setEmojiPickerPos(null);
                      } else {
                        justOpenedEmojiRef.current = true;
                        const rect = e.currentTarget.getBoundingClientRect();
                        setShowEmojiFor(msg.id);
                        setEmojiPickerPos({ x: rect.left + rect.width / 2, y: rect.top });
                      }
                    }}
                    style={{
                      opacity: 0, width: 22, height: 22,
                      borderRadius: '50%', border: '1px solid var(--canvas-grid)',
                      background: 'var(--paper)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, transition: 'opacity 0.15s', flexShrink: 0,
                    }}
                    title="React"
                  >＋</button>
                </div>

                {/* Reactions */}
                {reactionEntries.length > 0 && (
                  <div style={{
                    display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3,
                    paddingLeft: isOwn ? 0 : 4, paddingRight: isOwn ? 4 : 0,
                    justifyContent: isOwn ? 'flex-end' : 'flex-start',
                  }}>
                    {reactionEntries.map(([emoji, uids]) => (
                      <button
                        key={emoji}
                        onClick={() => onAddReaction(msg.id, emoji)}
                        title={uids.map(uid => users.find(u => u.id === uid)?.name ?? uid).join(', ')}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 3,
                          padding: '2px 6px', borderRadius: 100,
                          border: `1.5px solid ${uids.includes(currentUserId) ? 'var(--accent)' : 'var(--canvas-grid)'}`,
                          background: uids.includes(currentUserId) ? 'var(--accent-glow)' : 'var(--chalk)',
                          cursor: 'pointer', fontSize: 11,
                          fontFamily: 'DM Mono, monospace', transition: 'all 0.12s',
                        }}
                      >
                        <span>{emoji}</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{uids.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* @mention autocomplete — floats above the input */}
        {mentionCandidates.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: 58, left: 8, right: 8,
            background: 'var(--paper)',
            border: '1.5px solid var(--canvas-grid)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.1)',
            zIndex: 10,
          }}>
            {mentionCandidates.map((u, i) => (
              <button
                key={u.id}
                onMouseDown={e => { e.preventDefault(); insertMention(u.name); }}
                style={{
                  width: '100%', padding: '7px 12px', border: 'none',
                  background: i === mentionIndex ? 'var(--chalk)' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', fontFamily: 'DM Mono, monospace',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', background: u.color,
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: 'white', fontWeight: 600,
                }}>{u.name[0]?.toUpperCase()}</div>
                <span style={{ fontSize: 12, color: 'var(--ink)' }}>{u.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: '8px', borderTop: '1px solid var(--canvas-grid)',
          display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0,
        }}>
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Message... (@ to mention)"
            maxLength={500}
            style={{
              flex: 1, background: 'var(--chalk)',
              border: '1.5px solid var(--canvas-grid)',
              borderRadius: 8, padding: '7px 10px',
              fontFamily: 'DM Mono, monospace', fontSize: 12,
              color: 'var(--ink)', outline: 'none', transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.target.style.borderColor = 'var(--canvas-grid)')}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            style={{
              width: 34, height: 34, borderRadius: 8, border: 'none',
              background: input.trim() ? 'var(--accent)' : 'var(--canvas-grid)',
              color: 'white', cursor: input.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1 6.5h10M7 2.5l4 4-4 4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}