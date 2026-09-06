// features/history/learning-record-sync-integration.js
//
// Phase5-3: MemoryStorageへの同期保存とは別に、学習記録専用GAS
// （config/learning-record-gas-config.js、services/learning-record-service.js）へ
// 非同期でAttempt/AnswerRecordを送信するための橋渡し層。
//
// 責務：
//   - MemoryStorageの代替にはならない（MemoryStorage保存は既存の各*-integration.jsが
//     従来どおり同期的に行う。本ファイルはその「後から」GASへ送るだけ）
//   - GAS通信の失敗を既存Quiz処理へ一切throwしない（呼び出し元はawaitしない前提）
//   - console.errorで診断可能にするのみ
//
// 順序保証：
//   - saveAnswerRecordは、対象attemptIdのstartAttempt送信が完了するまで待ってから送信する
//     （新GAS側saveAnswerRecordは対象attemptIdがattemptsに存在することを要求するため）
//   - completeAttemptも同様にstartAttempt完了を待ってから送信する
//   - startAttemptが失敗した場合、依存するsaveAnswerRecord/completeAttemptの送信は
//     行わない（GAS側で「該当attemptIdなし」エラーになることが分かっているため）
//
//   - 【2026-08-30追加】同一attemptId内のsaveAnswerRecord/completeAttempt送信は、
//     attemptIdごとに1件ずつ直列実行する（runSerializedForAttempt_）。TS002（85問）の
//     本番E2Eで、回答を待ち時間なく連続実行すると85件のsaveAnswerRecordが並列に
//     GASへ届き、学習記録GAS側のLockService排他制御が輻輳して一部保存が失敗する
//     （画面は完了表示になるがサーバー側はAnswerRecord欠落・completed=falseのまま、
//     という不整合が実機で確認された）ことへの対応。直列化することで、GAS側の
//     排他ロック取得の競合そのものを減らす（固定sleepでの時間稼ぎではなく、
//     送信順序そのものを保証する方式）。
//     completeAttemptも同じattemptIdのqueueへ乗せることで、「その時点までに
//     enqueue済みの全saveAnswerRecordの送信（成功・リトライ後失敗いずれか確定するまで）」
//     が終わってから送信されることを保証する（＝全保存要求の処理終了→completeAttempt、
//     の順序保証）。個々のsaveAnswerRecordが最終的に失敗しても（services/
//     learning-record-service.jsのリトライを使い切った場合）、キュー自体は
//     次のタスクへ進む（1件の失敗でcompleteAttemptが永久に送られなくなることは防ぐ）。
//
// sourceType/testSetIdはPhase5-6でstartAttempt payloadへ配線済み（attempt.sourceType/
// testSetIdをそのまま送るのみ、値の組み立てはfeatures/history/attempt-model.js・
// app.js側の責務でありこのファイルでは行わない）。
// getStudentHistoryはPhase5-4で実装済み（features/history/learning-record-restore-integration.js）。
//
// Phase3B-2: attempt_progress（Phase3B-1でGAS側確定済み）の送信もこのファイルへ追加する。
// 【重要】progress専用の別ファイル（例: features/progress/progress-sync-integration.js）で
// 独立した直列queueを持たせると、completeAttemptが使うqueue（下記attemptTaskQueues）とは
// 別チェーンになり、「completeAttemptが未送信のprogressを追い越さない」という順序保証が
// 構造的に壊れる。そのためprogress送信は既存のrunSerializedForAttempt_/
// attemptTaskQueues/waitForStartAttempt_をそのまま再利用し、AnswerRecord・
// completeAttemptと同じ直列queueに乗せる（Phase3B-2実装前のコード監査で確定した設計判断）。
// progress固有の文脈（questionIds snapshot・unit・sourceType・testSetId・
// wrongQuestionIds・retryRound）はfeatures/progress/progress-model.jsが保持し、
// このファイルはGAS送信とqueueへの追加のみを担う。

import {
  startAttempt as sendStartAttempt,
  saveAnswerRecord as sendSaveAnswerRecord,
  completeAttempt as sendCompleteAttempt,
  saveAttemptProgress as sendSaveAttemptProgress
} from "../../services/learning-record-service.js";
import {
  buildAttemptProgressPayload,
  clearAttemptProgressContext,
  recordRetryStart
} from "../progress/progress-model.js";

// attemptId -> startAttempt送信のPromise（成功/失敗いずれも解決済みの状態を保持する）。
// syncCompleteAttempt完了時に破棄するため、同時に進行中のAttempt数程度のサイズに収まり、
// 無制限に増え続けない。
const startAttemptPromises = new Map();

// attemptId -> 「その時点までにenqueueされた全タスクが終わったこと」を表すPromise（常に解決済みへ
// 帰着し、rejectしない）。syncSaveAnswerRecord/syncCompleteAttemptはこのMapを介して同一attemptId内の
// 送信を1件ずつ直列実行する。syncCompleteAttempt完了時に破棄する（startAttemptPromisesと同じ方針）。
const attemptTaskQueues = new Map();

/**
 * 同一attemptId内のタスク（GAS送信）を1件ずつ直列実行する。
 * 前段のタスクが失敗していても、後続のタスクは実行する（1件の失敗でキュー全体を
 * 止めない＝completeAttemptが永久に送られなくなる事故を防ぐ）。
 *
 * @param {string} attemptId
 * @param {() => Promise<void>} taskFn
 * @returns {Promise<void>} このtaskFn自体の完了（呼び出し元は自分のタスクの成否をそのまま受け取れる）
 */
function runSerializedForAttempt_(attemptId, taskFn) {
  const previousTail = attemptTaskQueues.get(attemptId) || Promise.resolve();
  const taskResult = previousTail.then(taskFn, taskFn);
  const nextTail = taskResult.then(
    () => {},
    () => {}
  );
  attemptTaskQueues.set(attemptId, nextTail);
  return taskResult;
}

/**
 * Attempt開始を学習記録GASへ非同期送信する。呼び出し元はawaitしなくてよい
 * （UIをブロックしない、Quiz開始を止めない）。
 *
 * @param {import("./attempt-model.js").Attempt} attempt
 * @param {string} fieldId - startAttemptForQuiz()のsubject引数（クリーンなfieldId。
 *   旧saveRecordのbuildSavedSubjectName()による合成文字列とは別物であり、混同しない）
 */
export function syncStartAttempt(attempt, fieldId) {
  if (!attempt?.attemptId) return;

  const promise = sendStartAttempt({
    attemptId: attempt.attemptId,
    studentId: attempt.studentId,
    questionSetId: attempt.questionSetId,
    questionSetVersion: attempt.questionSetVersion,
    fieldId,
    startedAt: attempt.startedAt,
    // Phase5-6: attempt.sourceType/testSetIdがnullの場合、GAS側normalizeString_()が
    // 空文字列へ正規化するため、そのままJSON送信してよい（gas-api-contract-v1.md §5.1、
    // 既にGAS側で実装済みのvalidationと整合することをテストで確認する）。
    sourceType: attempt.sourceType,
    testSetId: attempt.testSetId
  }).catch((error) => {
    console.error("learning-record-service startAttempt error（MemoryStorageには影響しません）:", error);
    throw error; // rejected状態を保持し、依存するsaveAnswerRecord/completeAttempt側が判定できるようにする
  });

  // このPromiseを誰も待たない場合（例: 一度も回答せず離脱）でも
  // unhandled rejectionにならないようにする。
  promise.catch(() => {});

  startAttemptPromises.set(attempt.attemptId, promise);
}

async function waitForStartAttempt_(attemptId) {
  const promise = startAttemptPromises.get(attemptId);
  if (!promise) return true; // 追跡対象外(既に完了・破棄済み、または元々未追跡)は送信を許可する

  try {
    await promise;
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * AnswerRecordを学習記録GASへ非同期送信する。呼び出し元はawaitしなくてよい。
 * 対象attemptIdのstartAttemptが完了するまで内部で待機し、startAttemptが失敗していた
 * 場合は送信自体を行わない。
 *
 * @param {import("./answer-record-model.js").AnswerRecord} answerRecord
 */
export async function syncSaveAnswerRecord(answerRecord) {
  if (!answerRecord?.attemptId || !answerRecord?.questionId) return;

  const attemptId = answerRecord.attemptId;

  return runSerializedForAttempt_(attemptId, async () => {
    const started = await waitForStartAttempt_(attemptId);
    if (!started) {
      console.error(
        "learning-record-service saveAnswerRecord skipped（startAttemptが失敗したため送信しません）:",
        attemptId,
        answerRecord.questionId
      );
      return;
    }

    try {
      await sendSaveAnswerRecord({
        attemptId,
        questionId: answerRecord.questionId,
        studentId: answerRecord.studentId,
        fieldId: answerRecord.fieldId,
        unit: answerRecord.unit,
        selectedChoice: answerRecord.selectedChoice,
        correctAnswer: answerRecord.correctAnswer,
        isCorrect: answerRecord.isCorrect,
        answeredAt: answerRecord.answeredAt
      });
    } catch (error) {
      // リトライ上限（services/learning-record-service.js側、最大3回）を使い切っても
      // 失敗した場合にここへ到達する。データ欠落を黙って成功扱いにしないよう、
      // 通常のGAS通信エラーと区別できる形で明示的にログへ残す（UIへは表示しない、
      // 過度な複雑化を避ける方針のため）。
      console.error(
        `learning-record-service saveAnswerRecord 失敗（リトライ上限到達・MemoryStorageには影響しません、AnswerRecordがサーバー側に保存されていません）: attemptId=${attemptId} questionId=${answerRecord.questionId}`,
        error
      );
    }
  });
}

/**
 * 未完了Attemptの進行状態（attempt_progress）を学習記録GASへ非同期送信する
 * （Phase3B-2）。呼び出し元はawaitしなくてよい。対象attemptIdのstartAttemptが
 * 完了するまで内部で待機し（新GAS側saveAttemptProgressも対象attemptIdがattemptsに
 * 存在することを要求するため）、既存のAnswerRecord/completeAttemptと同じ直列queueへ
 * 乗せることで送信順序を保証する。
 *
 * progress固有の文脈（questionIds/unit/sourceType/testSetId/wrongQuestionIds/
 * retryRound）はfeatures/progress/progress-model.jsのcontextから組み立てる。
 * 対象attemptIdの文脈が存在しない場合（追跡対象外）は何もしない。
 *
 * enqueue自体は同期的に行われる（runSerializedForAttempt_は同期関数）ため、
 * 呼び出し元が本関数を「AnswerRecord保存の直後」など特定の順序で呼べば、
 * その呼び出し順序どおりにGASへの送信順が保証される。
 *
 * @param {string} attemptId
 * @param {number} currentQuestionIndex - 「次に表示すべき問題のindex」（0-based）
 */
export function syncAttemptProgress(attemptId, currentQuestionIndex) {
  if (!attemptId) return;

  const payload = buildAttemptProgressPayload(attemptId, currentQuestionIndex);
  if (!payload) return;

  runSerializedForAttempt_(attemptId, async () => {
    const started = await waitForStartAttempt_(attemptId);
    if (!started) {
      console.error(
        "learning-record-service saveAttemptProgress skipped（startAttemptが失敗したため送信しません）:",
        attemptId
      );
      return;
    }

    try {
      await sendSaveAttemptProgress({
        ...payload,
        questionIds: JSON.stringify(payload.questionIds),
        wrongQuestionIds: JSON.stringify(payload.wrongQuestionIds)
      });
    } catch (error) {
      console.error(
        `learning-record-service saveAttemptProgress 失敗（MemoryStorageには影響しません、続きから復元用の進行状態がサーバー側に保存されていません）: attemptId=${attemptId}`,
        error
      );
    }
  });
}

/**
 * retry（間違えた問題だけ復習）開始時に、progress文脈のwrongQuestionIds/retryRoundを
 * 更新したうえで、currentQuestionIndex=0としてただちに1回送信する（Phase3B-2）。
 * 呼び出し元（app.js）は、retryで実際に出題される順序（シャッフル後）を
 * wrongQuestionIdsとして渡すこと。
 *
 * @param {string} attemptId
 * @param {string[]} wrongQuestionIds - retryで実際に出題される順序
 */
export function syncAttemptProgressRetryStart(attemptId, wrongQuestionIds) {
  if (!attemptId) return;

  recordRetryStart(attemptId, wrongQuestionIds);
  syncAttemptProgress(attemptId, 0);
}

/**
 * Attempt完了を学習記録GASへ非同期送信する。呼び出し元はawaitしなくてよい。
 * 対象attemptIdのstartAttemptが完了するまで内部で待機する（順序保証）。
 * AnswerRecord送信の完了までは待たない（新GAS側completeAttemptはanswer_recordsを
 * 参照せずクライアントから受け取ったscore/totalCountをそのまま保存するだけのため）。
 *
 * 送信結果に関わらず、追跡用Promiseはここで破棄する（Attemptのライフサイクル終了に
 * 合わせてMapのサイズを抑える）。
 *
 * @param {import("./attempt-model.js").Attempt} completedAttempt
 */
export async function syncCompleteAttempt(completedAttempt) {
  if (!completedAttempt?.attemptId) return;

  const attemptId = completedAttempt.attemptId;

  // 同一attemptIdのqueueへ乗せることで、その時点までにenqueue済みの全saveAnswerRecord
  // （成功・リトライ後失敗いずれか確定するまで）が終わってから送信されることを保証する。
  try {
    await runSerializedForAttempt_(attemptId, async () => {
      const started = await waitForStartAttempt_(attemptId);
      if (!started) {
        console.error(
          "learning-record-service completeAttempt skipped（startAttemptが失敗したため送信しません）:",
          attemptId
        );
        return;
      }

      await sendCompleteAttempt({
        attemptId,
        completedAt: completedAttempt.completedAt,
        score: completedAttempt.score,
        totalCount: completedAttempt.totalCount,
        // Phase3D-2前提: nullは「情報不明」ではなく、この関数ではAttempt完了時に必ず
        // 実際の配列（空配列を含む）が渡ってくる想定のため、念のためnullのときのみ
        // 未記録を表す空文字列として送る（attempt_progressのquestionIds/wrongQuestionIdsと
        // 同じ「配列はJSON文字列化してから送る」規約に合わせる）。
        initialWrongQuestionIds:
          completedAttempt.initialWrongQuestionIds === null
            ? ""
            : JSON.stringify(completedAttempt.initialWrongQuestionIds)
      });
    });
  } catch (error) {
    console.error("learning-record-service completeAttempt error（MemoryStorageには影響しません）:", error);
  } finally {
    startAttemptPromises.delete(attemptId);
    attemptTaskQueues.delete(attemptId);
    // Phase3B-2: progress文脈もAttemptのライフサイクル終了に合わせて破棄する
    // （GAS側attempt_progress行自体は削除しない。あくまでクライアント側の後片付け）。
    clearAttemptProgressContext(attemptId);
  }
}
