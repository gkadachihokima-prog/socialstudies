// features/weakness/weakness-list-service.js
//
// Phase4D-1+2: 苦手問題一覧画面のためのデータ取得のみを担当する（DOM操作は一切行わない、
// features/history/history-detail-service.jsと同じ位置づけ）。
//
// 苦手判定そのものはfeatures/weakness/weakness-service.jsのgetWeakQuestions()のみを利用し
// （独自判定・独自sortは一切行わない、Phase4D事前監査の結論どおり）、questionIdから
// 現在の問題マスタを解決する部分は、features/history/history-detail-service.jsが既に持つ
// status不問キャッシュ（loadQuestionMapForField）をそのまま再利用する（重複CSV loaderを
// 作らない）。

import { getWeakQuestions } from "./weakness-service.js";
import { loadQuestionMapForField } from "../history/history-detail-service.js";
import { buildWeaknessListViewModel } from "./weakness-list-model.js";

/**
 * @param {string} studentId
 * @returns {Promise<import("./weakness-list-model.js").WeaknessListViewModel>}
 */
export async function getWeaknessListViewModel(studentId) {
  const weakQuestions = getWeakQuestions(studentId);
  const fieldIds = Array.from(new Set(weakQuestions.map((entry) => entry.fieldId).filter(Boolean)));

  const questionsByField = new Map();
  await Promise.all(
    fieldIds.map(async (fieldId) => {
      questionsByField.set(fieldId, await loadQuestionMapForField(fieldId));
    })
  );

  return buildWeaknessListViewModel(weakQuestions, questionsByField);
}
