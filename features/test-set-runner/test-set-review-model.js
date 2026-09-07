// features/test-set-runner/test-set-review-model.js
//
// Phase3D-4B-1: TestSet全group誤答復習（review phase）のためのpure関数群。
// DOM・GAS通信・test-set-runner.jsのrunnerState（モジュール内シングルトン）への
// 依存を一切持たない。plain dataのみを受け取り、plain dataのみを返す
// （Phase3D-4B設計監査の追加最終監査K・STEP64・STEP120のとおり）。
//
// この段階ではまだどこからも実際のtestset_review Attemptを開始しない
// （3D-4B-2でapp.jsから配線するまで、production実行経路からは呼ばれない）。

/**
 * @typedef {Object} TestSetGroupResult
 * @property {string} fieldId
 * @property {number} correct
 * @property {number} total
 * @property {string[]|null} initialWrongQuestionIds - null=情報不明（旧Attempt等）、
 *   []=記録済みで誤答0件、配列=記録済みの誤答questionId一覧
 *   （features/history/attempt-model.js の normalizeQuestionIdList()と同じ意味）
 */

/**
 * @typedef {Object} TestSetReviewGroup
 * @property {string} fieldId
 * @property {string[]} questionIds
 */

/**
 * 通常TestSet実行結果（グループごとのinitialWrongQuestionIds）から、
 * 復習フェーズ用のreviewGroupsを組み立てる。
 *
 * TestSetのgroupは既に「1 fieldId = 1 group」で構成される
 * （test-set-runner.js groupQuestionsByField()が同一fieldIdを常に1つのgroupへ統合するため、
 * Phase3D-4B設計監査で確認済み）。したがってgroup横断でのfieldId再集約は不要で、
 * 各resultsの要素をそのままreviewGroup候補として扱えばよい。
 *
 * @param {TestSetGroupResult[]} results
 * @returns {{available:boolean, groups:TestSetReviewGroup[]}}
 *   available=false: resultsに1件でもinitialWrongQuestionIds===null（またはundefined）が
 *   含まれ、復習対象を正確に特定できない（旧Attempt混在等）。この場合groupsは常に空配列。
 *   呼び出し側はこれを「アプリ異常」ではなく「復習機能を今回は使わずに従来summaryへ
 *   フォールバックする」正常系として扱う（console.error等は出さない）。
 * @throws {Error} initialWrongQuestionIdsがnull/undefined/配列のいずれでもない場合
 *   （呼び出し側の内部不整合であり、推測変換は行わない）
 */
export function buildTestSetReviewGroups(results) {
  const list = Array.isArray(results) ? results : [];
  const groups = [];

  for (const result of list) {
    const ids = result?.initialWrongQuestionIds;

    if (ids === null || ids === undefined) {
      return { available: false, groups: [] };
    }

    if (!Array.isArray(ids)) {
      throw new Error(
        "buildTestSetReviewGroups: initialWrongQuestionIdsはnullまたは配列である必要があります。"
      );
    }

    if (ids.length === 0) {
      continue;
    }

    const seen = new Set();
    const dedupedIds = [];
    ids.forEach((id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      dedupedIds.push(id);
    });

    if (dedupedIds.length === 0) {
      continue;
    }

    groups.push({ fieldId: result.fieldId, questionIds: dedupedIds });
  }

  return { available: true, groups };
}

/**
 * @param {TestSetReviewGroup[]} reviewGroups
 * @returns {number} reviewGroups全体の問題数合計
 */
export function getReviewQuestionCount(reviewGroups) {
  return (Array.isArray(reviewGroups) ? reviewGroups : []).reduce(
    (sum, group) => sum + (Array.isArray(group?.questionIds) ? group.questionIds.length : 0),
    0
  );
}

/**
 * @param {TestSetReviewGroup[]} reviewGroups
 * @param {string} fieldId
 * @returns {number} 一致するreviewGroupのindex（見つからない場合-1）
 */
export function findReviewGroupIndex(reviewGroups, fieldId) {
  return (Array.isArray(reviewGroups) ? reviewGroups : []).findIndex((group) => group?.fieldId === fieldId);
}

/**
 * 指定した条件（sourceType・testSetId・fieldId）に一致する完了済みAttemptのうち、
 * 最も新しく完了した1件を返す。
 *
 * features/test-set-runner/test-set-runner.js の restoreRunnerState() が持っていた
 * 候補選択ロジック（Phase3C）をそのままpure関数として切り出したもの。fieldIdの判定は
 * Attempt自体にfieldId列が無いため、questionSetIdの既定形式`<fieldId>__<coursePurposeId>__<slug>`
 * （config/course-purposes.js buildQuestionSetId）から導出する。この判定方法は
 * sourceType="testset"のAttemptとsourceType="testset_review"のAttemptの両方で同一
 * （features/history/quiz-start-integration.js startAttemptForQuiz()が、sourceTypeに関わらず
 * 常に同じbuildQuestionSetId(fieldId, coursePurposeId, slug)でquestionSetIdを生成するため、
 * Phase3D-4B設計監査 追加最終監査Qで実コード確認済み）。
 *
 * completedAtが完全に同一な複数候補が存在する場合の挙動は保証されない。
 * 比較関数`(a,b) => (a.completedAt < b.completedAt ? 1 : -1)`は同値のとき常に-1を返す
 * （同値の場合に0を返す仕様準拠のcomparatorになっていない）ため、Array.prototype.sortの
 * 安定ソート保証（比較関数が0を返す要素間でのみ成立）は適用されない。実測（Node.js/V8）では
 * 元の配列順で最後に現れた候補が選ばれるが、これはJSエンジンの実装依存であり、
 * 他エンジンでの動作を保証しない（Phase3D-4B-1でNode実行時に実測確認済み。既存の潜在的な
 * 既知制約であり、この抽出では比較関数・sort呼び出し自体を一切変更しない）。
 *
 * @param {import("../history/attempt-model.js").Attempt[]} attempts
 * @param {{sourceType:string, testSetId:string, fieldId:string}} criteria
 * @returns {import("../history/attempt-model.js").Attempt|null}
 */
export function findLatestCompletedAttemptForGroup(attempts, { sourceType, testSetId, fieldId } = {}) {
  if (!sourceType || !testSetId || !fieldId) return null;

  const candidates = (Array.isArray(attempts) ? attempts : []).filter((attempt) => {
    const attemptFieldId = String(attempt?.questionSetId || "").split("__")[0];
    return (
      attempt?.sourceType === sourceType &&
      attempt?.testSetId === testSetId &&
      attemptFieldId === fieldId &&
      attempt?.completed === true
    );
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
  return candidates[0];
}

/**
 * TestSet全体（通常group＋復習group）の最終結果を計算する。
 * 通常groupの得点（results）はreviewによって一切書き換えない
 * （Phase3D-4B設計監査「初回score」節のとおり）。
 *
 * この関数はまだfinishRun()（test-set-runner.js）からは呼ばれない
 * （3D-4B-3でUI配線するまで未使用。Phase3D-4B-1では通常summaryを一切変更しない）。
 *
 * @param {TestSetGroupResult[]} results
 * @param {TestSetGroupResult[]} reviewResults
 * @param {string} label
 * @returns {{label:string, totalQuestions:number, totalCorrect:number, totalIncorrect:number,
 *   review: {totalQuestions:number, totalCorrect:number, totalIncorrect:number, remainingWrong:number}|null}}
 */
export function computeReviewCompletionSummary(results, reviewResults, label) {
  const safeResults = Array.isArray(results) ? results : [];
  const safeReviewResults = Array.isArray(reviewResults) ? reviewResults : [];

  const totalQuestions = safeResults.reduce((sum, r) => sum + (r.total || 0), 0);
  const totalCorrect = safeResults.reduce((sum, r) => sum + (r.correct || 0), 0);

  let review = null;
  if (safeReviewResults.length > 0) {
    const reviewTotalQuestions = safeReviewResults.reduce((sum, r) => sum + (r.total || 0), 0);
    const reviewTotalCorrect = safeReviewResults.reduce((sum, r) => sum + (r.correct || 0), 0);
    const remainingWrong = safeReviewResults.reduce(
      (sum, r) => sum + (Array.isArray(r.initialWrongQuestionIds) ? r.initialWrongQuestionIds.length : 0),
      0
    );
    review = {
      totalQuestions: reviewTotalQuestions,
      totalCorrect: reviewTotalCorrect,
      totalIncorrect: reviewTotalQuestions - reviewTotalCorrect,
      remainingWrong
    };
  }

  return {
    label: String(label || ""),
    totalQuestions,
    totalCorrect,
    totalIncorrect: totalQuestions - totalCorrect,
    review
  };
}
