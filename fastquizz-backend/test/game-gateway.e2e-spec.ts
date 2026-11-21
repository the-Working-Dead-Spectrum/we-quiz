import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { GameGateway } from '../src/modules/game/game.gateway';
import { GameService } from '../src/modules/game/game.service';
import { RoomService } from '../src/modules/game/room.service';
import { GameRedisService } from '../src/common/redis/game-redis.service';

/**
 * Transport-level e2e for the game gateway (ADR 0001 section 1 and 5): real `ws` server through WsAdapter,
 * real Nest pipeline (guard, ValidationPipe, exception filter). Game services are mocked: no DB / Redis needed.
 */
describe('GameGateway transport (e2e)', () => {
  const FRONTEND_URL = 'http://localhost:5173';
  let app: INestApplication;
  let baseUrl: string;

  const redisMock = {
    getGameState: jest.fn().mockResolvedValue(null),
  };
  const gameServiceMock = {
    verifyHostToken: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GameGateway,
        { provide: GameService, useValue: gameServiceMock },
        { provide: GameRedisService, useValue: redisMock },
        { provide: RoomService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'app.frontendUrl' ? FRONTEND_URL : undefined) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    redisMock.getGameState.mockResolvedValue(null);
  });

  const open = (path = '/game', origin?: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(`${baseUrl}${path}`, origin ? { origin } : {});
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });

  const nextMessage = (socket: WebSocket): Promise<{ event: string; data: { code: string; message: string } }> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No message received')), 3000);
      socket.once('message', (raw) => {
        clearTimeout(timeout);
        resolve(JSON.parse(raw.toString()));
      });
    });

  const closeCode = (socket: WebSocket): Promise<number> =>
    new Promise((resolve) => socket.once('close', (code) => resolve(code)));

  it('accepts a connection on /game without Origin header', async () => {
    const socket = await open();
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it('accepts a connection whose Origin matches app.frontendUrl', async () => {
    const socket = await open('/game', FRONTEND_URL);
    socket.send(JSON.stringify({ event: 'player:join', data: { pin: '12', nickname: 'Al' } }));
    const message = await nextMessage(socket);
    expect(message.event).toBe('error');
    socket.close();
  });

  it('closes a connection from another Origin with code 1008', async () => {
    const socket = new WebSocket(`${baseUrl}/game`, { origin: 'http://evil.example' });
    expect(await closeCode(socket)).toBe(1008);
  });

  it('refuses an upgrade on another path', async () => {
    await expect(open('/socket.io')).rejects.toBeDefined();
  });

  it('answers VALIDATION_ERROR for an invalid pin and does not run the handler', async () => {
    const socket = await open();
    socket.send(JSON.stringify({ event: 'player:join', data: { pin: '12345', nickname: 'Alice' } }));
    const message = await nextMessage(socket);
    expect(message).toEqual({ event: 'error', data: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
    expect(redisMock.getGameState).not.toHaveBeenCalled();
    socket.close();
  });

  it('answers VALIDATION_ERROR for an extra field (playerToken is not allowed in player:join)', async () => {
    const socket = await open();
    socket.send(
      JSON.stringify({
        event: 'player:join',
        data: { pin: '123456', nickname: 'Alice', playerToken: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      }),
    );
    const message = await nextMessage(socket);
    expect(message.data.code).toBe('VALIDATION_ERROR');
    expect(redisMock.getGameState).not.toHaveBeenCalled();
    socket.close();
  });

  it('answers VALIDATION_ERROR for a missing host token', async () => {
    const socket = await open();
    socket.send(JSON.stringify({ event: 'host:start_game', data: { pin: '123456' } }));
    const message = await nextMessage(socket);
    expect(message.data.code).toBe('VALIDATION_ERROR');
    expect(gameServiceMock.verifyHostToken).not.toHaveBeenCalled();
    socket.close();
  });

  it('runs the handler for a valid, normalized payload and maps GameError to the error event', async () => {
    const socket = await open();
    socket.send(JSON.stringify({ event: 'player:join', data: { pin: ' ab12cd ', nickname: '  Alice ' } }));
    const message = await nextMessage(socket);
    expect(message).toEqual({ event: 'error', data: { code: 'GAME_NOT_FOUND', message: 'Game not found' } });
    expect(redisMock.getGameState).toHaveBeenCalledWith('AB12CD');
    socket.close();
  });

  it('maps an unexpected exception to INTERNAL_ERROR without leaking details', async () => {
    redisMock.getGameState.mockRejectedValueOnce(new Error('connection refused to 10.0.0.1'));
    const socket = await open();
    socket.send(JSON.stringify({ event: 'player:join', data: { pin: '123456', nickname: 'Alice' } }));
    const message = await nextMessage(socket);
    expect(message).toEqual({
      event: 'error',
      data: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    socket.close();
  });
});
