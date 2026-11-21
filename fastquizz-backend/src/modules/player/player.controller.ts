import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { PlayerService } from './player.service';

@ApiTags('players')
@Controller('players')
export class PlayerController {
  constructor(private playerService: PlayerService) {}

  @Get('game/:pin')
  @ApiOperation({ summary: 'Get all players in a game (for host dashboard)' })
  @ApiParam({ name: 'pin', description: 'Game PIN' })
  async getGamePlayers(@Param('pin') pin: string) {
    return this.playerService.getGamePlayers(pin);
  }

  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Get game session results' })
  @ApiParam({ name: 'sessionId', description: 'Game session ID' })
  async getGameResults(@Param('sessionId') sessionId: string) {
    return this.playerService.getGameResults(sessionId);
  }
}