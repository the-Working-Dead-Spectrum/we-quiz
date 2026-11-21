import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GameRedisService } from '../../common/redis/game-redis.service';

@Injectable()
export class PlayerService {
  constructor(
    private prisma: PrismaService,
    private redis: GameRedisService,
  ) {}

  async getGamePlayers(pin: string) {
    const players = await this.redis.getAllPlayers(pin);
    const leaderboard = await this.redis.getLeaderboard(pin);

    const playerMap = new Map(players.map((p) => [p.id, p]));

    return leaderboard.map((entry) => {
      const player = playerMap.get(entry.playerId);
      return {
        playerId: entry.playerId,
        nickname: player?.nickname || 'Unknown',
        score: entry.score,
        rank: entry.rank,
        streak: player?.streak || 0,
        connected: player?.connected || false,
      };
    });
  }

  async getGameResults(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: {
        results: { orderBy: { rank: 'asc' } },
        quiz: { select: { title: true } },
      },
    });

    if (!session) {
      throw new NotFoundException('Game session not found');
    }

    return session;
  }

  async getPlayerHistory(playerToken: string) {
    // This would require storing playerToken in PlayerResult
    // For now, return empty - implement if needed
    return [];
  }
}