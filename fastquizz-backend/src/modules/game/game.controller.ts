import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { GameService } from './game.service';
import { GameError } from './game-errors';
import { CreateGameDto, CreateGameResponseDto } from './dto/create-game.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface AuthenticatedRequest {
  user: { sub: string };
}

@ApiTags('games')
@Controller('games')
export class GameController {
  constructor(private readonly gameService: GameService) {}

  /**
   * ADR 0001 section 10. Creates the Room, the Redis game state and the GameSession (pin === room code).
   * The lobby timer is NOT started here: it starts on the first `host:join_game`.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a live game (room) from a quiz owned by the caller or public' })
  @ApiCreatedResponse({ type: CreateGameResponseDto })
  @ApiNotFoundResponse({ description: 'Quiz not found, or not owned by the caller and not public' })
  @ApiUnprocessableEntityResponse({ description: 'Quiz is not playable' })
  async createGame(@Request() req: AuthenticatedRequest, @Body() dto: CreateGameDto): Promise<CreateGameResponseDto> {
    try {
      const game = await this.gameService.createRoomGame(req.user.sub, dto.quizId);
      return {
        roomCode: game.pin,
        pin: game.pin,
        quizTitle: game.quizTitle,
        questionCount: game.questionCount,
        hostToken: game.hostToken,
      };
    } catch (error) {
      if (error instanceof GameError && error.code === 'QUIZ_NOT_FOUND') {
        throw new NotFoundException('Quiz not found');
      }
      if (error instanceof GameError && error.code === 'QUIZ_INVALID') {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get game room state by room code' })
  @ApiParam({ name: 'code', description: 'Room code / game PIN' })
  async getRoom(@Param('code') code: string) {
    return this.gameService.getGameState(code);
  }

  @Get(':code/players')
  @ApiOperation({ summary: 'Get players in game room' })
  @ApiParam({ name: 'code', description: 'Room code / game PIN' })
  async getPlayers(@Param('code') code: string) {
    return this.gameService.getPlayers(code);
  }

  @Post(':code/start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate host can start game (actual start via WebSocket)' })
  @ApiParam({ name: 'code', description: 'Room code / game PIN' })
  async startGame(@Request() req: AuthenticatedRequest, @Param('code') code: string) {
    return this.gameService.startGame(req.user.sub, code);
  }
}
