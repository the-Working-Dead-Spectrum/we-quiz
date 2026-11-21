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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { QuizService } from './quiz.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('quizzes')
@Controller('quizzes')
export class QuizController {
  constructor(private quizService: QuizService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new quiz' })
  async create(@Request() req: any, @Body() dto: CreateQuizDto) {
    return this.quizService.create(req.user.sub, dto);
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