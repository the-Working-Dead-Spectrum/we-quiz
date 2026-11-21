import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Body of `POST /api/games` (ADR 0001 section 10). */
export class CreateGameDto {
  @ApiProperty({ description: 'Quiz ID (uuid)' })
  @IsUUID()
  quizId: string;
}

/** Response of `POST /api/games` (ADR 0001 section 10). `roomCode === pin`. */
export class CreateGameResponseDto {
  @ApiProperty({ example: 'AB3XYZ' })
  roomCode: string;

  @ApiProperty({ example: 'AB3XYZ' })
  pin: string;

  @ApiProperty()
  quizTitle: string;

  @ApiProperty()
  questionCount: number;

  @ApiProperty({ description: 'Secret host token (uuid). Never log it, never put it in a URL.' })
  hostToken: string;
}
