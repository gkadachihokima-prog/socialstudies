// features/history/attempt-model.js
//
// 参照: docs/specification/domain-model-v1.md 3.11節（Attempt）
//
// Attemptは「1回のクイズ実施全体」を表すモデル。questionSetId/questionSetVersionを
// 保持し、features/question-set/question-set-model.js のQuestionSetを一方向に参照する
// （Attempt → QuestionSet）。QuestionSet側はAttemptの存在を一切知らず、
// QuestionSet一覧やAttempt数をQuestionSet側で保持することもしない
// （双方向参照・循環依存を避けるための確定方針）。
//
// 同様に、Attemptは./answer-record-model.js のAnswerRecordを一方向に参照する
// （Attempt → AnswerRecord）。AnswerRecord側はAttemptの存在を一切知らない。
// 依存の向きは QuestionSet → Attempt → AnswerRecord の一方向のみを維持する。
//
// 責務分担: Attemptは「Attempt全体・解答一覧・件数・進捗」を扱い、
// AnswerRecordは「1問分の解答情報」のみを持つ（集計・関係管理はAttempt側の責務）。
//
// 今回のタスクでは、GAS通信・履歴保存・実際のstudentId利用は開始しない
// （モデルの形と最小限の判定関数を定義するのみ）。

/**
 * @typedef {Object} Attempt
 * @property {string} attemptId - クライアント発行の一意なID
 * @property {string} studentId - 生徒ID（features/student/student-model.js の StudentRef.studentId に対応）
 * @property {string} questionSetId - 問題セットID
 * @property {number|null} questionSetVersion - 問題セットのバージョン
 * @property {string|null} startedAt - 開始日時（ISO文字列。未開始はnull）
 * @property {string|null} completedAt - 完了日時（ISO文字列。未完了はnull）
 * @property {boolean} completed - 完了したか（途中終了はfalseのまま）
 * @property {number} score - 正解数
 * @property {number} totalCount - 出題数
 * @property {number|null} rawTimeSeconds - ペナルティを含まない実測タイム
 * @property {number|null} penalizedTimeSeconds - ペナルティ込みタイム
 * @property {string|null} sourceType - Attemptの起点（`normal`/`weak_review`/`dormant_review`/`testset`、
 *   Phase5-6で追加。省略時・旧データはnull＝起点不明として扱う。domain-model-v1.md 3.11.1節参照）
 * @property {string|null} testSetId - `sourceType==="testset"`のときのみ値を持つ、それ以外はnull
 * @property {string[]|null} initialWrongQuestionIds - そのAttemptの通常ラウンド（retryMode===false の間）で
 *   一度でも isCorrect!==true となった問題のquestionId配列（Phase3D-2前提で追加）。retry結果で書き換えない。
 *   null＝情報が記録されていない（旧Attempt・GAS側で列が空欄）、[]＝記録済みで誤答0件、を明確に区別する。
 */

import { toTrimmedString, toBooleanFlag, toNullableNumber } from "../common/field-helpers.js";
import { generateAttemptId } from "../common/id-utils.js";
import { getQuestionCount } from "../question-set/question-set-model.js";
import { createAnswerRecord, getAnswerRecordKey } from "./answer-record-model.js";

/**
 * questionId配列を正規化する（Attempt.initialWrongQuestionIds専用、Phase3D-2前提）。
 * 非配列・非文字列（undefined/null含む）はnull（情報不明）として扱い、[]や機械的な補完はしない。
 * 文字列を受け取った場合は、GAS側getStudentHistoryが返す生セル値（JSON配列文字列、または
 * 未記録を表す空文字列）としてJSON.parseを試みる（不正なJSONもnull＝情報不明として扱い、
 * 例外は投げない。既存の他フィールド正規化関数と同じ「壊れた入力はnullへ落とす」方針）。
 * 配列の場合は、trim後に空文字要素を除外し、最初に出現した順序を保持したまま重複を除去する。
 *
 * @param {unknown} input
 * @returns {string[]|null}
 */
export function normalizeQuestionIdList(input) {
  let candidate = input;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    try {
      candidate = JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  }

  if (!Array.isArray(candidate)) return null;

  const seen = new Set();
  const result = [];
  candidate.forEach((id) => {
    const trimmedId = toTrimmedString(id);
    if (!trimmedId || seen.has(trimmedId)) return;
    seen.add(trimmedId);
    result.push(trimmedId);
  });
  return result;
}

/**
 * @param {Partial<Attempt>} [input]
 * @returns {Attempt}
 */
export function createAttempt(input = {}) {
  return {
    attemptId: toTrimmedString(input.attemptId) || generateAttemptId(),
    studentId: toTrimmedString(input.studentId),
    questionSetId: toTrimmedString(input.questionSetId),
    questionSetVersion: toNullableNumber(input.questionSetVersion),
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    completed: toBooleanFlag(input.completed),
    score: toNullableNumber(input.score) ?? 0,
    totalCount: toNullableNumber(input.totalCount) ?? 0,
    rawTimeSeconds: toNullableNumber(input.rawTimeSeconds),
    penalizedTimeSeconds: toNullableNumber(input.penalizedTimeSeconds),
    sourceType: input.sourceType ?? null,
    testSetId: input.testSetId ?? null,
    initialWrongQuestionIds: normalizeQuestionIdList(input.initialWrongQuestionIds)
  };
}

/**
 * 完了判定（設計書 ranking-spec-v1.md 2.1節「完了判定」に対応）。
 * @param {Attempt} attempt
 * @returns {boolean}
 */
export function isAttemptCompleted(attempt) {
  return Boolean(attempt && attempt.completed);
}

/**
 * AttemptがQuestionSetを正しく参照しているかどうかを検証する（関係の整合性のみ）。
 *
 * QuestionSetモデルの validateQuestionSet() とは責務が異なる点に注意:
 *   - validateQuestionSet(): QuestionSet単体の妥当性（必須項目・coursePurposeId・fieldId・
 *     questionIdsの非空・versionの形式など）を検証する。Attemptの存在を前提としない。
 *   - checkAttemptQuestionSetConsistency()（本関数）: 既にAttemptとQuestionSetの両方が
 *     存在する場合に、AttemptのquestionSetId/questionSetVersionが指しているQuestionSetと
 *     実際に一致しているかという「関係」のみを検証する。QuestionSet自体が妥当かどうかは見ない。
 *
 * @param {Attempt} attempt
 * @param {import("../question-set/question-set-model.js").QuestionSet} questionSet
 * @returns {{ consistent: boolean, errors: string[] }}
 */
export function checkAttemptQuestionSetConsistency(attempt, questionSet) {
  const errors = [];

  if (!attempt?.questionSetId) {
    errors.push("Attemptにquestion SetIdが設定されていません。");
  } else if (!questionSet?.questionSetId) {
    errors.push("比較対象のQuestionSetにquestionSetIdがありません。");
  } else if (attempt.questionSetId !== questionSet.questionSetId) {
    errors.push(
      `AttemptのquestionSetId="${attempt.questionSetId}"が、QuestionSetのquestionSetId="${questionSet.questionSetId}"と一致しません。`
    );
  }

  if (attempt?.questionSetVersion == null) {
    errors.push("Attemptにquestion SetVersionが設定されていません。");
  } else if (questionSet?.version == null) {
    errors.push("比較対象のQuestionSetにversionがありません。");
  } else if (attempt.questionSetVersion !== questionSet.version) {
    errors.push(
      `AttemptのquestionSetVersion=${attempt.questionSetVersion}が、QuestionSetのversion=${questionSet.version}と一致しません。`
    );
  }

  return { consistent: errors.length === 0, errors };
}

/**
 * 指定したQuestionSetに紐づくAttemptを生成する便利関数。
 * questionSetId/questionSetVersion/totalCountをQuestionSetから自動的に引き継ぐことで、
 * 手入力による転記ミス（バージョン不一致など）を構造的に防ぐ。
 * QuestionSet自体の妥当性チェック（validateQuestionSet）はここでは行わない。呼び出し側が
 * 必要に応じて別途 validateQuestionSet() を使うこと（責務を分離するため意図的に呼び出さない）。
 *
 * @param {import("../question-set/question-set-model.js").QuestionSet} questionSet
 * @param {Partial<Attempt>} [overrides] - studentId等、QuestionSet由来ではない項目
 * @returns {Attempt}
 */
export function createAttemptForQuestionSet(questionSet, overrides = {}) {
  return createAttempt({
    ...overrides,
    questionSetId: questionSet?.questionSetId,
    questionSetVersion: questionSet?.version,
    totalCount: getQuestionCount(questionSet)
  });
}

// ---------------------------------------------------------------------------
// Attempt ⇄ AnswerRecord（Attempt → AnswerRecordの一方向のみ）
// ---------------------------------------------------------------------------

/**
 * 【生成】指定したAttemptに紐づくAnswerRecordを生成する便利関数。
 * attemptId/studentIdをAttemptから自動的に引き継ぎ、転記ミスを防ぐ
 * （createAttemptForQuestionSet()と同じ考え方）。
 *
 * @param {Attempt} attempt
 * @param {Partial<import("./answer-record-model.js").AnswerRecord>} [answerInput] - questionId等、Attempt由来ではない項目
 * @returns {import("./answer-record-model.js").AnswerRecord}
 */
export function createAnswerRecordForAttempt(attempt, answerInput = {}) {
  return createAnswerRecord({
    ...answerInput,
    attemptId: attempt?.attemptId,
    studentId: attempt?.studentId
  });
}

/**
 * 【取得】渡されたAnswerRecord群の中から、指定したAttemptに属するものだけを絞り込む。
 * AnswerRecordの永続化・検索先（Sheets等）は未実装のため、呼び出し側が保持する配列を渡す形とする。
 *
 * @param {Attempt} attempt
 * @param {import("./answer-record-model.js").AnswerRecord[]} answerRecords
 * @returns {import("./answer-record-model.js").AnswerRecord[]}
 */
export function getAnswerRecordsForAttempt(attempt, answerRecords) {
  if (!Array.isArray(answerRecords)) return [];
  return answerRecords.filter((record) => record?.attemptId === attempt?.attemptId);
}

/**
 * 【検証】単一のAnswerRecordが、指定したAttemptに正しく属しているかを検証する（関係の整合性のみ）。
 * AnswerRecord自体のフィールド形式の妥当性はanswer-record-model.js側の責務であり、ここでは扱わない
 * （checkAttemptQuestionSetConsistency()と同じ責務分離の考え方）。
 *
 * @param {import("./answer-record-model.js").AnswerRecord} answerRecord
 * @param {Attempt} attempt
 * @returns {{ consistent: boolean, errors: string[] }}
 */
export function checkAnswerRecordBelongsToAttempt(answerRecord, attempt) {
  const errors = [];

  if (!answerRecord?.attemptId) {
    errors.push("AnswerRecordにattemptIdが設定されていません。");
  } else if (!attempt?.attemptId) {
    errors.push("比較対象のAttemptにattemptIdがありません。");
  } else if (answerRecord.attemptId !== attempt.attemptId) {
    errors.push(
      `AnswerRecordのattemptId="${answerRecord.attemptId}"が、AttemptのattemptId="${attempt.attemptId}"と一致しません。`
    );
  }

  if (answerRecord?.studentId && attempt?.studentId && answerRecord.studentId !== attempt.studentId) {
    errors.push(
      `AnswerRecordのstudentId="${answerRecord.studentId}"が、AttemptのstudentId="${attempt.studentId}"と一致しません。`
    );
  }

  return { consistent: errors.length === 0, errors };
}

/**
 * 【検証】AnswerRecord群全体の整合性を検証する。
 * 各レコードの所属確認（checkAnswerRecordBelongsToAttempt）に加え、
 * questionId重複（同じ問題への複数回答の混入）と、Attemptのtotal Countを超える件数が
 * 無いかをチェックする。
 *
 * @param {Attempt} attempt
 * @param {import("./answer-record-model.js").AnswerRecord[]} answerRecords
 * @returns {{ consistent: boolean, errors: string[] }}
 */
export function validateAnswerRecordsForAttempt(attempt, answerRecords) {
  const errors = [];
  const list = Array.isArray(answerRecords) ? answerRecords : [];
  const seenKeys = new Set();

  list.forEach((record) => {
    const { consistent, errors: relationErrors } = checkAnswerRecordBelongsToAttempt(record, attempt);
    if (!consistent) {
      errors.push(...relationErrors);
    }

    const key = getAnswerRecordKey(record);
    if (seenKeys.has(key)) {
      errors.push(`questionId="${record?.questionId}"の解答が重複しています。`);
    }
    seenKeys.add(key);
  });

  if (attempt?.totalCount && list.length > attempt.totalCount) {
    errors.push(`AnswerRecordの件数(${list.length})がAttemptのtotalCount(${attempt.totalCount})を超えています。`);
  }

  return { consistent: errors.length === 0, errors };
}

/**
 * 【補助】Attemptの進捗状況を算出する。
 * 「Attempt全体・解答一覧・件数・進捗」というAttempt側の責務に対応する集計処理であり、
 * AnswerRecord側には持たせない。
 *
 * @param {Attempt} attempt
 * @param {import("./answer-record-model.js").AnswerRecord[]} answerRecords
 * @returns {{ answeredCount: number, correctCount: number, totalCount: number, remainingCount: number }}
 */
export function calculateAttemptProgress(attempt, answerRecords) {
  const relevant = getAnswerRecordsForAttempt(attempt, answerRecords);
  const answeredCount = relevant.length;
  const correctCount = relevant.filter((record) => record?.isCorrect).length;
  const totalCount = Number(attempt?.totalCount) || 0;

  return {
    answeredCount,
    correctCount,
    totalCount,
    remainingCount: Math.max(totalCount - answeredCount, 0)
  };
}
