import RedisMock = require('ioredis-mock');
import { ConfigService } from '@nestjs/config';
import { GameRedisService } from './game-redis.service';

/**
 * Executes the real Lua scripts / MULTI transactions of GameRedisService against ioredis-mock
 * (in-memory Redis with Lua support, no Docker needed).
 */
describe('GameRedisService atomic operations (ioredis-mock)', () => {
  const PIN = '123456';
  let client: InstanceType<typeof RedisMock>;
  let service: GameRedisService;

  const createGame = (maxPlayers = 500) =>
    service.createGameState(PIN, {
      quizId: 'quiz-1',
      quizTitle: 'Quiz',
      questionCount: 2,
      hostId: null,
      roomId: null,
      maxPlayers,
      hostToken: 'host-token',
    });

  const join = (id: string, nickname: string) =>
    service.addPlayer(PIN, { id, nickname, joinedAt: Date.now() }, nickname.toLowerCase());

  const answer = (playerId: string, optionId = 'o1') => ({
    playerId,
    optionId,
    submittedAt: Date.now(),
    timeElapsed: 1000,
    isCorrect: optionId === 'o1',
    pointsEarned: optionId === 'o1' ? 975 : 0,
  });

  beforeEach(async () => {
    client = new RedisMock();
    await client.flushall();
    service = new GameRedisService({ get: () => undefined } as unknown as ConfigService);
    (service as unknown as { client: unknown }).client = client;
  });

  afterEach(async () => {
    await client.quit();
  });

  describe('addPlayer', () => {
    it('adds a player with zeroed counters and the connected flag', async () => {
      await createGame();

      expect(await join('p1', 'Alice')).toBe('OK');

      expect(await service.getAllPlayers(PIN)).toEqual([
        expect.objectContaining({ id: 'p1', nickname: 'Alice', score: 0, streak: 0, correctAnswersCount: 0, connected: true }),
      ]);
    });

    it('rejects the same nickname with another case (NICKNAME_TAKEN)', async () => {
      await createGame();
      await join('p1', 'Alice');

      expect(await join('p2', 'ALICE')).toBe('NICKNAME_TAKEN');
      expect(await service.getPlayerCount(PIN)).toBe(1);
    });

    it('rejects a player beyond maxPlayers (ROOM_FULL)', async () => {
      await createGame(1);
      await join('p1', 'Alice');

      expect(await join('p2', 'Bob')).toBe('ROOM_FULL');
    });

    it('rejects a join once the game left the lobby, and an unknown game', async () => {
      await createGame();
      await service.compareAndSetState(PIN, { status: 'LOBBY' }, { status: 'QUESTION_ACTIVE', currentQuestionIndex: 0 });

      expect(await join('p1', 'Alice')).toBe('GAME_ALREADY_STARTED');
      expect(await service.addPlayer('999999', { id: 'p1', nickname: 'A', joinedAt: 1 }, 'a')).toBe('GAME_NOT_FOUND');
    });

    it('removePlayer frees the nickname (rollback)', async () => {
      await createGame();
      await join('p1', 'Alice');

      await service.removePlayer(PIN, 'p1', 'alice');

      expect(await join('p2', 'alice')).toBe('OK');
    });
  });

  describe('compareAndSetState', () => {
    it('applies the transition only once (double start)', async () => {
      await createGame();
      const transition = () =>
        service.compareAndSetState(PIN, { status: 'LOBBY' }, { status: 'QUESTION_ACTIVE', currentQuestionIndex: 0, startedAt: 42 });

      expect(await transition()).toBe(true);
      expect(await transition()).toBe(false);
      expect(await service.getGameState(PIN)).toMatchObject({ status: 'QUESTION_ACTIVE', currentQuestionIndex: 0, startedAt: 42 });
    });

    it('checks the expected question index', async () => {
      await createGame();
      await service.compareAndSetState(PIN, { status: 'LOBBY' }, { status: 'QUESTION_ACTIVE', currentQuestionIndex: 0 });

      expect(await service.compareAndSetState(PIN, { status: 'QUESTION_ACTIVE', questionIndex: 1 }, { status: 'QUESTION_RESULT' })).toBe(false);
      expect(await service.compareAndSetState(PIN, { status: 'QUESTION_ACTIVE', questionIndex: 0 }, { status: 'QUESTION_RESULT' })).toBe(true);
    });

    it('NOT_PODIUM switches to the podium only once and never for an unknown game', async () => {
      await createGame();
      expect(await service.compareAndSetState(PIN, { status: 'NOT_PODIUM' }, { status: 'PODIUM' })).toBe(true);
      expect(await service.compareAndSetState(PIN, { status: 'NOT_PODIUM' }, { status: 'PODIUM' })).toBe(false);
      expect(await service.compareAndSetState('999999', { status: 'NOT_PODIUM' }, { status: 'PODIUM' })).toBe(false);
    });
  });

  describe('recordAnswer', () => {
    beforeEach(async () => {
      await createGame();
      await join('p1', 'Alice');
      await service.compareAndSetState(PIN, { status: 'LOBBY' }, { status: 'QUESTION_ACTIVE', currentQuestionIndex: 0 });
    });

    it('accepts the first answer and refuses the second one (ALREADY_ANSWERED)', async () => {
      const results = await Promise.all([
        service.recordAnswer(PIN, 0, answer('p1', 'o1')),
        service.recordAnswer(PIN, 0, answer('p1', 'o2')),
      ]);

      expect(results.sort()).toEqual(['ALREADY_ANSWERED', 'OK']);
      expect(await service.getAnswerCount(PIN, 0)).toBe(1);
    });

    it('stores isCorrect and pointsEarned', async () => {
      await service.recordAnswer(PIN, 0, answer('p1', 'o1'));
      expect(await service.getAnswer(PIN, 0, 'p1')).toMatchObject({ isCorrect: true, pointsEarned: 975 });
    });

    it('refuses an answer for another question or after the question closed', async () => {
      expect(await service.recordAnswer(PIN, 1, answer('p1'))).toBe('INVALID_QUESTION');

      await service.compareAndSetState(PIN, { status: 'QUESTION_ACTIVE', questionIndex: 0 }, { status: 'QUESTION_RESULT' });
      expect(await service.recordAnswer(PIN, 0, answer('p1'))).toBe('INVALID_STATE');
      expect(await service.recordAnswer('999999', 0, answer('p1'))).toBe('GAME_NOT_FOUND');
    });
  });

  describe('applyQuestionResults', () => {
    it('updates score, streak and correct answers without losing concurrent updates', async () => {
      await createGame();
      await join('p1', 'Alice');
      await join('p2', 'Bob');

      await Promise.all([
        service.applyQuestionResults(PIN, [{ playerId: 'p1', isCorrect: true, pointsEarned: 500 }]),
        service.applyQuestionResults(PIN, [{ playerId: 'p1', isCorrect: true, pointsEarned: 300 }]),
        service.setPlayerConnected(PIN, 'p1', false),
      ]);
      await service.applyQuestionResults(PIN, [{ playerId: 'p2', isCorrect: false, pointsEarned: 0 }]);

      const p1 = await service.getPlayer(PIN, 'p1');
      expect(p1).toMatchObject({ score: 800, streak: 2, correctAnswersCount: 2, connected: false });
      expect(await service.getPlayer(PIN, 'p2')).toMatchObject({ score: 0, streak: 0 });
      expect(await service.getLeaderboard(PIN)).toEqual([
        { playerId: 'p1', score: 800, rank: 1 },
        { playerId: 'p2', score: 0, rank: 2 },
      ]);
    });

    it('setPlayerConnected never recreates keys of a deleted game', async () => {
      await service.setPlayerConnected(PIN, 'ghost', true);
      expect(await client.exists(`game:${PIN}:connected`)).toBe(0);
    });
  });

  describe('pin reservation and cleanup', () => {
    it('reserves a pin once, and never a pin used by a live game', async () => {
      expect(await service.tryReservePin('AB3XYZ')).toBe(true);
      expect(await service.tryReservePin('AB3XYZ')).toBe(false);

      await createGame();
      expect(await service.tryReservePin(PIN)).toBe(false);
    });

    it('deleteGame removes state, players, host token, nicknames, answers, tokens and reservation', async () => {
      await service.tryReservePin(PIN);
      await createGame();
      await join('p1', 'Alice');
      await service.savePlayerToken('token-1', PIN, 'p1');
      await service.compareAndSetState(PIN, { status: 'LOBBY' }, { status: 'QUESTION_ACTIVE', currentQuestionIndex: 0 });
      await service.recordAnswer(PIN, 0, answer('p1'));

      await service.deleteGame(PIN);

      expect(await client.keys('*')).toEqual([]);
    });
  });
});
