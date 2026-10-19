import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QuizLibrary, gradeQuiz, presentQuestion, toQuizView } from './quizzes';

describe('quiz choice order', () => {
  it('never presents the correct choice first, and grading uses that order', () => {
    const library = new QuizLibrary();
    assert.equal(library.errors.length, 0);
    for (const quiz of library.list()) {
      const view = toQuizView(quiz);
      for (const question of quiz.def.questions) {
        const presented = presentQuestion(question);
        assert.notEqual(presented.answer, 0, question.id);
        assert.equal(presented.choices[presented.answer], question.choices[question.answer]);
        const shown = view.questions.find((q) => q.id === question.id)!;
        assert.deepEqual(shown.choices, presented.choices);
        const graded = gradeQuiz(quiz, { [question.id]: presented.answer }).results.find((r) => r.id === question.id);
        assert.equal(graded?.correct, true);
        assert.equal(graded?.answer, presented.answer);
        const wrong = presented.answer === 1 ? 2 : 1;
        const missed = gradeQuiz(quiz, { [question.id]: wrong }).results.find((r) => r.id === question.id);
        assert.equal(missed?.correct, false);
      }
    }
  });
});
