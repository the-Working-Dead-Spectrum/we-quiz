import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  HostCreateGameDto,
  HostStartGameDto,
  PlayerJoinDto,
  PlayerReconnectDto,
  PlayerSubmitAnswerDto,
} from './game-events.dto';

/**
 * Runs the DTOs through the same pipes as production: the global pipe of main.ts (with implicit conversion)
 * followed by the gateway pipe.
 */
const globalPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const gatewayPipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

async function validatePayload<T>(metatype: new () => T, payload: unknown): Promise<T> {
  const metadata: ArgumentMetadata = { type: 'body', metatype, data: undefined };
  const afterGlobal = await globalPipe.transform(payload, metadata);
  return gatewayPipe.transform(afterGlobal, metadata);
}

const TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OPTION_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('Game WebSocket DTOs (ADR 0001 section 5)', () => {
  describe('pin normalization and format', () => {
    it.each(['123456', '1234567', 'AB3XYZ12'])('accepts a %s-like pin', async (pin) => {
      const dto = await validatePayload(PlayerJoinDto, { pin, nickname: 'Alice' });
      expect(dto.pin).toBe(pin);
    });

    it('trims and upper-cases the pin before validation', async () => {
      const dto = await validatePayload(PlayerJoinDto, { pin: '  ab3xyz ', nickname: 'Alice' });
      expect(dto.pin).toBe('AB3XYZ');
    });

    it.each(['12345', '123456789', '12-456', '', 'ÀBCDEF'])('rejects pin "%s"', async (pin) => {
      await expect(validatePayload(PlayerJoinDto, { pin, nickname: 'Alice' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a numeric pin instead of coercing it (implicit conversion is cancelled)', async () => {
      await expect(validatePayload(PlayerJoinDto, { pin: 123456, nickname: 'Alice' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('PlayerJoinDto nickname', () => {
    it('trims the nickname', async () => {
      const dto = await validatePayload(PlayerJoinDto, { pin: '123456', nickname: '  Alice  ' });
      expect(dto.nickname).toBe('Alice');
    });

    it('accepts 20 characters and emoji', async () => {
      await expect(validatePayload(PlayerJoinDto, { pin: '123456', nickname: 'a'.repeat(20) })).resolves.toBeDefined();
      await expect(validatePayload(PlayerJoinDto, { pin: '123456', nickname: 'Zoé 🎉' })).resolves.toBeDefined();
    });

    it.each([
      ['empty after trim', '   '],
      ['21 characters', 'a'.repeat(21)],
      ['a control character', 'Ali\u0007ce'],
      ['a newline', 'Ali\nce'],
    ])('rejects a nickname with %s', async (_label, nickname) => {
      await expect(validatePayload(PlayerJoinDto, { pin: '123456', nickname })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects the removed playerToken field', async () => {
      await expect(
        validatePayload(PlayerJoinDto, { pin: '123456', nickname: 'Alice', playerToken: TOKEN }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('HostCreateGameDto', () => {
    it('accepts quizId with an optional shareToken', async () => {
      await expect(validatePayload(HostCreateGameDto, { quizId: TOKEN })).resolves.toBeDefined();
      await expect(validatePayload(HostCreateGameDto, { quizId: TOKEN, shareToken: 'abc123' })).resolves.toBeDefined();
    });

    it('rejects the removed hostId field', async () => {
      await expect(validatePayload(HostCreateGameDto, { quizId: TOKEN, hostId: TOKEN })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('host action DTOs', () => {
    it('requires the host token', async () => {
      await expect(validatePayload(HostStartGameDto, { pin: '123456' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a malformed host token', async () => {
      await expect(validatePayload(HostStartGameDto, { pin: '123456', hostToken: 'nope' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts pin + hostToken', async () => {
      const dto = await validatePayload(HostStartGameDto, { pin: 'ab3xyz', hostToken: TOKEN });
      expect(dto).toMatchObject({ pin: 'AB3XYZ', hostToken: TOKEN });
    });
  });

  describe('PlayerReconnectDto', () => {
    it('requires a uuid player token', async () => {
      await expect(validatePayload(PlayerReconnectDto, { playerToken: TOKEN })).resolves.toBeDefined();
      await expect(validatePayload(PlayerReconnectDto, { playerToken: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('PlayerSubmitAnswerDto', () => {
    const valid = { pin: '123456', questionIndex: 0, optionId: OPTION_ID, playerToken: TOKEN };

    it('accepts a valid answer', async () => {
      await expect(validatePayload(PlayerSubmitAnswerDto, valid)).resolves.toMatchObject(valid);
    });

    it.each([
      ['a negative index', -1],
      ['a decimal index', 1.5],
      ['a string index', '1'],
    ])('rejects %s', async (_label, questionIndex) => {
      await expect(validatePayload(PlayerSubmitAnswerDto, { ...valid, questionIndex })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a non-uuid optionId', async () => {
      await expect(validatePayload(PlayerSubmitAnswerDto, { ...valid, optionId: 'o1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
