// features/history/history-detail-model.js
//
// Phase3D-3: 学習履歴「詳細」画面用のview modelを組み立てる純粋関数群。
// DOM操作・GAS通信・CSV読込は一切行わない（features/history/history-detail-service.jsが
// 問題解決までを済ませたquestionsById(Map)を受け取るだけ）。
//
// 過去/現在データの責務分離（このファイル内で徹底する、追加監査F参照）:
//   - 過去の最終回答   -> AnswerRecord.selectedChoice
//   - 過去の正解記録   -> AnswerRecord.correctAnswer
//   - 過去の最終正誤   -> AnswerRecord.isCorrect
//   - 初回誤答の事実   -> Attempt.initialWrongQuestionIds
//   - 現在の問題文/画像/解説 -> questionsById（現在の問題マスタ、questionIdで解決）
//
// sort modeの既知の非対称な保存形式（実コード監査で判明、変更しない・追認するのみ）:
//   selectedChoiceはconfig側でjoinされず、配列がtoTrimmedString()を経由する際の
//   デフォルトのArray.prototype.toString()によりカンマ区切り文字列として保存される
//   （例: "飛鳥,奈良,平安"）。correctAnswerはjudges/answer-judge.jsのgetCorrectAnswer()が
//   " | "区切りで生成する（例: "飛鳥 | 奈良 | 平安"）。この非対称性は既存の保存仕様であり
//   本ファイルでは変更せず、表示時にのみ両者を同じ矢印区切りの人間向け表示へ変換する。

import { isUnknownAnswer, formatSelectedChoiceForDisplay } from "../../config/unknown-answer.js";

function splitCommaList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitPipeList(raw) {
  return String(raw ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * AnswerRecord.selectedChoiceを生徒向けの表示文字列へ変換する。
 * 「わからない」はformatSelectedChoiceForDisplay()で表示ラベルへ変換する
 * （AnswerRecordには内部センチネル"__UNKNOWN__"のまま保存されているため、
 * sort modeのカンマ分割より必ず先に判定する）。
 *
 * @param {string} selectedChoice - AnswerRecord.selectedChoice
 * @param {Object|null} question - 現在の問題マスタ（mode判定にのみ使用。無くても安全に動作する）
 * @returns {string|null} 表示可能な文字列、または回答記録が無い場合はnull
 */
export function formatFinalAnswerForDisplay(selectedChoice, question) {
  if (isUnknownAnswer(selectedChoice)) return formatSelectedChoiceForDisplay(selectedChoice);

  const trimmed = String(selectedChoice ?? "").trim();
  if (!trimmed) return null;

  if (question?.mode === "sort") {
    const items = splitCommaList(trimmed);
    return items.length > 0 ? items.join(" → ") : trimmed;
  }

  return trimmed;
}

/**
 * AnswerRecord.correctAnswerを生徒向けの表示文字列へ変換する。
 *
 * @param {string} correctAnswer - AnswerRecord.correctAnswer
 * @param {Object|null} question
 * @returns {string|null}
 */
export function formatCorrectAnswerForDisplay(correctAnswer, question) {
  const trimmed = String(correctAnswer ?? "").trim();
  if (!trimmed) return null;

  if (question?.mode === "sort") {
    const items = splitPipeList(trimmed);
    return items.length > 0 ? items.join(" → ") : trimmed;
  }

  return trimmed;
}

/**
 * 履歴一覧の1件に「詳細」を表示してよいかどうかを判定する純粋関数。
 * sourceTypeを問わない（TestSetも含む。再挑戦ではなく閲覧のみのため対象外にする理由がない）。
 *
 * @param {import("./attempt-model.js").Attempt} attempt
 * @param {number} answeredCount
 * @returns {boolean}
 */
export function isHistoryDetailEligible(attempt, answeredCount) {
  return Boolean(attempt?.completed === true && answeredCount > 0);
}

/**
 * @typedef {Object} HistoryDetailQuestionItem
 * @property {number} number - 1始まりの表示用問題番号
 * @property {boolean} available - 現在の問題マスタにquestionIdが存在するか
 * @property {string} questionText - 現在の問題文（available===falseなら空文字）
 * @property {string} imagePath - 現在の画像パス（無ければ空文字）
 * @property {string} explanation - 現在の解説（無ければ空文字）
 * @property {string|null} finalAnswer - 表示用に整形済みの最終回答（回答記録なしはnull）
 * @property {string|null} correctAnswer - 表示用に整形済みの正解記録（未記録はnull）
 * @property {boolean} isCorrect - AnswerRecord.isCorrectそのもの
 * @property {boolean} wasInitiallyWrong - Attempt.initialWrongQuestionIdsに含まれるか
 *   （initialWrongQuestionIdsがnull＝判定不能の場合は常にfalse。「初回正解」の意味では使わない）
 */

/**
 * @typedef {Object} HistoryDetailViewModel
 * @property {string} fieldId
 * @property {string|null} dateLabel - 生のISO文字列（表示整形はrenderer側の責務、既存基準を再利用するため）
 * @property {string|null} sourceType
 * @property {number} answeredCount
 * @property {HistoryDetailQuestionItem[]} items
 */

/**
 * @param {Object} params
 * @param {import("./attempt-model.js").Attempt} params.attempt
 * @param {Array<import("./answer-record-model.js").AnswerRecord>} params.answerRecords
 * @param {Map<string,Object>} params.questionsById - questionId -> 現在の正規化済み問題（現在の問題マスタ）
 * @param {string} params.fieldId
 * @returns {HistoryDetailViewModel}
 */
export function buildHistoryDetailViewModel({ attempt, answerRecords, questionsById, fieldId }) {
  const records = Array.isArray(answerRecords) ? answerRecords : [];

  // Phase3D-1で確立済みの「answeredAt昇順で回答順を復元する」という正式な方式をそのまま踏襲する。
  const sorted = [...records].sort((a, b) => {
    const aAt = a?.answeredAt || "";
    const bAt = b?.answeredAt || "";
    if (aAt < bAt) return -1;
    if (aAt > bAt) return 1;
    return 0;
  });

  const initialWrongIds = Array.isArray(attempt?.initialWrongQuestionIds) ? attempt.initialWrongQuestionIds : null;
  const initialWrongSet = initialWrongIds ? new Set(initialWrongIds) : null;

  const items = sorted.map((record, index) => {
    const questionId = String(record?.questionId || "").trim();
    const question = questionsById instanceof Map ? questionsById.get(questionId) || null : null;

    return {
      number: index + 1,
      available: Boolean(question),
      questionText: question?.question || "",
      imagePath: question?.imagePath || "",
      explanation: question?.explanation || "",
      finalAnswer: formatFinalAnswerForDisplay(record?.selectedChoice, question),
      correctAnswer: formatCorrectAnswerForDisplay(record?.correctAnswer, question),
      isCorrect: record?.isCorrect === true,
      wasInitiallyWrong: Boolean(initialWrongSet?.has(questionId))
    };
  });

  return {
    fieldId,
    dateLabel: attempt?.completedAt || attempt?.startedAt || null,
    sourceType: attempt?.sourceType || null,
    answeredCount: items.length,
    items
  };
}
