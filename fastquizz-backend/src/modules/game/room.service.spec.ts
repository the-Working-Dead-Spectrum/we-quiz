import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { RoomService } from './room.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GameRedisService } from '../../common/redis/game-redis.service';
import { GameIdentifierService } from './game-identifier.service';
import { GameError } from './game-errors';
import { RoomStatus } from '@prisma/client';

describe('RoomService', () => {
  let service: RoomService;
  let prisma: any;
  let redis: any;
  let identifiers: { allocateRoomCode: jest.Mock };

  const mockRoom = {
    id: 'room-1',
    code: 'ABC123',
    quizId: 'quiz-1',
    hostId: 'host-1',
    status: RoomStatus.LOBBY,
    maxPlayers: 500,
    startedAt: null,
    endedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    participants: [],
    quiz: { id: 'quiz-1', title: 'Test Quiz', questions: [] },
    gameSession: null,
  };

  const mockParticipant = {
    id: 'participant-1',
    roomId: 'room-1',
    userId: null,
    nickname: 'TestPlayer',
    score: 0,
    correctAnswersCount: 0,
    joinedAt: new Date(),
    leftAt: null,
  };

  beforeEach(async () => {
    const mockRedis = {
      setRoomState: jest.fn(),
      updateRoomParticipants: jest.fn(),
      deleteRoom: jest.fn(),
    };

    const mockPrisma = {
      room: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      roomParticipant: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      gameSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GameRedisService, useValue: mockRedis },
        { provide: GameIdentifierService, useValue: { allocateRoomCode: jest.fn() } },
      ],
    }).compile();

    service = module.get<RoomService>(RoomService);
    prisma = module.get(PrismaService);
    redis = module.get(GameRedisService);
    identifiers = module.get(GameIdentifierService);

    jest.clearAllMocks();
    identifiers.allocateRoomCode.mockResolvedValue('ABC234');
  });

  describe('createRoom', () => {
    it('should create a room with a code from the identifier allocator and initialize Redis state', async () => {
      prisma.room.create.mockResolvedValue(mockRoom);
      redis.setRoomState.mockResolvedValue(undefined);

      const result = await service.createRoom({ quizId: 'quiz-1', hostId: 'host-1' });

      expect(identifiers.allocateRoomCode).toHaveBeenCalled();
      expect(prisma.room.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'ABC234',
          quizId: 'quiz-1',
          hostId: 'host-1',
          status: RoomStatus.LOBBY,
          maxPlayers: 500,
        }),
      });
      expect(redis.setRoomState).toHaveBeenCalled();
      expect(result.code).toBe('ABC234');
    });

    it('should use custom maxPlayers when provided', async () => {
      prisma.room.create.mockResolvedValue({ ...mockRoom, maxPlayers: 100 });
      redis.setRoomState.mockResolvedValue(undefined);

      const result = await service.createRoom({ quizId: 'quiz-1', hostId: 'host-1', maxPlayers: 100 });

      expect(prisma.room.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ maxPlayers: 100 }),
      });
      expect(result.maxPlayers).toBe(100);
    });
  });

  describe('findByCode', () => {
    it('should return room with participants, quiz, and gameSession', async () => {
      prisma.room.findUnique.mockResolvedValue(mockRoom);

      const result = await service.findByCode('ABC123');

      expect(prisma.room.findUnique).toHaveBeenCalledWith({
        where: { code: 'ABC123' },
        include: { participants: true, quiz: true, gameSession: true },
      });
      expect(result).toEqual(mockRoom);
    });

    it('should return null for non-existent code', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      const result = await service.findByCode('NONEXIST');

      expect(result).toBeNull();
    });
  });

  describe('validateRoomAccess', () => {
    it('should return room when valid and in LOBBY', async () => {
      prisma.room.findUnique.mockResolvedValue(mockRoom);

      const result = await service.validateRoomAccess('ABC123');

      expect(result).toEqual(mockRoom);
    });

    it('should throw NotFoundException for non-existent room', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      await expect(service.validateRoomAccess('NONEXIST')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when room not in LOBBY', async () => {
      prisma.room.findUnique.mockResolvedValue({ ...mockRoom, status: RoomStatus.IN_PROGRESS });

      await expect(service.validateRoomAccess('ABC123')).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when room is full', async () => {
      const fullRoom = { ...mockRoom, maxPlayers: 2, participants: [{}, {}] };
      prisma.room.findUnique.mockResolvedValue(fullRoom);

      await expect(service.validateRoomAccess('ABC123')).rejects.toThrow(ConflictException);
    });
  });

  describe('addParticipant', () => {
    it('should add participant and sync to Redis', async () => {
      const roomWithParticipants = { ...mockRoom, participants: [] };
      prisma.room.findUnique
        .mockResolvedValueOnce(roomWithParticipants)
        .mockResolvedValueOnce({ ...mockRoom, participants: [mockParticipant] });
      prisma.roomParticipant.create.mockResolvedValue(mockParticipant);
      redis.updateRoomParticipants.mockResolvedValue(undefined);

      const result = await service.addParticipant('ABC123', { nickname: 'TestPlayer' });

      expect(prisma.roomParticipant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          roomId: 'room-1',
          nickname: 'TestPlayer',
          score: 0,
          correctAnswersCount: 0,
        }),
      });
      expect(redis.updateRoomParticipants).toHaveBeenCalled();
      expect(result.participant).toEqual(mockParticipant);
    });

    it('should throw ConflictException for duplicate nickname', async () => {
      const roomWithParticipant = { ...mockRoom, participants: [mockParticipant] };
      prisma.room.findUnique.mockResolvedValue(roomWithParticipant);

      await expect(
        service.addParticipant('ABC123', { nickname: 'TestPlayer' })
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeParticipant', () => {
    it('should mark participant as left and sync to Redis', async () => {
      const roomWithParticipant = { ...mockRoom, participants: [{ ...mockParticipant, leftAt: new Date() }] };
      prisma.roomParticipant.update.mockResolvedValue({ ...mockParticipant, leftAt: new Date() });
      prisma.room.findUnique.mockResolvedValue(roomWithParticipant);
      redis.updateRoomParticipants.mockResolvedValue(undefined);

      await service.removeParticipant('ABC123', 'participant-1');

      expect(prisma.roomParticipant.update).toHaveBeenCalledWith({
        where: { id: 'participant-1' },
        data: { leftAt: expect.any(Date) },
      });
      expect(redis.updateRoomParticipants).toHaveBeenCalled();
    });
  });

  describe('startRoom', () => {
    it('should start room and set status to IN_PROGRESS', async () => {
      const roomWithParticipants = { ...mockRoom, participants: [mockParticipant] };
      prisma.room.findUnique.mockResolvedValue(roomWithParticipants);
      prisma.room.update.mockResolvedValue({ ...mockRoom, status: RoomStatus.IN_PROGRESS, startedAt: new Date() });

      const result = await service.startRoom('ABC123');

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { code: 'ABC123' },
        data: { status: RoomStatus.IN_PROGRESS, startedAt: expect.any(Date) },
      });
      expect(result.status).toBe(RoomStatus.IN_PROGRESS);
    });

    it('should throw BadRequestException if room not in LOBBY', async () => {
      prisma.room.findUnique.mockResolvedValue({ ...mockRoom, status: RoomStatus.IN_PROGRESS });

      await expect(service.startRoom('ABC123')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if no participants', async () => {
      prisma.room.findUnique.mockResolvedValue({ ...mockRoom, participants: [] });

      await expect(service.startRoom('ABC123')).rejects.toThrow(BadRequestException);
    });
  });

  describe('endRoom', () => {
    it('should end room and set status to ENDED', async () => {
      prisma.room.update.mockResolvedValue({ ...mockRoom, status: RoomStatus.ENDED, endedAt: new Date() });

      const result = await service.endRoom('ABC123');

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { code: 'ABC123' },
        data: { status: RoomStatus.ENDED, endedAt: expect.any(Date) },
      });
      expect(result.status).toBe(RoomStatus.ENDED);
    });
  });

  describe('abandonRoom', () => {
    it('should abandon room and set status to ABANDONED', async () => {
      prisma.room.update.mockResolvedValue({ ...mockRoom, status: RoomStatus.ABANDONED, endedAt: new Date() });

      const result = await service.abandonRoom('ABC123');

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { code: 'ABC123' },
        data: { status: RoomStatus.ABANDONED, endedAt: expect.any(Date) },
      });
      expect(result.status).toBe(RoomStatus.ABANDONED);
    });
  });

  describe('createParticipant', () => {
    it('should persist the live-game player with its playerId as id', async () => {
      prisma.roomParticipant.create.mockResolvedValue(mockParticipant);

      await service.createParticipant('room-1', 'player-1', 'Alice');

      expect(prisma.roomParticipant.create).toHaveBeenCalledWith({
        data: { id: 'player-1', roomId: 'room-1', nickname: 'Alice', score: 0, correctAnswersCount: 0 },
      });
    });

    it('should map a Prisma P2002 unique violation to NICKNAME_TAKEN', async () => {
      prisma.roomParticipant.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

      const error = await service.createParticipant('room-1', 'player-1', 'Alice').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(GameError);
      expect((error as GameError).code).toBe('NICKNAME_TAKEN');
    });

    it('should rethrow any other database error', async () => {
      prisma.roomParticipant.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.createParticipant('room-1', 'player-1', 'Alice')).rejects.toThrow('connection lost');
    });
  });
});