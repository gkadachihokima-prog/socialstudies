// features/history/history-detail-service.js
//
// Phase3D-3: 学習履歴「詳細」画面のためのデータ取得のみを担当する（DOM操作は一切行わない）。
//
// 現在の問題マスタ（CSV）からquestionId単位で問題を解決する際、
// features/teacher/teacher-history-service.jsのfindQuestionByIdForField()と同じ理由
// （回答当時は存在したが現在はstatusが非active（hidden/archived）になった問題も、
// 過去に実際に解いた問題として文言を表示できる必要がある）により、
// filterManager.getNormalizedQuestionsForSubject()（status==="active"のみに絞り込む、
// 出題用の既存キャッシュ）は使わず、core/question-loader.js・core/question-normalizer.jsを
// 直接使う独自の非フィルタキャッシュを持つ。teacher側の実装そのものへは依存しない
// （生徒向け学習履歴機能と講師向け分析機能は責務が異なる別機能のため、この15行程度の
// 小規模な重複は許容する）。
//
// getStudentHistoryを再送信しない: 呼び出し元（app.js）が既に復元済みの
// {attempt, questionSet, answerRecords}をそのまま渡す前提（追加監査E）。

import { loadQuestions } from "../../core/question-loader.js";
import { normalizeQuestion } from "../../core/question-normalizer.js";
import { SUBJECT_CONFIG } from "../../config/subjects.js";
import { buildHistoryDetailViewModel } from "./history-detail-model.js";

// fieldId -> Map(questionId -> 正規化済みQuestion、status不問)。
const questionCacheByField = new Map();

async function loadQuestionMapForField(fieldId) {
  if (questionCacheByField.has(fieldId)) {
    return questionCacheByField.get(fieldId);
  }

  const config = SUBJECT_CONFIG[fieldId];
  if (!config) {
    const empty = new Map();
    questionCacheByField.set(fieldId, empty);
    return empty;
  }

  const rawRows = await loadQuestions(config.csvPath);
  const map = new Map();
  rawRows.forEach((row) => {
    const question = normalizeQuestion(row, fieldId);
    map.set(question.questionId, question);
  });
  questionCacheByField.set(fieldId, map);
  return map;
}

/**
 * 学習履歴一覧の1件（{attempt, questionSet, answerRecords}、features/history/
 * history-service.jsのgetStudentHistoryList()が返す形）から、詳細画面用のview modelを
 * 組み立てる。
 *
 * fieldIdはentry.questionSet?.fieldIdを優先し、無ければ既存のhistory-renderer.jsと
 * 同じフォールバック（answerRecords先頭1件のfieldId）を使う（QuestionSetモデルの
 * 単一fieldId制約、Task55により、同一Attempt内のAnswerRecordは常に同じfieldIdを持つ）。
 *
 * @param {{attempt:import("./attempt-model.js").Attempt, questionSet:Object|null, answerRecords:Array<Object>}} entry
 * @returns {Promise<import("./history-detail-model.js").HistoryDetailViewModel>}
 */
export async function getHistoryDetailViewModel(entry) {
  const answerRecords = Array.isArray(entry?.answerRecords) ? entry.answerRecords : [];
  const fieldId = entry?.questionSet?.fieldId || answerRecords[0]?.fieldId || "";
  const questionsById = await loadQuestionMapForField(fieldId);

  return buildHistoryDetailViewModel({ attempt: entry?.attempt, answerRecords, questionsById, fieldId });
}
