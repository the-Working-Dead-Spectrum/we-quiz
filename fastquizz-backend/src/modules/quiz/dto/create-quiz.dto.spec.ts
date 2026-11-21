import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateQuizDto } from './create-quiz.dto';
import { UpdateQuizDto } from './update-quiz.dto';

// Same options as the global pipe in src/main.ts (kept in sync by hand, see debt D-008).
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

type Dto = typeof CreateQuizDto | typeof UpdateQuizDto;

/** Returns the validation messages, or [] when the payload is accepted. */
async function validate(metatype: Dto, payload: unknown): Promise<string[]> {
  const metadata: ArgumentMetadata = { type: 'body', metatype, data: '' };
  try {
    await pipe.transform(payload, metadata);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const response = error.getResponse() as { message: string[] };
    return response.message;
  }
}

const option = (colorIndex: number, isCorrect = false) => ({ text: `Option ${colorIndex}`, isCorrect, colorIndex });

const question = (overrides: Record<string, unknown> = {}) => ({
  text: 'What is the capital of France?',
  timeLimit: 20,
  pointsMultiplier: 1,
  options: [option(0, true), option(1), option(2), option(3)],
  ...overrides,
});

const quiz = (overrides: Record<string, unknown> = {}) => ({
  title: 'Geography',
  description: 'Capitals',
  questions: [question()],
  ...overrides,
});

const withQuestion = (overrides: Record<string, unknown>) => quiz({ questions: [question(overrides)] });

function expectRejected(messages: string[], fragment: string) {
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.join(' | ')).toContain(fragment);
}

describe('CreateQuizDto validation (global ValidationPipe options)', () => {
  it('accepts a valid quiz', async () => {
    expect(await validate(CreateQuizDto, quiz())).toEqual([]);
  });

  it('accepts a 2-option question and an https image', async () => {
    const payload = withQuestion({
      options: [option(0), option(3, true)],
      imageUrl: 'https://example.com/image.jpg',
      pointsMultiplier: 1.5,
    });
    expect(await validate(CreateQuizDto, payload)).toEqual([]);
  });

  describe('options (B7, ADR 0001 section 8)', () => {
    it('rejects fewer than 2 options', async () => {
      expectRejected(
        await validate(CreateQuizDto, withQuestion({ options: [option(0, true)] })),
        'options must contain at least 2 elements',
      );
    });

    it('rejects more than 4 options', async () => {
      const options = [option(0, true), option(1), option(2), option(3), option(1)];
      expectRejected(
        await validate(CreateQuizDto, withQuestion({ options })),
        'options must contain no more than 4 elements',
      );
    });

    it('rejects a question without a correct option', async () => {
      const options = [option(0), option(1), option(2), option(3)];
      expectRejected(await validate(CreateQuizDto, withQuestion({ options })), 'exactly one correct option');
    });

    it('rejects a question with two correct options', async () => {
      const options = [option(0, true), option(1, true), option(2), option(3)];
      expectRejected(await validate(CreateQuizDto, withQuestion({ options })), 'exactly one correct option');
    });

    // Global enableImplicitConversion would turn "false" into true and make this payload "valid"
    // with option 0 as the correct answer.
    it('rejects isCorrect sent as the string "false" instead of flipping it to true', async () => {
      const options = [{ ...option(0), isCorrect: 'false' }, option(1), option(2), option(3)];
      expectRejected(await validate(CreateQuizDto, withQuestion({ options })), 'isCorrect must be a boolean value');
    });

    it('rejects isCorrect sent as the string "true"', async () => {
      const options = [{ ...option(0), isCorrect: 'true' }, option(1)];
      expectRejected(await validate(CreateQuizDto, withQuestion({ options })), 'isCorrect must be a boolean value');
    });

    it('rejects duplicate colorIndex within a question', async () => {
      const options = [option(0, true), option(0)];
      expectRejected(
        await validate(CreateQuizDto, withQuestion({ options })),
        'colorIndex must be unique within a question',
      );
    });

    it('accepts the same colorIndex in two different questions', async () => {
      const payload = quiz({ questions: [question(), question()] });
      expect(await validate(CreateQuizDto, payload)).toEqual([]);
    });

    it.each([
      [1.5, 'colorIndex must be an integer number'],
      [-1, 'colorIndex must not be less than 0'],
      [4, 'colorIndex must not be greater than 3'],
    ])('rejects colorIndex %p', async (colorIndex, fragment) => {
      const options = [option(0, true), { ...option(1), colorIndex }];
      expectRejected(await validate(CreateQuizDto, withQuestion({ options })), fragment);
    });
  });

  describe('timeLimit (ex T-016)', () => {
    it.each([
      [7.5, 'timeLimit must be an integer number'],
      [4, 'timeLimit must not be less than 5'],
      [121, 'timeLimit must not be greater than 120'],
    ])('rejects %p', async (timeLimit, fragment) => {
      expectRejected(await validate(CreateQuizDto, withQuestion({ timeLimit })), fragment);
    });

    it('accepts the bounds 5 and 120', async () => {
      const payload = quiz({ questions: [question({ timeLimit: 5 }), question({ timeLimit: 120 })] });
      expect(await validate(CreateQuizDto, payload)).toEqual([]);
    });
  });

  describe('pointsMultiplier (ex T-016)', () => {
    it.each([
      [0.05, 'pointsMultiplier must not be less than 0.1'],
      [11, 'pointsMultiplier must not be greater than 10'],
      ['abc', 'pointsMultiplier must be a number'],
    ])('rejects %p', async (pointsMultiplier, fragment) => {
      expectRejected(await validate(CreateQuizDto, withQuestion({ pointsMultiplier })), fragment);
    });
  });

  describe('imageUrl (ex T-016)', () => {
    it.each(['javascript:alert(1)', 'data:image/png;base64,iVBORw0KGgo=', 'ftp://example.com/a.png', '/relative.png', 'not a url'])(
      'rejects %p',
      async (imageUrl) => {
        expectRejected(await validate(CreateQuizDto, withQuestion({ imageUrl })), 'imageUrl must be a URL address');
      },
    );

    it('rejects a URL longer than 2048 characters', async () => {
      const imageUrl = `https://example.com/${'a'.repeat(2048)}`;
      expectRejected(
        await validate(CreateQuizDto, withQuestion({ imageUrl })),
        'imageUrl must be shorter than or equal to 2048 characters',
      );
    });

    it('accepts http and https URLs and an absent imageUrl', async () => {
      const payload = quiz({
        questions: [
          question({ imageUrl: 'http://example.com/a.png' }),
          question({ imageUrl: 'https://cdn.example.org/b.jpg?x=1' }),
          question(),
        ],
      });
      expect(await validate(CreateQuizDto, payload)).toEqual([]);
    });
  });

  describe('questions array (ex T-016)', () => {
    it('rejects an empty questions array', async () => {
      expectRejected(await validate(CreateQuizDto, quiz({ questions: [] })), 'At least one question is required');
    });

    it('rejects 101 questions', async () => {
      const questions = Array.from({ length: 101 }, () => question());
      expectRejected(
        await validate(CreateQuizDto, quiz({ questions })),
        'questions must contain no more than 100 elements',
      );
    });

    it('accepts 100 questions', async () => {
      const questions = Array.from({ length: 100 }, () => question());
      expect(await validate(CreateQuizDto, quiz({ questions }))).toEqual([]);
    });
  });

  describe('unknown fields (T-004 criterion 5)', () => {
    it('rejects an unknown top-level field', async () => {
      expectRejected(await validate(CreateQuizDto, quiz({ authorId: 'someone-else' })), 'property authorId should not exist');
    });

    it('rejects an unknown nested option field', async () => {
      const options = [{ ...option(0, true), points: 9999 }, option(1)];
      expectRejected(await validate(CreateQuizDto, withQuestion({ options })), 'property points should not exist');
    });
  });
});

describe('UpdateQuizDto validation (partial: absent allowed, present validated)', () => {
  it('accepts an empty payload', async () => {
    expect(await validate(UpdateQuizDto, {})).toEqual([]);
  });

  it('accepts a title-only payload', async () => {
    expect(await validate(UpdateQuizDto, { title: 'New title' })).toEqual([]);
  });

  it('accepts a valid questions payload', async () => {
    expect(await validate(UpdateQuizDto, { questions: [question()] })).toEqual([]);
  });

  it.each([
    ['no correct option', { options: [option(0), option(1)] }, 'exactly one correct option'],
    ['duplicate colorIndex', { options: [option(2, true), option(2)] }, 'colorIndex must be unique'],
    ['single option', { options: [option(0, true)] }, 'options must contain at least 2 elements'],
    ['string isCorrect', { options: [{ ...option(0), isCorrect: 'false' }, option(1)] }, 'isCorrect must be a boolean value'],
    ['decimal timeLimit', { timeLimit: 7.5 }, 'timeLimit must be an integer number'],
    ['out-of-range pointsMultiplier', { pointsMultiplier: 50 }, 'pointsMultiplier must not be greater than 10'],
    ['javascript: imageUrl', { imageUrl: 'javascript:alert(1)' }, 'imageUrl must be a URL address'],
  ])('rejects %s', async (_label, overrides, fragment) => {
    expectRejected(await validate(UpdateQuizDto, { questions: [question(overrides)] }), fragment);
  });

  it('rejects an empty questions array when present', async () => {
    expectRejected(await validate(UpdateQuizDto, { questions: [] }), 'At least one question is required');
  });

  it('rejects 101 questions', async () => {
    const questions = Array.from({ length: 101 }, () => question());
    expectRejected(await validate(UpdateQuizDto, { questions }), 'questions must contain no more than 100 elements');
  });

  it('rejects an unknown field', async () => {
    expectRejected(await validate(UpdateQuizDto, { isPublic: true }), 'property isPublic should not exist');
  });
});
