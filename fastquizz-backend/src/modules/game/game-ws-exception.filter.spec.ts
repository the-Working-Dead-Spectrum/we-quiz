import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { GameWsExceptionFilter } from './game-ws-exception.filter';
import { GameError } from './game-errors';

describe('GameWsExceptionFilter', () => {
  let filter: GameWsExceptionFilter;
  let client: { readyState: number; send: jest.Mock };

  const hostFor = (socket: unknown): ArgumentsHost =>
    ({ switchToWs: () => ({ getClient: () => socket }) }) as unknown as ArgumentsHost;

  const sentEnvelope = () => JSON.parse(client.send.mock.calls[0][0]);

  beforeEach(() => {
    filter = new GameWsExceptionFilter();
    client = { readyState: WebSocket.OPEN, send: jest.fn() };
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('forwards a GameError as is', () => {
    filter.catch(new GameError('HOST_UNAUTHORIZED', 'Invalid host token for this game'), hostFor(client));

    expect(sentEnvelope()).toEqual({
      event: 'error',
      data: { code: 'HOST_UNAUTHORIZED', message: 'Invalid host token for this game' },
    });
  });

  it('forwards a WsException carrying { code, message } as is', () => {
    filter.catch(new WsException({ code: 'ROOM_FULL', message: 'Full' }), hostFor(client));
    expect(sentEnvelope().data).toEqual({ code: 'ROOM_FULL', message: 'Full' });
  });

  it('maps a ValidationPipe BadRequestException to VALIDATION_ERROR with the validation messages', () => {
    filter.catch(
      new BadRequestException(['pin must be 6 to 8 alphanumeric characters', 'property foo should not exist']),
      hostFor(client),
    );

    expect(sentEnvelope().data).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'pin must be 6 to 8 alphanumeric characters; property foo should not exist',
    });
  });

  it('maps any other exception to INTERNAL_ERROR, logs it and never sends the stack', () => {
    const error = new Error('connection refused to 10.0.0.1');

    filter.catch(error, hostFor(client));

    expect(sentEnvelope().data).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    expect(client.send.mock.calls[0][0]).not.toContain('10.0.0.1');
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('maps a WsException with an unknown shape to INTERNAL_ERROR', () => {
    filter.catch(new WsException('Forbidden resource'), hostFor(client));
    expect(sentEnvelope().data.code).toBe('INTERNAL_ERROR');
  });

  it('does not send anything to a socket that is not open', () => {
    client.readyState = WebSocket.CLOSING;
    filter.catch(new GameError('UNAUTHORIZED', 'x'), hostFor(client));
    expect(client.send).not.toHaveBeenCalled();
  });
});
