import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { GameRedisService } from '../src/common/redis/game-redis.service';

let app: INestApplication;
let prisma: PrismaService;
let redis: GameRedisService;

export const getApp = () => app;
export const getPrisma = () => prisma;
export const getRedis = () => redis;

/**
 * Boots the full application (requires a valid .env with PostgreSQL + Redis).
 * AppModule is imported lazily: importing it evaluates ConfigModule.forRoot (env validation), which must not
 * break suites that do not need the full app (e.g. game-gateway.e2e-spec.ts).
 */
export async function setupTestApp(): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module');
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  // Same global pipe as main.ts
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();

  prisma = app.get(PrismaService);
  redis = app.get(GameRedisService);

  return app;
}

export async function teardownTestApp(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
  // Redis connections are closed by GameRedisService.onModuleDestroy during app.close().
  if (app) {
    await app.close();
  }
}

export const getHttpServer = () => app.getHttpServer();
export const apiRequest = (method: 'get' | 'post' | 'put' | 'delete' | 'patch', path: string) => {
  return request(app.getHttpServer())[method](path);
};
