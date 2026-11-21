import { Injectable, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import * as XLSX from 'xlsx';
import { CreateQuizDto, CreateQuestionDto, CreateOptionDto, QUIZ_LIMITS } from './dto/create-quiz.dto';
import { ImportPreviewDto } from './dto/import-preview.dto';

// Row-level error surfaced to the UI so each cell problem points back to its spreadsheet row.
export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportPreviewResult {
  dto: CreateQuizDto | null;
  errors: ImportRowError[];
  questionCount: number;
}

// Header names expected on the template's first row. The parser matches by name (case-insensitive,
// trimmed), so the column order in the file does not matter.
const REQUIRED_HEADERS = [
  'question_text',
  'time_limit',
  'points_multiplier',
  'option_1_text',
  'option_1_correct',
  'option_2_text',
  'option_2_correct',
] as const;

const OPTIONAL_HEADERS = [
  'image_url',
  'option_3_text',
  'option_3_correct',
  'option_4_text',
  'option_4_correct',
] as const;

type HeaderName = (typeof REQUIRED_HEADERS)[number] | (typeof OPTIONAL_HEADERS)[number];

// Column index 0..3 -> Prisma Option.colorIndex (ADR 0001 section 8).
// We derive it from the position so the template stays simple and the uniqueness invariant holds.
const COLOR_INDEX_BY_POSITION = [0, 1, 2, 3] as const;

@Injectable()
export class QuizImportService {
  /**
   * Parse the uploaded .xlsx, map every row to a CreateQuestionDto and validate the resulting quiz.
   * Writes nothing to the database. Returns the dto AND the list of errors so the UI can show both
   * a partial preview and a per-row error report at once.
   */
  async preview(file: Express.Multer.File, meta: ImportPreviewDto): Promise<ImportPreviewResult> {
    if (!file) {
      throw new BadRequestException('Fichier manquant');
    }

    const workbook = this.readWorkbook(file);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new BadRequestException("Le fichier ne contient aucune feuille");
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: true,
    });

    const headerErrors = this.checkHeaders(sheet);
    if (headerErrors.length > 0) {
      return { dto: null, errors: headerErrors, questionCount: 0 };
    }

    if (rows.length === 0) {
      return {
        dto: null,
        errors: [{ row: 2, message: 'Le fichier ne contient aucune question' }],
        questionCount: 0,
      };
    }

    if (rows.length > QUIZ_LIMITS.MAX_QUESTIONS) {
      return {
        dto: null,
        errors: [
          {
            row: QUIZ_LIMITS.MAX_QUESTIONS + 2,
            message: `Un quiz est limité à ${QUIZ_LIMITS.MAX_QUESTIONS} questions (${rows.length} détectées)`,
          },
        ],
        questionCount: rows.length,
      };
    }

    const errors: ImportRowError[] = [];
    const questions: CreateQuestionDto[] = [];

    rows.forEach((raw, index) => {
      // Row numbering follows the spreadsheet (row 1 is the header, data starts at row 2).
      const rowNumber = index + 2;
      const parsed = this.parseRow(raw, rowNumber, errors);
      if (parsed) questions.push(parsed);
    });

    const dtoCandidate = plainToInstance(CreateQuizDto, {
      title: meta.title,
      description: meta.description,
      questions,
    });

    const classErrors = await validate(dtoCandidate, { whitelist: true });
    classErrors.forEach((err) => this.flattenValidationError(err, errors, [err.property]));

    const sortedErrors = errors
      .slice()
      .sort((a, b) => a.row - b.row || (a.field || '').localeCompare(b.field || ''));

    return {
      dto: sortedErrors.length === 0 ? dtoCandidate : null,
      errors: sortedErrors,
      questionCount: questions.length,
    };
  }

  private readWorkbook(file: Express.Multer.File): XLSX.WorkBook {
    try {
      // dense:false is the default; cellDates:false keeps numbers as numbers (time_limit).
      return XLSX.read(file.buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException("Le fichier Excel n'a pas pu être lu (format invalide)");
    }
  }

  private checkHeaders(sheet: XLSX.WorkSheet): ImportRowError[] {
    const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0, defval: '' })[0] || [];
    const normalized = headerRow.map((h) => String(h || '').trim().toLowerCase());
    const missing = REQUIRED_HEADERS.filter((h) => !normalized.includes(h));
    if (missing.length === 0) return [];
    return [
      {
        row: 1,
        message: `En-têtes manquants : ${missing.join(', ')}`,
      },
    ];
  }

  private parseRow(
    raw: Record<string, unknown>,
    rowNumber: number,
    errors: ImportRowError[],
  ): CreateQuestionDto | null {
    const get = (key: HeaderName): unknown => {
      // Re-lookup by normalized header name so trailing spaces or case differences do not break the map.
      const found = Object.keys(raw).find((k) => k.trim().toLowerCase() === key);
      return found ? raw[found] : '';
    };

    const text = this.asString(get('question_text'));
    const imageUrl = this.asString(get('image_url'));
    const timeLimit = this.asNumber(get('time_limit'));
    const pointsMultiplier = this.asNumber(get('points_multiplier'));

    if (!text) {
      errors.push({ row: rowNumber, field: 'question_text', message: "L'énoncé de la question est obligatoire" });
    }
    if (timeLimit === null) {
      errors.push({ row: rowNumber, field: 'time_limit', message: 'time_limit doit être un entier entre 5 et 120' });
    }
    if (pointsMultiplier === null) {
      errors.push({
        row: rowNumber,
        field: 'points_multiplier',
        message: 'points_multiplier doit être un nombre entre 0.1 et 10',
      });
    }

    const options: CreateOptionDto[] = [];
    for (let i = 1; i <= 4; i++) {
      const optText = this.asString(get(`option_${i}_text` as HeaderName));
      const optCorrectRaw = get(`option_${i}_correct` as HeaderName);
      if (!optText) continue; // empty option column is ignored (2..4 options supported by DTO)
      const isCorrect = this.asBoolean(optCorrectRaw);
      if (isCorrect === null) {
        errors.push({
          row: rowNumber,
          field: `option_${i}_correct`,
          message: `option_${i}_correct doit valoir true ou false`,
        });
      }
      options.push({
        text: optText,
        isCorrect: isCorrect === true,
        colorIndex: COLOR_INDEX_BY_POSITION[i - 1],
      });
    }

    if (!text || timeLimit === null || pointsMultiplier === null) {
      return null;
    }

    return {
      text,
      imageUrl: imageUrl || undefined,
      timeLimit,
      pointsMultiplier,
      options,
    };
  }

  private asString(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const s = value.trim();
      if (s === '') return null;
      const n = Number(s.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // Accepts true/false, 1/0, "true"/"false", "vrai"/"faux", "oui"/"non" (case-insensitive).
  // Returns null for anything else so the row reports a clear error.
  private asBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
      return null;
    }
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'vrai', 'oui', 'x'].includes(s)) return true;
      if (['false', '0', 'no', 'faux', 'non', ''].includes(s)) return false;
    }
    return null;
  }

  // class-validator errors can nest (questions[0].options[1].text -> 3 levels). We flatten them into
  // row-anchored messages so the UI always knows which spreadsheet row to point at.
  private flattenValidationError(
    err: { property: string; constraints?: Record<string, string>; children?: unknown[] },
    bucket: ImportRowError[],
    pathParts: string[],
  ): void {
    if (err.constraints) {
      const row = this.rowFromPath(pathParts);
      const field = pathParts.join('.');
      Object.values(err.constraints).forEach((message) => bucket.push({ row, field, message }));
    }
    (err.children || []).forEach((child: any) => {
      this.flattenValidationError(child, bucket, [...pathParts, child.property]);
    });
  }

  private rowFromPath(pathParts: string[]): number {
    // paths look like ["questions","3","options","1","text"] -> questions index 3 -> row 5
    const idx = pathParts.findIndex((p) => p === 'questions');
    if (idx === -1 || !pathParts[idx + 1]) return 1;
    const questionIndex = Number(pathParts[idx + 1]);
    if (!Number.isFinite(questionIndex)) return 1;
    return questionIndex + 2;
  }
}
