// features/home/home-service.js
//
// Phase2 Task17-1: ホーム画面が必要とする情報を取得するためのFacade Service。
// HistoryServiceが既に「学習履歴に関する情報を取得するにはHistoryServiceだけを見れば済む」
// 構造を完成させているため、HomeServiceはそれをそのまま利用するだけの薄いラッパーとする。
//
// 使用するのは features/history/history-service.js の getHistoryDashboard() のみ
// （Repository・Storage・AttemptService・AnswerRecordService・QuestionSetServiceへは
// 一切直接アクセスしない）。今回はUI（app.js）とは接続しない。
//
// 今後、student（生徒プロフィール）・ranking（ランキング）・notifications（通知）・
// weakQuestions（苦手問題）等がHomeServiceの返り値に追加されていく想定のため、
// 返り値は { historyDashboard } という単一キーの構造を維持し、後続タスクで
// 既存キーの形を変えずにキーを追加していけるようにする。

import {
  getHistoryDashboard,
  getHistoryOverview,
  getLatestAttempt,
  getLatestCompletedAttempt,
  getStudyPeriod,
  getCurrentStudyStreak,
  getStudiedFields,
  getFieldDashboards
} from "../history/history-service.js";
import { getWeakDashboard } from "../weakness/weakness-service.js";

/**
 * 【取得】ホーム画面が必要とする情報をまとめて取得する。
 * 今回はHistoryServiceのgetHistoryDashboard()をそのまま返すだけ。
 *
 * @param {string} studentId
 * @returns {{ historyDashboard: ReturnType<typeof getHistoryDashboard> }}
 */
export function getHomeData(studentId) {
  return {
    historyDashboard: getHistoryDashboard(studentId)
  };
}

/**
 * 【取得】ホーム画面上部の概要表示（学習履歴概要・最後の学習）だけをまとめて取得する。
 * ホーム画面は、上部の概要表示にはこのAPIだけを取得すれば済むようにする想定。
 *
 * getHistoryOverview()・getLatestAttempt()・getLatestCompletedAttempt()
 * （いずれもfeatures/history/history-service.js）のみを利用する。getHistoryDashboard()・
 * getHomeData()は経由せず、新しい探索処理も書かない。
 * Repository・Storage・AttemptService・AnswerRecordService・QuestionSetServiceへは
 * 一切直接アクセスしない。
 *
 * Phase4C-1: latestCompletedAttemptは「前回学習」カードのタップ先解決専用
 * （既存latestAttemptの表示テキストは変更しない、completed問わず従来どおり）。
 *
 * @param {string} studentId
 * @returns {{
 *   historyOverview: ReturnType<typeof getHistoryOverview>,
 *   latestAttempt: ReturnType<typeof getLatestAttempt>,
 *   latestCompletedAttempt: ReturnType<typeof getLatestCompletedAttempt>
 * }}
 */
export function getHomeOverview(studentId) {
  return {
    historyOverview: getHistoryOverview(studentId),
    latestAttempt: getLatestAttempt(studentId),
    latestCompletedAttempt: getLatestCompletedAttempt(studentId)
  };
}

/**
 * 【取得】ホーム画面で使う学習日数情報（学習期間・連続学習日数）だけをまとめて取得する。
 *
 * getStudyPeriod()・getCurrentStudyStreak()（いずれもfeatures/history/history-service.js）
 * のみを利用する。それ以外のHistoryService APIは呼ばず、新しい集計処理も書かない。
 * Repository・Storage・AttemptService・AnswerRecordService・QuestionSetServiceへは
 * 一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {{
 *   studyPeriod: ReturnType<typeof getStudyPeriod>,
 *   studyStreak: ReturnType<typeof getCurrentStudyStreak>
 * }}
 */
export function getHomeStudyInfo(studentId) {
  return {
    studyPeriod: getStudyPeriod(studentId),
    studyStreak: getCurrentStudyStreak(studentId)
  };
}

/**
 * 【取得】ホーム画面で使う科目一覧（学習済み科目一覧・科目別ダッシュボード一覧）だけを
 * まとめて取得する。
 *
 * getStudiedFields()・getFieldDashboards()（いずれもfeatures/history/history-service.js）
 * のみを利用する。それ以外のHistoryService APIは呼ばず、新しい集計処理も書かない。
 * Repository・Storage・AttemptService・AnswerRecordService・QuestionSetServiceへは
 * 一切直接アクセスしない。
 *
 * getFieldDashboards()は現在studentIdに加えてfieldIds（対象科目のfieldId配列）を
 * 引数に取る実装のため、getStudiedFields(studentId)で得たfieldId一覧をそのまま
 * fieldIdsとして渡す（新しい集計・絞り込みロジックではなく、既存の返り値から
 * fieldId値を取り出して引き継ぐだけの委譲）。
 *
 * @param {string} studentId
 * @returns {{
 *   studiedFields: ReturnType<typeof getStudiedFields>,
 *   fieldDashboards: ReturnType<typeof getFieldDashboards>
 * }}
 */
export function getHomeFields(studentId) {
  const studiedFields = getStudiedFields(studentId);

  return {
    studiedFields,
    fieldDashboards: getFieldDashboards(studentId, studiedFields.map((field) => field.fieldId))
  };
}

/**
 * 【取得】ホーム画面全体が必要とする情報を1回でまとめて取得する。
 *
 * 既存のHomeService公開API（getHomeOverview()・getHomeStudyInfo()・getHomeFields()・
 * getHomeData()）のみを組み合わせるだけで、HistoryServiceを直接importしない
 * （HomeServiceは画面用Facadeであり、HistoryServiceを組み合わせるだけ・独自集計は
 * 禁止、という設計方針のとおり）。Repository・Storageへは一切直接アクセスしない。
 *
 * Task19-2でWeaknessService由来のweaknessキーを追加した。既存のoverview/studyInfo/
 * fields/historyDashboardキーの意味・構造は変更していない。
 *
 * @param {string} studentId
 * @returns {{
 *   overview: ReturnType<typeof getHomeOverview>,
 *   studyInfo: ReturnType<typeof getHomeStudyInfo>,
 *   fields: ReturnType<typeof getHomeFields>,
 *   historyDashboard: ReturnType<typeof getHomeData>["historyDashboard"],
 *   weakness: ReturnType<typeof getHomeWeakness>
 * }}
 */
export function getHomeDashboard(studentId) {
  return {
    overview: getHomeOverview(studentId),
    studyInfo: getHomeStudyInfo(studentId),
    fields: getHomeFields(studentId),
    historyDashboard: getHomeData(studentId).historyDashboard,
    weakness: getHomeWeakness(studentId)
  };
}

/**
 * 【取得】ホーム画面初期表示に必要な情報を1回でまとめて取得する。
 * 画面起動時はこのAPIだけ取得すれば済むようにするための窓口。
 *
 * getHomeDashboard()のみを利用する。HistoryServiceは直接importせず、新しい集計処理も
 * 一切書かない。Repository・Storageへは一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {{ dashboard: ReturnType<typeof getHomeDashboard> }}
 */
export function getHomeInitialData(studentId) {
  return {
    dashboard: getHomeDashboard(studentId)
  };
}

/**
 * 【取得】HomeServiceが提供する画面向けセクション一覧をまとめて取得する。
 * 将来app.jsやUI側は、このAPIだけを見ればHomeServiceが提供する入口を把握できる状態にする。
 *
 * getHomeOverview()・getHomeStudyInfo()・getHomeFields()・getHomeDashboard()・
 * getHomeWeakness()のみを利用する。HistoryServiceは直接importせず、新しい集計処理も
 * 一切書かない。Repository・Storageへは一切直接アクセスしない。
 *
 * Task19-3でWeaknessService由来のweaknessキーを追加した。既存のoverview/studyInfo/
 * fields/dashboardキーの意味・構造は変更していない。
 *
 * @param {string} studentId
 * @returns {{
 *   overview: ReturnType<typeof getHomeOverview>,
 *   studyInfo: ReturnType<typeof getHomeStudyInfo>,
 *   fields: ReturnType<typeof getHomeFields>,
 *   dashboard: ReturnType<typeof getHomeDashboard>,
 *   weakness: ReturnType<typeof getHomeWeakness>
 * }}
 */
export function getAvailableHomeSections(studentId) {
  return {
    overview: getHomeOverview(studentId),
    studyInfo: getHomeStudyInfo(studentId),
    fields: getHomeFields(studentId),
    dashboard: getHomeDashboard(studentId),
    weakness: getHomeWeakness(studentId)
  };
}

/**
 * 【存在確認】studentIdに紐づく学習履歴が存在するかどうかを返す。
 *
 * getHomeOverview()のみを利用する。新しい集計処理は書かない。
 *
 * @param {string} studentId
 * @returns {boolean}
 */
export function hasHomeData(studentId) {
  const { historyOverview } = getHomeOverview(studentId);
  return historyOverview.hasHistory;
}

/**
 * 【取得】studentIdに紐づく最新のAttemptDetailを取得する。
 *
 * getHomeOverview()のみを利用する。新しい集計処理は書かない。
 *
 * @param {string} studentId
 * @returns {ReturnType<typeof getHomeOverview>["latestAttempt"]}
 */
export function getHomeLatestAttempt(studentId) {
  const { latestAttempt } = getHomeOverview(studentId);
  return latestAttempt;
}

/**
 * 【取得】studentIdに紐づく学習済み科目一覧（fieldId単位の集計配列）を取得する。
 *
 * getHomeFields()のみを利用する。新しい集計処理は書かない。
 *
 * @param {string} studentId
 * @returns {ReturnType<typeof getHomeFields>["studiedFields"]}
 */
export function getHomeFieldList(studentId) {
  const { studiedFields } = getHomeFields(studentId);
  return studiedFields;
}

/**
 * 【取得】studentIdに紐づく科目別ダッシュボード一覧を取得する。
 *
 * getHomeFields()のみを利用する。新しい集計処理は書かない。
 *
 * @param {string} studentId
 * @returns {ReturnType<typeof getHomeFields>["fieldDashboards"]}
 */
export function getHomeFieldDashboards(studentId) {
  const { fieldDashboards } = getHomeFields(studentId);
  return fieldDashboards;
}

/**
 * 【取得】ホーム画面上部の概要表示に使う情報（履歴有無・最新Attempt・学習日数情報）を
 * まとめて取得する。
 *
 * hasHomeData()・getHomeLatestAttempt()・getHomeStudyInfo()のみを利用する。
 * HistoryServiceは直接importせず、新しい集計処理も一切書かない。
 * Repository・Storageへは一切直接アクセスしない。
 *
 * @param {string} studentId
 * @returns {{
 *   hasHomeData: ReturnType<typeof hasHomeData>,
 *   latestAttempt: ReturnType<typeof getHomeLatestAttempt>,
 *   studyInfo: ReturnType<typeof getHomeStudyInfo>
 * }}
 */
export function getHomeOverviewData(studentId) {
  return {
    hasHomeData: hasHomeData(studentId),
    latestAttempt: getHomeLatestAttempt(studentId),
    studyInfo: getHomeStudyInfo(studentId)
  };
}

/**
 * 【取得】ホーム画面で使う苦手問題情報をまとめて取得する。
 *
 * WeaknessServiceのgetWeakDashboard()のみを利用する（getWeakSummary()・
 * getWeakQuestions()・hasWeakQuestions()は直接呼ばない）。新しい集計処理は書かない。
 * Repository・Storageへは一切直接アクセスしない。HistoryServiceへの新規直接依存も追加しない。
 *
 * @param {string} studentId
 * @returns {{ weakDashboard: ReturnType<typeof getWeakDashboard> }}
 */
export function getHomeWeakness(studentId) {
  return {
    weakDashboard: getWeakDashboard(studentId)
  };
}
