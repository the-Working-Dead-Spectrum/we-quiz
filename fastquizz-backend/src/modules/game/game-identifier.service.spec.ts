import { GameIdentifierService } from './game-identifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GameRedisService } from '../../common/redis/game-redis.service';

describe('GameIdentifierService', () => {
  let prisma: { gameSession: { findUnique: jest.Mock }; room: { findUnique: jest.Mock } };
  let redis: { tryReservePin: jest.Mock };
  let service: GameIdentifierService;

  beforeEach(() => {
    prisma = {
      gameSession: { findUnique: jest.fn().mockResolvedValue(null) },
      room: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    redis = { tryReservePin: jest.fn().mockResolvedValue(true) };
    service = new GameIdentifierService(prisma as unknown as PrismaService, redis as unknown as GameRedisService);
  });

  describe('allocateNumericPin', () => {
    it('returns a 6-digit pin that is free in DB and reserved in Redis', async () => {
      const pin = await service.allocateNumericPin();

      expect(pin).toMatch(/^[1-9]\d{5}$/);
      expect(prisma.gameSession.findUnique).toHaveBeenCalledWith({ where: { pin }, select: { id: true } });
      expect(prisma.room.findUnique).toHaveBeenCalledWith({ where: { code: pin }, select: { id: true } });
      expect(redis.tryReservePin).toHaveBeenCalledWith(pin);
    });

    it('skips a value already used by a GameSession or a Room', async () => {
      prisma.gameSession.findUnique.mockResolvedValueOnce({ id: 'old-session' });
      prisma.room.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'room' });

      await service.allocateNumericPin();

      // attempts 1 and 2 rejected by the DB check, attempt 3 reserved
      expect(redis.tryReservePin).toHaveBeenCalledTimes(1);
      expect(prisma.gameSession.findUnique).toHaveBeenCalledTimes(3);
    });

    it('skips a value whose Redis reservation is already taken', async () => {
      redis.tryReservePin.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await service.allocateNumericPin();

      expect(redis.tryReservePin).toHaveBeenCalledTimes(2);
    });

    it('falls back to 8 digits when the 6-digit space is congested', async () => {
      redis.tryReservePin.mockImplementation(async (pin: string) => pin.length === 8);

      const pin = await service.allocateNumericPin(3);

      expect(pin).toMatch(/^[1-9]\d{7}$/);
      expect(redis.tryReservePin).toHaveBeenCalledTimes(4);
    });

    it('throws when no identifier can be allocated', async () => {
      redis.tryReservePin.mockResolvedValue(false);
      await expect(service.allocateNumericPin(2)).rejects.toThrow('Failed to allocate a unique game PIN');
    });
  });

  describe('allocateRoomCode', () => {
    it('returns 6 chars from the room alphabet (no 0, O, 1, I)', async () => {
      const code = await service.allocateRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    });

    it('throws after max attempts', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.allocateRoomCode(3)).rejects.toThrow(
        'Failed to generate unique room code after maximum attempts',
      );
      expect(prisma.room.findUnique).toHaveBeenCalledTimes(3);
      expect(redis.tryReservePin).not.toHaveBeenCalled();
    });
  });
});
