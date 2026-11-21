import { CanActivate, ExecutionContext } from '@nestjs/common';
import { WebSocket } from 'ws';

/**
 * Rejects messages coming from a socket that is no longer OPEN.
 *
 * A socket refused by the Origin check is closed with code 1008 in `handleConnection`, but a client can
 * still push frames before the closing handshake completes; this guard makes sure none of them reaches a
 * handler.
 */
export class OpenSocketGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<WebSocket | undefined>();
    return !!client && client.readyState === WebSocket.OPEN;
  }
}
