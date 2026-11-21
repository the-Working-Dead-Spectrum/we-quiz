import { ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { GameGateway, GameSocket } from './game.gateway';
import { GameService, GameQuestion } from './game.service';
import { RoomService } from './room.service';
import { GameRedisService, GameState, PlayerData } from '../../common/redis/game-redis.service';
import { GameError } from './game-errors';

type MockSocket = GameSocket & { send: jest.Mock; close: jest.Mock };

const PIN = '123456';
const HOST_TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';
const WRONG_HOST_TOKEN = '6fa459ea-ee8a-4ca4-894e-db77e160355e';
const PLAYER_TOKEN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OPTION_RED = '11111111-1111-4111-8111-111111111111';
const OPTION_BLUE = '22222222-2222-4222-8222-222222222222';
const OPTION_YELLOW = '33333333-3333-4333-8333-333333333333';

const baseState: GameState = {
  status: 'LOBBY',
  currentQuestionIndex: -1,
  questionStartTime: 0,
  quizId: 'quiz-1',
  quizTitle: 'Quiz',
  questionCount: 2,
  hostId: null,
  roomId: null,
  maxPlayers: 500,
  startedAt: null,
};
const stateWith = (overrides: Partial<GameState>): GameState => ({ ...baseState, ...overrides });

const alice: PlayerData = { id: 'p1', nickname: 'Alice', score: 0, streak: 0, correctAnswersCount: 0, connected: true, joinedAt: 1 };
const bob: PlayerData = { id: 'p2', nickname: 'Bob', score: 0, streak: 3, correctAnswersCount: 0, connected: true, joinedAt: 2 };

const playableQuestion = (): GameQuestion => ({
  id: 'q1',
  text: 'Question 1',
  imageUrl: null,
  timeLimit: 20,
  pointsMultiplier: 1,
  // Deliberately not sorted by colorIndex
  options: [
    { id: OPTION_YELLOW, text: 'C', isCorrect: false, colorIndex: 2 },
    { id: OPTION_RED, text: 'A', isCorrect: true, colorIndex: 0 },
    { id: OPTION_BLUE, text: 'B', isCorrect: false, colorIndex: 1 },
  ],
});

const makeSocket = (): MockSocket =>
  ({ readyState: WebSocket.OPEN, send: jest.fn(), close: jest.fn() }) as unknown as MockSocket;

const messages = (socket: MockSocket): Array<{ event: string; data: any }> =>
  socket.send.mock.calls.map(([raw]) => JSON.parse(raw));
const eventNames = (socket: MockSocket): string[] => messages(socket).map((message) => message.event);
const lastData = (socket: MockSocket, event: string): any =>
  messages(socket)
    .filter((message) => message.event === event)
    .pop()?.data;

describe('GameGateway', () => {
  let gateway: GameGateway;
  let redis: Record<string, jest.Mock>;
  let gameService: Record<string, jest.Mock>;
  let roomService: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);

    redis = {
      getGameState: jest.fn().mockResolvedValue(stateWith({})),
      getAllPlayers: jest.fn().mockResolvedValue([]),
      getPlayer: jest.fn().mockResolvedValue(null),
      getPlayerCount: jest.fn().mockResolvedValue(0),
      addPlayer: jest.fn().mockResolvedValue('OK'),
      removePlayer: jest.fn().mockResolvedValue(undefined),
      savePlayerToken: jest.fn().mockResolvedValue(undefined),
      getPlayerTokenData: jest.fn().mockResolvedValue(null),
      setPlayerConnected: jest.fn().mockResolvedValue(undefined),
      setLobbyTimer: jest.fn().mockResolvedValue(true),
      getLobbyTimeRemaining: jest.fn().mockResolvedValue(59_000),
      clearLobbyTimer: jest.fn().mockResolvedValue(undefined),
      setQuestionTimer: jest.fn().mockResolvedValue(undefined),
      getQuestionTimeRemaining: jest.fn().mockResolvedValue(0),
      clearQuestionTimer: jest.fn().mockResolvedValue(undefined),
      compareAndSetState: jest.fn().mockResolvedValue(true),
      recordAnswer: jest.fn().mockResolvedValue('OK'),
      getAnswer: jest.fn().mockResolvedValue(null),
      getAllAnswers: jest.fn().mockResolvedValue([]),
      getAnswerCount: jest.fn().mockResolvedValue(0),
      getAnswerDistribution: jest.fn().mockResolvedValue({}),
      applyQuestionResults: jest.fn().mockResolvedValue(undefined),
      getLeaderboard: jest.fn().mockResolvedValue([]),
      getPlayerRank: jest.fn().mockResolvedValue(1),
      hasPlayerAnswered: jest.fn().mockResolvedValue(false),
      deleteGame: jest.fn().mockResolvedValue(undefined),
    };
    gameService = {
      createAnonymousGame: jest.fn(),
      verifyHostToken: jest.fn().mockImplementation(async (_pin: string, token: string) => {
        if (token !== HOST_TOKEN) throw new GameError('HOST_UNAUTHORIZED', 'Invalid host token for this game');
      }),
      getQuestion: jest.fn().mockResolvedValue(playableQuestion()),
      markGameStarted: jest.fn().mockResolvedValue(undefined),
      finalizeGame: jest.fn().mockResolvedValue(undefined),
    };
    roomService = { createParticipant: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn().mockReturnValue('http://localhost:5173') };

    gateway = new GameGateway(
      gameService as unknown as GameService,
      redis as unknown as GameRedisService,
      roomService as unknown as RoomService,
      config as unknown as ConfigService,
    );
  });

  afterEach(() => {
    gateway.onModuleDestroy();
    jest.useRealTimers();
  });

  /** Binds a host socket to PIN through the real handler. */
  const joinAsHost = async (state: GameState = stateWith({})): Promise<MockSocket> => {
    const host = makeSocket();
    redis.getGameState.mockResolvedValue(state);
    await gateway.handleHostJoinGame(host, { pin: PIN, hostToken: HOST_TOKEN });
    host.send.mockClear();
    return host;
  };

  /** Binds a player socket without going through player:join. */
  const bindPlayer = (playerId: string, token = PLAYER_TOKEN): MockSocket => {
    const socket = makeSocket();
    (gateway as any).bindPlayer(socket, PIN, playerId, token);
    return socket;
  };

  // ========== CONNECTION ==========

  describe('handleConnection (Origin check)', () => {
    const request = (origin?: string) => ({ headers: origin ? { origin } : {} }) as IncomingMessage;

    it('closes a socket from another origin with 1008', () => {
      const socket = makeSocket();
      gateway.handleConnection(socket, request('http://evil.example'));
      expect(socket.close).toHaveBeenCalledWith(1008, 'Origin not allowed');
    });

    it('accepts the configured origin (trailing slash insensitive) and requests without Origin', () => {
      const allowed = makeSocket();
      const noOrigin = makeSocket();
      gateway.handleConnection(allowed, request('http://localhost:5173'));
      gateway.handleConnection(noOrigin, request());
      expect(allowed.close).not.toHaveBeenCalled();
      expect(noOrigin.close).not.toHaveBeenCalled();
    });
  });

  // ========== HOST ==========

  describe('host:create_game', () => {
    it('sends host:game_created, game:state_changed, lobby:timer and starts the lobby countdown', async () => {
      gameService.createAnonymousGame.mockResolvedValue({ pin: PIN, quizTitle: 'Quiz', questionCount: 2, hostToken: HOST_TOKEN });
      const host = makeSocket();

      await gateway.handleHostCreateGame(host, { quizId: 'quiz-1' });

      expect(eventNames(host)).toEqual(['host:game_created', 'game:state_changed', 'lobby:timer']);
      expect(messages(host)[0].data).toEqual({ pin: PIN, quizTitle: 'Quiz', questionCount: 2, hostToken: HOST_TOKEN });
      expect(messages(host)[1].data).toEqual({
        status: 'LOBBY',
        currentQuestionIndex: -1,
        questionCount: 2,
        timeRemaining: 0,
        players: [],
      });
      expect(messages(host)[2].data).toEqual({ remaining: 59_000 });
      expect(redis.setLobbyTimer).toHaveBeenCalledWith(PIN, 59_000);
      expect(host.isHost).toBe(true);
    });

    it('propagates QUIZ_NOT_FOUND from the service (sent by the exception filter)', async () => {
      gameService.createAnonymousGame.mockRejectedValue(new GameError('QUIZ_NOT_FOUND', 'Quiz not found'));
      await expect(gateway.handleHostCreateGame(makeSocket(), { quizId: 'quiz-1' })).rejects.toMatchObject({
        code: 'QUIZ_NOT_FOUND',
      });
    });
  });

  describe('host token checks', () => {
    it('host:join_game with the right token binds the host and sends the snapshot', async () => {
      const host = makeSocket();
      await gateway.handleHostJoinGame(host, { pin: PIN, hostToken: HOST_TOKEN });
      expect(host.isHost).toBe(true);
      expect(eventNames(host)).toEqual(['host:game_created', 'game:state_changed', 'lobby:timer']);
      expect(messages(host)[0].data.hostToken).toBe(HOST_TOKEN);
    });

    it('host:game_created is the first message even if a broadcast happens while the snapshot is built', async () => {
      const host = makeSocket();
      bindPlayer('p1'); // the room exists
      redis.getAllPlayers.mockImplementation(async () => {
        (gateway as any).broadcast(PIN, 'lobby:timer', { remaining: 12_000 });
        return [];
      });

      await gateway.handleHostJoinGame(host, { pin: PIN, hostToken: HOST_TOKEN });

      expect(eventNames(host)[0]).toBe('host:game_created');
    });

    it('host:join_game with a wrong token is HOST_UNAUTHORIZED and binds nothing', async () => {
      const host = makeSocket();
      await expect(gateway.handleHostJoinGame(host, { pin: PIN, hostToken: WRONG_HOST_TOKEN })).rejects.toMatchObject({
        code: 'HOST_UNAUTHORIZED',
      });
      expect(host.isHost).toBeFalsy();
      expect(host.send).not.toHaveBeenCalled();
    });

    it('host:join_game on an unknown pin is GAME_NOT_FOUND', async () => {
      redis.getGameState.mockResolvedValue(null);
      await expect(gateway.handleHostJoinGame(makeSocket(), { pin: PIN, hostToken: HOST_TOKEN })).rejects.toMatchObject({
        code: 'GAME_NOT_FOUND',
      });
    });

    it('host:start_game and host:next_step verify the token on every call, even from a bound host socket', async () => {
      const host = await joinAsHost();

      await expect(gateway.handleHostStartGame(host, { pin: PIN, hostToken: WRONG_HOST_TOKEN })).rejects.toMatchObject({
        code: 'HOST_UNAUTHORIZED',
      });
      await expect(gateway.handleHostNextStep(host, { pin: PIN, hostToken: WRONG_HOST_TOKEN })).rejects.toMatchObject({
        code: 'HOST_UNAUTHORIZED',
      });
      expect(redis.compareAndSetState).not.toHaveBeenCalled();
    });

    it('host:join_game in QUESTION_ACTIVE sends question:started (original start time) and question:answer_count', async () => {
      redis.getGameState.mockResolvedValue(
        stateWith({ status: 'QUESTION_ACTIVE', currentQuestionIndex: 0, questionStartTime: 990_000 }),
      );
      redis.getQuestionTimeRemaining.mockResolvedValue(10_000);
      const host = makeSocket();

      await gateway.handleHostJoinGame(host, { pin: PIN, hostToken: HOST_TOKEN });

      expect(eventNames(host)).toEqual(['host:game_created', 'game:state_changed', 'question:started', 'question:answer_count']);
      expect(messages(host)[1].data).toMatchObject({ status: 'QUESTION_ACTIVE', currentQuestionIndex: 0, timeRemaining: 10_000 });
      expect(messages(host)[2].data).toMatchObject({ questionStartTime: 990_000, serverTime: 1_000_000 });
      expect(redis.setLobbyTimer).not.toHaveBeenCalled();
    });

    it('host:join_game in QUESTION_RESULT sends question:ended, in PODIUM sends game:podium', async () => {
      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 0 }));
      const resultHost = makeSocket();
      await gateway.handleHostJoinGame(resultHost, { pin: PIN, hostToken: HOST_TOKEN });
      expect(eventNames(resultHost)).toEqual(['host:game_created', 'game:state_changed', 'question:ended']);

      redis.getGameState.mockResolvedValue(stateWith({ status: 'PODIUM', currentQuestionIndex: 1 }));
      const podiumHost = makeSocket();
      await gateway.handleHostJoinGame(podiumHost, { pin: PIN, hostToken: HOST_TOKEN });
      expect(eventNames(podiumHost)).toEqual(['host:game_created', 'game:state_changed', 'game:podium']);
    });
  });

  describe('host:start_game', () => {
    it('rejects a start outside the lobby with INVALID_STATE', async () => {
      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 0 }));
      await expect(gateway.handleHostStartGame(makeSocket(), { pin: PIN, hostToken: HOST_TOKEN })).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });

    it('rejects a start without players with NOT_ENOUGH_PLAYERS', async () => {
      redis.getPlayerCount.mockResolvedValue(0);
      await expect(gateway.handleHostStartGame(makeSocket(), { pin: PIN, hostToken: HOST_TOKEN })).rejects.toMatchObject({
        code: 'NOT_ENOUGH_PLAYERS',
      });
    });

    it('starts question 0 with 1 player, clears the lobby timer and broadcasts question:started', async () => {
      const host = await joinAsHost();
      expect((gateway as any).lobbyTimers.has(PIN)).toBe(true);
      redis.getPlayerCount.mockResolvedValue(1);

      await gateway.handleHostStartGame(host, { pin: PIN, hostToken: HOST_TOKEN });

      expect(redis.compareAndSetState).toHaveBeenCalledWith(
        PIN,
        { status: 'LOBBY' },
        { status: 'QUESTION_ACTIVE', currentQuestionIndex: 0, questionStartTime: 1_000_000, startedAt: 1_000_000 },
      );
      expect((gateway as any).lobbyTimers.has(PIN)).toBe(false);
      expect(redis.clearLobbyTimer).toHaveBeenCalledWith(PIN);
      expect(gameService.markGameStarted).toHaveBeenCalled();

      const started = lastData(host, 'question:started');
      expect(started).toEqual({
        questionIndex: 0,
        questionCount: 2,
        questionText: 'Question 1',
        imageUrl: null,
        timeLimit: 20,
        pointsMultiplier: 1,
        options: [
          { id: OPTION_RED, text: 'A', colorIndex: 0 },
          { id: OPTION_BLUE, text: 'B', colorIndex: 1 },
          { id: OPTION_YELLOW, text: 'C', colorIndex: 2 },
        ],
        questionStartTime: 1_000_000,
        serverTime: 1_000_000,
      });
      expect(JSON.stringify(started)).not.toContain('isCorrect');
    });

    it('is a no-op when the compare-and-set loses the race (e.g. lobby auto-start)', async () => {
      const host = await joinAsHost();
      redis.getPlayerCount.mockResolvedValue(1);
      redis.compareAndSetState.mockResolvedValue(false);

      await gateway.handleHostStartGame(host, { pin: PIN, hostToken: HOST_TOKEN });

      expect(eventNames(host)).not.toContain('question:started');
      expect((gateway as any).questionTimers.size).toBe(0);
    });
  });

  describe('host:next_step', () => {
    it('is INVALID_STATE in the lobby', async () => {
      await expect(gateway.handleHostNextStep(makeSocket(), { pin: PIN, hostToken: HOST_TOKEN })).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });

    it('starts the next question from QUESTION_RESULT', async () => {
      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 0 }));

      await gateway.handleHostNextStep(makeSocket(), { pin: PIN, hostToken: HOST_TOKEN });

      expect(redis.compareAndSetState).toHaveBeenCalledWith(
        PIN,
        { status: 'QUESTION_RESULT', questionIndex: 0 },
        { status: 'QUESTION_ACTIVE', currentQuestionIndex: 1, questionStartTime: 1_000_000 },
      );
    });

    it('shows the podium after the last question and saves the results', async () => {
      const host = await joinAsHost(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 1 }));
      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 1 }));
      redis.getAllPlayers.mockResolvedValue([alice, bob]);
      redis.getLeaderboard.mockResolvedValue([
        { playerId: 'p2', score: 900, rank: 1 },
        { playerId: 'p1', score: 400, rank: 2 },
      ]);

      await gateway.handleHostNextStep(host, { pin: PIN, hostToken: HOST_TOKEN });

      expect(redis.compareAndSetState).toHaveBeenCalledWith(PIN, { status: 'NOT_PODIUM' }, { status: 'PODIUM' });
      const podium = lastData(host, 'game:podium');
      expect(podium.finalLeaderboard).toEqual([
        { playerId: 'p2', nickname: 'Bob', score: 900, rank: 1, correctAnswersCount: 0 },
        { playerId: 'p1', nickname: 'Alice', score: 400, rank: 2, correctAnswersCount: 0 },
      ]);
      expect(podium.podium).toHaveLength(2);
      expect(gameService.finalizeGame).toHaveBeenCalledWith(PIN, expect.any(Object), podium.finalLeaderboard);
    });
  });

  // ========== PLAYERS ==========

  describe('player:join', () => {
    it('emits player:joined, game:state_changed, lobby:timer then broadcasts lobby:player_joined', async () => {
      const host = await joinAsHost();
      const player = makeSocket();
      redis.getAllPlayers.mockResolvedValue([{ ...alice, nickname: 'Alice' }]);

      await gateway.handlePlayerJoin(player, { pin: PIN, nickname: 'Alice' });

      expect(eventNames(player)).toEqual(['player:joined', 'game:state_changed', 'lobby:timer', 'lobby:player_joined']);
      expect(messages(player)[0].data).toMatchObject({
        pin: PIN,
        nickname: 'Alice',
        quizTitle: 'Quiz',
        questionCount: 2,
        players: [expect.objectContaining({ nickname: 'Alice' })],
      });
      expect(messages(player)[0].data.playerToken).toBe(player.playerToken);
      expect(redis.addPlayer).toHaveBeenCalledWith(PIN, expect.objectContaining({ nickname: 'Alice' }), 'alice');
      expect(redis.savePlayerToken).toHaveBeenCalledWith(player.playerToken, PIN, player.playerId);
      expect(eventNames(host)).toEqual(['lobby:player_joined']);
      expect(lastData(host, 'lobby:player_joined')).toEqual({ playerId: player.playerId, nickname: 'Alice', playerCount: 1 });
    });

    it.each(['NICKNAME_TAKEN', 'ROOM_FULL', 'GAME_ALREADY_STARTED'])('maps the atomic join verdict %s to an error', async (verdict) => {
      redis.addPlayer.mockResolvedValue(verdict);
      const player = makeSocket();

      await expect(gateway.handlePlayerJoin(player, { pin: PIN, nickname: 'ALICE' })).rejects.toMatchObject({ code: verdict });
      expect(redis.addPlayer).toHaveBeenCalledWith(PIN, expect.anything(), 'alice');
      expect(player.playerId).toBeUndefined();
    });

    it('is GAME_ALREADY_STARTED (not GAME_NOT_FOUND) when the game left the lobby', async () => {
      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_ACTIVE', currentQuestionIndex: 0 }));
      await expect(gateway.handlePlayerJoin(makeSocket(), { pin: PIN, nickname: 'Alice' })).rejects.toMatchObject({
        code: 'GAME_ALREADY_STARTED',
      });
      expect(redis.addPlayer).not.toHaveBeenCalled();
    });

    it('is GAME_NOT_FOUND for an unknown pin', async () => {
      redis.getGameState.mockResolvedValue(null);
      await expect(gateway.handlePlayerJoin(makeSocket(), { pin: PIN, nickname: 'Alice' })).rejects.toMatchObject({
        code: 'GAME_NOT_FOUND',
      });
    });

    it('room game: creates the RoomParticipant and rolls back Redis on NICKNAME_TAKEN (P2002)', async () => {
      redis.getGameState.mockResolvedValue(stateWith({ roomId: 'room-1' }));
      roomService.createParticipant.mockRejectedValue(new GameError('NICKNAME_TAKEN', 'taken'));

      await expect(gateway.handlePlayerJoin(makeSocket(), { pin: PIN, nickname: 'Alice' })).rejects.toMatchObject({
        code: 'NICKNAME_TAKEN',
      });
      expect(roomService.createParticipant).toHaveBeenCalledWith('room-1', expect.any(String), 'Alice');
      expect(redis.removePlayer).toHaveBeenCalledWith(PIN, expect.any(String), 'alice');
      expect(redis.savePlayerToken).not.toHaveBeenCalled();
    });
  });

  describe('player:reconnect', () => {
    it('in QUESTION_RESULT emits joined, state, question:ended, player:feedback then player:state_sync', async () => {
      redis.getPlayerTokenData.mockResolvedValue({ pin: PIN, playerId: 'p1' });
      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 0 }));
      redis.getPlayer.mockResolvedValue(alice);
      redis.getAllPlayers.mockResolvedValue([{ ...alice, score: 875, streak: 1, correctAnswersCount: 1 }]);
      redis.getLeaderboard.mockResolvedValue([{ playerId: 'p1', score: 875, rank: 1 }]);
      redis.getAnswer.mockResolvedValue({
        playerId: 'p1',
        optionId: OPTION_RED,
        submittedAt: 1,
        timeElapsed: 5000,
        isCorrect: true,
        pointsEarned: 875,
      });
      redis.hasPlayerAnswered.mockResolvedValue(true);
      const socket = makeSocket();

      await gateway.handlePlayerReconnect(socket, { playerToken: PLAYER_TOKEN });

      expect(eventNames(socket)).toEqual([
        'player:joined',
        'game:state_changed',
        'question:ended',
        'player:feedback',
        'player:state_sync',
      ]);
      expect(lastData(socket, 'player:joined')).toMatchObject({ playerId: 'p1', playerToken: PLAYER_TOKEN, nickname: 'Alice' });
      expect(lastData(socket, 'player:feedback')).toMatchObject({ answered: true, isCorrect: true, pointsEarned: 875, rank: 1 });
      expect(lastData(socket, 'player:state_sync')).toEqual({
        score: 875,
        rank: 1,
        streak: 1,
        correctAnswersCount: 1,
        hasAnsweredCurrentQuestion: true,
      });
      expect(redis.setPlayerConnected).toHaveBeenCalledWith(PIN, 'p1', true);
      expect(redis.addPlayer).not.toHaveBeenCalled();
    });

    it('in LOBBY emits joined, state, lobby:timer, state_sync', async () => {
      redis.getPlayerTokenData.mockResolvedValue({ pin: PIN, playerId: 'p1' });
      redis.getPlayer.mockResolvedValue(alice);
      redis.getAllPlayers.mockResolvedValue([alice]);
      const socket = makeSocket();

      await gateway.handlePlayerReconnect(socket, { playerToken: PLAYER_TOKEN });

      expect(eventNames(socket)).toEqual(['player:joined', 'game:state_changed', 'lobby:timer', 'player:state_sync']);
      expect(lastData(socket, 'player:state_sync').hasAnsweredCurrentQuestion).toBe(false);
    });

    it.each(['QUESTION_ACTIVE', 'PODIUM'] as const)('ends with player:state_sync in %s', async (status) => {
      redis.getPlayerTokenData.mockResolvedValue({ pin: PIN, playerId: 'p1' });
      redis.getGameState.mockResolvedValue(stateWith({ status, currentQuestionIndex: 0, questionStartTime: 990_000 }));
      redis.getPlayer.mockResolvedValue(alice);
      redis.getAllPlayers.mockResolvedValue([alice]);
      const socket = makeSocket();

      await gateway.handlePlayerReconnect(socket, { playerToken: PLAYER_TOKEN });

      const names = eventNames(socket);
      expect(names.slice(0, 2)).toEqual(['player:joined', 'game:state_changed']);
      expect(names[2]).toBe(status === 'PODIUM' ? 'game:podium' : 'question:started');
      expect(names[names.length - 1]).toBe('player:state_sync');
    });

    it('still ends with player:state_sync when the status-specific part of the snapshot fails', async () => {
      redis.getPlayerTokenData.mockResolvedValue({ pin: PIN, playerId: 'p1' });
      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_ACTIVE', currentQuestionIndex: 0 }));
      redis.getPlayer.mockResolvedValue(alice);
      redis.getAllPlayers.mockResolvedValue([alice]);
      gameService.getQuestion.mockRejectedValue(new Error('db down'));
      jest.spyOn((gateway as any).logger, 'error').mockImplementation(() => undefined);
      const socket = makeSocket();

      await gateway.handlePlayerReconnect(socket, { playerToken: PLAYER_TOKEN });

      expect(eventNames(socket)).toEqual(['player:joined', 'game:state_changed', 'player:state_sync']);
    });

    it('is INVALID_TOKEN for an unknown token and PLAYER_NOT_FOUND for a removed player', async () => {
      await expect(gateway.handlePlayerReconnect(makeSocket(), { playerToken: PLAYER_TOKEN })).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });

      redis.getPlayerTokenData.mockResolvedValue({ pin: PIN, playerId: 'p1' });
      redis.getPlayer.mockResolvedValue(null);
      await expect(gateway.handlePlayerReconnect(makeSocket(), { playerToken: PLAYER_TOKEN })).rejects.toMatchObject({
        code: 'PLAYER_NOT_FOUND',
      });
    });
  });

  describe('player:submit_answer', () => {
    const answer = { pin: PIN, questionIndex: 0, optionId: OPTION_RED, playerToken: PLAYER_TOKEN };

    beforeEach(() => {
      redis.getGameState.mockResolvedValue(
        stateWith({ status: 'QUESTION_ACTIVE', currentQuestionIndex: 0, questionStartTime: 1_000_000 - 5_000 }),
      );
    });

    it('is UNAUTHORIZED when the playerToken does not match the socket', async () => {
      const socket = bindPlayer('p1');
      await expect(
        gateway.handlePlayerSubmitAnswer(socket, { ...answer, playerToken: '6fa459ea-ee8a-4ca4-894e-db77e160355e' }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('is UNAUTHORIZED for a socket not bound to a player', async () => {
      await expect(gateway.handlePlayerSubmitAnswer(makeSocket(), answer)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('is INVALID_OPTION for an option of another question', async () => {
      const socket = bindPlayer('p1');
      await expect(
        gateway.handlePlayerSubmitAnswer(socket, { ...answer, optionId: '44444444-4444-4444-8444-444444444444' }),
      ).rejects.toMatchObject({ code: 'INVALID_OPTION' });
      expect(redis.recordAnswer).not.toHaveBeenCalled();
    });

    it('is INVALID_QUESTION for a stale question index', async () => {
      const socket = bindPlayer('p1');
      await expect(gateway.handlePlayerSubmitAnswer(socket, { ...answer, questionIndex: 1 })).rejects.toMatchObject({
        code: 'INVALID_QUESTION',
      });
    });

    it('records the answer atomically with isCorrect / pointsEarned and only acknowledges it', async () => {
      const socket = bindPlayer('p1');

      await gateway.handlePlayerSubmitAnswer(socket, answer);

      expect(redis.recordAnswer).toHaveBeenCalledWith(PIN, 0, {
        playerId: 'p1',
        optionId: OPTION_RED,
        submittedAt: 1_000_000,
        timeElapsed: 5_000,
        isCorrect: true,
        pointsEarned: 875,
      });
      expect(eventNames(socket)).toEqual(['player:answer_accepted', 'question:answer_count']);
      expect(lastData(socket, 'player:answer_accepted')).toEqual({ questionIndex: 0 });
      expect(eventNames(socket)).not.toContain('player:feedback');
    });

    it('is ALREADY_ANSWERED when the atomic HSETNX refuses a second answer', async () => {
      const socket = bindPlayer('p1');
      redis.recordAnswer.mockResolvedValue('ALREADY_ANSWERED');

      await expect(gateway.handlePlayerSubmitAnswer(socket, answer)).rejects.toMatchObject({ code: 'ALREADY_ANSWERED' });
      expect(eventNames(socket)).not.toContain('player:answer_accepted');
    });
  });

  // ========== ENGINE ==========

  describe('question end', () => {
    it('broadcasts question:ended then sends player:feedback to every player, answered: false for non-answerers', async () => {
      const host = await joinAsHost();
      const aliceSocket = bindPlayer('p1');
      const bobSocket = bindPlayer('p2', '6fa459ea-ee8a-4ca4-894e-db77e160355e');
      redis.getPlayerCount.mockResolvedValue(2);
      await gateway.handleHostStartGame(host, { pin: PIN, hostToken: HOST_TOKEN });

      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 0 }));
      redis.getAllAnswers.mockResolvedValue([
        { playerId: 'p1', optionId: OPTION_RED, submittedAt: 1, timeElapsed: 5000, isCorrect: true, pointsEarned: 875 },
      ]);
      redis.getAllPlayers.mockResolvedValue([alice, bob]);
      redis.getAnswerDistribution.mockResolvedValue({ [OPTION_YELLOW]: 0, [OPTION_RED]: 1, [OPTION_BLUE]: 0 });
      host.send.mockClear();
      aliceSocket.send.mockClear();
      bobSocket.send.mockClear();
      // After applyQuestionResults the stats are updated
      redis.applyQuestionResults.mockImplementation(async () => {
        redis.getAllPlayers.mockResolvedValue([
          { ...alice, score: 875, streak: 1, correctAnswersCount: 1 },
          { ...bob, streak: 0 },
        ]);
        redis.getLeaderboard.mockResolvedValue([
          { playerId: 'p1', score: 875, rank: 1 },
          { playerId: 'p2', score: 0, rank: 2 },
        ]);
      });

      await jest.advanceTimersByTimeAsync(20_000);

      expect(redis.compareAndSetState).toHaveBeenCalledWith(
        PIN,
        { status: 'QUESTION_ACTIVE', questionIndex: 0 },
        { status: 'QUESTION_RESULT' },
      );
      expect(redis.applyQuestionResults).toHaveBeenCalledWith(PIN, [
        { playerId: 'p1', isCorrect: true, pointsEarned: 875 },
        { playerId: 'p2', isCorrect: false, pointsEarned: 0 },
      ]);
      expect(redis.getAnswerDistribution).toHaveBeenCalledWith(PIN, 0, [OPTION_YELLOW, OPTION_RED, OPTION_BLUE]);

      expect(lastData(host, 'question:ended')).toEqual({
        questionIndex: 0,
        questionCount: 2,
        correctOptionId: OPTION_RED,
        answerDistribution: { [OPTION_YELLOW]: 0, [OPTION_RED]: 1, [OPTION_BLUE]: 0 },
        leaderboard: [
          { playerId: 'p1', nickname: 'Alice', score: 875, rank: 1, correctAnswersCount: 1 },
          { playerId: 'p2', nickname: 'Bob', score: 0, rank: 2, correctAnswersCount: 0 },
        ],
      });
      expect(eventNames(host)).not.toContain('player:feedback');

      expect(lastData(aliceSocket, 'player:feedback')).toEqual({
        questionIndex: 0,
        answered: true,
        isCorrect: true,
        pointsEarned: 875,
        totalScore: 875,
        rank: 1,
        streak: 1,
        correctAnswersCount: 1,
        correctOptionId: OPTION_RED,
      });
      expect(lastData(bobSocket, 'player:feedback')).toEqual({
        questionIndex: 0,
        answered: false,
        isCorrect: false,
        pointsEarned: 0,
        totalScore: 0,
        rank: 2,
        streak: 0,
        correctAnswersCount: 0,
        correctOptionId: OPTION_RED,
      });
      expect((gateway as any).answerCountIntervals.has(PIN)).toBe(false);
    });

    it('broadcasts QUIZ_INVALID and goes to the podium when the next question is unplayable (never freezes)', async () => {
      const host = await joinAsHost(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 0 }));
      redis.getGameState.mockResolvedValue(stateWith({ status: 'QUESTION_RESULT', currentQuestionIndex: 0 }));
      const broken = playableQuestion();
      broken.options = broken.options.map((option) => ({ ...option, isCorrect: true }));
      gameService.getQuestion.mockResolvedValue(broken);

      await gateway.handleHostNextStep(host, { pin: PIN, hostToken: HOST_TOKEN });

      expect(eventNames(host)).toEqual(['error', 'game:podium']);
      expect(lastData(host, 'error')).toMatchObject({ code: 'QUIZ_INVALID' });
      expect(redis.compareAndSetState).toHaveBeenCalledWith(PIN, { status: 'NOT_PODIUM' }, { status: 'PODIUM' });
      expect(redis.compareAndSetState).not.toHaveBeenCalledWith(PIN, expect.anything(), expect.objectContaining({ status: 'QUESTION_ACTIVE' }));
      expect(gameService.finalizeGame).toHaveBeenCalled();
    });
  });

  describe('lobby timer', () => {
    it('broadcasts LOBBY_EXPIRED when the lobby expires with 0 players, then deletes the game after 5 s', async () => {
      const host = await joinAsHost();
      redis.getLobbyTimeRemaining.mockResolvedValue(0);
      redis.getPlayerCount.mockResolvedValue(0);

      await jest.advanceTimersByTimeAsync(1_000);

      expect(lastData(host, 'error')).toMatchObject({ code: 'LOBBY_EXPIRED' });
      expect((gateway as any).lobbyTimers.has(PIN)).toBe(false);
      expect(redis.deleteGame).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(5_000);
      expect(redis.deleteGame).toHaveBeenCalledWith(PIN);
    });

    it('auto-starts question 0 when the lobby expires with 1 player', async () => {
      const host = await joinAsHost();
      redis.getLobbyTimeRemaining.mockResolvedValue(0);
      redis.getPlayerCount.mockResolvedValue(1);

      await jest.advanceTimersByTimeAsync(1_000);

      expect(redis.compareAndSetState).toHaveBeenCalledWith(PIN, { status: 'LOBBY' }, expect.objectContaining({ currentQuestionIndex: 0 }));
      expect(eventNames(host)).toContain('question:started');
    });

    it('broadcasts lobby:timer every second while in the lobby', async () => {
      const host = await joinAsHost();
      redis.getLobbyTimeRemaining.mockResolvedValue(42_000);

      await jest.advanceTimersByTimeAsync(2_000);

      expect(eventNames(host)).toEqual(['lobby:timer', 'lobby:timer']);
      expect(lastData(host, 'lobby:timer')).toEqual({ remaining: 42_000 });
    });

    it('never leaks a rejected promise from a timer callback', async () => {
      await joinAsHost();
      redis.getLobbyTimeRemaining.mockRejectedValue(new Error('redis down'));
      const errorSpy = jest.spyOn((gateway as any).logger, 'error').mockImplementation(() => undefined);

      await expect(jest.advanceTimersByTimeAsync(1_000)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('cleanupGame', () => {
    it('clears every timer of the pin (question timers, answer-count interval, lobby timer) and deletes Redis keys', async () => {
      const host = await joinAsHost();
      redis.getPlayerCount.mockResolvedValue(1);
      await gateway.handleHostStartGame(host, { pin: PIN, hostToken: HOST_TOKEN });
      (gateway as any).lobbyTimers.set(PIN, setInterval(() => undefined, 1_000));
      (gateway as any).questionTimers.set(`${PIN}:5`, setTimeout(() => undefined, 1_000));
      expect((gateway as any).questionTimers.size).toBe(2);
      expect((gateway as any).answerCountIntervals.has(PIN)).toBe(true);

      await (gateway as any).cleanupGame(PIN);

      expect((gateway as any).questionTimers.size).toBe(0);
      expect((gateway as any).answerCountIntervals.has(PIN)).toBe(false);
      expect((gateway as any).lobbyTimers.has(PIN)).toBe(false);
      expect((gateway as any).rooms.has(PIN)).toBe(false);
      expect(redis.deleteGame).toHaveBeenCalledWith(PIN);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('handleDisconnect', () => {
    it('marks the player disconnected only when no other socket is bound to it', async () => {
      const first = bindPlayer('p1');
      const second = bindPlayer('p1');

      gateway.handleDisconnect(first);
      await Promise.resolve();
      expect(redis.setPlayerConnected).not.toHaveBeenCalled();

      gateway.handleDisconnect(second);
      await jest.advanceTimersByTimeAsync(0);
      expect(redis.setPlayerConnected).toHaveBeenCalledWith(PIN, 'p1', false);
    });
  });
});
