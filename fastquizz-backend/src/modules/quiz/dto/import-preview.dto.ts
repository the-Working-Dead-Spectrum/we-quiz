import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// Form fields that accompany the uploaded .xlsx on POST /quizzes/import/preview.
// The questions themselves come from the file: there is no `questions` field here.
export class ImportPreviewDto {
  @ApiProperty({ example: 'Geography Quiz' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @ApiProperty({ example: 'Test your geography knowledge', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Multipart form fields arrive as strings: coerce the common truthy spellings to a boolean.
  @ApiProperty({ example: false, required: false, default: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['true', '1', 'on', 'yes'].includes(value.toLowerCase());
    return false;
  })
  isPublic?: boolean;
}
