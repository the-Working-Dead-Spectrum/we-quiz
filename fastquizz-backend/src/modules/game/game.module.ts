import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { GameController } from './game.controller';
import { RoomService } from './room.service';
import { GameIdentifierService } from './game-identifier.service';
import { RedisModule } from '../../common/redis/redis.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [RedisModule, PrismaModule],
  providers: [GameGateway, GameService, RoomService, GameIdentifierService],
  controllers: [GameController],
  exports: [GameGateway, GameService, RoomService],
})
export class GameModule {}
