// features/test-set-runner/test-set-review-resume.js
//
// Phase3D-4B-3: ブラウザリロード等で失われたrunnerStateを、testset_review progressから
// 安全に再構築するためのpure関数群。DOM・GAS通信・test-set-runner.jsのrunnerState
// （モジュール内シングルトン）への依存を一切持たない（plain dataのみを受け取り返す）。
//
// 通常TestSet resume（features/test-set-runner/test-set-runner.js の restoreRunnerState）は
// 本番稼働中の既存機能であり、このファイルはそれを壊さずに再利用する
// （groupQuestionsByField/findLatestCompletedAttemptForGroupを共有、大規模リファクタしない）。
//
// runIdが存在しないため、過去に同一TestSetをreview済みのcompleted Attemptが
// 混入するリスクを完全には排除できない（Phase3D-4B設計監査で確認済みの既存制約）。
// これを実用上抑制するため、「今回runの通常group最終完了時刻(normalRunCompletedAt)から
// 現在resume対象のreview Attempt開始時刻(progress.startedAt)まで」の時間窓の外にある
// review Attemptは候補から除外する。ただしこれは数学的な完全保証ではなく、既存の
// 潜在的制約（completedAt tie時の挙動を含む）をそのまま継承する。

import { groupQuestionsByField } from "./test-set-runner.js";
import {
  buildTestSetReviewGroups,
  findReviewGroupIndex,
  findLatestCompletedAttemptForGroup
} from "./test-set-review-model.js";

const REJECT_MESSAGE = "前回の間違い直しの続きを再開できませんでした。テスト対策画面からもう一度お試しください。";

function isValidIsoTimestamp(value) {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isSubsetOf(ids, allowedIds) {
  const allowedSet = new Set(allowedIds);
  return (Array.isArray(ids) ? ids : []).every((id) => allowedSet.has(id));
}

function arraysEqualInOrder(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * testset_review progressから、review再開に必要なrunnerState復元用plain dataを組み立てる。
 * 検証途中で1件でも不整合が見つかった場合、推測補完・部分復元は一切行わず即座に
 * {ok:false}を返す（Phase3D-4B設計監査「old data final contract」「error final contract」の結論どおり）。
 *
 * @param {Object} params
 * @param {{testSetId:string, label:string}} params.testSet - loadTestSet()のtestSet部分
 * @param {Array<{fieldId:string, questionId:string}>} params.questions - loadTestSet()のquestions部分
 * @param {Object} params.progress - getAttemptProgress()が返すprogress（sourceType==="testset_review"）
 * @param {Array<import("../history/attempt-model.js").Attempt>} params.priorAttempts - 同一studentIdの既存Attempt一覧
 *   （resume対象のcurrent review Attempt自身も含む、loadAttemptsByStudentの既存契約どおり）
 * @returns {{ok:true, runnerData:Object}|{ok:false, errorMessage:string}}
 */
export function prepareTestSetReviewResumePlan({ testSet, questions, progress, priorAttempts }) {
  const testSetId = String(testSet?.testSetId || "");
  const attempts = Array.isArray(priorAttempts) ? priorAttempts : [];

  // STEP22: progress基本validation
  if (
    progress?.sourceType !== "testset_review" ||
    !testSetId ||
    !progress?.fieldId ||
    !Array.isArray(progress?.questionIds) ||
    progress.questionIds.length === 0
  ) {
    return { ok: false, errorMessage: REJECT_MESSAGE };
  }

  // STEP241/242: resume対象の現在review Attempt自体の整合性を確認する。
  const currentAttempt = attempts.find((attempt) => attempt?.attemptId === progress.attemptId);
  const currentAttemptFieldId = String(currentAttempt?.questionSetId || "").split("__")[0];
  if (
    !currentAttempt ||
    currentAttempt.sourceType !== "testset_review" ||
    currentAttempt.testSetId !== testSetId ||
    currentAttemptFieldId !== progress.fieldId ||
    currentAttempt.completed === true
  ) {
    return { ok: false, errorMessage: REJECT_MESSAGE };
  }

  // STEP25: 通常TestSet groupsの再構築は既存groupQuestionsByFieldをそのまま使う（別group化禁止）。
  const groups = groupQuestionsByField(Array.isArray(questions) ? questions : []);

  // STEP30/224-228: 通常group全件について、完了済みAttemptから結果を復元する。
  // 1件でも見つからない・情報不明(null)・現在group定義とのsubset不整合があれば復元不能。
  const results = [];
  const normalCompletedAtList = [];

  for (const group of groups) {
    const latest = findLatestCompletedAttemptForGroup(attempts, {
      sourceType: "testset",
      testSetId,
      fieldId: group.fieldId
    });

    if (!latest) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }
    if (latest.initialWrongQuestionIds === null || latest.initialWrongQuestionIds === undefined) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }
    if (!isSubsetOf(latest.initialWrongQuestionIds, group.questionIds)) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }
    if (!isValidIsoTimestamp(latest.completedAt)) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }

    normalCompletedAtList.push(latest.completedAt);
    results.push({
      fieldId: group.fieldId,
      correct: latest.score,
      total: latest.totalCount,
      initialWrongQuestionIds: latest.initialWrongQuestionIds
    });
  }

  // STEP32: reviewGroupsを再生成する（3D-4B-1のbuildTestSetReviewGroupsをそのまま利用）。
  const reviewBuild = buildTestSetReviewGroups(results);
  if (!reviewBuild.available || reviewBuild.groups.length === 0) {
    return { ok: false, errorMessage: REJECT_MESSAGE };
  }

  // STEP33/34/81/82: progress.fieldIdに一致するreviewGroupを特定し、
  // questionIdsが完全一致（順序・件数・ID）することを確認する（TestSet定義変更検知）。
  const currentReviewIndex = findReviewGroupIndex(reviewBuild.groups, progress.fieldId);
  if (currentReviewIndex === -1) {
    return { ok: false, errorMessage: REJECT_MESSAGE };
  }
  if (!arraysEqualInOrder(reviewBuild.groups[currentReviewIndex].questionIds, progress.questionIds)) {
    return { ok: false, errorMessage: REJECT_MESSAGE };
  }

  // STEP96/229/230: 過去run混入を実用上抑制するための時間窓の境界値を検証する。
  const normalRunCompletedAt = normalCompletedAtList.reduce((max, value) => (value > max ? value : max));
  if (!isValidIsoTimestamp(normalRunCompletedAt) || !isValidIsoTimestamp(progress.startedAt)) {
    return { ok: false, errorMessage: REJECT_MESSAGE };
  }

  // STEP36-40/83-90: currentReviewIndexより前のreviewGroup全件について、
  // 完了済みreview Attemptを1件ずつ復元する。1件でも不足・不整合があれば復元不能。
  const reviewResults = [];

  for (let i = 0; i < currentReviewIndex; i += 1) {
    const reviewGroup = reviewBuild.groups[i];

    // STEP236: time windowで先に候補を絞り込んでから、既存helperで最新1件を選ぶ
    // （helper自体をreview専用条件で複雑化しない）。
    const windowedAttempts = attempts.filter(
      (attempt) =>
        isValidIsoTimestamp(attempt?.completedAt) &&
        attempt.completedAt >= normalRunCompletedAt &&
        attempt.completedAt <= progress.startedAt
    );

    const latestReview = findLatestCompletedAttemptForGroup(windowedAttempts, {
      sourceType: "testset_review",
      testSetId,
      fieldId: reviewGroup.fieldId
    });

    if (!latestReview) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }
    if (latestReview.initialWrongQuestionIds === null || latestReview.initialWrongQuestionIds === undefined) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }
    if (latestReview.score < 0 || latestReview.score > latestReview.totalCount) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }
    if (latestReview.totalCount !== reviewGroup.questionIds.length) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }
    if (!isSubsetOf(latestReview.initialWrongQuestionIds, reviewGroup.questionIds)) {
      return { ok: false, errorMessage: REJECT_MESSAGE };
    }

    reviewResults.push({
      fieldId: reviewGroup.fieldId,
      correct: latestReview.score,
      total: latestReview.totalCount,
      initialWrongQuestionIds: latestReview.initialWrongQuestionIds
    });
  }

  return {
    ok: true,
    runnerData: {
      testSetLabel: String(testSet?.label || ""),
      testSetId,
      groups,
      currentGroupIndex: groups.length - 1,
      results,
      reviewGroups: reviewBuild.groups,
      currentReviewIndex,
      reviewResults
    }
  };
}
