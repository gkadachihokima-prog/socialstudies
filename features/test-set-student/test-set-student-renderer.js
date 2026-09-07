// features/test-set-student/test-set-student-renderer.js
//
// test-set-student-screenのDOM描画のみを担当する（features/teacher/teacher-renderer.js・
// features/history/history-renderer.jsと同じ思想：呼び出し側が取得済みのDOM要素・データを
// 渡し、ここではfetch/GAS通信を行わない）。

export { renderSchoolOptions } from "../teacher/teacher-renderer.js";

const GRADE_OPTIONS = ["中1", "中2", "中3"];

/**
 * @param {HTMLSelectElement} selectEl
 */
export function renderGradeOptions(selectEl) {
  selectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "選択してください";
  selectEl.appendChild(placeholder);

  GRADE_OPTIONS.forEach((grade) => {
    const option = document.createElement("option");
    option.value = grade;
    option.textContent = grade;
    selectEl.appendChild(option);
  });
}

/**
 * TestSet一覧をカード形式で描画する。
 * @param {HTMLElement} containerEl
 * @param {Array<{testSetId:string, examRoundLabel:string, label:string, questionCount:number}>} testSets
 * @param {(testSetId:string) => void} onSelect
 */
export function renderTestSetList(containerEl, testSets, onSelect) {
  containerEl.innerHTML = "";

  testSets.forEach((testSet) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tss-test-set-card";

    const labelLine = document.createElement("p");
    labelLine.className = "tss-test-set-card-label";
    labelLine.textContent = testSet.label || "";

    const metaLine = document.createElement("p");
    metaLine.className = "tss-test-set-card-meta";
    metaLine.textContent = `${testSet.examRoundLabel || ""} ｜ ${testSet.questionCount ?? 0}問`;

    card.appendChild(labelLine);
    card.appendChild(metaLine);

    card.addEventListener("click", () => onSelect(testSet.testSetId));

    containerEl.appendChild(card);
  });
}

/**
 * 開始前確認の表示内容を組み立てる。
 * @param {HTMLElement} containerEl
 * @param {{schoolName:string, gradeId:string, testSet:Object}} data
 */
export function renderConfirmInfo(containerEl, data) {
  containerEl.innerHTML = "";

  const rows = [
    ["学校", data.schoolName],
    ["学年", data.gradeId],
    ["テスト回", data.testSet?.examRoundLabel || ""],
    ["セット名", data.testSet?.label || ""],
    ["問題数", `${Array.isArray(data.testSet?.questions) ? data.testSet.questions.length : 0}問`]
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("p");
    row.className = "tss-confirm-row";
    row.innerHTML = `<span class="tss-confirm-row-label">${label}</span><span class="tss-confirm-row-value"></span>`;
    row.querySelector(".tss-confirm-row-value").textContent = value;
    containerEl.appendChild(row);
  });
}

/**
 * TestSet全体完了時のサマリー表示を組み立てる（Task55）。
 * Phase3D-4B-3: summary.reviewが存在する場合のみ、間違い直し結果を追加表示する
 * （既存の問題数/正解数/不正解数の3行はreviewの有無に関わらず常に初回結果のまま、
 * Phase3D-4B設計監査「summary score意味」の結論どおり初回とreviewの点数を加算しない）。
 * @param {HTMLElement} containerEl
 * @param {{label:string, totalQuestions:number, totalCorrect:number, totalIncorrect:number,
 *   review?: {totalQuestions:number, totalCorrect:number, totalIncorrect:number, remainingWrong:number}|null}} summary
 */
export function renderCompletionSummary(containerEl, summary) {
  containerEl.innerHTML = "";

  const heading = document.createElement("p");
  heading.className = "tss-complete-heading";
  heading.textContent = `「${summary.label}」が終わりました`;
  containerEl.appendChild(heading);

  const rows = [
    ["問題数", `${summary.totalQuestions}問`],
    ["正解数", `${summary.totalCorrect}問`],
    ["不正解数", `${summary.totalIncorrect}問`]
  ];

  if (summary.review) {
    rows.push(["間違い直し", `${summary.review.totalCorrect} / ${summary.review.totalQuestions}問`]);
    if (summary.review.remainingWrong > 0) {
      rows.push(["まだ確認が必要", `${summary.review.remainingWrong}問`]);
    }
  }

  rows.forEach(([label, value]) => {
    const row = document.createElement("p");
    row.className = "tss-confirm-row";
    row.innerHTML = `<span class="tss-confirm-row-label">${label}</span><span class="tss-confirm-row-value"></span>`;
    row.querySelector(".tss-confirm-row-value").textContent = value;
    containerEl.appendChild(row);
  });

  if (summary.review && summary.review.remainingWrong === 0) {
    const note = document.createElement("p");
    note.className = "tss-confirm-message";
    note.textContent = "間違い直しは全問正解でした";
    containerEl.appendChild(note);
  }
}

/**
 * @param {HTMLElement} el
 * @param {string} message
 */
export function showTssError(el, message) {
  el.textContent = message || "";
}
