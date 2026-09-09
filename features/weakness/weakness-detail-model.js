// features/weakness/weakness-detail-model.js
//
// Phase4D-1+2: 苦手問題「詳細」画面用のview modelを組み立てる純粋関数。
// DOM操作・GAS通信・CSV読込は一切行わない。
//
// features/weakness/weakness-list-service.jsが既に解決済みの一覧item
// （features/weakness/weakness-list-model.jsのWeaknessListItem、questionまで解決済み）を
// そのまま受け取るだけで、questionIdの再検索・WeaknessServiceの再呼び出しは行わない
// （Phase4C-1/4C-2と同じ「一覧描画時に解決済みのentryをそのまま詳細へ渡す」設計）。
//
// 「現在の正解」はAnswerRecordの過去の回答記録ではなく、現在の問題マスタから
// judges/answer-judge.jsのgetCorrectAnswer()で都度算出する（history-detail-model.jsが
// AnswerRecord.correctAnswerという過去のスナップショットを使うのとは責務が異なる）。
// sort modeの人間可読整形（矢印区切り）は、既存のfeatures/history/history-detail-model.jsの
// formatCorrectAnswerForDisplay()をそのまま再利用する（同じ整形ロジックを複製しない）。
//
// Phase4D事前監査の結論どおり、MVPでは「いつからの回答か」（lastAnsweredAt）等は
// 表示しない（正本選択を増やさないため）。

import { getCorrectAnswer } from "../../judges/answer-judge.js";
import { formatCorrectAnswerForDisplay } from "../history/history-detail-model.js";

/**
 * @typedef {Object} WeaknessDetailViewModel
 * @property {string} questionId
 * @property {string} fieldId
 * @property {boolean} available
 * @property {string} questionText
 * @property {string} imagePath
 * @property {string} explanation
 * @property {string|null} correctAnswer - 表示用に整形済みの現在の正解（不明時はnull）
 * @property {number} answeredCount
 * @property {number} correctCount
 * @property {number} correctRate
 */

/**
 * @param {import("./weakness-list-model.js").WeaknessListItem} item
 * @returns {WeaknessDetailViewModel}
 */
export function buildWeaknessDetailViewModel(item) {
  const question = item?.question || null;
  const correctAnswerRaw = question ? getCorrectAnswer(question) : "";

  return {
    questionId: item?.questionId || "",
    fieldId: item?.fieldId || "",
    available: Boolean(question),
    questionText: question?.question || "",
    imagePath: question?.imagePath || "",
    explanation: question?.explanation || "",
    correctAnswer: formatCorrectAnswerForDisplay(correctAnswerRaw, question),
    answeredCount: item?.answeredCount ?? 0,
    correctCount: item?.correctCount ?? 0,
    correctRate: item?.correctRate ?? 0
  };
}
