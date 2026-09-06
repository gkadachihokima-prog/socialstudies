// features/history/attempt-complete-integration.js
//
// Phase2 Task14-3: 既存アプリ（app.js）のクイズ終了処理から、新しいドメイン基盤
// （Attempt）を「裏側で」完了状態へ更新するための最小限の橋渡し関数。
//
// 既存のリザルト計算・表示（core/result-controller.js の renderFinalResult 等、
// state.quiz.score等を使う既存ロジック）は一切変更せず、既に終了したクイズについて、
// 裏側のAttemptを完了状態へ更新するだけの薄いラッパーとする。
// GAS保存・ランキング・履歴画面等は今回一切行わない。
//
// 使用するのは以下の2つのみ（Repository・Storageへは直接アクセスしない、というご指示どおり）:
//   - features/history/attempt-service.js の loadAttempt() / saveAttempt()
//     （Task12で作成済み。内部でAttemptRepository・既定のMemoryStorageを使う）
//   - features/history/answer-record-service.js の loadAnswerRecordsByAttempt()
//     （Task13/Task14-2で作成済み。実際に保存されたAnswerRecordから解答数・正答数を算出することで、
//     既存のstate.quiz.score等に頼らず、裏側の記録だけで完結させる）
//
// features/history/quiz-start-integration.js / answer-record-integration.js と同じ考え方で、
// 例外は投げず失敗時はnullを返す（呼び出し側＝既存のリザルト表示フローを絶対に止めないため）。

import { loadAttempt, saveAttempt } from "./attempt-service.js";
import { loadAnswerRecordsByAttempt } from "./answer-record-service.js";
import { syncCompleteAttempt } from "./learning-record-sync-integration.js";
import { normalizeQuestionIdList } from "./attempt-model.js";

/**
 * クイズ終了時に、裏側でAttemptを完了状態へ更新する。
 * 更新内容: completed, completedAt（終了時刻）, score（正答数）,
 * answeredCount（解答数）, correctRate（正答率）, initialWrongQuestionIds（Phase3D-2前提で追加）。
 * 既存のscore/totalCount/sourceType/testSetId等の意味・算出方法は変更しない。
 *
 * @param {string} attemptId - Task14-1で発行済みのAttemptId
 * @param {string[]} [initialWrongQuestionIds] - そのAttemptの通常ラウンドで一度でも誤答した
 *   問題のquestionId配列（呼び出し元＝app.jsが、既にメモリ上に存在するstate.quiz.wrongQuestions
 *   から抽出して渡す。retry後のAnswerRecordやattempt_progressから逆算しない）。省略時はnull
 *   （情報不明）として保存する。
 * @returns {(import("./attempt-model.js").Attempt & { answeredCount: number, correctRate: number }) | null}
 */
export function completeAttempt(attemptId, initialWrongQuestionIds) {
  try {
    if (!attemptId) return null;

    const attempt = loadAttempt(attemptId);
    if (!attempt) return null;

    const answerRecords = loadAnswerRecordsByAttempt(attemptId);
    const answeredCount = answerRecords.length;
    const correctCount = answerRecords.filter((record) => record.isCorrect).length;
    const correctRate = answeredCount > 0 ? correctCount / answeredCount : 0;

    const completedAttempt = {
      ...attempt,
      completed: true,
      completedAt: new Date().toISOString(),
      score: correctCount,
      answeredCount,
      correctRate,
      initialWrongQuestionIds: normalizeQuestionIdList(initialWrongQuestionIds)
    };

    const savedAttempt = saveAttempt(completedAttempt);

    // Phase5-3: MemoryStorage保存成功後、学習記録専用GASへも非同期送信する
    // （fire-and-forget、呼び出し元はawaitしない・失敗してもここでは影響しない）。
    syncCompleteAttempt(savedAttempt);

    return savedAttempt;
  } catch (error) {
    console.error("completeAttempt error（裏側の記録のみ失敗。既存のリザルト表示フローには影響しません）:", error);
    return null;
  }
}
