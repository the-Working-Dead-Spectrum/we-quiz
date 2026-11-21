import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  MinLength,
  MaxLength,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  IsNumber,
  IsUrl,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { HasExactlyOneCorrectOption, HasUniqueColorIndexes } from './option-rules.validator';

// Limits shared by the DTOs and their specs (ADR 0001 section 8 for options / colorIndex).
export const QUIZ_LIMITS = {
  MIN_OPTIONS: 2,
  MAX_OPTIONS: 4,
  MAX_QUESTIONS: 100,
  MAX_IMAGE_URL_LENGTH: 2048,
} as const;

export class CreateOptionDto {
  @ApiProperty({ example: 'Option text' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  text: string;

  // The global pipe's enableImplicitConversion turns "false" into true (Boolean("false")).
  // Keep the raw input so @IsBoolean rejects strings instead of flipping the correct answer.
  @ApiProperty({ example: true })
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  isCorrect: boolean;

  @ApiProperty({ example: 0, minimum: 0, maximum: 3, description: '0: Red/Triangle, 1: Blue/Diamond, 2: Yellow/Circle, 3: Green/Square' })
  @IsInt()
  @Min(0)
  @Max(3)
  colorIndex: number;
}

export class CreateQuestionDto {
  @ApiProperty({ example: 'What is the capital of France?' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;

  // Only absolute http(s) URLs: rejects javascript:, data: and relative values rendered in <img src>.
  @ApiProperty({ example: 'https://example.com/image.jpg', required: false, maxLength: QUIZ_LIMITS.MAX_IMAGE_URL_LENGTH })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(QUIZ_LIMITS.MAX_IMAGE_URL_LENGTH)
  imageUrl?: string;

  // Integer: the Prisma column is Int, a decimal would fail at write time (500).
  @ApiProperty({ example: 20, default: 20, minimum: 5, maximum: 120 })
  @IsInt()
  @Min(5)
  @Max(120)
  timeLimit: number;

  @ApiProperty({ example: 1.0, default: 1.0, minimum: 0.1, maximum: 10 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.1)
  @Max(10)
  pointsMultiplier: number;

  @ApiProperty({ type: [CreateOptionDto], minItems: QUIZ_LIMITS.MIN_OPTIONS, maxItems: QUIZ_LIMITS.MAX_OPTIONS })
  @IsArray()
  @ArrayMinSize(QUIZ_LIMITS.MIN_OPTIONS)
  @ArrayMaxSize(QUIZ_LIMITS.MAX_OPTIONS)
  @HasExactlyOneCorrectOption()
  @HasUniqueColorIndexes()
  @ValidateNested({ each: true })
  @Type(() => CreateOptionDto)
  options: CreateOptionDto[];
}

export class CreateQuizDto {
  @ApiProperty({ example: 'Geography Quiz' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiProperty({ example: 'Test your geography knowledge', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: [CreateQuestionDto], minItems: 1, maxItems: QUIZ_LIMITS.MAX_QUESTIONS })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  @ArrayMinSize(1, { message: 'At least one question is required' })
  @ArrayMaxSize(QUIZ_LIMITS.MAX_QUESTIONS)
  questions: CreateQuestionDto[];
}
