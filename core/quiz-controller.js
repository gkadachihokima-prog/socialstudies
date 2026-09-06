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

/**
 * Phase3D-1本体: 学習履歴の完了済みAttemptに属するAnswerRecordから、対象のfieldIdを
 * 一意に確定する。非TestSet Attempt（normal/weak_review/dormant_review）は既存の
 * QuestionSet単一fieldId制約（Task55）により常に単一fieldIdのはずであり、複数が
 * 検出された場合は不正データとして開始を拒否する（別問題への補完・多数決等はしない）。
 *
 * app.js側がCSV読込（filterManager.getNormalizedQuestionsForSubject）に必要な
 * fieldIdを、prepareFixedQuestionSession()より前に単独で確定するために使う
 * （prepareFixedQuestionSession()内部でも同じ関数を呼び、判定基準を1箇所に保つ）。
 *
 * @param {Array<{fieldId:string}>} answerRecords
 * @returns {{ok:true, fieldId:string}|{ok:false, errorMessage:string}}
 */
export function resolveFixedSessionFieldId(answerRecords) {
  const records = Array.isArray(answerRecords) ? answerRecords : [];
  const fieldIds = new Set(
    records.map((record) => String(record?.fieldId || "").trim()).filter(Boolean)
  );

  if (fieldIds.size !== 1) {
    return {
      ok: false,
      errorMessage: "この学習は現在やり直せません。"
    };
  }

  return { ok: true, fieldId: [...fieldIds][0] };
}

/**
 * Phase3D-1本体: 「もう一度やる」用。学習履歴の完了済みAttemptに属するAnswerRecordから、
 * 実際に出題されたquestionIdsをanswered At昇順で復元し、既存のstate.quiz/state.session
 * 構造を直接組み立てる（prepareQuizStart()・prepareResumedQuiz()と並ぶ第3の準備関数）。
 *
 * 「続きから」（prepareResumedQuiz）とは異なり、これは新しい学習の開始である：
 *   - currentQuestionIndex=0固定（保存済み位置からの再開ではない）
 *   - retryRound=0固定、score等の再計算はしない（新規セッションなのでゼロから）
 *   - 呼び出し元がこの後、新しいattemptIdでstartAttemptForQuiz()を呼ぶ前提
 *
 * CSVの再抽選・再shuffleは一切しない。DOM操作・GAS通信・Attempt生成・confirmは
 * 一切行わない（呼び出し元=app.jsの責務）。
 *
 * @param {Object} params
 * @param {import("./state.js").state} params.state
 * @param {Array<Object>} params.questions - fieldIdの正規化済み問題一覧（filterManager.getNormalizedQuestionsForSubjectの結果）
 * @param {Array<{questionId:string, fieldId:string, unit:string, answeredAt:string|null}>} params.answerRecords - 対象Attemptの全AnswerRecord
 * @returns {{ok:true, fieldId:string, unit:string}|{ok:false, errorMessage:string}}
 */
export function prepareFixedQuestionSession({ state, questions, answerRecords }) {
  const records = Array.isArray(answerRecords) ? answerRecords : [];

  if (records.length === 0) {
    return { ok: false, errorMessage: "この学習にはやり直せる問題がありません。" };
  }

  // answeredAtが1件でも欠落・不正な場合、出題順を正確に決定できないため開始を拒否する
  // （現在時刻等での補完・Spreadsheet行順の推測は行わない）。
  const hasInvalidTimestamp = records.some((record) => {
    const value = record?.answeredAt;
    if (!value) return true;
    return Number.isNaN(new Date(value).getTime());
  });
  if (hasInvalidTimestamp) {
    return { ok: false, errorMessage: "この学習は現在やり直せません。" };
  }

  const fieldResult = resolveFixedSessionFieldId(records);
  if (!fieldResult.ok) {
    return fieldResult;
  }

  const sortedRecords = [...records].sort((a, b) => {
    if (a.answeredAt < b.answeredAt) return -1;
    if (a.answeredAt > b.answeredAt) return 1;
    return 0;
  });

  // 重複questionId（現行upsert仕様では通常発生しないが、pure関数として安全側に倒す）は
  // 最初に現れた順序を維持したまま1件へ畳み込む。後から現れた同一questionIdで
  // 順序を書き換えない。
  const seenIds = new Set();
  const orderedQuestionIds = [];
  sortedRecords.forEach((record) => {
    const id = String(record?.questionId || "").trim();
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    orderedQuestionIds.push(id);
  });

  if (orderedQuestionIds.length === 0) {
    return { ok: false, errorMessage: "この学習にはやり直せる問題がありません。" };
  }

  // unitFilter="all"で出題された場合、AnswerRecord間でunitが混在するのは既存の正式経路
  // （unitFilterが特定単元ならAnswerRecordのunitは常に単一になる）。単一ならその値、
  // 複数なら"all"とすることで、新しい「混在」状態を作らず既存のunitFilter="all"と
  // 同じ意味へ正しく還元する（推測での固定値変換はしない）。
  const units = new Set(
    sortedRecords.map((record) => String(record?.unit || "").trim()).filter(Boolean)
  );
  const unit = units.size === 1 ? [...units][0] : "all";

  const questionById = new Map(
    (Array.isArray(questions) ? questions : []).map((question) => [question.questionId, question])
  );
  const resolvedQuestions = [];
  const missingIds = [];

  orderedQuestionIds.forEach((id) => {
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
      errorMessage: "この学習の一部の問題が見つからないため、やり直せません。"
    };
  }

  resetQuizState(state);
  resetUiState(state);

  state.session.subject = fieldResult.fieldId;
  state.session.unitFilter = unit;
  state.session.modeFilter = "all";
  state.session.subunitFilter = "all";

  state.quiz.allQuestions = questions;
  state.quiz.quizQuestions = resolvedQuestions;
  state.quiz.currentIndex = 0;
  state.quiz.retryMode = false;
  state.quiz.wrongQuestions = [];
  state.quiz.score = 0;

  return { ok: true, fieldId: fieldResult.fieldId, unit };
}