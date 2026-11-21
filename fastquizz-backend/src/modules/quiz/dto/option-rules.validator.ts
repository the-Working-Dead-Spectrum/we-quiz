import { registerDecorator, ValidationOptions } from 'class-validator';

// Cross-field rules on a question's `options` array (ADR 0001 section 8, "playable quiz").
// They live on the array because a single option cannot know about its siblings.
// Non-array values are rejected here too, but @IsArray reports the clearer message.

type OptionLike = { isCorrect?: unknown; colorIndex?: unknown } | null | undefined;

export function HasExactlyOneCorrectOption(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'hasExactlyOneCorrectOption',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (!Array.isArray(value)) return false;
          return value.filter((option: OptionLike) => option?.isCorrect === true).length === 1;
        },
        defaultMessage(): string {
          return '$property: each question must have exactly one correct option (isCorrect: true)';
        },
      },
    });
  };
}

export function HasUniqueColorIndexes(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'hasUniqueColorIndexes',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (!Array.isArray(value)) return false;
          const colorIndexes = value.map((option: OptionLike) => option?.colorIndex);
          return new Set(colorIndexes).size === colorIndexes.length;
        },
        defaultMessage(): string {
          return '$property: colorIndex must be unique within a question';
        },
      },
    });
  };
}
