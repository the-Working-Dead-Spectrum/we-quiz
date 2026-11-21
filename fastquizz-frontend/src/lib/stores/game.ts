// Game stores (host and player), implementing docs/adr/0001-websocket-game-protocol.md (v1).
//
// - Transport and reconnection are owned by WebSocketManager; these stores never retry by themselves.
// - The identity message sent on every (re)open is computed from the current state:
//   host  -> `host:join_game` once the hostToken is known, else `host:create_game`;
//   player -> `player:reconnect` once the playerToken is known, else `player:join`.
// - All durations held here are in milliseconds (ADR 0001 §1).

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import {
  createWebSocketManager,
  destroyWebSocketManager,
  getGameSocketUrl,
  type WebSocketManager,
} from '$lib/utils/websocket';
import type {
  ClientEvent,
  ErrorCode,
  ErrorEvent,
  GamePodiumEvent,
  GameStatus,
  HostCreateGamePayload,
  PlayerFeedbackEvent,
  PlayerJoinPayload,
  PlayerPublic,
  QuestionEndedEvent,
  QuestionStartedEvent,
} from '$lib/types';

const CLOCK_TICK_MS = 250;
const TRANSIENT_ERROR_MS = 4000;

// ---------------------------------------------------------------------------
// Persistence (localStorage). Keys are part of the frontend contract (T-009).
// ---------------------------------------------------------------------------

const HOST_TOKEN_PREFIX = 'host_token_';
const PLAYER_TOKEN_KEY = 'player_token';
const PLAYER_PIN_KEY = 'player_pin';
const PLAYER_NICKNAME_KEY = 'player_nickname';
const LEGACY_PLAYER_CODE_KEY = 'player_code';

function storageGet(key: string): string | null {
  if (!browser) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  if (!browser) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or disabled: the game still works, only refresh-recovery is lost.
  }
}

function storageRemove(key: string): void {
  if (!browser) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** ADR 0001 §3: the hostToken lives in localStorage["host_token_" + pin], never in a URL. */
export function getStoredHostToken(pin: string): string | null {
  return storageGet(HOST_TOKEN_PREFIX + pin);
}

export function storeHostToken(pin: string, hostToken: string): void {
  storageSet(HOST_TOKEN_PREFIX + pin, hostToken);
}

export function clearHostToken(pin: string): void {
  storageRemove(HOST_TOKEN_PREFIX + pin);
}

export interface StoredPlayerSession {
  playerToken: string;
  pin: string;
  nickname: string;
}

export function getStoredPlayerSession(): StoredPlayerSession | null {
  const playerToken = storageGet(PLAYER_TOKEN_KEY);
  const pin = storageGet(PLAYER_PIN_KEY);
  if (!playerToken || !pin) return null;
  return { playerToken, pin, nickname: storageGet(PLAYER_NICKNAME_KEY) ?? '' };
}

function storePlayerSession(session: StoredPlayerSession): void {
  storageSet(PLAYER_TOKEN_KEY, session.playerToken);
  storageSet(PLAYER_PIN_KEY, session.pin);
  storageSet(PLAYER_NICKNAME_KEY, session.nickname);
  storageRemove(LEGACY_PLAYER_CODE_KEY);
}

export function clearStoredPlayerSession(): void {
  storageRemove(PLAYER_TOKEN_KEY);
  storageRemove(PLAYER_PIN_KEY);
  storageRemove(PLAYER_NICKNAME_KEY);
  storageRemove(LEGACY_PLAYER_CODE_KEY);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface GameFatalError {
  code: ErrorCode;
  message: string;
  /** Player join refusals: code to prefill on /player/join. */
  prefillCode?: string;
}

const ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  QUIZ_NOT_FOUND: 'Quiz introuvable ou non accessible.',
  QUIZ_INVALID: "Ce quiz n'est pas jouable (questions ou réponses incomplètes).",
  GAME_NOT_FOUND: 'Partie introuvable. Vérifiez le code.',
  HOST_UNAUTHORIZED: "Vous n'êtes plus autorisé à animer cette partie.",
  LOBBY_EXPIRED: 'Le lobby a expiré faute de joueurs.',
  GAME_ALREADY_STARTED: 'La partie a déjà commencé.',
  ROOM_FULL: 'La partie est complète.',
  NICKNAME_TAKEN: 'Ce pseudo est déjà pris dans cette partie.',
  INVALID_TOKEN: 'Session de jeu invalide.',
  PLAYER_NOT_FOUND: 'Joueur introuvable dans cette partie.',
  NOT_ENOUGH_PLAYERS: 'Il faut au moins 1 joueur pour démarrer.',
  MAX_RECONNECT: 'Connexion perdue. Rechargez la page.',
};

function messageFor(error: ErrorEvent): string {
  return ERROR_MESSAGES[error.code] ?? (error.message || 'Une erreur est survenue.');
}

/**
 * Question countdown (ADR 0001 §6): deadline = questionStartTime + timeLimit * 1000,
 * offset = serverTime - Date.now() measured on receipt, remaining = deadline - (now + offset).
 */
function createQuestionClock(onTick: (remainingMs: number) => void) {
  let timer: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start(question: QuestionStartedEvent): void {
    stop();
    const deadline = question.questionStartTime + question.timeLimit * 1000;
    const offset = question.serverTime - Date.now();
    const remaining = () => Math.max(0, deadline - (Date.now() + offset));

    const first = remaining();
    onTick(first);
    if (first <= 0) return;

    timer = setInterval(() => {
      const ms = remaining();
      onTick(ms);
      if (ms <= 0) stop();
    }, CLOCK_TICK_MS);
  }

  return { start, stop };
}

function createTransientError(apply: (message: string | null) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clear(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function show(message: string): void {
    clear();
    apply(message);
    timer = setTimeout(() => {
      timer = null;
      apply(null);
    }, TRANSIENT_ERROR_MS);
  }

  return { show, clear };
}

// ---------------------------------------------------------------------------
// Host store
// ---------------------------------------------------------------------------

export interface HostGameState {
  pin: string | null;
  quizTitle: string | null;
  status: GameStatus;
  currentQuestionIndex: number;
  questionCount: number;
  /** ms */
  timeRemaining: number;
  /** ms */
  lobbyTimerRemaining: number;
  players: PlayerPublic[];
  question: QuestionStartedEvent | null;
  questionResults: QuestionEndedEvent | null;
  podium: GamePodiumEvent | null;
  answerCount: { answered: number; total: number };
  isConnected: boolean;
  isReconnecting: boolean;
  connectionLost: boolean;
  error: string | null;
  fatal: GameFatalError | null;
}

function initialHostState(): HostGameState {
  return {
    pin: null,
    quizTitle: null,
    status: 'LOBBY',
    currentQuestionIndex: -1,
    questionCount: 0,
    timeRemaining: 0,
    lobbyTimerRemaining: 0,
    players: [],
    question: null,
    questionResults: null,
    podium: null,
    answerCount: { answered: 0, total: 0 },
    isConnected: false,
    isReconnecting: false,
    connectionLost: false,
    error: null,
    fatal: null,
  };
}

function createHostGameStore() {
  const store = writable<HostGameState>(initialHostState());
  const { subscribe, set, update } = store;

  let ws: WebSocketManager | null = null;
  // Kept out of the store state so it is never rendered or logged by accident.
  let hostToken: string | null = null;
  let pendingCreate: HostCreateGamePayload | null = null;

  const clock = createQuestionClock((ms) => update((s) => ({ ...s, timeRemaining: ms })));
  const transientError = createTransientError((message) => update((s) => ({ ...s, error: message })));

  function identify(): ClientEvent | null {
    const { pin } = get(store);
    if (pin && hostToken) return { event: 'host:join_game', data: { pin, hostToken } };
    if (pendingCreate) return { event: 'host:create_game', data: pendingCreate };
    return null;
  }

  function teardown(): void {
    clock.stop();
    if (ws) {
      destroyWebSocketManager(ws);
      ws = null;
    }
  }

  function fail(error: ErrorEvent): void {
    const { pin } = get(store);
    if (pin) clearHostToken(pin);
    hostToken = null;
    pendingCreate = null;
    teardown();
    transientError.clear();
    update((s) => ({
      ...s,
      isConnected: false,
      isReconnecting: false,
      error: null,
      fatal: { code: error.code, message: messageFor(error) },
    }));
  }

  function handleError(error: ErrorEvent): void {
    switch (error.code) {
      case 'HOST_UNAUTHORIZED':
      case 'GAME_NOT_FOUND':
      case 'QUIZ_NOT_FOUND':
      case 'LOBBY_EXPIRED':
        fail(error);
        return;
      case 'QUIZ_INVALID':
        // Fatal at creation (no pin yet); mid-game it is a broadcast followed by the podium.
        if (!get(store).pin) fail(error);
        else transientError.show(messageFor(error));
        return;
      case 'MAX_RECONNECT':
        update((s) => ({ ...s, connectionLost: true, isReconnecting: false, error: error.message || messageFor(error) }));
        return;
      default:
        transientError.show(messageFor(error));
    }
  }

  function open(): void {
    teardown();
    const manager = createWebSocketManager({
      url: getGameSocketUrl(),
      identify,
      onOpen: () => update((s) => ({ ...s, isConnected: true, isReconnecting: false, connectionLost: false })),
      onClose: (_event, willReconnect) =>
        update((s) => ({ ...s, isConnected: false, isReconnecting: willReconnect })),
    });
    ws = manager;

    manager.on('host:game_created', (data) => {
      hostToken = data.hostToken;
      pendingCreate = null;
      storeHostToken(data.pin, data.hostToken);
      update((s) => ({ ...s, pin: data.pin, quizTitle: data.quizTitle, questionCount: data.questionCount }));
    });

    manager.on('game:state_changed', (data) => {
      if (data.status !== 'QUESTION_ACTIVE') clock.stop();
      update((s) => ({
        ...s,
        status: data.status,
        currentQuestionIndex: data.currentQuestionIndex,
        questionCount: data.questionCount,
        timeRemaining: data.status === 'QUESTION_ACTIVE' ? data.timeRemaining : 0,
        lobbyTimerRemaining: data.status === 'LOBBY' ? s.lobbyTimerRemaining : 0,
        players: data.players,
        answerCount: { ...s.answerCount, total: data.players.length },
      }));
    });

    manager.on('lobby:player_joined', (data) => {
      update((s) => {
        if (s.players.some((p) => p.id === data.playerId)) return s;
        const player: PlayerPublic = {
          id: data.playerId,
          nickname: data.nickname,
          score: 0,
          streak: 0,
          correctAnswersCount: 0,
          connected: true,
          joinedAt: Date.now(),
        };
        return { ...s, players: [...s.players, player] };
      });
    });

    manager.on('lobby:timer', (data) => {
      update((s) => ({ ...s, lobbyTimerRemaining: data.remaining }));
    });

    manager.on('question:started', (data) => {
      update((s) => ({
        ...s,
        status: 'QUESTION_ACTIVE',
        currentQuestionIndex: data.questionIndex,
        questionCount: data.questionCount,
        question: data,
        questionResults: null,
        lobbyTimerRemaining: 0,
        answerCount:
          s.question?.questionIndex === data.questionIndex
            ? s.answerCount
            : { answered: 0, total: s.players.length },
      }));
      clock.start(data);
    });

    manager.on('question:answer_count', (data) => {
      update((s) =>
        data.questionIndex === s.currentQuestionIndex
          ? { ...s, answerCount: { answered: data.answeredCount, total: data.totalPlayers } }
          : s,
      );
    });

    manager.on('question:ended', (data) => {
      clock.stop();
      update((s) => ({
        ...s,
        status: 'QUESTION_RESULT',
        currentQuestionIndex: data.questionIndex,
        questionCount: data.questionCount,
        questionResults: data,
        timeRemaining: 0,
      }));
    });

    manager.on('game:podium', (data) => {
      clock.stop();
      update((s) => ({ ...s, status: 'PODIUM', podium: data, timeRemaining: 0 }));
    });

    manager.on('error', handleError);

    manager.connect();
  }

  function sendHostAction(event: 'host:start_game' | 'host:next_step'): boolean {
    const { pin } = get(store);
    if (!ws || !pin || !hostToken) return false;
    const sent = ws.send(event, { pin, hostToken });
    if (!sent) transientError.show('Connexion indisponible, réessayez dans un instant.');
    return sent;
  }

  return {
    subscribe,

    /** Anonymous hosting via WS (ADR 0001 §5 `host:create_game`). */
    createGame(quizId: string, shareToken?: string): void {
      transientError.clear();
      set(initialHostState());
      hostToken = null;
      pendingCreate = shareToken ? { quizId, shareToken } : { quizId };
      open();
    },

    /** Binds as host of an existing game. Returns false when no hostToken is stored for this pin. */
    joinGame(pin: string): boolean {
      const token = getStoredHostToken(pin);
      if (!token) return false;
      transientError.clear();
      hostToken = token;
      pendingCreate = null;
      set({ ...initialHostState(), pin });
      open();
      return true;
    },

    /** True when this store already holds a live (or reconnecting) host session for `pin`. */
    isActiveFor(pin: string): boolean {
      return !!ws && !ws.isDestroyed && !!hostToken && get(store).pin === pin;
    },

    startGame(): boolean {
      return sendHostAction('host:start_game');
    },

    nextStep(): boolean {
      return sendHostAction('host:next_step');
    },

    /** Closes the socket (no reconnect). The stored hostToken is kept for a later re-join. */
    disconnect(): void {
      teardown();
      update((s) => ({ ...s, isConnected: false, isReconnecting: false }));
    },

    /** Ends the host session for good (podium "Terminer"): closes the socket, forgets the token. */
    reset(): void {
      const { pin } = get(store);
      if (pin) clearHostToken(pin);
      teardown();
      transientError.clear();
      hostToken = null;
      pendingCreate = null;
      set(initialHostState());
    },
  };
}

// ---------------------------------------------------------------------------
// Player store
// ---------------------------------------------------------------------------

export type AnswerStatus = 'none' | 'sent' | 'accepted';

export interface PlayerGameState {
  pin: string | null;
  playerId: string | null;
  playerToken: string | null;
  nickname: string | null;
  quizTitle: string | null;
  status: GameStatus;
  currentQuestionIndex: number;
  questionCount: number;
  /** ms */
  timeRemaining: number;
  /** ms */
  lobbyTimerRemaining: number;
  score: number;
  rank: number;
  streak: number;
  correctAnswersCount: number;
  question: QuestionStartedEvent | null;
  /** Answer state for the current question (optimistic 'sent', confirmed 'accepted'). */
  answerStatus: AnswerStatus;
  selectedOptionId: string | null;
  feedback: PlayerFeedbackEvent | null;
  questionResults: QuestionEndedEvent | null;
  podium: GamePodiumEvent | null;
  isConnected: boolean;
  /** True from a socket loss until the reconnect snapshot ends (`player:state_sync`). */
  isReconnecting: boolean;
  connectionLost: boolean;
  error: string | null;
  fatal: GameFatalError | null;
}

function initialPlayerState(): PlayerGameState {
  return {
    pin: null,
    playerId: null,
    playerToken: null,
    nickname: null,
    quizTitle: null,
    status: 'LOBBY',
    currentQuestionIndex: -1,
    questionCount: 0,
    timeRemaining: 0,
    lobbyTimerRemaining: 0,
    score: 0,
    rank: 0,
    streak: 0,
    correctAnswersCount: 0,
    question: null,
    answerStatus: 'none',
    selectedOptionId: null,
    feedback: null,
    questionResults: null,
    podium: null,
    isConnected: false,
    isReconnecting: false,
    connectionLost: false,
    error: null,
    fatal: null,
  };
}

function createPlayerGameStore() {
  const store = writable<PlayerGameState>(initialPlayerState());
  const { subscribe, set, update } = store;

  let ws: WebSocketManager | null = null;
  let pendingJoin: PlayerJoinPayload | null = null;

  const clock = createQuestionClock((ms) => update((s) => ({ ...s, timeRemaining: ms })));
  const transientError = createTransientError((message) => update((s) => ({ ...s, error: message })));

  function identify(): ClientEvent | null {
    const { playerToken } = get(store);
    if (playerToken) return { event: 'player:reconnect', data: { playerToken } };
    if (pendingJoin) return { event: 'player:join', data: pendingJoin };
    return null;
  }

  function teardown(): void {
    clock.stop();
    if (ws) {
      destroyWebSocketManager(ws);
      ws = null;
    }
  }

  function fail(error: ErrorEvent, prefillCode?: string): void {
    clearStoredPlayerSession();
    pendingJoin = null;
    teardown();
    transientError.clear();
    update((s) => ({
      ...s,
      playerToken: null,
      isConnected: false,
      isReconnecting: false,
      error: null,
      fatal: { code: error.code, message: messageFor(error), prefillCode },
    }));
  }

  function revertPendingAnswer(): void {
    update((s) => (s.answerStatus === 'sent' ? { ...s, answerStatus: 'none', selectedOptionId: null } : s));
  }

  function handleError(error: ErrorEvent): void {
    switch (error.code) {
      case 'INVALID_TOKEN':
      case 'PLAYER_NOT_FOUND':
      case 'GAME_NOT_FOUND':
      case 'LOBBY_EXPIRED':
      case 'GAME_ALREADY_STARTED':
      case 'ROOM_FULL':
      case 'NICKNAME_TAKEN':
        // During a first join, send the user back to /player/join with the typed code prefilled.
        fail(error, pendingJoin?.pin);
        return;
      case 'ALREADY_ANSWERED':
        update((s) => ({ ...s, answerStatus: 'accepted' }));
        return;
      case 'INVALID_QUESTION':
        revertPendingAnswer();
        return;
      case 'UNAUTHORIZED':
      case 'INVALID_OPTION':
      case 'INVALID_STATE':
        revertPendingAnswer();
        transientError.show(messageFor(error));
        return;
      case 'MAX_RECONNECT':
        update((s) => ({ ...s, connectionLost: true, isReconnecting: false, error: error.message || messageFor(error) }));
        return;
      default:
        transientError.show(messageFor(error));
    }
  }

  function open(): void {
    teardown();
    const manager = createWebSocketManager({
      url: getGameSocketUrl(),
      identify,
      onOpen: () =>
        update((s) => ({
          ...s,
          isConnected: true,
          connectionLost: false,
          // A reconnect stays "in progress" until the snapshot ends with player:state_sync.
          isReconnecting: !!s.playerToken,
        })),
      onClose: (_event, willReconnect) =>
        update((s) => ({ ...s, isConnected: false, isReconnecting: willReconnect })),
    });
    ws = manager;

    manager.on('player:joined', (data) => {
      const wasFirstJoin = pendingJoin !== null;
      pendingJoin = null;
      storePlayerSession({ playerToken: data.playerToken, pin: data.pin, nickname: data.nickname });
      update((s) => ({
        ...s,
        pin: data.pin,
        playerId: data.playerId,
        playerToken: data.playerToken,
        nickname: data.nickname,
        quizTitle: data.quizTitle,
        questionCount: data.questionCount,
        isConnected: true,
        isReconnecting: wasFirstJoin ? false : s.isReconnecting,
      }));
    });

    manager.on('game:state_changed', (data) => {
      if (data.status !== 'QUESTION_ACTIVE') clock.stop();
      update((s) => {
        const next: PlayerGameState = {
          ...s,
          status: data.status,
          currentQuestionIndex: data.currentQuestionIndex,
          questionCount: data.questionCount,
          timeRemaining: data.status === 'QUESTION_ACTIVE' ? data.timeRemaining : 0,
          lobbyTimerRemaining: data.status === 'LOBBY' ? s.lobbyTimerRemaining : 0,
        };
        if (data.status === 'LOBBY') {
          next.question = null;
          next.feedback = null;
          next.questionResults = null;
          next.podium = null;
          next.answerStatus = 'none';
          next.selectedOptionId = null;
        }
        return next;
      });
    });

    manager.on('lobby:timer', (data) => {
      update((s) => ({ ...s, lobbyTimerRemaining: data.remaining }));
    });

    manager.on('question:started', (data) => {
      update((s) => {
        const sameQuestion = s.question?.questionIndex === data.questionIndex;
        return {
          ...s,
          status: 'QUESTION_ACTIVE',
          currentQuestionIndex: data.questionIndex,
          questionCount: data.questionCount,
          question: data,
          lobbyTimerRemaining: 0,
          answerStatus: sameQuestion ? s.answerStatus : 'none',
          selectedOptionId: sameQuestion ? s.selectedOptionId : null,
          feedback: null,
          questionResults: null,
        };
      });
      clock.start(data);
    });

    manager.on('player:answer_accepted', (data) => {
      update((s) =>
        data.questionIndex === s.currentQuestionIndex ? { ...s, answerStatus: 'accepted' } : s,
      );
    });

    // question:ended and player:feedback may arrive in any order (ADR 0001 §6): each one
    // independently moves the screen to QUESTION_RESULT; stale indexes are ignored.
    manager.on('question:ended', (data) => {
      if (data.questionIndex < get(store).currentQuestionIndex) return;
      clock.stop();
      update((s) => ({
        ...s,
        status: s.status === 'PODIUM' ? s.status : 'QUESTION_RESULT',
        currentQuestionIndex: data.questionIndex,
        questionCount: data.questionCount,
        questionResults: data,
        timeRemaining: 0,
      }));
    });

    manager.on('player:feedback', (data) => {
      if (data.questionIndex < get(store).currentQuestionIndex) return;
      clock.stop();
      update((s) => ({
        ...s,
        status: s.status === 'PODIUM' ? s.status : 'QUESTION_RESULT',
        currentQuestionIndex: data.questionIndex,
        feedback: data,
        score: data.totalScore,
        rank: data.rank,
        streak: data.streak,
        correctAnswersCount: data.correctAnswersCount,
        timeRemaining: 0,
        answerStatus: data.answered ? 'accepted' : s.answerStatus,
      }));
    });

    manager.on('game:podium', (data) => {
      clock.stop();
      update((s) => {
        const me = s.playerId ? data.finalLeaderboard.find((e) => e.playerId === s.playerId) : undefined;
        return {
          ...s,
          status: 'PODIUM',
          podium: data,
          timeRemaining: 0,
          score: me?.score ?? s.score,
          rank: me?.rank ?? s.rank,
          correctAnswersCount: me?.correctAnswersCount ?? s.correctAnswersCount,
        };
      });
    });

    // Last message of the reconnect snapshot (ADR 0001 §7).
    manager.on('player:state_sync', (data) => {
      update((s) => ({
        ...s,
        score: data.score,
        rank: data.rank,
        streak: data.streak,
        correctAnswersCount: data.correctAnswersCount,
        answerStatus: data.hasAnsweredCurrentQuestion ? 'accepted' : 'none',
        selectedOptionId: data.hasAnsweredCurrentQuestion ? s.selectedOptionId : null,
        isReconnecting: false,
      }));
    });

    manager.on('error', handleError);

    manager.connect();
  }

  return {
    subscribe,

    /** First-time join (ADR 0001 §5 `player:join`). Any previous session is discarded. */
    join(pin: string, nickname: string): void {
      transientError.clear();
      clearStoredPlayerSession();
      const payload: PlayerJoinPayload = { pin: pin.trim().toUpperCase(), nickname: nickname.trim() };
      pendingJoin = payload;
      set({ ...initialPlayerState(), pin: payload.pin, nickname: payload.nickname });
      open();
    },

    /** Resumes the stored session with `player:reconnect`. Returns false when none is stored. */
    resume(): boolean {
      const session = getStoredPlayerSession();
      if (!session) return false;
      transientError.clear();
      pendingJoin = null;
      set({
        ...initialPlayerState(),
        pin: session.pin,
        nickname: session.nickname || null,
        playerToken: session.playerToken,
        isReconnecting: true,
      });
      open();
      return true;
    },

    submitAnswer(optionId: string): void {
      const s = get(store);
      if (
        !ws ||
        !s.pin ||
        !s.playerToken ||
        s.status !== 'QUESTION_ACTIVE' ||
        !s.question ||
        s.currentQuestionIndex < 0 ||
        s.answerStatus !== 'none'
      ) {
        return;
      }
      const sent = ws.send('player:submit_answer', {
        pin: s.pin,
        questionIndex: s.currentQuestionIndex,
        optionId,
        playerToken: s.playerToken,
      });
      if (!sent) {
        transientError.show('Pas de connexion : réponse non envoyée, réessayez.');
        return;
      }
      update((st) => ({ ...st, answerStatus: 'sent', selectedOptionId: optionId }));
    },

    /** Closes the socket (no reconnect) but keeps the stored session (page leave / refresh). */
    disconnect(): void {
      teardown();
      update((s) => ({ ...s, isConnected: false, isReconnecting: false }));
    },

    /** Leaves the game for good: closes the socket and forgets the stored session. */
    leave(): void {
      teardown();
      transientError.clear();
      pendingJoin = null;
      clearStoredPlayerSession();
      set(initialPlayerState());
    },
  };
}

export const hostGameStore = createHostGameStore();
export const playerGameStore = createPlayerGameStore();

// Derived stores for host
export const hostPin = derived(hostGameStore, ($s) => $s.pin);
export const hostQuizTitle = derived(hostGameStore, ($s) => $s.quizTitle);
export const hostStatus = derived(hostGameStore, ($s) => $s.status);
export const hostPlayers = derived(hostGameStore, ($s) => $s.players);
export const hostPlayerCount = derived(hostGameStore, ($s) => $s.players.length);
export const hostCurrentQuestion = derived(hostGameStore, ($s) => $s.question);
export const hostQuestionResults = derived(hostGameStore, ($s) => $s.questionResults);
export const hostPodium = derived(hostGameStore, ($s) => $s.podium);
export const hostAnswerCount = derived(hostGameStore, ($s) => $s.answerCount);
export const hostTimeRemaining = derived(hostGameStore, ($s) => $s.timeRemaining);
export const hostLobbyTimerRemaining = derived(hostGameStore, ($s) => $s.lobbyTimerRemaining);
export const hostIsConnected = derived(hostGameStore, ($s) => $s.isConnected);
export const hostError = derived(hostGameStore, ($s) => $s.error);

// Derived stores for player
export const playerPin = derived(playerGameStore, ($s) => $s.pin);
export const playerNickname = derived(playerGameStore, ($s) => $s.nickname);
export const playerId = derived(playerGameStore, ($s) => $s.playerId);
export const playerStatus = derived(playerGameStore, ($s) => $s.status);
export const playerScore = derived(playerGameStore, ($s) => $s.score);
export const playerRank = derived(playerGameStore, ($s) => $s.rank);
export const playerStreak = derived(playerGameStore, ($s) => $s.streak);
export const playerQuestion = derived(playerGameStore, ($s) => $s.question);
export const playerFeedback = derived(playerGameStore, ($s) => $s.feedback);
export const playerQuestionResults = derived(playerGameStore, ($s) => $s.questionResults);
export const playerAnswerStatus = derived(playerGameStore, ($s) => $s.answerStatus);
export const playerPodium = derived(playerGameStore, ($s) => $s.podium);
export const playerTimeRemaining = derived(playerGameStore, ($s) => $s.timeRemaining);
export const playerLobbyTimerRemaining = derived(playerGameStore, ($s) => $s.lobbyTimerRemaining);
export const playerIsConnected = derived(playerGameStore, ($s) => $s.isConnected);
export const playerIsReconnecting = derived(playerGameStore, ($s) => $s.isReconnecting);
export const playerError = derived(playerGameStore, ($s) => $s.error);
export const playerCurrentQuestionIndex = derived(playerGameStore, ($s) => $s.currentQuestionIndex);
export const playerQuestionCount = derived(playerGameStore, ($s) => $s.questionCount);

/** The player may click an option. */
export const canAnswer = derived(
  playerGameStore,
  ($s) =>
    $s.status === 'QUESTION_ACTIVE' &&
    !!$s.question &&
    $s.question.questionIndex === $s.currentQuestionIndex &&
    $s.answerStatus === 'none' &&
    $s.timeRemaining > 0 &&
    $s.isConnected &&
    !$s.isReconnecting,
);

/** Result screen: every player, answered or not (ADR 0001 §6 `player:feedback`). */
export const showQuestionResults = derived(playerGameStore, ($s) => $s.status === 'QUESTION_RESULT');

export const showPodium = derived(playerGameStore, ($s) => $s.status === 'PODIUM' && !!$s.podium);
