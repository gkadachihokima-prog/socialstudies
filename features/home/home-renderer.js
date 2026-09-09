// features/home/home-renderer.js
//
// Phase2 Task20-B: ホーム画面のDOM描画専用モジュール。
// HomeServiceへの入口はgetHomeInitialData(studentId)の1つのみとし、それ以外の
// HomeService公開API（getHomeDashboard・getHomeOverview・getHomeWeakness等）、
// HistoryService・WeaknessService・Repository・Storageへは一切直接アクセスしない。
//
// 「getHomeInitialData(studentId) → 取得済みデータ → DOM描画」という一方向の流れのみを持ち、
// 学習履歴の集計・苦手判定など独自のドメインロジックは一切実装しない
// （既存renderers/*.jsと同じ「DOM要素+データ→描画」のみを行う位置づけ）。
//
// 責務分離: 画面切り替え自体はcore/screen-controller.jsの責務、DOM要素参照の取得・
// イベントリスナー登録・「苦手を復習」等のクリック時に実際に何をするか（Bridge呼び出し・
// クイズ開始）はapp.jsの責務。本ファイルは「渡されたDOM要素へ、取得したデータを描画し、
// ボタンが押されたらapp.js側から渡されたコールバックを呼ぶだけ」に徹する
// （renderers/choice-renderer.js の renderChoiceQuestion(question, elements, onSelectChoice)
// と同じ「描画対象・DOM要素・コールバック」を受け取る形を踏襲）。
//
// Phase2 Task21-3: 「苦手を復習」「復習する」ボタンはfieldId単位でのみ表示する
// （features/weakness/weakness-quiz-bridge.jsがfieldId単位でのみ問題を突き合わせる
// 設計のため、科目をまたいだ一括復習ボタンは提供しない）。

import { getHomeInitialData } from "./home-service.js";
import { SUBJECT_CONFIG } from "../../config/subjects.js";

const DORMANT_DISPLAY_LIMIT = 5;

/**
 * @typedef {Object} HomeScreenElements
 * @property {HTMLElement} infoContainer - 統計情報全体のコンテナ
 * @property {HTMLElement} emptyMessage - 生徒未選択時のメッセージ
 * @property {HTMLElement} errorMessage - 取得失敗時のエラーメッセージ
 * @property {HTMLElement} totalStudyDays - 累計学習日数の表示先
 * @property {HTMLElement} currentStreak - 連続学習日数の表示先
 * @property {HTMLElement} latestStudy - 前回学習の表示先
 * @property {HTMLButtonElement} latestStudyCard - 前回学習カード全体（Phase4C-1: 既存学習履歴
 *   詳細へのタップ先。完了済みAttemptが無い場合はdisabledのまま）
 * @property {HTMLElement} weakCount - 苦手問題数の表示先
 * @property {HTMLButtonElement} weakCountCard - 苦手問題カード全体（Phase4D-1+2: 苦手一覧
 *   画面へのタップ先。苦手問題が0件の場合はdisabledのまま）
 * @property {HTMLElement} detailToggleWrap - 詳細表示トグルボタンのラッパー
 * @property {HTMLElement} detail - 詳細表示コンテナ（折りたたみ対象）
 * @property {HTMLElement} fieldList - 科目別学習状況の表示先
 * @property {HTMLElement} dormantList - 復習推奨情報の表示先
 * @property {HTMLButtonElement} startButton - 「学習を始める」ボタン
 */

function getSubjectLabel(fieldId) {
  return SUBJECT_CONFIG[fieldId]?.label || fieldId || "";
}

function formatDateLabel(isoTimestamp) {
  if (!isoTimestamp) return "";
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatLatestStudyText(latestAttempt) {
  if (!latestAttempt) return "まだ学習記録がありません";

  const subjectLabel = getSubjectLabel(latestAttempt.questionSet?.fieldId);
  const dateLabel = formatDateLabel(latestAttempt.attempt?.completedAt || latestAttempt.attempt?.startedAt);

  const text = [dateLabel, subjectLabel].filter(Boolean).join(" ");
  return text || "まだ学習記録がありません";
}

/**
 * 生徒未選択時の初期状態を表示する。
 * @param {HomeScreenElements} elements
 */
function showHomeEmptyState(elements) {
  elements.infoContainer.classList.add("hidden");
  elements.detail.classList.add("hidden");
  elements.emptyMessage.classList.remove("hidden");
  elements.errorMessage.textContent = "";
  elements.startButton.disabled = true;
  elements.latestStudyCard.disabled = true;
  elements.latestStudyCard.onclick = null;
  elements.weakCountCard.disabled = true;
  elements.weakCountCard.onclick = null;
}

/**
 * getHomeInitialData()取得失敗時のエラー状態を表示する。
 * studentId自体は有効なため、既存クイズフローを止めないよう開始ボタンは有効のままにする。
 * @param {HomeScreenElements} elements
 */
function showHomeErrorState(elements) {
  elements.infoContainer.classList.add("hidden");
  elements.detail.classList.add("hidden");
  elements.emptyMessage.classList.add("hidden");
  elements.errorMessage.textContent = "学習状況の取得に失敗しました。時間をおいて再度お試しください。";
  elements.startButton.disabled = false;
  elements.latestStudyCard.disabled = true;
  elements.latestStudyCard.onclick = null;
  elements.weakCountCard.disabled = true;
  elements.weakCountCard.onclick = null;
}

/**
 * 【表示整形のみ】fieldId毎の苦手問題数を、ボタン表示用に集計する。
 * WeaknessServiceが既に持つgetWeakFields()と同じ「fieldId一致で数える」だけの単純な
 * 集約であり、新しい苦手判定ロジックではない（判定自体はWeaknessService側で完結済み）。
 *
 * @param {Array<{ fieldId: string, weakQuestionCount: number }>} weakFields
 * @returns {Map<string, number>}
 */
function buildWeakCountByField(weakFields) {
  const map = new Map();
  (Array.isArray(weakFields) ? weakFields : []).forEach((field) => {
    if (field?.fieldId) map.set(field.fieldId, field.weakQuestionCount ?? 0);
  });
  return map;
}

/**
 * 【表示整形のみ】復習推奨問題（questionId単位の配列）を、ボタン表示用にfieldId毎の
 * 件数へ集計する。dormantQuestionsは既にWeaknessServiceが判定済みの配列であり、
 * ここではその表示上の件数集計のみを行う（新しい復習推奨判定ロジックではない）。
 *
 * @param {Array<{ fieldId: string }>} dormantQuestions
 * @returns {Map<string, number>}
 */
function buildDormantCountByField(dormantQuestions) {
  const map = new Map();
  (Array.isArray(dormantQuestions) ? dormantQuestions : []).forEach((question) => {
    const fieldId = question?.fieldId || "";
    if (!fieldId) return;
    map.set(fieldId, (map.get(fieldId) || 0) + 1);
  });
  return map;
}

/**
 * 「苦手を復習」「復習する」共通のボタンを1つ生成する。DOM生成のみを行い、
 * クリック時に何が起きるかはapp.js側から渡されたonPracticeコールバックに委ねる
 * （本ファイルはBridge呼び出し・クイズ開始処理を一切知らない）。
 *
 * @param {string} label
 * @param {() => void} onPractice
 * @returns {HTMLButtonElement}
 */
function createPracticeButton(label, onPractice) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button home-practice-button";
  button.textContent = label;
  button.addEventListener("click", onPractice);
  return button;
}

function renderFieldList(fieldDashboards, weakCountByField, listElement, onPracticeWeakField) {
  listElement.innerHTML = "";

  const items = Array.isArray(fieldDashboards) ? fieldDashboards : [];
  if (items.length === 0) return false;

  const title = document.createElement("p");
  title.className = "home-section-title";
  title.textContent = "科目別学習状況";
  listElement.appendChild(title);

  items.forEach((field) => {
    const item = document.createElement("div");
    item.className = "home-field-item";

    const row = document.createElement("div");
    row.className = "home-field-item-row";

    const name = document.createElement("span");
    name.className = "home-field-item-name";
    name.textContent = getSubjectLabel(field.fieldId);

    const count = document.createElement("span");
    count.className = "home-field-item-count";
    const rate = Math.round((field.summary?.overallCorrectRate ?? 0) * 100);
    count.textContent = `${field.summary?.attemptCount ?? 0}回 正答率${rate}%`;

    row.appendChild(name);
    row.appendChild(count);
    item.appendChild(row);

    const weakCount = weakCountByField.get(field.fieldId) || 0;
    if (weakCount > 0 && typeof onPracticeWeakField === "function") {
      item.appendChild(
        createPracticeButton(`苦手を復習（${weakCount}問）`, () => onPracticeWeakField(field.fieldId))
      );
    }

    listElement.appendChild(item);
  });

  return true;
}

function renderDormantList(dormantQuestions, dormantCountByField, listElement, onPracticeDormantField) {
  listElement.innerHTML = "";

  const items = Array.isArray(dormantQuestions) ? dormantQuestions : [];
  if (items.length === 0) return false;

  const title = document.createElement("p");
  title.className = "home-section-title";
  title.textContent = "復習推奨";
  listElement.appendChild(title);

  items.slice(0, DORMANT_DISPLAY_LIMIT).forEach((question) => {
    const item = document.createElement("div");
    item.className = "home-dormant-item";

    const name = document.createElement("span");
    name.className = "home-dormant-item-name";
    name.textContent = getSubjectLabel(question.fieldId) || question.questionId;

    const count = document.createElement("span");
    count.className = "home-dormant-item-count";
    const dateLabel = formatDateLabel(question.lastAnsweredAt);
    count.textContent = dateLabel ? `最終: ${dateLabel}` : "";

    item.appendChild(name);
    item.appendChild(count);
    listElement.appendChild(item);
  });

  if (items.length > DORMANT_DISPLAY_LIMIT) {
    const more = document.createElement("p");
    more.className = "home-section-title";
    more.textContent = `他${items.length - DORMANT_DISPLAY_LIMIT}件`;
    listElement.appendChild(more);
  }

  // fieldId単位の「復習する」ボタンは、既存の個別問題一覧（上記）とは別の行として
  // 末尾へ追加する（既存の個別一覧の見た目・構造は変更しない）。
  if (typeof onPracticeDormantField === "function") {
    Array.from(dormantCountByField.entries()).forEach(([fieldId, count]) => {
      const actionItem = document.createElement("div");
      actionItem.className = "home-dormant-item home-dormant-action-item";
      actionItem.appendChild(
        createPracticeButton(
          `${getSubjectLabel(fieldId) || fieldId}を復習する（${count}問）`,
          () => onPracticeDormantField(fieldId)
        )
      );
      listElement.appendChild(actionItem);
    });
  }

  return true;
}

/**
 * @typedef {Object} HomePracticeCallbacks
 * @property {(fieldId: string) => void} [onPracticeWeakField] - 「苦手を復習」ボタン押下時
 * @property {(fieldId: string) => void} [onPracticeDormantField] - 「復習する」ボタン押下時
 * @property {(entry: Object) => void} [onLatestStudyClick] - 「前回学習」カード押下時
 *   （Phase4C-1。completed済みAttemptが無い場合はカードがdisabledのため呼ばれない）
 * @property {() => void} [onWeakCountClick] - 「苦手問題」カード押下時
 *   （Phase4D-1+2。苦手問題が0件の場合はカードがdisabledのため呼ばれない）
 */

/**
 * getHomeInitialData()の返り値をホーム画面のDOMへ描画する。
 * @param {ReturnType<typeof getHomeInitialData>} homeInitialData
 * @param {HomeScreenElements} elements
 * @param {HomePracticeCallbacks} callbacks
 */
function renderHomeDashboard(homeInitialData, elements, callbacks) {
  const dashboard = homeInitialData.dashboard;
  const historyOverview = dashboard.overview.historyOverview;
  const weakDashboard = dashboard.weakness.weakDashboard;

  elements.totalStudyDays.textContent = `${historyOverview.totalStudyDays}日`;
  elements.currentStreak.textContent = `${historyOverview.currentStudyStreak}日`;
  elements.latestStudy.textContent = formatLatestStudyText(dashboard.overview.latestAttempt);
  elements.weakCount.textContent = `${weakDashboard.summary.weakQuestionCount}問`;

  // Phase4C-1: 「前回学習」カードのタップ先はcompleted済みAttemptに限定する
  // （in_progressのみの場合はresumeに任せ、detailへは導線を出さない）。
  // .onclick=での代入は、Homeが同じ要素を何度も再描画する（生徒切替・ホームへ戻る等）ため、
  // addEventListenerの多重登録を避けるための既定パターン（前回分のハンドラを自動的に置き換える）。
  const latestCompletedEntry = dashboard.overview.latestCompletedAttempt;
  elements.latestStudyCard.disabled = !latestCompletedEntry;
  elements.latestStudyCard.onclick =
    latestCompletedEntry && typeof callbacks?.onLatestStudyClick === "function"
      ? () => callbacks.onLatestStudyClick(latestCompletedEntry)
      : null;

  // Phase4D-1+2: 「苦手問題」カードのタップ先は苦手一覧画面。4C-1「前回学習」カードと
  // 同じ.onclick=代入パターン（Homeの再描画のたびにハンドラを置き換える）。
  // 苦手0件ならdisabledのまま（一覧画面自体は空状態として作るが、タップ導線は出さない）。
  const hasWeakQuestions = weakDashboard.summary.weakQuestionCount > 0;
  elements.weakCountCard.disabled = !hasWeakQuestions;
  elements.weakCountCard.onclick =
    hasWeakQuestions && typeof callbacks?.onWeakCountClick === "function" ? () => callbacks.onWeakCountClick() : null;

  const weakCountByField = buildWeakCountByField(weakDashboard.weakFields);
  const dormantCountByField = buildDormantCountByField(weakDashboard.dormantQuestions);

  const hasFieldDetail = renderFieldList(
    dashboard.fields.fieldDashboards,
    weakCountByField,
    elements.fieldList,
    callbacks?.onPracticeWeakField
  );
  const hasDormantDetail = renderDormantList(
    weakDashboard.dormantQuestions,
    dormantCountByField,
    elements.dormantList,
    callbacks?.onPracticeDormantField
  );

  elements.detailToggleWrap.classList.toggle("hidden", !(hasFieldDetail || hasDormantDetail));
  elements.detail.classList.add("hidden");

  elements.infoContainer.classList.remove("hidden");
  elements.emptyMessage.classList.add("hidden");
  elements.errorMessage.textContent = "";
  elements.startButton.disabled = false;
}

/**
 * 【入口】studentIdに紐づくホーム画面情報を取得し、DOMへ描画する。
 * HomeServiceへは getHomeInitialData(studentId) のみでアクセスする。
 *
 * @param {string} studentId
 * @param {HomeScreenElements} elements
 * @param {HomePracticeCallbacks} [callbacks] - 「苦手を復習」「復習する」ボタン押下時のコールバック
 * @returns {ReturnType<typeof getHomeInitialData>|null} 取得できたデータ（失敗・未選択時はnull）
 */
export function renderHomeForStudent(studentId, elements, callbacks = {}) {
  if (!studentId) {
    showHomeEmptyState(elements);
    return null;
  }

  try {
    const homeInitialData = getHomeInitialData(studentId);
    renderHomeDashboard(homeInitialData, elements, callbacks);
    return homeInitialData;
  } catch (error) {
    console.error("getHomeInitialData error（ホーム画面の表示のみ失敗。既存のクイズフローには影響しません）:", error);
    showHomeErrorState(elements);
    return null;
  }
}

/**
 * 詳細表示（科目別学習状況・復習推奨）の折りたたみを切り替える。
 * 追加のデータ取得は行わない（既にDOMへ描画済みの内容の表示/非表示のみ）。
 *
 * @param {HomeScreenElements} elements
 */
export function toggleHomeDetail(elements) {
  elements.detail.classList.toggle("hidden");
}
