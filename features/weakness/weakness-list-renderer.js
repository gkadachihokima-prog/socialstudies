// features/weakness/weakness-list-renderer.js
//
// Phase4D-1+2: 苦手問題一覧画面のDOM描画専用モジュール。view model
// （features/weakness/weakness-list-service.jsのgetWeaknessListViewModel()の結果）を
// 受け取って描画するだけで、GAS通信・苦手判定・Attempt開始は一切行わない
// （features/history/history-renderer.jsと同じ「取得済みデータ→DOM描画」の位置づけ）。
//
// 日付・科目名・正答率の表示基準はfeatures/history/history-renderer.jsのgetSubjectLabel()/
// formatPercent()をそのまま再利用する（表示ロジックを複数箇所に分岐させない）。
//
// 「この1問を解く」「まとめて解く」ボタンはPhase4D-3対象のため、本ファイルには一切含めない
// （card tapは「詳細」への遷移のみ）。

import { getSubjectLabel, formatPercent } from "../history/history-renderer.js";

/**
 * @typedef {Object} WeaknessScreenElements
 * @property {HTMLElement} emptyMessage
 * @property {HTMLElement} errorMessage
 * @property {HTMLElement} list
 */

/**
 * 1件のitemを1枚のcard（button要素）として生成する。
 * questionIdが現在の問題マスタに存在しない場合（missing）は、そのcardのみ
 * 「現在利用できない問題です。」を表示し非活性にする（一覧全体は継続表示、Phase4D事前監査STEP5）。
 *
 * @param {import("./weakness-list-model.js").WeaknessListItem} item
 * @param {(item: Object) => void} onOpenDetail
 * @returns {HTMLButtonElement}
 */
function renderWeaknessListItem(item, onOpenDetail) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "weakness-list-item";
  card.dataset.questionId = item.questionId;

  const subject = document.createElement("span");
  subject.className = "weakness-list-item-subject";
  subject.textContent = getSubjectLabel(item.fieldId);
  card.appendChild(subject);

  const text = document.createElement("span");
  text.className = "weakness-list-item-question";

  if (!item.available) {
    text.textContent = "現在利用できない問題です。";
    card.appendChild(text);
    card.classList.add("weakness-list-item-unavailable");
    card.disabled = true;
    return card;
  }

  // CSV由来の問題文はXSS対策のためtextContent経由のみで挿入する（innerHTML不使用）。
  text.textContent = item.question?.question || "";
  card.appendChild(text);

  const stat = document.createElement("span");
  stat.className = "weakness-list-item-stat";
  stat.textContent = `正答率${formatPercent(item.correctRate)}（${item.answeredCount}問中${item.correctCount}問正解）`;
  card.appendChild(stat);

  card.addEventListener("click", () => onOpenDetail(item));

  return card;
}

/**
 * 【入口】studentIdに紐づく苦手問題一覧をDOMへ描画する。
 *
 * @param {import("./weakness-list-model.js").WeaknessListViewModel} viewModel
 * @param {WeaknessScreenElements} elements
 * @param {(item: Object) => void} [onOpenDetail] - card押下時（Phase4D-1+2は詳細画面遷移のみ）
 */
export function renderWeaknessListScreen(viewModel, elements, onOpenDetail) {
  elements.list.innerHTML = "";
  elements.errorMessage.textContent = "";

  const items = Array.isArray(viewModel?.items) ? viewModel.items : [];

  if (items.length === 0) {
    elements.emptyMessage.classList.remove("hidden");
    return;
  }

  elements.emptyMessage.classList.add("hidden");

  items.forEach((item) => {
    elements.list.appendChild(renderWeaknessListItem(item, onOpenDetail));
  });
}

/**
 * @param {WeaknessScreenElements} elements
 * @param {string} message
 */
export function showWeaknessListError(elements, message) {
  elements.list.innerHTML = "";
  elements.emptyMessage.classList.add("hidden");
  elements.errorMessage.textContent = message || "";
}
