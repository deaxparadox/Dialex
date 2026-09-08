'use client';

import { useRef } from 'react';
import { config } from './config';

// Ported from frontend/src/app/features/debate/data/debate-stream.ts.
export type DebateStreamEvent =
  | { type: 'argument_complete'; argument_id: number }
  | { type: 'status_change'; status: string }
  | { type: 'opening_statement_complete' }
  | {
      type: 'turn_started';
      agent_persona_id: number;
      agent_name: string;
      stage: 'opening_statement' | 'argument' | 'verdict';
      round_number: number | null;
    }
  | {
      type: 'turn_token';
      agent_persona_id: number;
      stage: 'opening_statement' | 'argument' | 'verdict';
      round_number: number | null;
      token: string;
    }
  | {
      type: 'turn_token_reset';
      agent_persona_id: number;
      stage: 'opening_statement' | 'argument' | 'verdict';
      round_number: number | null;
    };

const orchestratorWsBase = config.orchestratorApiBase.replace(/^http/, 'ws');

// Thin wrapper around the native WebSocket, same shape as the Angular
// service it ports — kept as a hook so a single socket ref survives
// re-renders without being recreated.
export function useDebateStream() {
  const socketRef = useRef<WebSocket | null>(null);

  function disconnect(): void {
    if (socketRef.current) {
      socketRef.current.onclose = null; // deliberate close — don't trigger the fallback
      socketRef.current.close();
      socketRef.current = null;
    }
  }

  function connect(
    debateId: number,
    accessToken: string,
    onMessage: (event: DebateStreamEvent) => void,
    onUnexpectedClose: () => void
  ): void {
    disconnect();
    const socket = new WebSocket(`${orchestratorWsBase}/api/debates/${debateId}/stream`, [accessToken]);
    socket.onmessage = (raw: MessageEvent<string>) => onMessage(JSON.parse(raw.data) as DebateStreamEvent);
    socket.onclose = (event) => {
      if (socketRef.current === socket && !event.wasClean) onUnexpectedClose();
    };
    socketRef.current = socket;
  }

  return { connect, disconnect };
}
