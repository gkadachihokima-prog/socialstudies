// features/history/history-service.js
//
// Phase2 Task16-1: QuestionSet・Attempt・AnswerRecordの「保存済みデータの取得」を
// 1箇所に統合するService（学習履歴取得サービス）。保存（save）は一切行わない、
// 取得（読み取り）専用のファサード。
//
// Repositoryへは一切直接アクセスしない。それぞれのドメインの既存Serviceが既に
// 「Repositoryへ直接アクセスするのはこのServiceだけ」という方針で作られているため
// （features/history/attempt-service.js・answer-record-service.js・
//  features/question-set/question-set-service.js）、本Serviceはそれらの読み取りAPIに
// そのまま委譲するだけとし、Repositoryアクセスの重複実装は一切行わない:
//   - attempt-service.js の loadAttempt() / loadAttemptsByStudent()
//   - answer-record-service.js の loadAnswerRecordsByAttempt()
//   - question-set/question-set-service.js の loadQuestionSet()
//
// これにより、UI（app.js）は各ドメインのServiceや、まして
// features/repository/配下・features/storage/配下を個別にimportする必要がなくなり、
// 学習履歴の取得はこのHistoryServiceだけを見れば済む構造にする
// （「UIやapp.jsはHistoryServiceだけを見る構造にする」というご指示のとおり）。
//
// 今回は取得のみ。保存処理（save系API）は一切追加しない。

import { loadAttempt, loadAttemptsByStudent } from "./attempt-service.js";
import { loadAnswerRecordsByAttempt } from "./answer-record-service.js";
import { loadQuestionSet } from "../question-set/question-set-service.js";

/**
 * 【取得】attemptIdでAttemptを1件取得する。
 * @param {string} attemptId
 * @returns {import("./attempt-model.js").Attempt|null}
 */
export function getAttempt(attemptId) {
  return loadAttempt(attemptId);
}

/**
 * 【取得】studentIdに紐づくAttempt一覧を取得する。
 * @param {string} studentId
 * @returns {Array<import("./attempt-model.js").Attempt>}
 */
export function getAttemptsByStudent(studentId) {
  return loadAttemptsByStudent(studentId);
}

/**
 * 【取得】attemptIdに紐づくAnswerRecord一覧を取得する。
 * @param {string} attemptId
 * @returns {Array<import("./answer-record-model.js").AnswerRecord>}
 */
export function getAnswerRecordsForAttempt(attemptId) {
  return loadAnswerRecordsByAttempt(attemptId);
}

/**
 * 【取得】Attemptが参照しているQuestionSetを取得する。
 * @param {import("./attempt-model.js").Attempt} attempt
 * @returns {import("../question-set/question-set-model.js").QuestionSet|null}
 */
export function getQuestionSetForAttempt(attempt) {
  if (!attempt?.questionSetId) return null;
  return loadQuestionSet(attempt.questionSetId);
}

/**
 * 【統合取得】1件のAttemptについて、QuestionSet・AnswerRecordを含めた詳細を取得する。
 * Attemptが存在しない場合はnullを返す。
 *
 * @param {string} attemptId
 * @returns {{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * } | null}
 */
export function getAttemptDetail(attemptId) {
  const attempt = getAttempt(attemptId);
  if (!attempt) return null;

  return {
    attempt,
    questionSet: getQuestionSetForAttempt(attempt),
    answerRecords: getAnswerRecordsForAttempt(attemptId)
  };
}

/**
 * 【統合取得】studentIdに紐づく全Attemptについて、それぞれのQuestionSet・AnswerRecordを
 * 含めた学習履歴一覧を取得する。
 *
 * @param {string} studentId
 * @returns {Array<{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * }>}
 */
export function getStudentHistory(studentId) {
  return getAttemptsByStudent(studentId).map((attempt) => ({
    attempt,
    questionSet: getQuestionSetForAttempt(attempt),
    answerRecords: getAnswerRecordsForAttempt(attempt.attemptId)
  }));
}

/**
 * 【キー抽出】学習履歴の1エントリ（{attempt, questionSet, answerRecords}）から、
 * 新しさの比較に使うキーを取り出す共通ヘルパー。
 * completedAt優先、無ければstartedAtを代用する（Attemptモデルにcreated Atは存在しないため、
 * 開始日時であるstartedAtを代用する）。どちらも無ければnull（比較対象外）を返す。
 *
 * findLatestHistoryEntry()・sortHistoryByRecency()の両方がこの1箇所のキー抽出ロジックのみを
 * 使う（Task16-2/16-3/16-4/16-5で比較・並び替えロジックを重複実装しない）。
 *
 * @param {{ attempt: import("./attempt-model.js").Attempt }} entry
 * @returns {string|null}
 */
function getRecencyKey(entry) {
  return entry?.attempt?.completedAt || entry?.attempt?.startedAt || null;
}

/**
 * 【比較】nullを許容するISO文字列2件を比較する共通プリミティブ。
 * null（比較対象外）は常に最も古い値として扱う。
 * sortHistoryByRecency()の並び替え・getMaxTimestamp()の最大値抽出の両方が、
 * この1箇所の比較ロジックのみを使う（Task16-2〜16-7で比較ロジックを重複実装しない）。
 *
 * @param {string|null} a
 * @param {string|null} b
 * @returns {number} aがbより古ければ負、新しければ正、同じなら0
 */
function compareTimestamps(a, b) {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/**
 * 【並び替え】学習履歴一覧を、getRecencyKey()のキーで新しい順（"desc"）または
 * 古い順（"asc"）に並び替える共通ヘルパー。
 * キーを持たないエントリ（比較対象外）は最も古いものとして扱い、"asc"では先頭、
 * "desc"では末尾に置かれる。比較自体はcompareTimestamps()に委譲する。
 *
 * @param {Array<{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * }>} history
 * @param {"asc"|"desc"} order
 * @returns {Array<{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * }>}
 */
function sortHistoryByRecency(history, order) {
  const ascending = [...history].sort((entryA, entryB) =>
    compareTimestamps(getRecencyKey(entryA), getRecencyKey(entryB))
  );

  return order === "asc" ? ascending : ascending.reverse();
}

/**
 * 【最大値抽出】学習履歴一覧の中から、指定したAttemptのタイムスタンプ項目
 * （"completedAt" | "startedAt"）の最新値のみを抽出する共通ヘルパー。
 * getStudiedFields()のlatestCompletedAt/latestStartedAt算出から利用する。
 * 比較はcompareTimestamps()に委譲する（sortHistoryByRecency()と同じ比較ロジックを再利用し、
 * 別の比較コードを持たない）。対象値を持つエントリが1件も無ければnullを返す。
 *
 * @param {Array<{ attempt: import("./attempt-model.js").Attempt }>} entries
 * @param {"completedAt"|"startedAt"} timestampField
 * @returns {string|null}
 */
function getMaxTimestamp(entries, timestampField) {
  return entries.reduce((max, entry) => {
    const value = entry?.attempt?.[timestampField] ?? null;
    return compareTimestamps(value, max) > 0 ? value : max;
  }, null);
}

/**
 * 【探索】学習履歴一覧（getStudentHistoryが返す配列と同じ形）の中から、
 * 最も新しいAttemptを含むエントリを1件探す共通ヘルパー。
 * summarizeHistory()・getLatestAttempt()の両方がこの1箇所にのみ実装された探索ロジックを
 * 利用する（Task16-2/16-3/16-4で重複実装しない）。比較・並び替え自体はsortHistoryByRecency()
 * （＝getRecencyKey()）に委譲し、別の比較ロジックを持たない。
 *
 * 比較対象（completedAt・startedAtのいずれか）を持つAttemptが1件も無ければnullを返す。
 *
 * @param {Array<{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * }>} history
 * @returns {{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * } | null}
 */
function findLatestHistoryEntry(history) {
  const latestFirst = sortHistoryByRecency(history, "desc");
  const latestEntry = latestFirst.find((entry) => getRecencyKey(entry) !== null);
  return latestEntry ?? null;
}

/**
 * 【集計】学習履歴一覧（getStudentHistoryが返す配列と同じ形）を集計する共通ヘルパー。
 * getStudentHistorySummary()・getStudentHistoryByField()の両方から呼ばれる集計ロジック本体
 * であり、集計処理の実装はここ1箇所にのみ存在する（重複実装しない）。
 * 最新Attemptの探索はfindLatestHistoryEntry()に委譲する。
 *
 * @param {Array<{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * }>} history
 * @returns {{
 *   attemptCount: number,
 *   completedAttemptCount: number,
 *   totalQuestions: number,
 *   answeredQuestions: number,
 *   correctAnswers: number,
 *   overallCorrectRate: number,
 *   latestAttempt: import("./attempt-model.js").Attempt|null,
 *   latestCompletedAt: string|null
 * }}
 */
function summarizeHistory(history) {
  let completedAttemptCount = 0;
  let totalQuestions = 0;
  let answeredQuestions = 0;
  let correctAnswers = 0;

  history.forEach(({ attempt, answerRecords }) => {
    if (attempt?.completed) {
      completedAttemptCount += 1;
    }

    totalQuestions += Number(attempt?.totalCount) || 0;

    const records = Array.isArray(answerRecords) ? answerRecords : [];
    answeredQuestions += records.length;
    correctAnswers += records.filter((record) => record?.isCorrect).length;
  });

  const overallCorrectRate = answeredQuestions > 0 ? correctAnswers / answeredQuestions : 0;
  const latestAttempt = findLatestHistoryEntry(history)?.attempt ?? null;

  return {
    attemptCount: history.length,
    completedAttemptCount,
    totalQuestions,
    answeredQuestions,
    correctAnswers,
    overallCorrectRate,
    latestAttempt,
    latestCompletedAt: latestAttempt?.completedAt ?? null
  };
}

/**
 * 【集計取得】studentIdに紐づく学習履歴（getStudentHistory）を元に、
 * 生徒の学習状況を集計したサマリーを取得する。
 *
 * Repository・Storage・AttemptServiceへは一切直接アクセスせず、本ファイル内の
 * 既存公開API（getStudentHistory）が返す情報のみから集計する（保存・生成は行わない）。
 * 集計処理自体はsummarizeHistory()に委譲する（getStudentHistoryByField()と共通化）。
 *
 * @param {string} studentId
 * @returns {{
 *   studentId: string,
 *   attemptCount: number,
 *   completedAttemptCount: number,
 *   totalQuestions: number,
 *   answeredQuestions: number,
 *   correctAnswers: number,
 *   overallCorrectRate: number,
 *   latestAttempt: import("./attempt-model.js").Attempt|null,
 *   latestCompletedAt: string|null
 * }}
 */
export function getStudentHistorySummary(studentId) {
  const history = getStudentHistory(studentId);

  return {
    studentId,
    ...summarizeHistory(history)
  };
}

/**
 * 【集計取得】studentIdに紐づく学習履歴のうち、指定したfieldId（例: japan_geo/world_geo/history）
 * のAttemptだけを抽出し、その一覧と集計サマリーを取得する。
 *
 * fieldIdはAttempt自体ではなくQuestionSet側が持つ情報のため（features/question-set/
 * question-set-model.js参照）、getStudentHistory()が返す各エントリのquestionSet.fieldIdで
 * 絞り込む。Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスせず、既存公開API（getStudentHistory）のみを使う。
 * 集計処理はgetStudentHistorySummary()と同じsummarizeHistory()に委譲する（コピペしない）。
 *
 * @param {string} studentId
 * @param {string} fieldId
 * @returns {{
 *   studentId: string,
 *   fieldId: string,
 *   attempts: Array<{
 *     attempt: import("./attempt-model.js").Attempt,
 *     questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *     answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 *   }>,
 *   summary: {
 *     attemptCount: number,
 *     completedAttemptCount: number,
 *     totalQuestions: number,
 *     answeredQuestions: number,
 *     correctAnswers: number,
 *     overallCorrectRate: number,
 *     latestAttempt: import("./attempt-model.js").Attempt|null,
 *     latestCompletedAt: string|null
 *   }
 * }}
 */
export function getStudentHistoryByField(studentId, fieldId) {
  const history = getStudentHistory(studentId);
  const attempts = history.filter((entry) => entry.questionSet?.fieldId === fieldId);

  return {
    studentId,
    fieldId,
    attempts,
    summary: summarizeHistory(attempts)
  };
}

/**
 * 【取得】studentIdに紐づく学習履歴（getStudentHistory）の中から、最新のAttemptDetailを
 * 1件取得する。「前回の続き」「最後に学習した単元」「おすすめ復習」等の機能から利用する想定。
 *
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスせず、既存公開API（getStudentHistory）のみを使う。
 * 最新Attemptの探索はsummarizeHistory()と同じfindLatestHistoryEntry()に委譲する
 * （探索ロジックの重複実装はしない）。
 *
 * @param {string} studentId
 * @returns {{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * } | null}
 */
export function getLatestAttempt(studentId) {
  const history = getStudentHistory(studentId);
  return findLatestHistoryEntry(history) ?? null;
}

/**
 * 【取得】studentIdに紐づく学習履歴のうち、completed===trueのAttemptに限定した
 * 最新のエントリを取得する（Phase4C-1: ホーム「前回学習」カードのタップ先解決専用）。
 *
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスせず、既存公開API（getStudentHistory）のみを使う。
 * 最新Attemptの探索はgetLatestAttempt()と同じfindLatestHistoryEntry()に委譲する
 * （探索・比較ロジックの重複実装はしない）。sourceTypeによる絞り込みは行わない
 * （normal/weak_review/dormant_review/testset/testset_reviewいずれもcompletedなら対象）。
 *
 * @param {string} studentId
 * @returns {{
 *   attempt: import("./attempt-model.js").Attempt,
 *   questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *   answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 * } | null}
 */
export function getLatestCompletedAttempt(studentId) {
  const history = getStudentHistory(studentId).filter((entry) => entry.attempt?.completed === true);
  return findLatestHistoryEntry(history) ?? null;
}

/**
 * 【一覧取得】studentIdに紐づく学習履歴（getStudentHistory）を、新しい順・古い順で
 * 並び替えた一覧として取得する。学習履歴画面・ランキング・生徒詳細画面等から利用する想定。
 *
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスせず、既存公開API（getStudentHistory）のみを使う。
 * 並び替えはgetLatestAttempt()と同じsortHistoryByRecency()（＝getRecencyKey()）に委譲し、
 * 比較ロジックを別途持たない。
 *
 * @param {string} studentId
 * @param {{ order?: "asc"|"desc", limit?: number }} [options]
 *   order省略時は"desc"（新しい順）。"asc"/"desc"以外はすべて"desc"として扱う。
 *   limitは数値のみ有効。未指定・数値以外の場合は全件を返す。
 * @returns {{
 *   studentId: string,
 *   totalCount: number,
 *   items: Array<{
 *     attempt: import("./attempt-model.js").Attempt,
 *     questionSet: import("../question-set/question-set-model.js").QuestionSet|null,
 *     answerRecords: Array<import("./answer-record-model.js").AnswerRecord>
 *   }>
 * }}
 */
export function getStudentHistoryList(studentId, options = {}) {
  const history = getStudentHistory(studentId);
  const order = options?.order === "asc" ? "asc" : "desc";
  const sorted = sortHistoryByRecency(history, order);

  const items = typeof options?.limit === "number" ? sorted.slice(0, Math.max(0, options.limit)) : sorted;

  return {
    studentId,
    totalCount: history.length,
    items
  };
}

/**
 * 【取得】studentIdに紐づく最新のAttempt（getLatestAttempt）から、最新に学習していた科目
 * （fieldId）に関する最小限の情報のみを取り出す。ホーム画面「前回の続き」「おすすめ復習」等、
 * Attempt・QuestionSetそのものではなく、この5項目だけを必要とする画面から利用する想定。
 *
 * getLatestAttempt(studentId)（Task16-4）のみを利用する（getStudentHistory()を直接呼ばない、
 * というご指示のとおり）。Repository・Storage・AttemptService・QuestionSetService・
 * AnswerRecordServiceへは一切直接アクセスしない。
 * 最新Attemptの探索・比較ロジックはgetLatestAttempt()内部（findLatestHistoryEntry()・
 * sortHistoryByRecency()・getRecencyKey()）に既に集約されており、本関数では比較ロジックを
 * 一切持たない。
 *
 * fieldIdはAttempt自体ではなくQuestionSet側の情報のため（features/question-set/
 * question-set-model.js参照）、QuestionSetが見つからない場合はfieldIdをnullにする
 * （getLatestField()自体がnullになるわけではない。Attemptが1件も見つからない場合のみ
 * 関数全体としてnullを返す）。versionはAttempt側が保持するquestionSetVersion
 * （その時点のQuestionSetのバージョンをAttemptが記録したもの）を返す。
 *
 * @param {string} studentId
 * @returns {{
 *   fieldId: string|null,
 *   questionSetId: string|null,
 *   version: number|null,
 *   completedAt: string|null,
 *   startedAt: string|null
 * } | null}
 */
export function getLatestField(studentId) {
  const latest = getLatestAttempt(studentId);
  if (!latest) return null;

  const { attempt, questionSet } = latest;

  return {
    fieldId: questionSet?.fieldId ?? null,
    questionSetId: attempt?.questionSetId ?? null,
    version: attempt?.questionSetVersion ?? null,
    completedAt: attempt?.completedAt ?? null,
    startedAt: attempt?.startedAt ?? null
  };
}

/**
 * 【一覧取得】studentIdに紐づく学習履歴（getStudentHistory）を、fieldId（例: japan_geo/
 * world_geo/history）ごとに集約した「学習済み科目一覧」を取得する。
 * ホーム画面・履歴画面・フィルター等、生徒がどの科目を学習済みかを一覧表示する画面から
 * 利用する想定。
 *
 * getStudentHistory(studentId)のみを利用する。Repository・Storage・AttemptService・
 * QuestionSetService・AnswerRecordServiceへは一切直接アクセスしない。
 * fieldIdはAttempt自体ではなくQuestionSet側の情報のため（features/question-set/
 * question-set-model.js参照）、questionSet.fieldIdが無いエントリ（QuestionSetが見つからない
 * Attempt）は集約対象から除外する（fieldId不明の科目集計は作れないため）。
 * 最新値の抽出はgetMaxTimestamp()（＝compareTimestamps()）に委譲し、
 * sortHistoryByRecency()と同じ比較ロジックを再利用する（重複実装しない）。
 *
 * @param {string} studentId
 * @returns {Array<{
 *   fieldId: string,
 *   attemptCount: number,
 *   latestCompletedAt: string|null,
 *   latestStartedAt: string|null
 * }>} fieldId昇順
 */
export function getStudiedFields(studentId) {
  const history = getStudentHistory(studentId);

  const entriesByField = new Map();
  history.forEach((entry) => {
    const fieldId = entry?.questionSet?.fieldId;
    if (!fieldId) return;

    if (!entriesByField.has(fieldId)) {
      entriesByField.set(fieldId, []);
    }
    entriesByField.get(fieldId).push(entry);
  });

  return Array.from(entriesByField.entries())
    .map(([fieldId, entries]) => ({
      fieldId,
      attemptCount: entries.length,
      latestCompletedAt: getMaxTimestamp(entries, "completedAt"),
      latestStartedAt: getMaxTimestamp(entries, "startedAt")
    }))
    .sort((a, b) => (a.fieldId < b.fieldId ? -1 : a.fieldId > b.fieldId ? 1 : 0));
}

/**
 * 【存在確認】studentIdに紐づくAttemptが1件以上存在するかどうかを返す。
 * 初回ログイン判定・ホーム画面・チュートリアル表示等から利用する想定。
 *
 * getStudentHistory(studentId)のみを利用し、その件数（length）を見るだけの薄い判定とする。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスせず、新たな探索・比較ロジックも持たない。
 *
 * @param {string} studentId
 * @returns {boolean}
 */
export function hasHistory(studentId) {
  return getStudentHistory(studentId).length > 0;
}

/**
 * 【日付切り出し】ISO日時文字列（例: "2026-08-05T00:00:00.000Z"）から日付部分
 * （"YYYY-MM-DD"）だけを取り出す共通ヘルパー。
 * @param {string} isoTimestamp
 * @returns {string}
 */
function getDatePart(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}

/**
 * 【取得】studentIdに紐づく学習履歴（getStudentHistory）を元に、学習した日付
 * （YYYY-MM-DD）の重複なし昇順一覧と、その件数（累計学習日数）を取得する。
 * ホーム画面・プロフィール・学習継続表示・連続学習日数計算の基礎として利用する想定。
 *
 * getStudentHistory(studentId)のみを利用する。Repository・Storage・AttemptService・
 * QuestionSetService・AnswerRecordServiceへは一切直接アクセスしない。
 *
 * 各Attemptの学習日は、getRecencyKey()（Task16-4で作成。completedAt優先、無ければ
 * startedAtを代用、どちらも無ければ比較対象外）が返すキーの日付部分とする。
 * これはこのタスクの「日付取得ルール」と完全に同じ優先順位のため、新たな比較ロジックを
 * 書かず、既存のgetRecencyKey()をそのまま再利用する。
 *
 * @param {string} studentId
 * @returns {{ totalStudyDays: number, studyDates: string[] }}
 */
export function getStudyDayCount(studentId) {
  const history = getStudentHistory(studentId);

  const dateSet = new Set();
  history.forEach((entry) => {
    const key = getRecencyKey(entry);
    if (!key) return;
    dateSet.add(getDatePart(key));
  });

  const studyDates = Array.from(dateSet).sort();

  return {
    totalStudyDays: studyDates.length,
    studyDates
  };
}

/**
 * 【取得】studentIdに紐づく最新の学習日（YYYY-MM-DD）を取得する。
 * ホーム画面・プロフィール・連続学習日数・最終学習表示等から利用する想定。
 *
 * getStudyDayCount(studentId)（Task16-9）のみを利用する。studyDatesは既に重複なし昇順の
 * 配列として得られるため、新たに学習履歴を探索せず、その末尾を取るだけで済ませる
 * （getStudentHistory()を直接呼ばない、というご指示のとおり）。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {string|null}
 */
export function getLatestStudyDate(studentId) {
  const { studyDates } = getStudyDayCount(studentId);
  if (studyDates.length === 0) return null;
  return studyDates[studyDates.length - 1];
}

/**
 * 【取得】studentIdに紐づく最初の学習日（YYYY-MM-DD）を取得する。
 * 利用開始日表示・学習期間・継続率等から利用する想定。
 *
 * getStudyDayCount(studentId)（Task16-9）のみを利用する。studyDatesは既に重複なし昇順の
 * 配列として得られるため、新たに学習履歴を探索せず、その先頭を取るだけで済ませる
 * （getStudentHistory()を直接呼ばない、というご指示のとおり）。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {string|null}
 */
export function getFirstStudyDate(studentId) {
  const { studyDates } = getStudyDayCount(studentId);
  if (studyDates.length === 0) return null;
  return studyDates[0];
}

/**
 * 【取得】studentIdに紐づく学習期間（最初の学習日・最新の学習日・累計学習日数）を
 * まとめて取得する。プロフィール・ダッシュボード・継続率表示・学習統計等から
 * 利用する想定。
 *
 * getFirstStudyDate(studentId)（Task16-11）・getLatestStudyDate(studentId)（Task16-10）・
 * getStudyDayCount(studentId)（Task16-9）のみを利用する。いずれも新たに学習履歴を探索せず、
 * 既存APIの結果をまとめるだけとする（getStudentHistory()を直接呼ばない、というご指示のとおり）。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {{ firstStudyDate: string|null, latestStudyDate: string|null, totalStudyDays: number }}
 */
export function getStudyPeriod(studentId) {
  return {
    firstStudyDate: getFirstStudyDate(studentId),
    latestStudyDate: getLatestStudyDate(studentId),
    totalStudyDays: getStudyDayCount(studentId).totalStudyDays
  };
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 【日付変換】"YYYY-MM-DD"形式の日付文字列を、UTC基準の日数比較に使えるタイムスタンプ
 * （ミリ秒）に変換する共通ヘルパー。タイムゾーンによるズレを避けるためDate.UTC()を使う。
 * @param {string} dateOnly - "YYYY-MM-DD"
 * @returns {number}
 */
function toUtcDayTimestamp(dateOnly) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * 【取得】studentIdに紐づく連続学習日数（currentStreak）と最新学習日を取得する。
 * ホーム画面・プロフィール・連続学習表示・バッジ等から利用する想定。
 *
 * getStudyDayCount(studentId)（Task16-9）のみを利用する。studyDatesが重複なし昇順の
 * "YYYY-MM-DD"配列であることを前提に、末尾（最新日）から1件ずつ前日と比較し、
 * ちょうど1日差が続く限り連続日数を積み上げる。1日でも空けば打ち切る
 * （getStudentHistory()を直接呼ばない、というご指示のとおり）。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {{ currentStreak: number, latestStudyDate: string|null }}
 */
export function getCurrentStudyStreak(studentId) {
  const { studyDates } = getStudyDayCount(studentId);

  if (studyDates.length === 0) {
    return { currentStreak: 0, latestStudyDate: null };
  }

  let currentStreak = 1;
  for (let i = studyDates.length - 1; i > 0; i--) {
    const diffDays = (toUtcDayTimestamp(studyDates[i]) - toUtcDayTimestamp(studyDates[i - 1])) / MILLISECONDS_PER_DAY;
    if (diffDays !== 1) break;
    currentStreak += 1;
  }

  return {
    currentStreak,
    latestStudyDate: studyDates[studyDates.length - 1]
  };
}

/**
 * 【取得】studentIdに紐づく最新学習日と、todayから見た経過日数（日単位）を取得する。
 * ホーム画面・ダッシュボード・学習継続通知等から利用する想定。
 *
 * getLatestStudyDate(studentId)（Task16-10）のみを利用する（getStudentHistory()を直接
 * 呼ばない、というご指示のとおり）。日付の正規化・比較は、既存のgetDatePart()
 * （Task16-9でISO文字列から"YYYY-MM-DD"を切り出す用途に作成済み）とtoUtcDayTimestamp()
 * （Task16-13でUTC日単位のタイムスタンプに変換する用途に作成済み）をそのまま再利用し、
 * 新しい日付変換ロジックは持たない。todayもgetDatePart(today.toISOString())で
 * "YYYY-MM-DD"化した上でtoUtcDayTimestamp()に通し、latestStudyDateと同じUTC日単位で比較する。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @param {Date} [today] - 省略時は現在時刻
 * @returns {{ latestStudyDate: string|null, daysSinceLastStudy: number|null }}
 */
export function getDaysSinceLastStudy(studentId, today = new Date()) {
  const latestStudyDate = getLatestStudyDate(studentId);

  if (!latestStudyDate) {
    return { latestStudyDate: null, daysSinceLastStudy: null };
  }

  const todayTimestamp = toUtcDayTimestamp(getDatePart(today.toISOString()));
  const latestTimestamp = toUtcDayTimestamp(latestStudyDate);
  const daysSinceLastStudy = Math.round((todayTimestamp - latestTimestamp) / MILLISECONDS_PER_DAY);

  return { latestStudyDate, daysSinceLastStudy };
}

/**
 * 【概要取得】studentIdに紐づく学習状況の主要情報をまとめて取得する。
 * ホーム画面・プロフィール・ダッシュボードは、このAPIだけを呼べば主要情報を
 * 取得できるようにするための統合窓口。
 *
 * hasHistory()（Task16-8）・getStudyPeriod()（Task16-12）・getCurrentStudyStreak()
 * （Task16-13）・getDaysSinceLastStudy()（Task16-14）のみを利用する。いずれも新たに
 * 学習履歴を探索せず、既存APIの結果をまとめるだけとする（getStudentHistory()を
 * 直接呼ばない、というご指示のとおり）。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {{
 *   hasHistory: boolean,
 *   firstStudyDate: string|null,
 *   latestStudyDate: string|null,
 *   totalStudyDays: number,
 *   currentStudyStreak: number,
 *   daysSinceLastStudy: number|null
 * }}
 */
export function getHistoryOverview(studentId) {
  const studyPeriod = getStudyPeriod(studentId);

  return {
    hasHistory: hasHistory(studentId),
    firstStudyDate: studyPeriod.firstStudyDate,
    latestStudyDate: studyPeriod.latestStudyDate,
    totalStudyDays: studyPeriod.totalStudyDays,
    currentStudyStreak: getCurrentStudyStreak(studentId).currentStreak,
    daysSinceLastStudy: getDaysSinceLastStudy(studentId).daysSinceLastStudy
  };
}

/**
 * 【ダッシュボード取得】studentIdに紐づく学習履歴トップページ用の情報を一括取得する。
 * 今後のホーム画面・マイページは、このAPIだけ取得すれば必要情報を一括表示できるように
 * するための統合窓口。
 *
 * getHistoryOverview()（Task16-15）・getStudiedFields()（Task16-7）・
 * getLatestAttempt()（Task16-4）のみを利用する。いずれも新たに学習履歴を探索せず、
 * 既存APIの結果をまとめるだけとする（getStudentHistory()を直接呼ばない、という
 * ご指示のとおり）。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {{
 *   overview: ReturnType<typeof getHistoryOverview>,
 *   studiedFields: ReturnType<typeof getStudiedFields>,
 *   latestAttempt: ReturnType<typeof getLatestAttempt>
 * }}
 */
export function getHistoryDashboard(studentId) {
  return {
    overview: getHistoryOverview(studentId),
    studiedFields: getStudiedFields(studentId),
    latestAttempt: getLatestAttempt(studentId)
  };
}

/**
 * 【科目別ダッシュボード取得】studentIdに紐づく、指定したfieldIdだけの学習状況を
 * 1回の取得でまとめる。ホーム画面から科目を選択した際に利用する想定。
 *
 * getStudentHistoryByField()（Task16-3）・getLatestAttempt()（Task16-4）のみを利用する。
 * いずれも新たに学習履歴を探索せず、既存APIの結果をまとめるだけとする
 * （getStudentHistory()を直接呼ばない、というご指示のとおり）。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * latestAttemptは、getLatestAttempt(studentId)（全科目を通じた最新Attempt）が
 * 指定したfieldIdのものである場合のみ返し、別科目の場合はnullにする
 * （「その科目だけ」の最新Attemptではなく、全科目中の最新が対象科目と一致するかどうかの判定）。
 *
 * @param {string} studentId
 * @param {string} fieldId
 * @returns {{
 *   fieldId: string,
 *   summary: ReturnType<typeof getStudentHistoryByField>["summary"],
 *   latestAttempt: ReturnType<typeof getLatestAttempt>|null
 * }}
 */
export function getFieldDashboard(studentId, fieldId) {
  const { summary } = getStudentHistoryByField(studentId, fieldId);
  const latest = getLatestAttempt(studentId);
  const latestAttempt = latest?.questionSet?.fieldId === fieldId ? latest : null;

  return {
    fieldId,
    summary,
    latestAttempt
  };
}

/**
 * 【複数科目ダッシュボード一括取得】studentIdに紐づく、指定した複数fieldIdぶんの
 * 科目別ダッシュボード（getFieldDashboard）をまとめて取得する。
 * ホーム画面・マイページで各科目カードをまとめて取得する用途を想定。
 *
 * getFieldDashboard()（Task16-17）のみを利用する。fieldIdsを渡された順番のまま
 * 1件ずつgetFieldDashboard(studentId, fieldId)へ委譲するだけで、新たな学習履歴探索・
 * ソート・フィルタ・加工は一切行わない（getStudentHistory()を直接呼ばない、という
 * ご指示のとおり）。
 * Repository・Storage・AttemptService・QuestionSetService・AnswerRecordServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @param {string[]} fieldIds
 * @returns {Array<ReturnType<typeof getFieldDashboard>>} fieldIdsと同じ順序
 */
export function getFieldDashboards(studentId, fieldIds) {
  return fieldIds.map((fieldId) => getFieldDashboard(studentId, fieldId));
}
