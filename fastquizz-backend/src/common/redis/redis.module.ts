import { Global, Module } from '@nestjs/common';
import { GameRedisService } from './game-redis.service';

@Global()
@Module({
  providers: [GameRedisService],
  exports: [GameRedisService],
})
export class RedisModule {}