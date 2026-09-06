// features/history/history-renderer.js
//
// Phase2 Task23-1〜23-3: 学習履歴詳細画面（history-screen）のDOM描画専用モジュール。
// HistoryServiceへの入口はgetHistoryScreenData(studentId)（本ファイル内の非公開関数）
// の1つに集約し、それ以外の箇所からHistoryServiceの各APIを個別に呼び出すことはしない。
// Repository・Storage・AttemptService・AnswerRecordService・QuestionSetService・
// WeaknessService・HomeServiceへは一切直接アクセスしない。
//
// 「getHistoryScreenData(studentId) → 取得済みデータ → DOM描画」という一方向の流れのみを持ち、
// 正答率計算・日数集計など履歴集計そのものは一切実装しない（HistoryServiceが返した値を
// %表示・整数丸め・日付整形するだけに徹する。既存renderers/*.js・home-renderer.jsと同じ
// 「DOM要素+データ→描画」のみを行う位置づけ）。
//
// 今回はTier1（総回答数・総正答率・累計学習日数・連続学習日数）とTier2（科目別学習状況・
// 最近の学習履歴5件）のみを対象とする。Attempt単位の正解数・正答率・日付別詳細・
// 「もっと見る」等（Tier3相当）は今回実装しない。

import {
  getHistoryDashboard,
  getStudentHistorySummary,
  getFieldDashboards,
  getStudentHistoryList
} from "./history-service.js";
import { SUBJECT_CONFIG } from "../../config/subjects.js";
import { isWrongRetryEligibleAttempt } from "../../core/quiz-controller.js";

const RECENT_HISTORY_LIMIT = 5;

// Phase3D-1: 「もう一度やる」を表示してよいsourceType（TestSet・未知sourceTypeは対象外、
// 安全側のホワイトリスト方式。新しいsourceTypeを追加する場合はここへ明示的に加える必要がある）。
// Phase3D-2: 「間違えたN問をやり直す」の対象sourceTypeも同一のため、この1つのSetを共有する
// （app.js側の直接呼び出し防御にも同じSetをexportして再利用させ、別リストを新設しない）。
export const RETRY_ELIGIBLE_SOURCE_TYPES = new Set(["normal", "weak_review", "dormant_review"]);

/**
 * @typedef {Object} HistoryScreenElements
 * @property {HTMLElement} infoContainer - Tier1/Tier2全体のコンテナ
 * @property {HTMLElement} emptyMessage - 学習履歴が無い場合のメッセージ
 * @property {HTMLElement} errorMessage - 取得失敗時のエラーメッセージ
 * @property {HTMLElement} totalAnswered - 総回答数の表示先
 * @property {HTMLElement} correctRate - 総正答率の表示先
 * @property {HTMLElement} totalStudyDays - 累計学習日数の表示先
 * @property {HTMLElement} currentStreak - 連続学習日数の表示先
 * @property {HTMLElement} subjectList - 科目別学習状況の表示先
 * @property {HTMLElement} recentList - 最近の学習履歴の表示先
 */

function getSubjectLabel(fieldId) {
  return SUBJECT_CONFIG[fieldId]?.label || fieldId || "不明";
}

function formatDateLabel(isoTimestamp) {
  if (!isoTimestamp) return "";
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatPercent(rate) {
  return `${Math.round((rate || 0) * 100)}%`;
}

/**
 * 【非公開・唯一のHistoryService入口】history-screenが必要とするデータをまとめて取得する。
 *
 * 使用するのは以下の4つのみ:
 *   - getHistoryDashboard(studentId): overview（学習日数・連続日数・履歴有無）と
 *     studiedFields（学習済みfieldId一覧）を取得する。
 *   - getStudentHistorySummary(studentId): 総回答数・総正解数・総正答率を取得する
 *     （getHistoryDashboardには含まれないため別途必要）。
 *   - getFieldDashboards(studentId, fieldIds): 科目別のAttempt数・回答数・正答率を取得する。
 *     fieldIdsはgetHistoryDashboard()が返したstudiedFieldsから組み立てる
 *     （getStudiedFields()を別途呼び直さない）。
 *   - getStudentHistoryList(studentId, {order:"desc", limit:5}): 最近の学習履歴5件を取得する。
 *
 * getHistoryOverview()・getStudiedFields()は個別に呼ばない（getHistoryDashboard()が
 * 既に内包しているため、同じ情報を重複取得しない）。
 *
 * @param {string} studentId
 * @returns {{
 *   dashboard: ReturnType<typeof getHistoryDashboard>,
 *   summary: ReturnType<typeof getStudentHistorySummary>,
 *   fieldDashboards: ReturnType<typeof getFieldDashboards>,
 *   recentHistory: ReturnType<typeof getStudentHistoryList>
 * }}
 */
function getHistoryScreenData(studentId) {
  const dashboard = getHistoryDashboard(studentId);
  const summary = getStudentHistorySummary(studentId);
  const fieldIds = dashboard.studiedFields.map((field) => field.fieldId);
  const fieldDashboards = getFieldDashboards(studentId, fieldIds);

  // AnswerRecordが0件のAttempt（開始のみで未回答のまま終わったAttempt。TestSet/通常学習を
  // 問わず発生しうる）は「最近の学習履歴」には表示しない。Attempt/AnswerRecordの保存自体は
  // 一切変更しない（削除・無効化しない）、表示のみの除外とする。
  // limit適用前に全件取得してから除外することで、除外後もRECENT_HISTORY_LIMIT件を
  // 確実に表示できるようにする（limit適用後に除外すると件数が欠けるため）。
  const allHistory = getStudentHistoryList(studentId, { order: "desc" });
  const answeredItems = allHistory.items.filter(
    (entry) => Array.isArray(entry.answerRecords) && entry.answerRecords.length > 0
  );
  const recentHistory = {
    studentId: allHistory.studentId,
    totalCount: allHistory.totalCount,
    items: answeredItems.slice(0, RECENT_HISTORY_LIMIT)
  };

  return { dashboard, summary, fieldDashboards, recentHistory };
}

/**
 * studentId未指定、または学習履歴が0件の場合の空状態を表示する。
 * @param {HistoryScreenElements} elements
 */
function showHistoryEmptyState(elements) {
  elements.infoContainer.classList.add("hidden");
  elements.emptyMessage.classList.remove("hidden");
  elements.errorMessage.textContent = "";
}

/**
 * getHistoryScreenData()取得失敗時のエラー状態を表示する。
 * @param {HistoryScreenElements} elements
 */
function showHistoryErrorState(elements) {
  elements.infoContainer.classList.add("hidden");
  elements.emptyMessage.classList.add("hidden");
  elements.errorMessage.textContent = "学習履歴の取得に失敗しました。時間をおいて再度お試しください。";
}

/**
 * Tier1（総回答数・総正答率・累計学習日数・連続学習日数）を描画する。
 * summary.overallCorrectRate・overview.totalStudyDays・overview.currentStudyStreakは
 * いずれもHistoryServiceが計算済みの値をそのまま%表示・文字列整形するだけで、
 * 正答率・日数の再計算は行わない。
 *
 * @param {HistoryScreenElements} elements
 * @param {ReturnType<typeof getHistoryScreenData>["summary"]} summary
 * @param {ReturnType<typeof getHistoryScreenData>["dashboard"]["overview"]} overview
 */
function renderTier1(elements, summary, overview) {
  elements.totalAnswered.textContent = `${summary.answeredQuestions}問`;
  elements.correctRate.textContent = formatPercent(summary.overallCorrectRate);
  elements.totalStudyDays.textContent = `${overview.totalStudyDays}日`;
  elements.currentStreak.textContent = `${overview.currentStudyStreak}日`;
}

/**
 * Tier2-A: 科目別学習状況を描画する。
 * getFieldDashboards()が返したsummary（attemptCount/answeredQuestions/overallCorrectRate）を
 * そのまま表示するだけで、独自の科目別集計は行わない。科目名はconfig/subjects.jsの
 * SUBJECT_CONFIGのみを使用する（独自の科目名マッピングは作らない）。
 *
 * @param {ReturnType<typeof getFieldDashboards>} fieldDashboards
 * @param {HTMLElement} listElement
 */
function renderSubjectList(fieldDashboards, listElement) {
  listElement.innerHTML = "";

  const items = Array.isArray(fieldDashboards) ? fieldDashboards : [];
  if (items.length === 0) return;

  const title = document.createElement("p");
  title.className = "history-section-title";
  title.textContent = "科目別学習状況";
  listElement.appendChild(title);

  items.forEach((field) => {
    const item = document.createElement("div");
    item.className = "history-subject-item";

    const name = document.createElement("span");
    name.className = "history-subject-item-name";
    name.textContent = getSubjectLabel(field.fieldId);

    const detail = document.createElement("span");
    detail.className = "history-subject-item-detail";
    const attemptCount = field.summary?.attemptCount ?? 0;
    const answeredQuestions = field.summary?.answeredQuestions ?? 0;
    const rate = formatPercent(field.summary?.overallCorrectRate);
    detail.textContent = `${attemptCount}回 / ${answeredQuestions}問 / 正答率${rate}`;

    item.appendChild(name);
    item.appendChild(detail);
    listElement.appendChild(item);
  });
}

/**
 * Tier2-B: 最近の学習履歴（最大5件）を描画する。
 * 表示するのは日付・科目・回答数のみ。Attemptごとの正解数・正答率・間違い数は
 * 今回表示しない（未完了Attemptのscoreが実際の正解数と一致しない場合があるため、
 * UI側での補正も行わない。回答数はanswerRecords.lengthという実データの件数のみを使う）。
 *
 * questionSetがnull（QuestionSetが見つからないAttempt。ページ再読込等で別セッションに
 * なり、QuestionSetがメモリ上に復元されていない場合に発生する。QuestionSet自体はGASへ
 * 保存・復元されないため、既存の仕様上の制約であり本修正の対象外）の場合は、
 * 同じAttemptに属するAnswerRecord（GASへ保存され再読込後も復元される）が保持する
 * fieldIdを代わりに使う。AnswerRecordは同一Attempt内で常に同じfieldIdを持つため
 * （QuestionSetモデルの単一fieldId制約、Task55）、先頭の1件で十分。
 * どちらも取得できない場合のみ、getSubjectLabel()が"不明"を返す。
 *
 * Phase3D-1: 対象条件（completed===true・answerRecords 1件以上・sourceTypeが
 * RETRY_ELIGIBLE_SOURCE_TYPESに含まれる）を満たすitemにのみ「もう一度やる」ボタンを追加する。
 * TestSet（sourceType==="testset"）・未完了Attempt・未知sourceTypeには表示しない
 * （安全側、ホワイトリスト方式）。押下時の実処理（questionIds復元・Attempt生成等）は
 * 一切ここで行わず、onRetryAttemptコールバックへ丸ごと委譲する（app.js側の責務）。
 *
 * Phase3D-2: 上記に加え、isWrongRetryEligibleAttempt()（core/quiz-controller.js）が
 * trueを返すitemにのみ「間違えたN問をやり直す」ボタンを追加する（Nはattempt.
 * initialWrongQuestionIds.lengthそのもの。AnswerRecord.isCorrectやwrongQuestionsの
 * 現在値からは数えない）。判定ロジックはisWrongRetryEligibleAttempt()に一本化し、
 * ここでは表示条件の分岐を複雑にしない。押下時の実処理はonRetryWrongAttemptコール
 * バックへ丸ごと委譲する（app.js側の責務、3D-1と同じ構造）。
 *
 * @param {ReturnType<typeof getStudentHistoryList>["items"]} items
 * @param {HTMLElement} listElement
 * @param {(entry: Object) => void} [onRetryAttempt] - 「もう一度やる」押下時のコールバック
 * @param {(entry: Object) => void} [onRetryWrongAttempt] - 「間違えたN問をやり直す」押下時のコールバック
 */
function renderRecentList(items, listElement, onRetryAttempt, onRetryWrongAttempt) {
  listElement.innerHTML = "";

  const entries = Array.isArray(items) ? items : [];
  if (entries.length === 0) return;

  const title = document.createElement("p");
  title.className = "history-section-title";
  title.textContent = "最近の学習履歴";
  listElement.appendChild(title);

  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "history-recent-item";

    const dateLabel = formatDateLabel(entry.attempt?.completedAt || entry.attempt?.startedAt);
    const fallbackFieldId = Array.isArray(entry.answerRecords) ? entry.answerRecords[0]?.fieldId : undefined;
    const subjectLabel = getSubjectLabel(entry.questionSet?.fieldId || fallbackFieldId);
    const answeredCount = Array.isArray(entry.answerRecords) ? entry.answerRecords.length : 0;

    const date = document.createElement("span");
    date.className = "history-recent-item-date";
    date.textContent = dateLabel || "-";

    const subject = document.createElement("span");
    subject.className = "history-recent-item-subject";
    subject.textContent = subjectLabel;

    const count = document.createElement("span");
    count.className = "history-recent-item-count";
    count.textContent = `${answeredCount}問`;

    item.appendChild(date);
    item.appendChild(subject);
    item.appendChild(count);

    const isRetryEligible =
      entry.attempt?.completed === true &&
      answeredCount > 0 &&
      RETRY_ELIGIBLE_SOURCE_TYPES.has(entry.attempt?.sourceType) &&
      typeof onRetryAttempt === "function";

    const isWrongRetryEligible =
      isWrongRetryEligibleAttempt(entry.attempt, RETRY_ELIGIBLE_SOURCE_TYPES) &&
      typeof onRetryWrongAttempt === "function";

    if (isRetryEligible || isWrongRetryEligible) {
      const actions = document.createElement("div");
      actions.className = "history-recent-item-actions";

      // Phase3D-2: 誤答復習の方をやや優先し、先に配置する（STEP71）。
      if (isWrongRetryEligible) {
        const wrongCount = entry.attempt.initialWrongQuestionIds.length;
        const retryWrongButton = document.createElement("button");
        retryWrongButton.type = "button";
        retryWrongButton.className = "primary-button history-recent-item-retry-wrong-button";
        retryWrongButton.textContent = `間違えた${wrongCount}問をやり直す`;
        retryWrongButton.addEventListener("click", () => onRetryWrongAttempt(entry));
        actions.appendChild(retryWrongButton);
      }

      if (isRetryEligible) {
        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "secondary-button history-recent-item-retry-button";
        retryButton.textContent = "もう一度やる";
        retryButton.addEventListener("click", () => onRetryAttempt(entry));
        actions.appendChild(retryButton);
      }

      item.appendChild(actions);
    }

    listElement.appendChild(item);
  });
}

/**
 * 【入口】studentIdに紐づく学習履歴詳細情報を取得し、history-screenのDOMへ描画する。
 * HistoryServiceへは本ファイル内のgetHistoryScreenData(studentId)のみでアクセスする。
 *
 * @param {string} studentId
 * @param {HistoryScreenElements} elements
 * @param {(entry: Object) => void} [onRetryAttempt] - Phase3D-1「もう一度やる」押下時のコールバック
 * @param {(entry: Object) => void} [onRetryWrongAttempt] - Phase3D-2「間違えたN問をやり直す」押下時のコールバック
 * @returns {ReturnType<typeof getHistoryScreenData>|null} 取得できたデータ（失敗・履歴無し時はnull）
 */
export function renderHistoryForStudent(studentId, elements, onRetryAttempt, onRetryWrongAttempt) {
  if (!studentId) {
    showHistoryEmptyState(elements);
    return null;
  }

  try {
    const data = getHistoryScreenData(studentId);

    if (!data.dashboard.overview.hasHistory) {
      showHistoryEmptyState(elements);
      return data;
    }

    renderTier1(elements, data.summary, data.dashboard.overview);
    renderSubjectList(data.fieldDashboards, elements.subjectList);
    renderRecentList(data.recentHistory.items, elements.recentList, onRetryAttempt, onRetryWrongAttempt);

    elements.infoContainer.classList.remove("hidden");
    elements.emptyMessage.classList.add("hidden");
    elements.errorMessage.textContent = "";

    return data;
  } catch (error) {
    console.error("getHistoryScreenData error（学習履歴画面の表示のみ失敗。既存のクイズフローには影響しません）:", error);
    showHistoryErrorState(elements);
    return null;
  }
}
