// features/test-set-runner/test-set-runner.js
//
// TestSet（{fieldId,questionId}の集合）を、既存の単一fieldId QuestionSet/Attempt
// 実行フローで順番に実行するための橋渡し（Task55確定方針）。
//
// 最重要方針：QuestionSetモデルの「fieldIdは単一必須」という既存制約
// （features/question-set/question-set-model.js の validateQuestionSet）を変更しない。
// TestSetをfieldIdごとにグループへ分割し、既存の単一fieldId Attempt実行を
// グループの数だけ順番に呼び出す（Task50確定方針の実装）。
//
// このモジュールはDOM操作・画面遷移・GAS通信を一切行わない。
// 「今どのグループを実行中か」「各グループの結果」だけを管理する。
// 実際にQuiz画面を表示する処理（app.js側のstartTestSetGroupQuiz等）や、
// 問題データの取得（filterManager.getNormalizedQuestionsForSubject）は
// 呼び出し側から関数として注入される（テスト容易性・責務分離のため）。

import { createRunnerState } from "./test-set-runner-state.js";

let runnerState = createRunnerState();

/**
 * TestSet.questionsを、最初に現れたfieldIdの順序でグループ化する。
 * 新しいdisplayOrder列は使わない（Task49で不要と確定済み）。既存のQuestionSet生成順・
 * 出題順は各グループ内で既存のshuffleArray()に委ねる（Task49/Task55確定方針）。
 *
 * @param {Array<{fieldId:string, questionId:string}>} questions
 * @returns {Array<{fieldId:string, questionIds:string[]}>}
 */
function groupQuestionsByField(questions) {
  const order = [];
  const map = new Map();

  questions.forEach(({ fieldId, questionId }) => {
    if (!map.has(fieldId)) {
      map.set(fieldId, []);
      order.push(fieldId);
    }
    map.get(fieldId).push(questionId);
  });

  return order.map((fieldId) => ({ fieldId, questionIds: map.get(fieldId) }));
}

/**
 * TestSetの実行を開始する（グループ分割＋事前検証）。
 * 検証NGの場合はrunnerStateを一切変更せず、既存機能（通常学習）に影響を与えない。
 *
 * questionIdの実在確認は、fieldIdごとに現在activeな問題一覧（getActiveQuestionsForField、
 * 実体はfilterManager.getNormalizedQuestionsForSubjectでstatus=active済み）に対して行う。
 * これにより「questionIdが存在しない」「作成後にstatusがactiveでなくなった」
 * 「fieldIdとquestionIdの組み合わせが誤っている（他教科の問題IDを指している）」の
 * 3パターンすべてを、既存コードの再利用だけで検出できる（CSV parser等の新規実装なし）。
 *
 * @param {{label?:string, questions?:Array<{fieldId:string, questionId:string}>}} selectedTestSet
 * @param {(fieldId:string) => Promise<Array<{questionId:string}>>} getActiveQuestionsForField
 * @returns {Promise<{ok:boolean, errorMessage?:string}>}
 */
export async function startTestSetRun(selectedTestSet, getActiveQuestionsForField) {
  const questions = Array.isArray(selectedTestSet?.questions) ? selectedTestSet.questions : [];

  if (questions.length === 0) {
    return { ok: false, errorMessage: "テスト対策の問題データに不整合があります。先生に確認してください。" };
  }

  const groups = groupQuestionsByField(questions);

  for (const group of groups) {
    let activeQuestions;
    try {
      activeQuestions = await getActiveQuestionsForField(group.fieldId);
    } catch (error) {
      console.error("TestSet実行時の問題データ取得に失敗:", group.fieldId, error);
      return { ok: false, errorMessage: "テスト対策の問題データに不整合があります。先生に確認してください。" };
    }

    const activeIds = new Set((activeQuestions || []).map((q) => q.questionId));
    const missingIds = group.questionIds.filter((id) => !activeIds.has(id));

    if (missingIds.length > 0) {
      // 開発時に原因特定できるよう詳細はconsoleへ。学校名・生徒情報等の個人情報は含まない。
      console.error("TestSet実行時にquestionIdが見つかりません（存在しない/非active/fieldId不一致のいずれか）:", {
        fieldId: group.fieldId,
        missingIds
      });
      return { ok: false, errorMessage: "テスト対策の問題データに不整合があります。先生に確認してください。" };
    }
  }

  runnerState = {
    active: true,
    testSetLabel: String(selectedTestSet.label || ""),
    testSetId: String(selectedTestSet.testSetId || ""),
    groups,
    currentGroupIndex: 0,
    results: []
  };

  return { ok: true };
}

/**
 * @returns {boolean} TestSet実行中かどうか
 */
export function isRunnerActive() {
  return runnerState.active;
}

/**
 * @returns {string} 実行中TestSetのtestSetId（未実行時は空文字列）。
 *   Attempt生成箇所（app.js）がsourceType="testset"のAttemptへ渡すために使う
 *   （Phase5-6、features/history/attempt-model.js参照）。
 */
export function getRunnerTestSetId() {
  return runnerState.testSetId;
}

/**
 * @returns {{fieldId:string, questionIds:string[]}|null} 現在実行中のグループ
 */
export function getCurrentGroup() {
  return runnerState.groups[runnerState.currentGroupIndex] || null;
}

/**
 * 現在グループの結果を記録する。
 * 呼び出し側（app.js）が、通常学習と全く同じ既存Attempt完了処理
 * （firstRoundScore/firstRoundTotal優先の集計方式、既存result-controller.jsの
 * renderFinalResultと同じロジック）で算出した値を渡す。
 *
 * @param {number} correct
 * @param {number} total
 */
export function recordCurrentGroupResult(correct, total) {
  const group = getCurrentGroup();
  if (!group) return;
  runnerState.results.push({ fieldId: group.fieldId, correct, total });
}

/**
 * @returns {boolean} 次のグループが残っているか
 */
export function hasNextGroup() {
  return runnerState.currentGroupIndex < runnerState.groups.length - 1;
}

/**
 * @returns {{fieldId:string, questionIds:string[]}|null} 次のグループへ進めて返す
 */
export function advanceToNextGroup() {
  runnerState.currentGroupIndex += 1;
  return getCurrentGroup();
}

/**
 * TestSet全体の完了集計を返し、runnerStateを非実行中へ戻す。
 * @returns {{label:string, totalQuestions:number, totalCorrect:number, totalIncorrect:number}}
 */
export function finishRun() {
  const totalQuestions = runnerState.results.reduce((sum, r) => sum + r.total, 0);
  const totalCorrect = runnerState.results.reduce((sum, r) => sum + r.correct, 0);

  const summary = {
    label: runnerState.testSetLabel,
    totalQuestions,
    totalCorrect,
    totalIncorrect: totalQuestions - totalCorrect
  };

  runnerState = createRunnerState();
  return summary;
}

/**
 * TestSet実行を中断し、runnerStateを安全に破棄する（次グループを勝手に再開しない）。
 * 生徒がQuiz画面から「開始画面へ戻る」を押した場合等に呼ぶ。
 */
export function abortRun() {
  runnerState = createRunnerState();
}

/**
 * Phase3C本体: ページリロード等でrunnerStateが失われた状態から、resume対象progress
 * （sourceType==="testset"）をもとにTestSet全体の進行状態を再構築する。
 *
 * 新しいstartAttempt送信・questionIds再抽選は一切行わない。既に完了済みグループの
 * 得点は、新規GAS呼び出しを増やさず、生徒選択時に既に復元済みのAttempt一覧
 * （features/history/learning-record-restore-integration.js、priorAttempts引数）から
 * 同一testSetId・completed=trueのAttemptを検索して再構成する。
 *
 * Attemptモデル自体にfieldId列は無いため（features/history/attempt-model.js参照）、
 * questionSetIdの既定形式`<fieldId>__<coursePurposeId>__<slug>`
 * （config/course-purposes.jsのbuildQuestionSetId、features/question-set/
 * question-set-loader.jsで生成）からfieldIdを導出する。新しいAttempt列は追加しない。
 *
 * @param {Object} params
 * @param {{testSetId:string, label:string}} params.testSet - loadTestSet()のtestSet部分
 * @param {Array<{fieldId:string, questionId:string}>} params.questions - loadTestSet()のquestions部分
 * @param {string} params.resumeFieldId - resume対象progressのfieldId（現在再開すべきグループ）
 * @param {Array<import("../history/attempt-model.js").Attempt>} params.priorAttempts - 同一studentIdの既存Attempt一覧
 * @returns {{ok:true}|{ok:false, errorMessage:string}}
 */
export function restoreRunnerState({ testSet, questions, resumeFieldId, priorAttempts }) {
  const groups = groupQuestionsByField(Array.isArray(questions) ? questions : []);
  const groupIndex = groups.findIndex((group) => group.fieldId === resumeFieldId);

  if (groupIndex === -1) {
    return { ok: false, errorMessage: "テスト対策の問題データに不整合があります。先生に確認してください。" };
  }

  const testSetId = String(testSet?.testSetId || "");
  const results = [];

  for (let i = 0; i < groupIndex; i += 1) {
    const group = groups[i];
    const candidates = (Array.isArray(priorAttempts) ? priorAttempts : []).filter((attempt) => {
      const attemptFieldId = String(attempt?.questionSetId || "").split("__")[0];
      return (
        attempt?.sourceType === "testset" &&
        attempt?.testSetId === testSetId &&
        attemptFieldId === group.fieldId &&
        attempt?.completed === true
      );
    });

    if (candidates.length === 0) {
      return { ok: false, errorMessage: "前回の続きのデータに不整合があります。先生に確認してください。" };
    }

    // 同一fieldIdに複数の完了済みAttemptが存在する場合(通常運用では発生しない想定)は、
    // 最も新しく完了したものを採用する。
    candidates.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
    const latest = candidates[0];
    results.push({ fieldId: group.fieldId, correct: latest.score, total: latest.totalCount });
  }

  runnerState = {
    active: true,
    testSetLabel: String(testSet?.label || ""),
    testSetId,
    groups,
    currentGroupIndex: groupIndex,
    results
  };

  return { ok: true };
}
