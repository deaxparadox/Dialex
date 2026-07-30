import { Service } from '@angular/core';

import { environment } from '../../../../environments/environment';

/** The event types published on `debate:{id}:stream` (ADR 0006, specs
 * 0018/0019) — `turn_started` carries no persisted content (nothing to
 * refetch), the others mean "something changed, go re-fetch." */
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
    };

/** Thin wrapper around the native WebSocket so `DebateThread` stays focused
 * on UI/state and the connection is mockable in unit tests without a real
 * socket. Backend: `WS /api/debates/{id}/stream` (spec 0013/ADR 0006). */
@Service()
export class DebateStream {
  private socket: WebSocket | null = null;

  /** Access token rides as the sole WS subprotocol (ADR 0006 decision 4) —
   * browsers can't set custom headers on a WS handshake, and this avoids
   * the token landing in plaintext access logs a query param would hit. */
  connect(
    debateId: number,
    accessToken: string,
    onMessage: (event: DebateStreamEvent) => void,
    onUnexpectedClose: () => void,
  ): void {
    this.disconnect();
    const socket = new WebSocket(
      `${environment.orchestratorWsBase}/api/debates/${debateId}/stream`,
      [accessToken],
    );
    socket.onmessage = (raw: MessageEvent<string>) => onMessage(JSON.parse(raw.data) as DebateStreamEvent);
    socket.onclose = (event) => {
      if (this.socket === socket && !event.wasClean) onUnexpectedClose();
    };
    this.socket = socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.onclose = null; // deliberate close — don't trigger the fallback
      this.socket.close();
      this.socket = null;
    }
  }
}
