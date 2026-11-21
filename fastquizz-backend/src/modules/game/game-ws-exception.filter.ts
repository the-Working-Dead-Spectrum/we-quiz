import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { GameErrorPayload, isGameErrorPayload } from './game-errors';

const MAX_VALIDATION_MESSAGE_LENGTH = 300;
const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred';

/**
 * Catch-all filter for the game gateway.
 *
 * Nest's BaseWsExceptionFilter calls `client.emit('exception')`, which sends nothing over a raw `ws`
 * socket. This filter sends the ADR 0001 `error` envelope with `client.send()` instead:
 * - WsException carrying `{ code, message }` (including GameError) -> forwarded as is
 * - BadRequestException (ValidationPipe) -> VALIDATION_ERROR
 * - anything else -> INTERNAL_ERROR (logged server-side, no stack sent to the client)
 */
@Catch()
export class GameWsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GameWsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<WebSocket | undefined>();
    const payload = this.toPayload(exception);

    if (!client || client.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      client.send(JSON.stringify({ event: 'error', data: payload }));
    } catch (sendError) {
      this.logger.warn(`Failed to send error event: ${describe(sendError)}`);
    }
  }

  toPayload(exception: unknown): GameErrorPayload {
    if (exception instanceof WsException) {
      const error = exception.getError();
      if (isGameErrorPayload(error)) {
        return { code: error.code, message: error.message };
      }
    }

    if (exception instanceof BadRequestException) {
      return { code: 'VALIDATION_ERROR', message: extractValidationMessage(exception) };
    }

    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(`Unhandled exception in game gateway: ${describe(exception)}`, stack);
    return { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE };
  }
}

function extractValidationMessage(exception: BadRequestException): string {
  const response = exception.getResponse();
  let message: string = exception.message;
  if (typeof response === 'object' && response !== null) {
    const raw = (response as { message?: unknown }).message;
    if (Array.isArray(raw)) {
      message = raw.filter((item): item is string => typeof item === 'string').join('; ');
    } else if (typeof raw === 'string') {
      message = raw;
    }
  }
  if (!message) {
    message = 'Invalid payload';
  }
  return message.length > MAX_VALIDATION_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_VALIDATION_MESSAGE_LENGTH)}...`
    : message;
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}
