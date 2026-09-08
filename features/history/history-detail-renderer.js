// features/history/history-detail-renderer.js
//
// Phase3D-3: 学習履歴「詳細」画面のDOM描画専用モジュール。view model
// （features/history/history-detail-service.jsのgetHistoryDetailViewModel()の結果）を
// 受け取って描画するだけで、GAS通信・履歴取得・Attempt開始は一切行わない
// （history-renderer.jsと同じ「取得済みデータ→DOM描画」のみの位置づけ）。
//
// 問題文・解説はfeatures/furigana/furigana-apply.jsのapplyFuriganaText()を再利用し、
// 安全なDOM生成（innerHTML不使用、createTextNode経由）とふりがな設定の両方を
// 既存の仕組みのままquiz画面と同じように適用する（新しいふりがな処理を作らない）。
//
// 日付・科目名の表示基準はhistory-renderer.jsのformatDateLabel()/getSubjectLabel()を
// そのまま再利用する（表示ロジックを2箇所に分岐させない）。

import { getSubjectLabel, formatDateLabel, RETRY_ELIGIBLE_SOURCE_TYPES } from "./history-renderer.js";
import { applyFuriganaText } from "../furigana/furigana-apply.js";
import { isWrongRetryEligibleAttempt, isRetryEligibleAttempt } from "../../core/quiz-controller.js";

function renderQuestionItem(item) {
  const card = document.createElement("div");
  card.className = "history-detail-item";

  const number = document.createElement("p");
  number.className = "history-detail-item-number";
  number.textContent = `${item.number}.`;
  card.appendChild(number);

  if (!item.available) {
    const unavailable = document.createElement("p");
    unavailable.className = "history-detail-item-unavailable";
    unavailable.textContent = "現在利用できない問題です。";
    card.appendChild(unavailable);
    return card;
  }

  const questionText = document.createElement("p");
  questionText.className = "history-detail-item-question";
  applyFuriganaText(questionText, item.questionText || "");
  card.appendChild(questionText);

  if (item.imagePath) {
    const image = document.createElement("img");
    image.className = "history-detail-item-image";
    image.src = item.imagePath;
    image.alt = "";
    card.appendChild(image);
  }

  const finalAnswerLine = document.createElement("p");
  finalAnswerLine.className = "history-detail-item-final-answer";
  finalAnswerLine.textContent = `最終回答：${item.finalAnswer ?? "回答記録なし"}`;
  card.appendChild(finalAnswerLine);

  const correctAnswerLine = document.createElement("p");
  correctAnswerLine.className = "history-detail-item-correct-answer";
  correctAnswerLine.textContent = `正解：${item.correctAnswer ?? "（未記録）"}`;
  card.appendChild(correctAnswerLine);

  const resultLine = document.createElement("p");
  resultLine.className = `history-detail-item-result ${item.isCorrect ? "correct" : "incorrect"}`;
  resultLine.textContent = `最終結果：${item.isCorrect ? "正解" : "不正解"}`;
  card.appendChild(resultLine);

  if (item.wasInitiallyWrong) {
    const badge = document.createElement("span");
    badge.className = "history-detail-item-badge";
    badge.textContent = "最初の学習で間違えた";
    card.appendChild(badge);
  }

  // 追加監査N: explanationが空欄の問題は「解説：」だけの空ブロックを表示しない。
  if (item.explanation) {
    const explanationLine = document.createElement("p");
    explanationLine.className = "history-detail-item-explanation";
    const label = document.createElement("span");
    label.textContent = "解説：";
    explanationLine.appendChild(label);
    const body = document.createElement("span");
    applyFuriganaText(body, item.explanation);
    explanationLine.appendChild(body);
    card.appendChild(explanationLine);
  }

  return card;
}

/**
 * @typedef {Object} HistoryDetailScreenElements
 * @property {HTMLElement} dateLabel
 * @property {HTMLElement} subjectLabel
 * @property {HTMLElement} countLabel
 * @property {HTMLElement} sourceNote
 * @property {HTMLElement} list
 * @property {HTMLElement} error
 */

/**
 * @param {import("./history-detail-model.js").HistoryDetailViewModel} viewModel
 * @param {HistoryDetailScreenElements} elements
 */
export function renderHistoryDetailScreen(viewModel, elements) {
  elements.error.textContent = "";

  elements.dateLabel.textContent = formatDateLabel(viewModel.dateLabel) || "-";
  elements.subjectLabel.textContent = getSubjectLabel(viewModel.fieldId);
  elements.countLabel.textContent = `${viewModel.answeredCount}問`;
  // 追加監査S: TestSet起点でも「TestSet全体の詳細」と誤認させない、group番号は推測表示しない。
  elements.sourceNote.textContent = viewModel.sourceType === "testset" ? "（学校のテスト対策）" : "";

  elements.list.innerHTML = "";
  viewModel.items.forEach((item) => {
    elements.list.appendChild(renderQuestionItem(item));
  });
}

/**
 * @param {HistoryDetailScreenElements} elements
 * @param {string} message
 */
export function showHistoryDetailError(elements, message) {
  elements.error.textContent = message || "";
}

/**
 * @typedef {Object} HistoryDetailRetryCallbacks
 * @property {(entry: Object) => void} [onRetryAttempt] - 「もう一度やる」押下時
 * @property {(entry: Object) => void} [onRetryWrongAttempt] - 「間違えたN問をやり直す」押下時
 */

/**
 * Phase4C-2: detail画面内の「間違えたN問をやり直す」「もう一度やる」ボタンを描画する。
 *
 * eligibility判定はhistory-renderer.js（履歴一覧）と同じ isRetryEligibleAttempt()・
 * isWrongRetryEligibleAttempt()（core/quiz-controller.js）に一本化する（判定条件を
 * 2箇所に複製しない）。表示テキスト・並び順（誤答復習を先に配置）もhistory-renderer.jsの
 * renderRecentList()と揃える。
 *
 * 押下時の実処理（questionIds復元・resume競合確認・Attempt生成等）は一切ここで行わず、
 * コールバックへ丸ごと委譲する（本ファイルはrenderer、Attempt開始処理はapp.js側の責務、
 * history-renderer.js側の既存構造と同じ）。
 *
 * @param {{attempt:Object, questionSet:Object|null, answerRecords:Array<Object>}|null} entry
 *   - detail表示中のentry。表示できるentryが無い場合（読込失敗時等）はnullを渡すと
 *     両ボタンとも非表示になる。
 * @param {{retryWrongButton:HTMLButtonElement, retryButton:HTMLButtonElement}} elements
 * @param {HistoryDetailRetryCallbacks} [callbacks]
 */
export function renderHistoryDetailRetryActions(entry, elements, callbacks = {}) {
  const attempt = entry?.attempt;
  const answeredCount = Array.isArray(entry?.answerRecords) ? entry.answerRecords.length : 0;

  const isWrongRetryEligible =
    Boolean(entry) && isWrongRetryEligibleAttempt(attempt, RETRY_ELIGIBLE_SOURCE_TYPES);
  const isRetryEligible =
    Boolean(entry) && isRetryEligibleAttempt(attempt, answeredCount, RETRY_ELIGIBLE_SOURCE_TYPES);

  // Phase3D-2のhistory-renderer.jsと同じ理由（誤答復習の方をやや優先）で、
  // wrongボタンを先に配置する（DOM順自体はindex.html側で固定済み、ここではhidden切替のみ）。
  if (isWrongRetryEligible) {
    elements.retryWrongButton.textContent = `間違えた${attempt.initialWrongQuestionIds.length}問をやり直す`;
    elements.retryWrongButton.classList.remove("hidden");
    elements.retryWrongButton.onclick =
      typeof callbacks.onRetryWrongAttempt === "function" ? () => callbacks.onRetryWrongAttempt(entry) : null;
  } else {
    elements.retryWrongButton.classList.add("hidden");
    elements.retryWrongButton.onclick = null;
  }

  if (isRetryEligible) {
    elements.retryButton.classList.remove("hidden");
    elements.retryButton.onclick =
      typeof callbacks.onRetryAttempt === "function" ? () => callbacks.onRetryAttempt(entry) : null;
  } else {
    elements.retryButton.classList.add("hidden");
    elements.retryButton.onclick = null;
  }
}
