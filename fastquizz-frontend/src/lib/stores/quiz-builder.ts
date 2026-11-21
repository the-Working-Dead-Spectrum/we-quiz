// Quiz builder store for admin quiz creation

import { writable, derived, get } from 'svelte/store';
import type { CreateQuizDto, CreateQuestionDto, CreateOptionDto, ColorIndex } from '$lib/types';

// Internal types with isDirty flag for tracking changes
interface QuestionDraft extends CreateQuestionDto {
  isDirty?: boolean;
  options: OptionDraft[];
}

interface OptionDraft extends CreateOptionDto {
  isDirty?: boolean;
}

interface QuizBuilderState {
  title: string;
  description: string;
  questions: QuestionDraft[];
  activeQuestionIndex: number;
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
}

const createInitialQuestion = (): QuestionDraft => ({
  text: '',
  imageUrl: '',
  timeLimit: 20,
  pointsMultiplier: 1.0,
  options: [
    { text: '', isCorrect: false, colorIndex: 0 },
    { text: '', isCorrect: false, colorIndex: 1 },
    { text: '', isCorrect: false, colorIndex: 2 },
    { text: '', isCorrect: false, colorIndex: 3 },
  ],
});

function createQuizBuilderStore() {
  const initialState: QuizBuilderState = {
    title: '',
    description: '',
    questions: [createInitialQuestion()],
    activeQuestionIndex: 0,
    isDirty: false,
    isSaving: false,
    error: null,
  };

  const { subscribe, set, update } = writable<QuizBuilderState>(initialState);

  // Load from localStorage on init
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('quiz_builder_draft');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        set({ ...initialState, ...parsed, isDirty: false });
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Auto-save to localStorage
  let saveTimer: ReturnType<typeof setTimeout>;
  const autoSave = (state: QuizBuilderState) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (typeof window !== 'undefined' && state.isDirty) {
        localStorage.setItem('quiz_builder_draft', JSON.stringify(state));
      }
    }, 1000);
  };

  return {
    subscribe,

    // Title & Description
    setTitle: (title: string) => update((state) => {
      const newState = { ...state, title, isDirty: true };
      autoSave(newState);
      return newState;
    }),

    setDescription: (description: string) => update((state) => {
      const newState = { ...state, description, isDirty: true };
      autoSave(newState);
      return newState;
    }),

    // Question management
    addQuestion: () => update((state) => {
      const newQuestion = createInitialQuestion();
      const newState = {
        ...state,
        questions: [...state.questions, newQuestion],
        activeQuestionIndex: state.questions.length,
        isDirty: true,
      };
      autoSave(newState);
      return newState;
    }),

    removeQuestion: (index: number) => update((state) => {
      if (state.questions.length <= 1) return state;
      const newQuestions = state.questions.filter((_, i) => i !== index);
      const newIndex = Math.min(index, newQuestions.length - 1);
      const newState = {
        ...state,
        questions: newQuestions,
        activeQuestionIndex: newIndex,
        isDirty: true,
      };
      autoSave(newState);
      return newState;
    }),

    duplicateQuestion: (index: number) => update((state) => {
      const question = state.questions[index];
      const newQuestions = [
        ...state.questions.slice(0, index + 1),
        { ...question, options: question.options.map(o => ({ ...o })) },
        ...state.questions.slice(index + 1),
      ];
      const newState = {
        ...state,
        questions: newQuestions,
        activeQuestionIndex: index + 1,
        isDirty: true,
      };
      autoSave(newState);
      return newState;
    }),

    reorderQuestions: (fromIndex: number, toIndex: number) => update((state) => {
      const newQuestions = [...state.questions];
      const [removed] = newQuestions.splice(fromIndex, 1);
      newQuestions.splice(toIndex, 0, removed);
      const newState = {
        ...state,
        questions: newQuestions,
        activeQuestionIndex: toIndex,
        isDirty: true,
      };
      autoSave(newState);
      return newState;
    }),

    setActiveQuestion: (index: number) => update((state) => ({
      ...state,
      activeQuestionIndex: index,
    })),

    // Question fields
    updateQuestionText: (index: number, text: string) => update((state) => {
      const newQuestions = [...state.questions];
      newQuestions[index] = { ...newQuestions[index], text, isDirty: true };
      const newState = { ...state, questions: newQuestions, isDirty: true };
      autoSave(newState);
      return newState;
    }),

    updateQuestionImage: (index: number, imageUrl: string) => update((state) => {
      const newQuestions = [...state.questions];
      newQuestions[index] = { ...newQuestions[index], imageUrl, isDirty: true };
      const newState = { ...state, questions: newQuestions, isDirty: true };
      autoSave(newState);
      return newState;
    }),

    updateQuestionTimeLimit: (index: number, timeLimit: number) => update((state) => {
      const newQuestions = [...state.questions];
      newQuestions[index] = { ...newQuestions[index], timeLimit, isDirty: true };
      const newState = { ...state, questions: newQuestions, isDirty: true };
      autoSave(newState);
      return newState;
    }),

    updateQuestionPointsMultiplier: (index: number, pointsMultiplier: number) => update((state) => {
      const newQuestions = [...state.questions];
      newQuestions[index] = { ...newQuestions[index], pointsMultiplier, isDirty: true };
      const newState = { ...state, questions: newQuestions, isDirty: true };
      autoSave(newState);
      return newState;
    }),

    // Option management
    updateOptionText: (questionIndex: number, optionIndex: number, text: string) => update((state) => {
      const newQuestions = [...state.questions];
      const newOptions = [...newQuestions[questionIndex].options];
      newOptions[optionIndex] = { ...newOptions[optionIndex], text, isDirty: true };
      newQuestions[questionIndex] = { ...newQuestions[questionIndex], options: newOptions };
      const newState = { ...state, questions: newQuestions, isDirty: true };
      autoSave(newState);
      return newState;
    }),

    setCorrectOption: (questionIndex: number, optionIndex: number) => update((state) => {
      const newQuestions = [...state.questions];
      const newOptions = newQuestions[questionIndex].options.map((o, i) => ({
        ...o,
        isCorrect: i === optionIndex,
      }));
      newQuestions[questionIndex] = { ...newQuestions[questionIndex], options: newOptions };
      const newState = { ...state, questions: newQuestions, isDirty: true };
      autoSave(newState);
      return newState;
    }),

    // Validation & submission
    validate: () => {
      const state = get(quizBuilderStore);
      const errors: string[] = [];

      if (!state.title.trim()) {
        errors.push('Le titre du quiz est requis');
      }

      if (state.questions.length === 0) {
        errors.push('Au moins une question est requise');
      }

      state.questions.forEach((q, i) => {
        if (!q.text.trim()) {
          errors.push(`Question ${i + 1}: Le texte est requis`);
        }
        const correctCount = q.options.filter(o => o.isCorrect).length;
        if (correctCount !== 1) {
          errors.push(`Question ${i + 1}: Exactement une réponse correcte est requise`);
        }
        q.options.forEach((o, j) => {
          if (!o.text.trim()) {
            errors.push(`Question ${i + 1}, Option ${j + 1}: Le texte est requis`);
          }
        });
        if (q.timeLimit < 5 || q.timeLimit > 120) {
          errors.push(`Question ${i + 1}: Le temps doit être entre 5 et 120 secondes`);
        }
      });

      return errors;
    },

    getPayload: (): CreateQuizDto => {
      const state = get(quizBuilderStore);
      return {
        title: state.title.trim(),
        description: state.description.trim() || undefined,
        questions: state.questions.map(q => ({
          text: q.text.trim(),
          imageUrl: q.imageUrl?.trim() || undefined,
          timeLimit: q.timeLimit,
          pointsMultiplier: q.pointsMultiplier,
          options: q.options.map(o => ({
            text: o.text.trim(),
            isCorrect: o.isCorrect,
            colorIndex: o.colorIndex,
          })),
        })),
      };
    },

    setSaving: (isSaving: boolean) => update((state) => ({ ...state, isSaving })),
    setError: (error: string | null) => update((state) => ({ ...state, error })),

    // Reset & load
    reset: () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('quiz_builder_draft');
      }
      set(initialState);
    },

    loadQuiz: (quiz: any) => {
      const questions: QuestionDraft[] = quiz.questions.map((q: any) => ({
        text: q.text,
        imageUrl: q.imageUrl || '',
        timeLimit: q.timeLimit,
        pointsMultiplier: q.pointsMultiplier,
        options: q.options.map((o: any) => ({
          text: o.text,
          isCorrect: o.isCorrect,
          colorIndex: o.colorIndex,
        })),
      }));

      const newState = {
        ...initialState,
        title: quiz.title,
        description: quiz.description || '',
        questions: questions.length > 0 ? questions : [createInitialQuestion()],
        isDirty: false,
      };
      set(newState);
    },

    clearDraft: () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('quiz_builder_draft');
      }
      update((state) => ({ ...state, isDirty: false }));
    },
  };
}

export const quizBuilderStore = createQuizBuilderStore();

// Derived stores
export const activeQuestion = derived(
  quizBuilderStore,
  ($store) => $store.questions[$store.activeQuestionIndex]
);

export const questionCount = derived(
  quizBuilderStore,
  ($store) => $store.questions.length
);

export const canAddQuestion = derived(
  quizBuilderStore,
  ($store) => $store.questions.length < 20
);

export const hasUnsavedChanges = derived(
  quizBuilderStore,
  ($store) => $store.isDirty
);

export const validationErrors = derived(
  quizBuilderStore,
  ($store) => {
    const errors: string[] = [];
    if (!$store.title.trim()) errors.push('Titre requis');
    $store.questions.forEach((q, i) => {
      if (!q.text.trim()) errors.push(`Q${i+1}: texte requis`);
      const correct = q.options.filter(o => o.isCorrect).length;
      if (correct !== 1) errors.push(`Q${i+1}: 1 bonne réponse requise`);
    });
    return errors;
  }
);

export const isValid = derived(
  validationErrors,
  ($errors) => $errors.length === 0
);