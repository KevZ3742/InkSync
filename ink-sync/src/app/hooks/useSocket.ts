'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { DrawElement } from '../components/DrawingCanvas';
import { ChatMessage } from '../components/ChatPanel';

interface User {
  id: string;
  name: string;
  color: string;
}

interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface UseSocketReturn {
  connected: boolean;
  users: User[];
  remoteCursors: RemoteCursor[];
  chatMessages: ChatMessage[];
  sendElements: (elements: DrawElement[]) => void;
  sendCursorMove: (x: number, y: number) => void;
  sendCursorLeave: () => void;
  sendChatMessage: (text: string) => void;
  sendChatReaction: (messageId: string, emoji: string) => void;
}

function dedupe(users: User[]): User[] {
  return Array.from(new Map(users.map(u => [u.id, u])).values());
}

export function useSocket(
  roomCode: string | null,
  userName: string | null,
  userId: string | null,
  onElementsUpdate: (elements: DrawElement[]) => void,
): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const onElementsUpdateRef = useRef(onElementsUpdate);
  useEffect(() => { onElementsUpdateRef.current = onElementsUpdate; }, [onElementsUpdate]);

  const msgCounterRef = useRef(0);

  useEffect(() => {
    if (!roomCode || !userName || !userId) return;

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const socket = io({ transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-room', { roomCode, userName, userId });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('room-state', ({ elements, users: incoming, chatMessages: history }: {
      elements: DrawElement[];
      users: User[];
      chatMessages: ChatMessage[];
    }) => {
      onElementsUpdateRef.current(elements);
      setUsers(prev => dedupe([...incoming, ...prev]));
      setChatMessages(history ?? []);
    });

    socket.on('user-joined', (user: User) => {
      setUsers(prev => dedupe([...prev, user]));
    });

    socket.on('user-left', ({ userId: uid }: { userId: string }) => {
      setUsers(prev => prev.filter(u => u.id !== uid));
      setRemoteCursors(prev => prev.filter(c => c.userId !== uid));
    });

    socket.on('draw-elements', ({ elements }: { elements: DrawElement[] }) => {
      onElementsUpdateRef.current(elements);
    });

    socket.on('cursor-move', (data: RemoteCursor) => {
      setRemoteCursors(prev => {
        const filtered = prev.filter(c => c.userId !== data.userId);
        return [...filtered, data];
      });
    });

    socket.on('cursor-leave', ({ userId: uid }: { userId: string }) => {
      setRemoteCursors(prev => prev.filter(c => c.userId !== uid));
    });

    socket.on('chat-message', ({ message }: { message: ChatMessage }) => {
      setChatMessages(prev => [...prev, message]);
    });

    socket.on('chat-reaction', ({ messageId, reactions }: { messageId: string; emoji: string; reactions: Record<string, string[]> }) => {
      setChatMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, reactions } : m
      ));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, userName, userId]);

  const sendElements = useCallback((elements: DrawElement[]) => {
    socketRef.current?.emit('draw-elements', { elements });
  }, []);

  const sendCursorMove = useCallback((x: number, y: number) => {
    socketRef.current?.emit('cursor-move', { x, y });
  }, []);

  const sendCursorLeave = useCallback(() => {
    socketRef.current?.emit('cursor-leave');
  }, []);

  const sendChatMessage = useCallback((text: string) => {
    if (!userId) return;
    const id = `msg_${Date.now()}_${msgCounterRef.current++}`;
    socketRef.current?.emit('chat-message', { message: { id, text } });
  }, [userId]);

  const sendChatReaction = useCallback((messageId: string, emoji: string) => {
    socketRef.current?.emit('chat-reaction', { messageId, emoji });
  }, []);

  return {
    connected, users, remoteCursors, chatMessages,
    sendElements, sendCursorMove, sendCursorLeave,
    sendChatMessage, sendChatReaction,
  };
}