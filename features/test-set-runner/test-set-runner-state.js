// features/test-set-runner/test-set-runner-state.js
//
// TestSet実行中の状態（グループ分割・進行位置・各グループ結果）のみを保持する
// 純粋なデータ構造。DOM・GAS通信・既存quiz state（core/state.js）へは一切依存しない。

/**
 * @typedef {Object} TestSetGroup
 * @property {string} fieldId
 * @property {string[]} questionIds
 */

/**
 * @returns {Object} TestSetRunnerの初期state（非実行中）
 */
export function createRunnerState() {
  return {
    active: false,
    testSetLabel: "",
    testSetId: "",
    groups: /** @type {TestSetGroup[]} */ ([]),
    currentGroupIndex: -1,
    results: [], // [{fieldId, correct, total, initialWrongQuestionIds}] グループ完了ごとに追加
    // Phase3D-4B-1: TestSet全group誤答復習（review phase）のための状態。
    // ここで型を追加するのみで、実際にreview Attemptを開始する配線は3D-4B-2で行う。
    phase: "groups", // "groups" | "review"
    reviewGroups: /** @type {TestSetGroup[]} */ ([]),
    currentReviewIndex: -1,
    reviewResults: [] // [{fieldId, correct, total, initialWrongQuestionIds}] 復習グループ完了ごとに追加
  };
}
