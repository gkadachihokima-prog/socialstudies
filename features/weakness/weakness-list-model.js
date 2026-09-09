// features/weakness/weakness-list-model.js
//
// Phase4D-1+2: 苦手問題一覧画面用のview modelを組み立てる純粋関数。
// DOM操作・GAS通信・CSV読込は一切行わない（features/weakness/weakness-list-service.jsが
// WeaknessServiceからの取得・問題解決までを済ませたデータを受け取るだけ、
// features/history/history-detail-model.jsと同じ責務分離）。
//
// 苦手判定そのもの（score・matchedConditions等）はWeaknessService（weakness-rules.js）が
// 正本であり、本ファイルでは再判定・再sortを一切行わない（Phase4D事前監査の結論どおり）。
// score/matchedConditionsは内部判定情報のため、view modelには含めない（露出させない）。

/**
 * @typedef {Object} WeaknessListItem
 * @property {string} questionId
 * @property {string} fieldId
 * @property {string} unit
 * @property {boolean} available - 現在の問題マスタにquestionIdが存在するか（status不問キャッシュで解決）
 * @property {Object|null} question - 現在の問題マスタ（status不問。存在しなければnull）
 * @property {number} answeredCount
 * @property {number} correctCount
 * @property {number} correctRate
 */

/**
 * @typedef {Object} WeaknessListViewModel
 * @property {WeaknessListItem[]} items
 * @property {number} totalCount
 */

/**
 * @param {ReturnType<typeof import("./weakness-service.js").getWeakQuestions>} weakQuestions
 * @param {Map<string, Map<string, Object>>} questionsByField - fieldId -> (questionId -> 現在の正規化済み問題)
 * @returns {WeaknessListViewModel}
 */
export function buildWeaknessListViewModel(weakQuestions, questionsByField) {
  const entries = Array.isArray(weakQuestions) ? weakQuestions : [];

  const items = entries.map((entry) => {
    const fieldMap = questionsByField instanceof Map ? questionsByField.get(entry.fieldId) : null;
    const question = fieldMap instanceof Map ? fieldMap.get(entry.questionId) || null : null;

    return {
      questionId: entry.questionId,
      fieldId: entry.fieldId,
      unit: entry.unit || "",
      available: Boolean(question),
      question,
      answeredCount: entry.answeredCount ?? 0,
      correctCount: entry.correctCount ?? 0,
      correctRate: entry.correctRate ?? 0
    };
  });

  return { items, totalCount: items.length };
}
