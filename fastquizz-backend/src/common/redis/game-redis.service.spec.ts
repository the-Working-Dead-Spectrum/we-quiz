import { Test, TestingModule } from '@nestjs/testing';
import { GameRedisService, GAME_TTL_SECONDS } from './game-redis.service';
import { ConfigService } from '@nestjs/config';
import { GameStatus } from '../../modules/game/dto/game-events.dto';

describe('GameRedisService', () => {
  let service: GameRedisService;

  const createPipelineMock = (execResult: Array<[Error | null, unknown]> = []) => {
    const pipeline: Record<string, jest.Mock> = {};
    for (const method of ['hset', 'hget', 'hgetall', 'hdel', 'hincrby', 'zadd', 'zrem', 'zscore', 'zrange', 'zincrby', 'expire', 'del', 'set']) {
      pipeline[method] = jest.fn().mockReturnValue(pipeline);
    }
    pipeline.exec = jest.fn().mockResolvedValue(execResult);
    return pipeline;
  };

  const mockClient = {
    hset: jest.fn(),
    hget: jest.fn(),
    hgetall: jest.fn(),
    hdel: jest.fn(),
    hkeys: jest.fn(),
    hlen: jest.fn(),
    hexists: jest.fn(),
    zadd: jest.fn(),
    zrevrange: jest.fn(),
    zrevrank: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
    pipeline: jest.fn(),
    multi: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameRedisService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('redis://localhost:6379') } },
      ],
    }).compile();

    service = module.get<GameRedisService>(GameRedisService);
    // Replace the internal client with our mock (onModuleInit is not called: no connection)
    (service as unknown as { client: typeof mockClient }).client = mockClient;

    jest.clearAllMocks();
  });

  describe('createGameState', () => {
    it('writes the state hash, the TTL and the host token in one transaction', async () => {
      const multi = createPipelineMock();
      mockClient.multi.mockReturnValue(multi);

      await service.createGameState('123456', {
        quizId: 'quiz-123',
        quizTitle: 'Quiz',
        questionCount: 5,
        hostId: null,
        roomId: null,
        maxPlayers: 500,
        hostToken: 'host-token',
      });

      expect(multi.hset).toHaveBeenCalledWith(
        'game:123456:state',
        expect.objectContaining({
          status: 'LOBBY',
          currentQuestionIndex: '-1',
          quizId: 'quiz-123',
          quizTitle: 'Quiz',
          questionCount: '5',
          hostId: '',
          roomId: '',
          maxPlayers: '500',
        }),
      );
      expect(multi.expire).toHaveBeenCalledWith('game:123456:state', GAME_TTL_SECONDS);
      expect(multi.set).toHaveBeenCalledWith('game:123456:host_token', 'host-token', 'EX', GAME_TTL_SECONDS);
      expect(multi.exec).toHaveBeenCalled();
    });
  });

  describe('getGameState', () => {
    it('returns the parsed state with null host/room for an anonymous game', async () => {
      mockClient.hgetall.mockResolvedValue({
        status: GameStatus.LOBBY,
        currentQuestionIndex: '-1',
        questionStartTime: '0',
        quizId: 'quiz-123',
        quizTitle: 'Quiz',
        questionCount: '3',
        hostId: '',
        roomId: '',
        maxPlayers: '500',
      });

      const result = await service.getGameState('123456');

      expect(result).toEqual({
        status: 'LOBBY',
        currentQuestionIndex: -1,
        questionStartTime: 0,
        quizId: 'quiz-123',
        quizTitle: 'Quiz',
        questionCount: 3,
        hostId: null,
        roomId: null,
        maxPlayers: 500,
        startedAt: null,
      });
    });

    it('returns null for a non-existent game', async () => {
      mockClient.hgetall.mockResolvedValue({});
      expect(await service.getGameState('non-existent')).toBeNull();
    });
  });

  describe('compareAndSetState', () => {
    it('passes the expectation and the updates to the CAS script', async () => {
      mockClient.eval.mockResolvedValue(1);

      const ok = await service.compareAndSetState(
        '123456',
        { status: 'QUESTION_RESULT', questionIndex: 0 },
        { status: 'QUESTION_ACTIVE', currentQuestionIndex: 1, questionStartTime: 42 },
      );

      expect(ok).toBe(true);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'game:123456:state',
        'QUESTION_RESULT',
        '0',
        'status',
        'QUESTION_ACTIVE',
        'currentQuestionIndex',
        '1',
        'questionStartTime',
        '42',
      );
    });

    it('returns false when the state did not match', async () => {
      mockClient.eval.mockResolvedValue(0);
      expect(await service.compareAndSetState('123456', { status: 'NOT_PODIUM' }, { status: 'PODIUM' })).toBe(false);
    });
  });

  describe('addPlayer (atomic join)', () => {
    it('runs the join script on all player keys with the lower-cased nickname key', async () => {
      mockClient.eval.mockResolvedValue('OK');

      const result = await service.addPlayer('123456', { id: 'p1', nickname: 'Alice', joinedAt: 1 }, 'alice');

      expect(result).toBe('OK');
      const args = mockClient.eval.mock.calls[0];
      expect(args[0]).toContain('HSETNX');
      expect(args.slice(1, 9)).toEqual([
        7,
        'game:123456:state',
        'game:123456:nicknames',
        'game:123456:players',
        'game:123456:leaderboard',
        'game:123456:streaks',
        'game:123456:correct',
        'game:123456:connected',
      ]);
      expect(args[9]).toBe('alice');
      expect(args[10]).toBe('p1');
    });

    it.each(['NICKNAME_TAKEN', 'ROOM_FULL', 'GAME_ALREADY_STARTED', 'GAME_NOT_FOUND'])(
      'forwards the %s verdict of the script',
      async (verdict) => {
        mockClient.eval.mockResolvedValue(verdict);
        expect(await service.addPlayer('123456', { id: 'p1', nickname: 'Alice', joinedAt: 1 }, 'alice')).toBe(verdict);
      },
    );
  });

  describe('getPlayer / getAllPlayers', () => {
    it('assembles a player from its profile and counters', async () => {
      mockClient.pipeline.mockReturnValue(
        createPipelineMock([
          [null, JSON.stringify({ id: 'p1', nickname: 'Alice', joinedAt: 10 })],
          [null, '1500'],
          [null, '2'],
          [null, '3'],
          [null, '1'],
        ]),
      );

      expect(await service.getPlayer('123456', 'p1')).toEqual({
        id: 'p1',
        nickname: 'Alice',
        joinedAt: 10,
        score: 1500,
        streak: 2,
        correctAnswersCount: 3,
        connected: true,
      });
    });

    it('returns null for an unknown player', async () => {
      mockClient.pipeline.mockReturnValue(createPipelineMock([[null, null], [null, null], [null, null], [null, null], [null, null]]));
      expect(await service.getPlayer('123456', 'unknown')).toBeNull();
    });

    it('throws instead of swallowing a pipeline command error', async () => {
      mockClient.pipeline.mockReturnValue(createPipelineMock([[new Error('boom'), null], [null, null], [null, null], [null, null], [null, null]]));
      await expect(service.getPlayer('123456', 'p1')).rejects.toThrow('boom');
    });

    it('lists all players ordered by join time', async () => {
      mockClient.pipeline.mockReturnValue(
        createPipelineMock([
          [
            null,
            {
              p2: JSON.stringify({ id: 'p2', nickname: 'Bob', joinedAt: 20 }),
              p1: JSON.stringify({ id: 'p1', nickname: 'Alice', joinedAt: 10 }),
            },
          ],
          [null, ['p2', '0', 'p1', '700']],
          [null, { p1: '1', p2: '0' }],
          [null, { p1: '1', p2: '0' }],
          [null, { p1: '1', p2: '0' }],
        ]),
      );

      const players = await service.getAllPlayers('123456');

      expect(players.map((p) => p.id)).toEqual(['p1', 'p2']);
      expect(players[0]).toMatchObject({ score: 700, streak: 1, correctAnswersCount: 1, connected: true });
      expect(players[1]).toMatchObject({ score: 0, streak: 0, correctAnswersCount: 0, connected: false });
    });
  });

  describe('applyQuestionResults (no read-modify-write)', () => {
    it('uses ZINCRBY / HINCRBY for correct answers and resets the streak otherwise, in one MULTI', async () => {
      const multi = createPipelineMock();
      mockClient.multi.mockReturnValue(multi);

      await service.applyQuestionResults('123456', [
        { playerId: 'p1', isCorrect: true, pointsEarned: 800 },
        { playerId: 'p2', isCorrect: false, pointsEarned: 0 },
      ]);

      expect(multi.zincrby).toHaveBeenCalledWith('game:123456:leaderboard', 800, 'p1');
      expect(multi.hincrby).toHaveBeenCalledWith('game:123456:streaks', 'p1', 1);
      expect(multi.hincrby).toHaveBeenCalledWith('game:123456:correct', 'p1', 1);
      expect(multi.hset).toHaveBeenCalledWith('game:123456:streaks', 'p2', '0');
      expect(multi.zincrby).toHaveBeenCalledTimes(1);
      expect(multi.exec).toHaveBeenCalledTimes(1);
      expect(mockClient.hget).not.toHaveBeenCalled();
    });
  });

  describe('getLeaderboard', () => {
    it('returns sorted leaderboard with ranks', async () => {
      mockClient.zrevrange.mockResolvedValue(['player-1', '2000', 'player-2', '1500', 'player-3', '1000']);

      expect(await service.getLeaderboard('123456')).toEqual([
        { playerId: 'player-1', score: 2000, rank: 1 },
        { playerId: 'player-2', score: 1500, rank: 2 },
        { playerId: 'player-3', score: 1000, rank: 3 },
      ]);
      expect(mockClient.zrevrange).toHaveBeenCalledWith('game:123456:leaderboard', 0, -1, 'WITHSCORES');
    });

    it('limits the range when a limit is given', async () => {
      mockClient.zrevrange.mockResolvedValue([]);
      await service.getLeaderboard('123456', 10);
      expect(mockClient.zrevrange).toHaveBeenCalledWith('game:123456:leaderboard', 0, 9, 'WITHSCORES');
    });
  });

  describe('recordAnswer (atomic)', () => {
    const answer = {
      playerId: 'player-1',
      optionId: 'option-1',
      submittedAt: 1000,
      timeElapsed: 5000,
      isCorrect: true,
      pointsEarned: 875,
    };

    it('stores the answer with isCorrect and pointsEarned through the HSETNX script', async () => {
      mockClient.eval.mockResolvedValue('OK');

      expect(await service.recordAnswer('123456', 0, answer)).toBe('OK');

      const args = mockClient.eval.mock.calls[0];
      expect(args[0]).toContain('HSETNX');
      expect(args.slice(1, 6)).toEqual([2, 'game:123456:state', 'game:123456:answers:0', '0', 'player-1']);
      expect(JSON.parse(args[6])).toEqual(answer);
      expect(mockClient.hexists).not.toHaveBeenCalled();
    });

    it('returns ALREADY_ANSWERED when the HSETNX did not set the field', async () => {
      mockClient.eval.mockResolvedValue('ALREADY_ANSWERED');
      expect(await service.recordAnswer('123456', 0, answer)).toBe('ALREADY_ANSWERED');
    });
  });

  describe('getAnswerDistribution', () => {
    it('contains every option id, 0 when nobody chose it', async () => {
      mockClient.hgetall.mockResolvedValue({
        'player-1': JSON.stringify({ optionId: 'option-1' }),
        'player-2': JSON.stringify({ optionId: 'option-1' }),
        'player-3': JSON.stringify({ optionId: 'option-2' }),
      });

      const result = await service.getAnswerDistribution('123456', 0, ['option-1', 'option-2', 'option-3']);

      expect(result).toEqual({ 'option-1': 2, 'option-2': 1, 'option-3': 0 });
    });
  });

  describe('savePlayerToken / getPlayerTokenData', () => {
    it('saves and retrieves a player token', async () => {
      const pipeline = createPipelineMock();
      mockClient.pipeline.mockReturnValue(pipeline);
      mockClient.get.mockResolvedValue(JSON.stringify({ pin: '123456', playerId: 'player-1' }));

      await service.savePlayerToken('token-123', '123456', 'player-1');
      const result = await service.getPlayerTokenData('token-123');

      expect(pipeline.set).toHaveBeenCalledWith('player:token:token-123', expect.any(String), 'EX', GAME_TTL_SECONDS);
      expect(pipeline.set).toHaveBeenCalledWith('game:123456:player_token:player-1', 'token-123', 'EX', GAME_TTL_SECONDS);
      expect(result).toEqual({ pin: '123456', playerId: 'player-1' });
    });

    it('returns null for an invalid token', async () => {
      mockClient.get.mockResolvedValue(null);
      expect(await service.getPlayerTokenData('invalid-token')).toBeNull();
    });
  });

  describe('timers', () => {
    it('sets the question timer with a PX TTL', async () => {
      await service.setQuestionTimer('123456', 0, 30000);
      expect(mockClient.set).toHaveBeenCalledWith('game:123456:question_timer', expect.any(String), 'PX', 30000);
    });

    it('starts the lobby timer only if none is running (NX)', async () => {
      mockClient.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

      expect(await service.setLobbyTimer('123456', 59000)).toBe(true);
      expect(await service.setLobbyTimer('123456', 59000)).toBe(false);
      expect(mockClient.set).toHaveBeenCalledWith('game:123456:lobby_timer', expect.any(String), 'PX', 59000, 'NX');
    });

    it('returns the remaining lobby time', async () => {
      mockClient.get.mockResolvedValue(String(Date.now() + 15000));
      const result = await service.getLobbyTimeRemaining('123456');
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(15000);
    });
  });

  describe('tryReservePin', () => {
    it('reserves the pin through the script (reservation key + state key)', async () => {
      mockClient.eval.mockResolvedValue(1);

      expect(await service.tryReservePin('AB3XYZ')).toBe(true);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        'game:pin:AB3XYZ:reserved',
        'game:AB3XYZ:state',
        GAME_TTL_SECONDS,
      );
    });

    it('returns false when the pin is reserved or used by a live game', async () => {
      mockClient.eval.mockResolvedValue(0);
      expect(await service.tryReservePin('123456')).toBe(false);
    });
  });

  describe('getHostToken', () => {
    it('reads game:{pin}:host_token', async () => {
      mockClient.get.mockResolvedValue('host-token');
      expect(await service.getHostToken('123456')).toBe('host-token');
      expect(mockClient.get).toHaveBeenCalledWith('game:123456:host_token');
    });
  });

  describe('deleteGame', () => {
    it('deletes every game key, including host token, nicknames, player tokens and the PIN reservation', async () => {
      mockClient.hget.mockResolvedValue('2'); // questionCount = 2
      mockClient.hkeys.mockResolvedValue(['p1']);
      mockClient.get.mockResolvedValue('token-1');
      mockClient.del.mockResolvedValue(1);

      await service.deleteGame('123456');

      const deleted = mockClient.del.mock.calls[0];
      expect(deleted).toEqual(
        expect.arrayContaining([
          'game:123456:state',
          'game:123456:players',
          'game:123456:leaderboard',
          'game:123456:streaks',
          'game:123456:correct',
          'game:123456:connected',
          'game:123456:nicknames',
          'game:123456:host_token',
          'game:123456:question_timer',
          'game:123456:lobby_timer',
          'game:pin:123456:reserved',
          'game:123456:answers:0',
          'game:123456:answers:1',
          'game:123456:player_token:p1',
          'player:token:token-1',
        ]),
      );
    });
  });
});
