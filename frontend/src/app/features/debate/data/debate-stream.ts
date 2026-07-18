import { Service } from '@angular/core';

import { environment } from '../../../../environments/environment';

/** Thin wrapper around the native WebSocket so `DebateThread` stays focused
 * on UI/state and the connection is mockable in unit tests without a real
 * socket. Backend: `WS /api/debates/{id}/stream` (spec 0013/ADR 0006). */
@Service()
export class DebateStream {
  private socket: WebSocket | null = null;

  /** Access token rides as the sole WS subprotocol (ADR 0006 decision 4) —
   * browsers can't set custom headers on a WS handshake, and this avoids
   * the token landing in plaintext access logs a query param would hit. */
  connect(debateId: number, accessToken: string, onMessage: () => void, onUnexpectedClose: () => void): void {
    this.disconnect();
    const socket = new WebSocket(
      `${environment.orchestratorWsBase}/api/debates/${debateId}/stream`,
      [accessToken],
    );
    socket.onmessage = onMessage;
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
