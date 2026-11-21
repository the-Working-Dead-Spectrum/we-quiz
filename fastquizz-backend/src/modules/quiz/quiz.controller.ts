import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { QuizService } from './quiz.service';
import { QuizImportService } from './quiz-import.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { ImportPreviewDto } from './dto/import-preview.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const XLSX_MAX_BYTES = 2 * 1024 * 1024; // 2 MB hard cap on the upload before parsing
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers mislabel .xlsx this way
]);

@ApiTags('quizzes')
@Controller('quizzes')
export class QuizController {
  constructor(
    private quizService: QuizService,
    private quizImportService: QuizImportService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new quiz' })
  async create(@Request() req: any, @Body() dto: CreateQuizDto) {
    return this.quizService.create(req.user.sub, dto);
  }

  @Post('import/preview')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        description: { type: 'string' },
        isPublic: { type: 'boolean' },
      },
      required: ['file', 'title'],
    },
  })
  @ApiOperation({
    summary: 'Parse an uploaded .xlsx into a CreateQuizDto preview (no DB write)',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: XLSX_MAX_BYTES, files: 1 },
    }),
  )
  async importPreview(
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: ImportPreviewDto,
  ) {
    if (!file) {
      throw new BadRequestException('Fichier Excel manquant');
    }
    if (!/\.xlsx$/i.test(file.originalname || '')) {
      throw new BadRequestException('Format attendu : .xlsx');
    }
    if (file.mimetype && !XLSX_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Type MIME invalide (attendu : .xlsx)');
    }
    return this.quizImportService.preview(file, meta);
  }

  // Lists the caller's quizzes only. Any `authorId` query parameter is ignored on purpose (IDOR fix).
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the authenticated user's quizzes" })
  async findAll(@Request() req: any) {
    return this.quizService.findAll(req.user.sub);
  }

  @Get('public')
  @ApiOperation({ summary: 'Get all public quizzes' })
  async findPublic() {
    return this.quizService.findPublic();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a quiz by ID (owner: full quiz; others: public quiz without answers)' })
  @ApiParam({ name: 'id', description: 'Quiz ID' })
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.quizService.findOne(id, req.user.sub);
  }

  @Get(':id/game')
  @ApiOperation({ summary: 'Get a public quiz for game play (without correct answers); 404 if private' })
  @ApiParam({ name: 'id', description: 'Quiz ID' })
  async getForGame(@Param('id') id: string) {
    return this.quizService.getQuizForGame(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a quiz' })
  @ApiParam({ name: 'id', description: 'Quiz ID' })
  async update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateQuizDto) {
    return this.quizService.update(req.user.sub, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a quiz' })
  @ApiParam({ name: 'id', description: 'Quiz ID' })
  async delete(@Request() req: any, @Param('id') id: string) {
    return this.quizService.delete(req.user.sub, id);
  }

  // ========== SHARE ENDPOINTS ==========
  @Put(':id/public')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle quiz public/private visibility' })
  @ApiParam({ name: 'id', description: 'Quiz ID' })
  async togglePublic(@Request() req: any, @Param('id') id: string) {
    return this.quizService.togglePublic(req.user.sub, id);
  }

  @Post(':id/share')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate shareable link for quiz' })
  @ApiParam({ name: 'id', description: 'Quiz ID' })
  async generateShareToken(@Request() req: any, @Param('id') id: string) {
    return this.quizService.generateShareToken(req.user.sub, id);
  }

  @Delete(':id/share')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke shareable link for quiz' })
  @ApiParam({ name: 'id', description: 'Quiz ID' })
  async revokeShareToken(@Request() req: any, @Param('id') id: string) {
    return this.quizService.revokeShareToken(req.user.sub, id);
  }

  @Get('shared/:token')
  @ApiOperation({ summary: 'Get quiz by share token (no auth required)' })
  @ApiParam({ name: 'token', description: 'Share token' })
  async getByShareToken(@Param('token') token: string) {
    return this.quizService.getQuizByShareToken(token);
  }
}