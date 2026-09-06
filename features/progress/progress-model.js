// features/progress/progress-model.js
//
// Phase3B-2: attempt_progress（docs/specification/domain-model-v1.md 3.12.2節、
// Phase3B-1でGAS側確定済み）のpayload組み立てに必要な、Attempt単位の一時的な
// 文脈（questionIds snapshot・unit・sourceType・testSetId・wrongQuestionIds・retryRound・
// retryWrongEnabled[Phase3C前提で追加]）を保持する。GAS通信・直列queueは一切持たない（それはfeatures/history/
// learning-record-sync-integration.jsの責務。既存のattemptId単位直列queueと
// 同じ場所に置くことで、AnswerRecord/completeAttemptとの送信順序保証を構造的に壊さない
// ため、意図的にGAS通信をこのファイルへ持ち込まない）。
//
// 1画面につき同時に1つのAttemptしか進行しない現状のUI制約と同じ前提で、
// attemptId -> context のMapとして保持する（既存のstartAttemptPromises/
// attemptTaskQueuesと同じ設計方針）。

const contexts = new Map();

/**
 * 出題済み問題配列から、順序を保持したままquestionIdの配列を抽出する。
 * sort・重複除去はしない（既存のQuestionSet生成ロジックと同じ抽出方法、
 * features/history/quiz-start-integration.js のquestionIds抽出と同一の考え方）。
 *
 * @param {Array<Object>} questions
 * @returns {string[]}
 */
export function extractQuestionIds(questions) {
  return (Array.isArray(questions) ? questions : [])
    .map((question) => question?.questionId ?? question?.id)
    .filter(Boolean);
}

/**
 * progress.unitへ送る値を決める。
 * 通常学習（sourceType==="normal"）のみ、実際にstart画面で選択された単元フィルタを
 * 意味のある値として送る。weak_review/dormant_review/testsetは、単元セレクタを
 * 経由せずunitFilterが技術的に"all"固定されるだけであり、生徒が単元を選んだ
 * わけではないため、GAS契約で許容されている空文字を送る
 * （docs/operations/learning-record-gas/README.md 3節のunit仕様どおり）。
 *
 * @param {string|null} sourceType
 * @param {string} unitFilter
 * @returns {string}
 */
export function resolveUnitForSourceType(sourceType, unitFilter) {
  return sourceType === "normal" ? String(unitFilter || "") : "";
}

/**
 * Attempt開始時に、そのAttempt専用のprogress文脈を新規作成する。
 *
 * @param {Object} params
 * @param {import("../history/attempt-model.js").Attempt} params.attempt
 * @param {string} params.fieldId
 * @param {string} params.unit
 * @param {string[]} params.questionIds - 開始時点の出題順snapshot（以後retryでも変更しない）
 * @param {boolean} params.retryWrongEnabled - 開始時点でのretry可否設定のsnapshot
 *   （Phase3C前提。中断→再開時に正確に復元するため、retryRoundやsourceTypeからの
 *   再計算はしない。呼び出し元がその時点の実際の設定値をそのまま渡す）
 */
export function initAttemptProgressContext({ attempt, fieldId, unit, questionIds, retryWrongEnabled }) {
  if (!attempt?.attemptId) return;

  contexts.set(attempt.attemptId, {
    studentId: attempt.studentId,
    fieldId,
    unit,
    sourceType: attempt.sourceType,
    testSetId: attempt.testSetId,
    questionIds: [...questionIds],
    wrongQuestionIds: [],
    retryRound: 0,
    retryWrongEnabled: Boolean(retryWrongEnabled),
    startedAt: attempt.startedAt
  });
}

/**
 * ページリロード等でcontextsが失われた状態から、getAttemptProgressで取得済みの
 * progressレスポンスをそのまま文脈へ復元する（Phase3C本体）。
 * initAttemptProgressContext()と異なり、retryRound/wrongQuestionIdsを0/[]へ初期化せず、
 * GAS側に保存されていた値をそのまま復元する（中断前の状態を正確に再現するため）。
 *
 * @param {Object} progress - getAttemptProgressのレスポンスのprogress部分（null不可）
 */
export function restoreAttemptProgressContext(progress) {
  if (!progress?.attemptId) return;

  contexts.set(progress.attemptId, {
    studentId: progress.studentId,
    fieldId: progress.fieldId,
    unit: progress.unit,
    sourceType: progress.sourceType,
    testSetId: progress.testSetId,
    questionIds: [...(progress.questionIds || [])],
    wrongQuestionIds: [...(progress.wrongQuestionIds || [])],
    retryRound: progress.retryRound,
    retryWrongEnabled: Boolean(progress.retryWrongEnabled),
    startedAt: progress.startedAt
  });
}

/**
 * retry開始時に、実際にretryで出題される順序（シャッフル後）をwrongQuestionIdsとして
 * 記録し、retryRoundを1へ進める。通常ラウンドのquestionIds（context.questionIds）は
 * 一切書き換えない。
 *
 * @param {string} attemptId
 * @param {string[]} wrongQuestionIds - retryで実際に出題される順序（呼び出し側で確定済み）
 */
export function recordRetryStart(attemptId, wrongQuestionIds) {
  const context = contexts.get(attemptId);
  if (!context) return;

  context.wrongQuestionIds = [...wrongQuestionIds];
  context.retryRound = 1;
}

/**
 * Attemptのライフサイクル終了時（completeAttempt送信後）に文脈を破棄する。
 * GAS側のattempt_progress行自体は削除しない（Phase3B-1確定仕様）。
 * あくまでこのMapのサイズを、同時進行中のAttempt数程度に抑えるためのクライアント側の
 * 後片付けに過ぎない。
 *
 * @param {string} attemptId
 */
export function clearAttemptProgressContext(attemptId) {
  contexts.delete(attemptId);
}

/**
 * 現在の文脈から、saveAttemptProgressへ送るpayloadを組み立てる。
 * questionIds/wrongQuestionIdsは配列のまま返す（JSON文字列化はGAS送信直前、
 * features/history/learning-record-sync-integration.js側の責務とする）。
 *
 * @param {string} attemptId
 * @param {number} currentQuestionIndex - 「次に表示すべき問題のindex」（0-based）
 * @returns {Object|null} 文脈が存在しない場合はnull（追跡対象外＝送信しない）
 */
export function buildAttemptProgressPayload(attemptId, currentQuestionIndex) {
  const context = contexts.get(attemptId);
  if (!context) return null;

  return {
    attemptId,
    studentId: context.studentId,
    fieldId: context.fieldId,
    unit: context.unit,
    sourceType: context.sourceType,
    testSetId: context.testSetId,
    questionIds: context.questionIds,
    currentQuestionIndex,
    wrongQuestionIds: context.wrongQuestionIds,
    retryRound: context.retryRound,
    retryWrongEnabled: context.retryWrongEnabled,
    status: "in_progress",
    startedAt: context.startedAt
  };
}
