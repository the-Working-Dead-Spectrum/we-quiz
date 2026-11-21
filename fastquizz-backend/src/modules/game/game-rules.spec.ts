import { calculateScore, isPlayableQuestion, isPlayableQuiz, nicknameKey } from './game-rules';
import { safeEqual } from '../../common/security/safe-equal';

describe('game rules (ADR 0001 section 8)', () => {
  const option = (isCorrect: boolean, colorIndex: number) => ({ isCorrect, colorIndex });

  describe('isPlayableQuestion', () => {
    it('accepts 2 to 4 options with exactly one correct and distinct colors', () => {
      expect(isPlayableQuestion({ options: [option(true, 0), option(false, 1)] })).toBe(true);
      expect(isPlayableQuestion({ options: [option(false, 3), option(true, 2), option(false, 1), option(false, 0)] })).toBe(true);
    });

    it.each([
      ['no correct option', [option(false, 0), option(false, 1)]],
      ['two correct options', [option(true, 0), option(true, 1)]],
      ['a single option', [option(true, 0)]],
      ['five options', [option(true, 0), option(false, 1), option(false, 2), option(false, 3), option(false, 3)]],
      ['duplicate colors', [option(true, 0), option(false, 0)]],
      ['an out-of-range color', [option(true, 0), option(false, 4)]],
    ])('rejects a question with %s', (_label, options) => {
      expect(isPlayableQuestion({ options })).toBe(false);
    });
  });

  it('isPlayableQuiz requires at least one question', () => {
    expect(isPlayableQuiz({ questions: [] })).toBe(false);
    expect(isPlayableQuiz({ questions: [{ options: [option(true, 0), option(false, 1)] }] })).toBe(true);
  });

  it('calculateScore follows the unchanged formula', () => {
    expect(calculateScore(0, 30000, 1, true)).toBe(1000);
    expect(calculateScore(15000, 30000, 1, true)).toBe(750);
    expect(calculateScore(5000, 20000, 1.5, true)).toBe(1313);
    expect(calculateScore(5000, 30000, 1, false)).toBe(0);
    expect(calculateScore(70000, 30000, 1, true)).toBe(0);
    expect(calculateScore(1000, 0, 1, true)).toBe(0);
  });

  it('nicknameKey is case-insensitive', () => {
    expect(nicknameKey('ALICE')).toBe(nicknameKey('alice'));
    expect(nicknameKey('Zoé')).toBe('zoé');
  });

  it('safeEqual compares strings, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
