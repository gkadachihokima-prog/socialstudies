import { SUBJECT_CONFIG } from "../config/subjects.js";
import { pickQuestions, shuffleArray } from "./question-picker.js";
import { filterQuestions } from "./question-filters.js";
import { resetQuizState, resetUiState } from "./state.js";

export async function prepareQuizStart(params) {
  const {
    state,
    filterManager,
    normalizeValue,
    studentName,
    studentId,
    subject,
    unitFilter,
    modeFilter,
    subunitFilter,
    requestedQuestionCount,
    retryWrongEnabled
  } = params;

  if (!studentId || !studentName) {
    return {
      ok: false,
      errorMessage: "候補から生徒を選んでください。"
    };
  }

  if (!subject || !SUBJECT_CONFIG[subject]) {
    return {
      ok: false,
      errorMessage: "科目を選んでください。"
    };
  }

  const normalizedQuestions = await filterManager.getNormalizedQuestionsForSubject(subject);
  const allQuestions = filterQuestions(
    normalizedQuestions,
    {
      unitFilter,
      modeFilter,
      subunitFilter
    },
    normalizeValue
  );

  if (!allQuestions.length) {
    return {
      ok: false,
      errorMessage: "条件に合う問題がありません。"
    };
  }

  state.session.studentName = studentName;
  state.session.studentId = studentId;
  state.session.subject = subject;
  state.session.unitFilter = unitFilter;
  state.session.modeFilter = modeFilter;
  state.session.subunitFilter = subunitFilter;
  state.session.requestedQuestionCount = requestedQuestionCount;
  state.session.retryWrongEnabled = Boolean(retryWrongEnabled);

  resetQuizState(state);
  resetUiState(state);

  state.quiz.allQuestions = allQuestions;
  state.quiz.quizQuestions = pickQuestions(allQuestions, requestedQuestionCount);

  return {
    ok: true
  };
}

/**
 * Phase3C本体: 「続きから」再開時に、getAttemptProgressで取得したprogressと、
 * 既にCSVから読み込み済みの正規化問題一覧から、既存のstate.quiz/state.session構造を
 * 直接組み立てる（prepareQuizStart()と対の関数。CSVの再抽選・再shuffleは一切しない）。
 *
 * fieldId・questionIds/wrongQuestionIds・currentQuestionIndexはprogressの保存値をそのまま
 * 使い、resume時に新しいAttempt/QuestionSetは生成しない（呼び出し元がprogress.attemptIdを
 * そのまま使い回す前提）。score・wrongQuestionsは、既に保存済みのAnswerRecordから
 * 再計算する（新しいカウンタ状態は持たない。既存の非resumeフローと同じ「実際に保存された
 * 解答結果」を正とする考え方）。
 *
 * @param {Object} params
 * @param {import("./state.js").state} params.state
 * @param {Array<Object>} params.questions - fieldIdの正規化済み問題一覧（filterManager.getNormalizedQuestionsForSubjectの結果）
 * @param {Object} params.progress - getAttemptProgressのprogress部分
 * @param {Array<{questionId:string, isCorrect:boolean}>} params.answerRecords - 対象attemptIdの既存AnswerRecord一覧
 * @returns {{ok:true}|{ok:false, errorMessage:string}}
 */
export function prepareResumedQuiz({ state, questions, progress, answerRecords }) {
  const isRetry = Number(progress.retryRound) >= 1;
  const rawTargetIds = isRetry ? progress.wrongQuestionIds : progress.questionIds;
  const targetIds = Array.isArray(rawTargetIds) ? rawTargetIds : [];

  // STEP12: questionIds/wrongQuestionIdsが空・非配列の場合は、0問のquizを有効な
  // resumeとして扱わず、明示的にresumeを拒否する（「この続きはやめる」で処理させる）。
  if (targetIds.length === 0) {
    return {
      ok: false,
      errorMessage: "前回の続きのデータが不正です。「この続きはやめる」を選んでください。"
    };
  }

  const questionById = new Map((Array.isArray(questions) ? questions : []).map((q) => [q.questionId, q]));
  const resolvedQuestions = [];
  const missingIds = [];

  targetIds.forEach((id) => {
    const question = questionById.get(id);
    if (question) {
      resolvedQuestions.push(question);
    } else {
      missingIds.push(id);
    }
  });

  if (missingIds.length > 0) {
    return {
      ok: false,
      errorMessage: "前回の続きの問題データが見つかりませんでした。「この続きはやめる」を選んでください。"
    };
  }

  const currentQuestionIndex = Number(progress.currentQuestionIndex);
  if (!Number.isInteger(currentQuestionIndex) || currentQuestionIndex < 0 || currentQuestionIndex > resolvedQuestions.length) {
    return {
      ok: false,
      errorMessage: "前回の続きのデータが不正です。「この続きはやめる」を選んでください。"
    };
  }

  const answerRecordByQuestionId = new Map(
    (Array.isArray(answerRecords) ? answerRecords : []).map((record) => [record.questionId, record])
  );

  const answeredSoFar = resolvedQuestions.slice(0, currentQuestionIndex);
  const correctCount = answeredSoFar.filter(
    (q) => answerRecordByQuestionId.get(q.questionId)?.isCorrect === true
  ).length;
  const wrongQuestions = isRetry
    ? []
    : answeredSoFar.filter((q) => answerRecordByQuestionId.get(q.questionId)?.isCorrect === false);

  resetQuizState(state);
  resetUiState(state);

  state.session.subject = progress.fieldId;
  state.session.unitFilter = progress.unit || "all";
  state.session.modeFilter = "all";
  state.session.subunitFilter = "all";
  state.session.retryWrongEnabled = Boolean(progress.retryWrongEnabled);

  state.quiz.allQuestions = questions;
  state.quiz.quizQuestions = resolvedQuestions;
  state.quiz.currentIndex = currentQuestionIndex;
  state.quiz.retryMode = isRetry;
  state.quiz.wrongQuestions = wrongQuestions;
  state.quiz.score = correctCount;

  if (isRetry) {
    const normalRoundIds = Array.isArray(progress.questionIds) ? progress.questionIds : [];
    state.quiz.firstRoundTotal = normalRoundIds.length;
    state.quiz.firstRoundScore = normalRoundIds.filter(
      (id) => answerRecordByQuestionId.get(id)?.isCorrect === true
    ).length;
  }

  return { ok: true };
}

export function startRetryWrongRound(state) {
  state.quiz.firstRoundScore = state.quiz.score;
  state.quiz.firstRoundTotal = state.quiz.quizQuestions.length;
  state.quiz.quizQuestions = shuffleArray([...state.quiz.wrongQuestions]);
  state.quiz.currentIndex = 0;
  state.quiz.score = 0;
  state.quiz.currentQuestion = null;
  state.quiz.retryMode = true;

  resetUiState(state);
}