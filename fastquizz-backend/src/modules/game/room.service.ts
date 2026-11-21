import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GameRedisService } from '../../common/redis/game-redis.service';
import { RoomStatus, Room } from '@prisma/client';
import { GameIdentifierService } from './game-identifier.service';
import { GameError } from './game-errors';

@Injectable()
export class RoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GameRedisService,
    private readonly identifiers: GameIdentifierService,
  ) {}

  /**
   * Creates a Room whose code is unique across Room.code, GameSession.pin and Redis
   * (the code is reserved in Redis and becomes the game `pin`, ADR 0001 section 2).
   */
  async createRoom(data: {
    quizId: string;
    hostId: string;
    maxPlayers?: number;
  }): Promise<Room & { code: string }> {
    const code = await this.identifiers.allocateRoomCode();
    const room = await this.prisma.room.create({
      data: {
        code,
        quizId: data.quizId,
        hostId: data.hostId,
        maxPlayers: data.maxPlayers ?? 500,
        status: RoomStatus.LOBBY,
      },
    });

    await this.redis.setRoomState(code, {
      status: RoomStatus.LOBBY,
      quizId: data.quizId,
      hostId: data.hostId,
      maxPlayers: data.maxPlayers ?? 500,
      participants: [],
    });

    return { ...room, code };
  }

  async findByCode(code: string): Promise<Room | null> {
    return this.prisma.room.findUnique({
      where: { code },
      include: {
        participants: true,
        quiz: true,
        gameSession: true,
      },
    });
  }

  async findByCodeOrThrow(code: string): Promise<Room & { participants: any[]; quiz: any; gameSession: any }> {
    const room = await this.findByCode(code);
    if (!room) {
      throw new NotFoundException(`Room with code ${code} not found`);
    }
    return room as Room & { participants: any[]; quiz: any; gameSession: any };
  }

  async validateRoomAccess(code: string): Promise<Room & { participants: any[]; quiz: any; gameSession: any }> {
    const room = await this.findByCodeOrThrow(code);

    if (room.status !== RoomStatus.LOBBY) {
      throw new BadRequestException(`Room is not accepting players (status: ${room.status})`);
    }

    const participantCount = room.participants.length;
    if (participantCount >= room.maxPlayers) {
      throw new ConflictException('Room is full');
    }

    return room;
  }

  async addParticipant(roomCode: string, data: {
    nickname: string;
    userId?: string;
  }): Promise<{ participant: any; room: Room & { participants: any[] } }> {
    const room = await this.validateRoomAccess(roomCode);

    const existingParticipant = room.participants.find((p: any) => p.nickname === data.nickname);
    if (existingParticipant) {
      throw new ConflictException(`Nickname "${data.nickname}" is already taken in this room`);
    }

    const participant = await this.prisma.roomParticipant.create({
      data: {
        roomId: room.id,
        userId: data.userId,
        nickname: data.nickname,
        score: 0,
        correctAnswersCount: 0,
      },
    });

    const updatedRoom = await this.prisma.room.findUnique({
      where: { code: roomCode },
      include: { participants: true },
    });

    if (!updatedRoom) {
      throw new NotFoundException(`Room with code ${roomCode} not found after adding participant`);
    }

    const redisParticipants = updatedRoom.participants.map((p: any) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      correctAnswersCount: p.correctAnswersCount,
      joinedAt: p.joinedAt.getTime(),
    }));

    await this.redis.updateRoomParticipants(roomCode, redisParticipants);

    return { participant, room: updatedRoom };
  }

  async removeParticipant(roomCode: string, participantId: string): Promise<void> {
    await this.prisma.roomParticipant.update({
      where: { id: participantId },
      data: { leftAt: new Date() },
    });

    const updatedRoom = await this.prisma.room.findUnique({
      where: { code: roomCode },
      include: { participants: true },
    });

    if (updatedRoom) {
      const redisParticipants = updatedRoom.participants
        .filter(p => !p.leftAt)
        .map(p => ({
          id: p.id,
          nickname: p.nickname,
          score: p.score,
          correctAnswersCount: p.correctAnswersCount,
          joinedAt: p.joinedAt.getTime(),
        }));

      await this.redis.updateRoomParticipants(roomCode, redisParticipants);
    }
  }

  async startRoom(roomCode: string): Promise<Room> {
    const room = await this.findByCodeOrThrow(roomCode);

    if (room.status !== RoomStatus.LOBBY) {
      throw new BadRequestException(`Room cannot be started (status: ${room.status})`);
    }

    if (room.participants.length === 0) {
      throw new BadRequestException('Cannot start room with no participants');
    }

    return this.prisma.room.update({
      where: { code: roomCode },
      data: {
        status: RoomStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });
  }

  async endRoom(roomCode: string): Promise<Room> {
    return this.prisma.room.update({
      where: { code: roomCode },
      data: {
        status: RoomStatus.ENDED,
        endedAt: new Date(),
      },
    });
  }

  async abandonRoom(roomCode: string): Promise<Room> {
    return this.prisma.room.update({
      where: { code: roomCode },
      data: {
        status: RoomStatus.ABANDONED,
        endedAt: new Date(),
      },
    });
  }

  async getParticipants(roomCode: string) {
    const room = await this.findByCodeOrThrow(roomCode);
    return room.participants.filter(p => !p.leftAt);
  }

  /**
   * Persists a live-game player as RoomParticipant (id = playerId).
   * A unique-constraint violation on (roomId, nickname) is a NICKNAME_TAKEN, never an INTERNAL_ERROR.
   */
  async createParticipant(roomId: string, playerId: string, nickname: string): Promise<void> {
    try {
      await this.prisma.roomParticipant.create({
        data: {
          id: playerId,
          roomId,
          nickname,
          score: 0,
          correctAnswersCount: 0,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new GameError('NICKNAME_TAKEN', 'This nickname is already taken in this game');
      }
      throw error;
    }
  }
}

/** Prisma P2002 = unique constraint failed. Duck-typed to stay independent of the generated client. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}