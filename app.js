import {
  state,
  resetSessionState,
  resetQuizState,
  resetUiState
} from "./core/state.js";
import { normalizeQuestion, buildFallbackQuestionId } from "./core/question-normalizer.js";
import { prepareQuizStart, startRetryWrongRound, prepareResumedQuiz } from "./core/quiz-controller.js";
import { pickQuestions } from "./core/question-picker.js";
import {
  buildResultMessage,
  buildSavedSubjectName,
  renderFinalResult,
  buildQuizMetaText
} from "./core/result-controller.js";
import { restartQuiz, resetStartScreenMessages } from "./core/session-controller.js";
import { applyAnswerResult } from "./core/answer-controller.js";
import { renderCurrentQuestion } from "./core/question-screen-controller.js";
import {
  showHomeScreen,
  showQuizScreen,
  showResultScreen,
  showStartScreen,
  showHistoryScreen,
  showTeacherScreen,
  showTestSetStudentScreen
} from "./core/screen-controller.js";
import { renderTextQuestion } from "./renderers/text-renderer.js";
import { renderChoiceQuestion, lockChoiceButtons } from "./renderers/choice-renderer.js";
import { renderEraQuestion } from "./renderers/era-renderer.js";
import { renderSortQuestion, drawSortList } from "./renderers/sort-renderer.js";
import {
  renderMapClickQuestion,
  lockMapClickVisuals,
  resetMapClickArea,
  getSelectedMapAnswer,
  getMapAreaLabelById
} from "./renderers/map-click-renderer.js";
import { judgeAnswer, getCorrectAnswer } from "./judges/answer-judge.js";
import { createFilterManager } from "./filters/filter-manager.js";
import {
  loadActiveStudents,
  saveAnswerRecord,
  renderStudentSuggestions,
  selectStudent,
  filterStudents
} from "./services/student-service.js";
import { ERA_CHOICES } from "./config/era-choices.js";
import { UNKNOWN_ANSWER_VALUE } from "./config/unknown-answer.js";
import { isFuriganaEnabled, setFuriganaEnabled } from "./features/furigana/furigana-state.js";
import { ensureFuriganaEngineReady } from "./features/furigana/furigana-service.js";
import { applyFuriganaText } from "./features/furigana/furigana-apply.js";
import { startAttemptForQuiz } from "./features/history/quiz-start-integration.js";
import { recordAnswerForAttempt } from "./features/history/answer-record-integration.js";
import { completeAttempt } from "./features/history/attempt-complete-integration.js";
import { restoreStudentLearningRecords } from "./features/history/learning-record-restore-integration.js";
import { syncAttemptProgressRetryStart } from "./features/history/learning-record-sync-integration.js";
import { extractQuestionIds, resolveUnitForSourceType, restoreAttemptProgressContext } from "./features/progress/progress-model.js";
import { getAttemptProgress, abandonAttemptProgress } from "./services/learning-record-service.js";
import { loadAttempt, loadAttemptsByStudent, saveAttempt } from "./features/history/attempt-service.js";
import { loadAnswerRecordsByAttempt } from "./features/history/answer-record-service.js";
import { loadTestSet } from "./services/test-set-service.js";
import { SUBJECT_CONFIG } from "./config/subjects.js";
import { renderHomeForStudent, toggleHomeDetail } from "./features/home/home-renderer.js";
import { buildHomePracticeQuiz } from "./features/home/home-practice-controller.js";
import { renderHistoryForStudent } from "./features/history/history-renderer.js";
import { initTeacherScreen } from "./features/teacher/teacher-controller.js";
import { initTeacherHistorySection } from "./features/teacher/teacher-history-controller.js";
import { initTestSetStudentScreen, showTestSetCompletion } from "./features/test-set-student/test-set-student-controller.js";
import {
  startTestSetRun,
  isRunnerActive,
  getCurrentGroup,
  getRunnerTestSetId,
  recordCurrentGroupResult,
  hasNextGroup,
  advanceToNextGroup,
  finishRun,
  abortRun,
  restoreRunnerState
} from "./features/test-set-runner/test-set-runner.js";

const homeScreen = document.getElementById("home-screen");
const startScreen = document.getElementById("start-screen");
const quizScreen = document.getElementById("quiz-screen");
const resultScreen = document.getElementById("result-screen");
const historyScreen = document.getElementById("history-screen");
const teacherScreen = document.getElementById("teacher-screen");
const testSetStudentScreen = document.getElementById("test-set-student-screen");
const allScreens = [
  homeScreen,
  startScreen,
  quizScreen,
  resultScreen,
  historyScreen,
  teacherScreen,
  testSetStudentScreen
];

// Phase2 Task20-A: ホーム画面の生徒選択欄。既存start-screenの生徒選択（下記
// studentNameInput等）とはDOM要素が別だが、選択処理はservices/student-service.jsの
// 既存関数（selectStudent等）をそのまま再利用し、別実装として複製しない。
const homeStudentNameInput = document.getElementById("home-student-name-input");
const homeStudentIdInput = document.getElementById("home-student-id");
const homeStudentSuggestions = document.getElementById("home-student-suggestions");
const homeSelectedStudentLabel = document.getElementById("home-selected-student-label");
const homeInfo = document.getElementById("home-info");
const homeEmptyMessage = document.getElementById("home-empty-message");
const homeError = document.getElementById("home-error");
const homeTotalStudyDays = document.getElementById("home-total-study-days");
const homeCurrentStreak = document.getElementById("home-current-streak");
const homeLatestStudy = document.getElementById("home-latest-study");
const homeWeakCount = document.getElementById("home-weak-count");
const homeDetailToggleWrap = document.getElementById("home-detail-toggle-wrap");
const homeDetailToggle = document.getElementById("home-detail-toggle");
const homeDetail = document.getElementById("home-detail");
const homeFieldList = document.getElementById("home-field-list");
const homeDormantList = document.getElementById("home-dormant-list");
const homeStartButton = document.getElementById("home-start-button");
const homeHistoryButton = document.getElementById("home-history-button");

const homeElements = {
  infoContainer: homeInfo,
  emptyMessage: homeEmptyMessage,
  errorMessage: homeError,
  totalStudyDays: homeTotalStudyDays,
  currentStreak: homeCurrentStreak,
  latestStudy: homeLatestStudy,
  weakCount: homeWeakCount,
  detailToggleWrap: homeDetailToggleWrap,
  detail: homeDetail,
  fieldList: homeFieldList,
  dormantList: homeDormantList,
  startButton: homeStartButton
};

// Phase2 Task23-1: 学習履歴詳細画面（history-screen）のDOM要素。
// history-renderer.jsはHistoryServiceのみを見て描画し、Repository/Storage/
// WeaknessService/HomeServiceへは一切アクセスしない（features/history/history-renderer.js参照）。
const historyEmptyMessage = document.getElementById("history-empty-message");
const historyError = document.getElementById("history-error");
const historyInfo = document.getElementById("history-info");
const historyTotalAnswered = document.getElementById("history-total-answered");
const historyCorrectRate = document.getElementById("history-correct-rate");
const historyTotalStudyDays = document.getElementById("history-total-study-days");
const historyCurrentStreak = document.getElementById("history-current-streak");
const historySubjectList = document.getElementById("history-subject-list");
const historyRecentList = document.getElementById("history-recent-list");
const historyBackButton = document.getElementById("history-back-button");

const historyElements = {
  infoContainer: historyInfo,
  emptyMessage: historyEmptyMessage,
  errorMessage: historyError,
  totalAnswered: historyTotalAnswered,
  correctRate: historyCorrectRate,
  totalStudyDays: historyTotalStudyDays,
  currentStreak: historyCurrentStreak,
  subjectList: historySubjectList,
  recentList: historyRecentList
};

// Task53: 講師用問題選定画面（teacher-screen）のDOM要素。
// teacher-controller.jsはこのelementsバッグを受け取るだけで、DOM取得は一切行わない
// （history-renderer.jsと同じ方針）。studentId関連の状態には一切触れない。
const homeTeacherModeButton = document.getElementById("home-teacher-mode-button");
const teacherBackButton = document.getElementById("teacher-back-button");

const teacherElements = {
  pinGate: document.getElementById("teacher-pin-gate"),
  pinInput: document.getElementById("teacher-pin-input"),
  pinSubmitButton: document.getElementById("teacher-pin-submit-button"),
  pinError: document.getElementById("teacher-pin-error"),
  form: document.getElementById("teacher-form"),
  schoolSelect: document.getElementById("teacher-school-select"),
  gradeSelect: document.getElementById("teacher-grade-select"),
  academicYearInput: document.getElementById("teacher-academic-year-input"),
  testsetListSection: document.getElementById("teacher-testset-list-section"),
  testsetListStatus: document.getElementById("teacher-testset-list-status"),
  testsetListContainer: document.getElementById("teacher-testset-list"),
  examRoundInput: document.getElementById("teacher-exam-round-input"),
  labelInput: document.getElementById("teacher-label-input"),
  fieldSelect: document.getElementById("teacher-field-select"),
  unitSelect: document.getElementById("teacher-unit-select"),
  subunitSelect: document.getElementById("teacher-subunit-select"),
  questionError: document.getElementById("teacher-question-error"),
  questionList: document.getElementById("teacher-question-list"),
  selectAllButton: document.getElementById("teacher-select-all-button"),
  deselectAllButton: document.getElementById("teacher-deselect-all-button"),
  selectionSummary: document.getElementById("teacher-selection-summary"),
  saveButton: document.getElementById("teacher-save-button"),
  saveResult: document.getElementById("teacher-save-result")
};

// 管理Phase M-2: 講師用「生徒別の間違い問題確認」セクションのDOM要素。
// teacher-history-controller.jsはこのelementsバッグを受け取るだけで、
// DOM取得は一切行わない（teacher-controller.jsと同じ方針）。
const teacherHistoryElements = {
  studentInput: document.getElementById("teacher-history-student-input"),
  studentIdInput: document.getElementById("teacher-history-student-id"),
  studentSuggestions: document.getElementById("teacher-history-student-suggestions"),
  selectedStudentLabel: document.getElementById("teacher-history-selected-student-label"),
  showButton: document.getElementById("teacher-history-show-button"),
  status: document.getElementById("teacher-history-status"),
  wrongList: document.getElementById("teacher-history-wrong-list")
};

// Task54: 生徒用「学校のテスト対策」選択画面（test-set-student-screen）のDOM要素。
// test-set-student-controller.jsはこのelementsバッグを受け取るだけで、DOM取得は
// 一切行わない（teacher-controller.jsと同じ方針）。studentId関連の状態には触れない。
const homeTestSetButton = document.getElementById("home-test-set-button");
const tssHomeBackButton = document.getElementById("tss-home-back-button");

// STEP5: TestSet専用のresume候補UI要素（sourceType==="testset"のcandidate表示専用、
// start-screenの#resume-progressとは別要素。既存tssElementsへは混ぜず、
// resume/discardのapp.js側ロジックだけが直接触るため独立して保持する）。
const tssResumeBlock = document.getElementById("tss-resume-progress");
const tssResumeText = document.getElementById("tss-resume-progress-text");
const tssResumeContinueButton = document.getElementById("tss-resume-continue-button");
const tssResumeDiscardButton = document.getElementById("tss-resume-discard-button");
const tssResumeError = document.getElementById("tss-resume-progress-error");

const tssElements = {
  selectStep: document.getElementById("tss-select-step"),
  listStep: document.getElementById("tss-list-step"),
  confirmStep: document.getElementById("tss-confirm-step"),
  schoolSelect: document.getElementById("tss-school-select"),
  gradeSelect: document.getElementById("tss-grade-select"),
  selectError: document.getElementById("tss-select-error"),
  searchButton: document.getElementById("tss-search-button"),
  listEmpty: document.getElementById("tss-list-empty"),
  testSetList: document.getElementById("tss-test-set-list"),
  confirmInfo: document.getElementById("tss-confirm-info"),
  confirmMessage: document.getElementById("tss-confirm-message"),
  startButton: document.getElementById("tss-start-button"),
  completeStep: document.getElementById("tss-complete-step"),
  completeInfo: document.getElementById("tss-complete-info")
};

// Phase2 Task21-3: 「苦手を復習」「復習する」ボタン押下時に呼ばれるコールバック。
// home-renderer.js はこれらの中身（Bridge呼び出し・クイズ開始）を一切知らない。
const homePracticeCallbacks = {
  onPracticeWeakField: startWeaknessReview,
  onPracticeDormantField: startDormantReview
};

const studentNameInput = document.getElementById("student-name-input");
const studentIdInput = document.getElementById("student-id");
const studentSuggestions = document.getElementById("student-suggestions");
const selectedStudentLabel = document.getElementById("selected-student-label");

const subjectSelect = document.getElementById("subject-select");
const unitFilterSelect = document.getElementById("unit-filter-select");
const modeFilterSelect = document.getElementById("mode-filter-select");
const subunitFilterSelect = document.getElementById("subunit-filter-select");
const questionCountSelect = document.getElementById("question-count");
const retryWrongOnlyCheckbox = document.getElementById("retry-wrong-only");
const startButton = document.getElementById("start-button");
const startHomeBackButton = document.getElementById("start-home-back-button");
const startError = document.getElementById("start-error");

// Phase3C本体: 開始画面の再開候補（中断→続きから再開）UI要素。
const resumeProgressBlock = document.getElementById("resume-progress");
const resumeProgressText = document.getElementById("resume-progress-text");
const resumeContinueButton = document.getElementById("resume-continue-button");
const resumeDiscardButton = document.getElementById("resume-discard-button");
const resumeProgressError = document.getElementById("resume-progress-error");

// STEP4: resume候補競合確認は、Home（苦手復習・復習推奨）・start-screen（開始）・
// TestSet（このテスト対策を始める）の複数画面から共通で使うため、特定の.screenの中に
// 置かず、画面遷移とは独立したグローバルモーダルとして持つ（1箇所に集約、複製しない）。
const globalConfirmModal = document.getElementById("global-confirm-modal");
const globalConfirmText = document.getElementById("global-confirm-text");
const globalConfirmError = document.getElementById("global-confirm-error");
const globalConfirmYesButton = document.getElementById("global-confirm-yes-button");
const globalConfirmCancelButton = document.getElementById("global-confirm-cancel-button");

const quizStudent = document.getElementById("quiz-student");
const quizSubject = document.getElementById("quiz-subject");
const quizProgress = document.getElementById("quiz-progress");
const quizScore = document.getElementById("quiz-score");
const quizUnit = document.getElementById("quiz-unit");
const furiganaToggleButton = document.getElementById("furigana-toggle-button");
const furiganaStatus = document.getElementById("furigana-status");
const choicesContainer = document.getElementById("choices-container");
const answerInput = document.getElementById("answer-input");
const submitButton = document.getElementById("submit-button");
const unknownAnswerButton = document.getElementById("unknown-answer-button");
const answerResult = document.getElementById("answer-result");
const nextButton = document.getElementById("next-button");
const backToStartButton = document.getElementById("back-to-start-button");

const finalStudent = document.getElementById("final-student");
const finalSubject = document.getElementById("final-subject");
const finalScore = document.getElementById("final-score");
const retryButton = document.getElementById("retry-button");
const backButton = document.getElementById("back-button");
const wrongRetryButton = document.getElementById("wrong-retry-button");

const questionElements = {
  get questionText() {
    return document.getElementById("question-text");
  },
  get choicesContainer() {
    return document.getElementById("choices-container");
  },
  get answerInput() {
    return document.getElementById("answer-input");
  },
  get submitButton() {
    return document.getElementById("submit-button");
  },
  get answerResult() {
    return document.getElementById("answer-result");
  },
  get questionImage() {
    return document.getElementById("question-image");
  },
  get mapClickContainer() {
    return document.getElementById("map-click-container");
  },
  get mapClickStatus() {
    return document.getElementById("map-click-status");
  }
};

const filterManager = createFilterManager({
  state,
  subjectSelect,
  unitFilterSelect,
  modeFilterSelect,
  subunitFilterSelect,
  normalizeQuestion,
  normalizeValue
});

homeStartButton.addEventListener("click", goToStartScreenFromHome);
homeDetailToggle.addEventListener("click", () => toggleHomeDetail(homeElements));
homeHistoryButton.addEventListener("click", goToHistoryScreen);
historyBackButton.addEventListener("click", returnToHome);

homeTeacherModeButton.addEventListener("click", goToTeacherScreen);
teacherBackButton.addEventListener("click", returnToHome);

homeTestSetButton.addEventListener("click", goToTestSetStudentScreen);
tssHomeBackButton.addEventListener("click", returnToHome);

startHomeBackButton.addEventListener("click", returnToHome);

startButton.addEventListener("click", startQuiz);
resumeContinueButton.addEventListener("click", handleResumeContinueClick);
resumeDiscardButton.addEventListener("click", handleResumeDiscardClick);
tssResumeContinueButton.addEventListener("click", handleTestSetResumeContinueClick);
tssResumeDiscardButton.addEventListener("click", handleTestSetResumeDiscardClick);
globalConfirmYesButton.addEventListener("click", handleGlobalConfirmYesClick);
globalConfirmCancelButton.addEventListener("click", handleGlobalConfirmCancelClick);
submitButton.addEventListener("click", handleSubmitButton);
unknownAnswerButton.addEventListener("click", () => handleAnswer(UNKNOWN_ANSWER_VALUE));
nextButton.addEventListener("click", goToNextQuestion);
retryButton.addEventListener("click", retryQuiz);
backButton.addEventListener("click", backToStart);
wrongRetryButton.addEventListener("click", retryWrongOnlyFromResult);
backToStartButton.addEventListener("click", backToStart);
furiganaToggleButton.addEventListener("click", handleFuriganaToggle);

subjectSelect.addEventListener("change", async () => {
  await filterManager.syncFiltersForSubjectChange();
});

unitFilterSelect.addEventListener("change", async () => {
  await filterManager.syncSubunitOptionsOnly();
});

modeFilterSelect.addEventListener("change", async () => {
  await filterManager.syncSubunitOptionsOnly();
});

answerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !state.ui.answered) {
    handleSubmitButton();
  }
});

initApp();

function initLocalState() {
  resetSessionState(state);
  resetQuizState(state);
  resetUiState(state);
  ensureMapSelectionState();
}

function ensureMapSelectionState() {
  if (!Array.isArray(state.ui.selectedMapAreaIds)) {
    state.ui.selectedMapAreaIds = [];
  }
}

async function initApp() {
  initLocalState();

  try {
    await Promise.all([
      loadActiveStudents(state),
      filterManager.syncFiltersForSubjectChange()
    ]);
    setupStudentAutocomplete();
    setupHomeStudentAutocomplete();
  } catch (error) {
    console.error("initApp error:", error);
    startError.textContent = "生徒一覧または問題設定の取得に失敗しました。GAS公開設定やCSVを確認してください。";
  }
}

// Phase2 Task14-2: Task14-1で発行されたAttemptのIDを、回答確定時のAnswerRecord保存で使うために保持する。
let currentDomainAttemptId = "";

// Phase3C本体: 開始画面の再開候補（getAttemptProgressの結果、候補なしはnull）。
let resumeCandidate = null;
// 生徒切替race対策: この番号が発行時点の最新値と一致する場合のみ結果を反映する。
let resumeCandidateRequestId = 0;
// グローバル確認モーダルの「はい」「キャンセル」押下時に実行する処理（用途により差し替える）。
let globalConfirmYesAction = null;
let globalConfirmCancelAction = null;

// STEP3/STEP4: resume候補が存在する状態で新しいAttemptを開始するすべての経路
// （通常「開始」・Home「苦手を復習」「復習する」・TestSet「このテスト対策を始める」）が
// 通る共通ガード。候補が無ければ即座にonProceedを実行してその戻り値をそのまま返す。
// 候補がある場合は確認モーダルを表示し、
//   - キャンセル: onProceedを実行せず、cancelResult（省略時undefined）で解決する
//   - はい→abandon失敗: onProceedを実行せず、abandonFailResult（省略時undefined）で解決する
//     （新規開始しない。エラーはグローバルモーダル内に表示する）
//   - はい→abandon成功: 旧resume候補を隠し、onProceedを実行してその戻り値をそのまま返す
// TestSet実行中の次グループ開始（finishCurrentTestSetGroupAndAdvance→startTestSetGroupQuiz）は
// この関数を経由しない（「このテスト対策を始める」の最初の1回だけをガードする、STEP6）。
function confirmAndAbandonResumeBeforeNewAttempt(onProceed, { cancelResult, abandonFailResult } = {}) {
  if (!resumeCandidate) {
    return onProceed();
  }

  const candidateAttemptId = resumeCandidate.attemptId;

  return new Promise((resolve) => {
    openGlobalConfirm(
      "前回の続きは再開できなくなります。新しく始めますか？",
      async () => {
        try {
          await abandonAttemptProgress(candidateAttemptId);
        } catch (error) {
          console.error("abandonAttemptProgress error（新規開始を中止します）:", error);
          globalConfirmError.textContent = "前回の続きの削除に失敗しました。通信環境を確認して、もう一度お試しください。";
          resolve(abandonFailResult);
          return;
        }
        closeGlobalConfirm();
        hideResumeCandidate();
        resolve(await onProceed());
      },
      () => resolve(cancelResult)
    );
  });
}

async function startQuiz() {
  await confirmAndAbandonResumeBeforeNewAttempt(executeStartQuiz);
}

async function executeStartQuiz() {
  const studentName = String(studentNameInput.value || "").trim();
  const studentId = String(studentIdInput.value || "").trim();
  const subject = String(subjectSelect.value || "").trim();
  const unitFilter = String(unitFilterSelect.value || "all").trim();
  const modeFilter = String(modeFilterSelect.value || "all").trim();
  const subunitFilter = String(subunitFilterSelect.value || "all").trim();
  const requestedQuestionCount = Number(questionCountSelect.value || 10);

  startError.textContent = "";

  try {
    startButton.disabled = true;
    startButton.textContent = "読込中...";

    const result = await prepareQuizStart({
      state,
      filterManager,
      normalizeValue,
      studentName,
      studentId,
      subject,
      unitFilter,
      modeFilter,
      subunitFilter,
      requestedQuestionCount,
      retryWrongEnabled: retryWrongOnlyCheckbox.checked
    });

    if (!result.ok) {
      startError.textContent = result.errorMessage || "開始に失敗しました。";
      return;
    }

    await beginAttemptAndShowQuiz("normal", null, unitFilter);
  } catch (error) {
    console.error("startQuiz error:", error);
    startError.textContent = "開始に失敗しました。GAS URLやCSVを確認してください。";
  } finally {
    startButton.disabled = false;
    startButton.textContent = "開始";
  }
}

// Phase2 Task14-1相当の裏側処理（QuestionSet/Attempt生成）とクイズ画面表示をまとめた
// 共通処理。state.quiz.quizQuestions・state.session.subject等が既に正しく設定済みで
// あることを前提とする（通常のstartQuiz()、Task21-3の苦手復習・復習推奨開始、Task55の
// TestSet実行の全てから呼ばれる。既存の出題フロー・裏側の記録処理自体は一切変更しない）。
//
// Phase5-6: sourceType/testSetIdは呼び出し元（既知の開始経路）が明示的に渡す。
// 「値が無ければnormal」という後方互換fallbackはしない（起点不明のまま送るより、
// 呼び出し元の実装漏れとして気づける方を優先する）。
// Phase3B-2: unitFilterも呼び出し元が渡す（state.session.unitFilterは呼び出し元によって
// "all"固定の場合と実際の選択値の場合があるため、ここではなく各呼び出し元の直前で
// 読む）。resolveUnitForSourceType()がsourceType==="normal"以外を空文字へ正規化する。
// Phase3C前提: retryWrongEnabledは、この時点で既にstate.session.retryWrongEnabledへ
// 呼び出し元（startQuiz/startPracticeSession/startTestSetGroupQuiz）が正しい実効値を
// 設定済みのため、ここで直接読むだけでよい（新しい引数を各呼び出し元へ増やさない）。
async function beginAttemptAndShowQuiz(sourceType, testSetId = null, unitFilter = "") {
  try {
    const domainAttemptResult = await startAttemptForQuiz({
      quizQuestions: state.quiz.quizQuestions,
      subject: state.session.subject,
      studentId: state.session.studentId,
      sourceType,
      testSetId,
      unit: resolveUnitForSourceType(sourceType, unitFilter),
      retryWrongEnabled: state.session.retryWrongEnabled
    });
    currentDomainAttemptId = domainAttemptResult ? domainAttemptResult.attempt.attemptId : "";
  } catch (domainError) {
    console.error("startAttemptForQuiz error（既存の出題フローには影響しません）:", domainError);
    currentDomainAttemptId = "";
  }

  await renderQuestion();
  // TestSet実行中は「開始画面へ戻る」が通常学習のstart-screenへ迷い込ませてしまうため、
  // 文言を「テスト対策へ戻る」に変える（backToStart()側の遷移先切り替えと対）。
  backToStartButton.textContent = isRunnerActive() ? "テスト対策へ戻る" : "開始画面へ戻る";
  showQuizScreen(quizScreen, allScreens);
}

// Phase5-6: home-practice-controller.jsのpracticeType（"weak"/"dormant"、既存の内部呼称）と、
// Attemptのsource Type（"weak_review"/"dormant_review"、domain-model-v1.md 3.11.1節の正式値）は
// 文字列表現が異なるため、ここで変換する。他ファイルへ波及させない最小限のマッピング。
const PRACTICE_TYPE_TO_SOURCE_TYPE = {
  weak: "weak_review",
  dormant: "dormant_review"
};

// Phase2 Task21-3/Task22-2: ホーム画面の「苦手を復習」「復習する」から、既存start-screenの
// 科目/単元/分野/出題形式選択を経由せず直接quiz-screenへ入るための共通処理。
// どのBridge（苦手/復習推奨）を使うか・questionId突き合わせ自体は
// features/home/home-practice-controller.js（buildHomePracticeQuiz）に委譲し、
// ここでは「controllerを呼ぶ→0件なら中断→stateへ反映→既存クイズ開始処理を呼ぶ」という
// 画面固有の配線のみを行う（0件の場合はクイズを開始しない、というご指示のとおり）。
async function startPracticeSession(fieldId, practiceType) {
  if (!state.session.studentId || !fieldId) return;

  homeError.textContent = "";

  const availableQuestions = await filterManager.getNormalizedQuestionsForSubject(fieldId);
  const practiceResult = buildHomePracticeQuiz({
    studentId: state.session.studentId,
    fieldId,
    practiceType,
    availableQuestions
  });

  if (practiceResult.questions.length === 0) {
    homeError.textContent = "現在解ける問題がありません。時間をおいて再度お試しください。";
    return;
  }

  state.session.subject = fieldId;
  state.session.unitFilter = "all";
  state.session.modeFilter = "all";
  state.session.subunitFilter = "all";
  state.session.requestedQuestionCount = practiceResult.questions.length;

  resetQuizState(state);
  resetUiState(state);

  state.quiz.allQuestions = practiceResult.questions;
  state.quiz.quizQuestions = pickQuestions(practiceResult.questions, practiceResult.questions.length);

  await beginAttemptAndShowQuiz(PRACTICE_TYPE_TO_SOURCE_TYPE[practiceType] || null, null, state.session.unitFilter);
}

// STEP7: 苦手復習・復習推奨もresume候補競合の共通ガードを通す
// （practiceType自体はstartPracticeSession内部でsourceTypeへ変換されるため、
// ここでは呼び出し方を変えるだけで既存のマッピングロジックには触れない）。
function startWeaknessReview(fieldId) {
  return confirmAndAbandonResumeBeforeNewAttempt(() => startPracticeSession(fieldId, "weak"));
}

function startDormantReview(fieldId) {
  return confirmAndAbandonResumeBeforeNewAttempt(() => startPracticeSession(fieldId, "dormant"));
}

function getQuestionId(question) {
  const rawId = String(question?.questionId ?? question?.id ?? "").trim();
  if (rawId) return rawId;
  return buildFallbackQuestionId(question || {}, state.session.subject || "");
}

// Task F-1/F-2: ふりがなON/OFF切替。
// トグル自体はrenderQuestion()を呼び直さない（state.ui.answered等がリセットされ、
// 既に解答済みの問題が誤って未解答状態へ戻ってしまうため）。代わりに、現在画面に
// 出ている問題文・choiceボタン・sort項目のテキストだけを、既存の解答済み状態
// （ロック・正誤色・selectedChoice等）を一切変えずに再描画する。
async function handleFuriganaToggle() {
  const nextEnabled = !isFuriganaEnabled();
  setFuriganaEnabled(nextEnabled);
  furiganaToggleButton.textContent = nextEnabled ? "ふりがな ON" : "ふりがな OFF";
  furiganaToggleButton.setAttribute("aria-pressed", String(nextEnabled));

  if (!nextEnabled) {
    furiganaStatus.textContent = "";
    refreshFuriganaDisplay();
    return;
  }

  furiganaStatus.textContent = "ふりがなを準備中…";
  const ready = await ensureFuriganaEngineReady();

  // 準備中にもう一度OFFへ切り替えられていたら、ここでONへ戻さない。
  if (!isFuriganaEnabled()) {
    furiganaStatus.textContent = "";
    return;
  }

  if (!ready) {
    furiganaStatus.textContent = "ふりがなの準備に失敗しました。通常表示のまま続けられます。";
    setFuriganaEnabled(false);
    furiganaToggleButton.textContent = "ふりがな OFF";
    furiganaToggleButton.setAttribute("aria-pressed", "false");
    return;
  }

  furiganaStatus.textContent = "";
  refreshFuriganaDisplay();
}

// 現在表示中の問題文・choice/eraボタン・sort項目のテキストだけを、
// ふりがな設定に合わせて再描画する（クイズの進行状態・解答結果には触れない）。
function refreshFuriganaDisplay() {
  const question = state.quiz.currentQuestion;
  if (!question) return;

  applyFuriganaText(questionElements.questionText, question.question || questionElements.questionText.textContent);

  if (question.mode === "choice" || question.mode === "era") {
    choicesContainer.querySelectorAll(".choice-button").forEach((button) => {
      const value = button.dataset.choiceValue;
      if (value !== undefined) applyFuriganaText(button, value);
    });
  }

  if (question.mode === "sort") {
    drawSortList(choicesContainer, state, (fromIndex, toIndex) => {
      if (state.ui.answered) return;
      swapSortItems(fromIndex, toIndex);
    });
  }
}

async function renderQuestion() {
  await renderCurrentQuestion({
    state,
    questionElements,
    nextButton,
    answerResult,
    quizStudent,
    quizSubject,
    quizProgress,
    quizScore,
    quizUnit,
    buildQuizMetaText,
    resetQuestionArea,
    renderMapClickQuestion,
    renderEraQuestion,
    renderSortQuestion,
    renderChoiceQuestion,
    renderTextQuestion,
    ERA_CHOICES,
    handleAnswer,
    swapSortItems,
    hideSubunit: isRunnerActive()
  });
}

function resetQuestionArea() {
  ensureMapSelectionState();

  state.ui.selectedChoice = "";
  state.ui.selectedMapArea = "";
  state.ui.selectedMapAreaId = "";
  state.ui.selectedMapAreaIds = [];

  choicesContainer.innerHTML = "";
  choicesContainer.className = "choices";

  answerInput.value = "";
  answerInput.style.display = "none";

  submitButton.style.display = "none";
  submitButton.disabled = false;

  unknownAnswerButton.disabled = false;

  answerResult.classList.remove("correct", "incorrect");
  answerResult.style.color = "";

  questionElements.questionImage.classList.add("hidden");
  questionElements.questionImage.src = "";
  questionElements.questionImage.alt = "";

  resetMapClickArea(questionElements);
}

function swapSortItems(fromIndex, toIndex) {
  const copied = [...state.ui.currentSortOrder];
  [copied[fromIndex], copied[toIndex]] = [copied[toIndex], copied[fromIndex]];
  state.ui.currentSortOrder = copied;

  drawSortList(choicesContainer, state, (newFrom, newTo) => {
    if (state.ui.answered) return;
    swapSortItems(newFrom, newTo);
  });
}

function handleSubmitButton() {
  if (state.ui.answered) return;

  const currentMode = state.quiz.currentQuestion?.mode;

  if (currentMode === "map_click") {
    handleAnswer(getSelectedMapAnswer(state));
    return;
  }

  if (currentMode === "sort") {
    handleAnswer([...state.ui.currentSortOrder]);
    return;
  }

  handleAnswer(answerInput.value.trim());
}

function toJudgeableMapClickAnswer(selectedChoice) {
  if (!Array.isArray(selectedChoice)) {
    return selectedChoice;
  }

  return [...selectedChoice]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

function handleAnswer(selectedChoice) {
  if (state.ui.answered) return;

  if (
    selectedChoice === undefined ||
    selectedChoice === null ||
    (typeof selectedChoice === "string" && !selectedChoice) ||
    (Array.isArray(selectedChoice) && selectedChoice.length === 0)
  ) {
    return;
  }

  state.ui.answered = true;
  unknownAnswerButton.disabled = true;

  const question = state.quiz.currentQuestion;
  const isUnknownAnswer = selectedChoice === UNKNOWN_ANSWER_VALUE;

  const judgeTarget =
    question?.mode === "map_click"
      ? toJudgeableMapClickAnswer(selectedChoice)
      : selectedChoice;

  const correctAnswer = getCorrectAnswer(question);
  // 「わからない」はjudgeAnswer()の偶然の不一致に依存せず、明示的にisCorrect=falseとする
  // （STEP4の方針どおり。judgeAnswer・AnswerRecordモデル・GAS契約は無変更）。
  const isCorrect = isUnknownAnswer ? false : judgeAnswer(question, judgeTarget, normalizeValue);

  const displaySelectedChoice =
    question?.mode === "map_click"
      ? formatMapClickChoiceForDisplay(selectedChoice, getMapAreaLabelById)
      : judgeTarget;

  const { savePayload } = applyAnswerResult({
    state,
    question,
    selectedChoice: displaySelectedChoice,
    correctAnswer,
    isCorrect,
    getQuestionId,
    buildResultMessage,
    getMapAreaLabelById,
    buildSavedSubjectName,
    normalizeValue,
    choicesContainer,
    questionElements,
    quizScore,
    nextButton,
    answerResult,
    lockChoiceButtons,
    drawSortList,
    swapSortItems,
    lockMapClickVisuals,
    rawSelectedChoice: selectedChoice
  });

  saveAnswerRecord(savePayload);

  // Phase2 Task14-2: 裏側でAnswerRecordを生成・保存する（既存の正誤判定・GAS保存には影響しない）
  try {
    recordAnswerForAttempt({
      attemptId: currentDomainAttemptId,
      studentId: savePayload.studentId,
      questionId: savePayload.questionId,
      fieldId: state.session.subject,
      unit: savePayload.unit,
      selectedChoice: savePayload.selectedChoice,
      correctAnswer: savePayload.correctAnswer,
      isCorrect: savePayload.isCorrect,
      // Phase3B-2: 「次に表示すべき問題のindex」。「次へ」クリック時ではなく回答確定時点で
      // 送ることで、ブラウザが閉じられても回答済みの問題へ再開時に戻ってしまうズレを防ぐ
      // （state.quiz.currentIndexはこの時点ではまだ「今answerした問題」のindexのまま、
      // goToNextQuestion()が押されるまでインクリメントされない）。
      currentQuestionIndex: state.quiz.currentIndex + 1
    });
  } catch (domainError) {
    console.error("recordAnswerForAttempt error（既存の回答フローには影響しません）:", domainError);
  }
}

function formatMapClickChoiceForDisplay(selectedChoice, getMapAreaLabelById) {
  if (Array.isArray(selectedChoice)) {
    return selectedChoice
      .map((item) => getMapAreaLabelById(item) || String(item ?? ""))
      .join(" | ");
  }

  return String(selectedChoice ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => getMapAreaLabelById(item) || item)
    .join(" | ");
}

function normalizeValue(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/　/g, "")
    .trim()
    .toLowerCase();
}

function goToNextQuestion() {
  if (state.quiz.currentIndex < state.quiz.quizQuestions.length - 1) {
    state.quiz.currentIndex += 1;
    renderQuestion();
    return;
  }

  if (!state.quiz.retryMode && state.session.retryWrongEnabled && state.quiz.wrongQuestions.length > 0) {
    startRetryWrongRound(state);
    // Phase3B-2: startRetryWrongRound()実行後はstate.quiz.quizQuestionsが
    // シャッフル済みのwrong問題一覧に置き換わっているため、この時点で抽出した順序が
    // 「retryで実際に出題される順序」と一致する（wrongQuestionIdsとして送るのはこの順序）。
    syncAttemptProgressRetryStart(currentDomainAttemptId, extractQuestionIds(state.quiz.quizQuestions));
    renderQuestion();
    return;
  }

  showFinalResult();
}

function showFinalResult() {
  // Task55: TestSet実行中は、既存result-screenを表示せず次グループへ連続実行する
  // （通常学習のresult-screen・retry/wrong-retryボタンはTestSet実行中は一切使わない、
  // Task55確定方針）。既存Attempt完了処理（completeAttempt）は各グループとも通常学習と
  // 全く同じ経路をそのまま通す。
  if (isRunnerActive()) {
    finishCurrentTestSetGroupAndAdvance();
    return;
  }

  renderFinalResult(state, {
    finalStudent,
    finalSubject,
    finalScore,
    wrongRetryButton
  });
  showResultScreen(resultScreen, allScreens);

  // Phase2 Task14-3: 裏側でAttemptを完了状態へ更新する（既存のリザルト表示には影響しない）
  try {
    completeAttempt(currentDomainAttemptId);
  } catch (domainError) {
    console.error("completeAttempt error（既存のリザルト表示フローには影響しません）:", domainError);
  }
}

// Task55: TestSetの現在グループの結果を記録し、次グループがあれば続けてQuizを開始する。
// 全グループ完了時のみTestSet全体完了として扱う（result-controller.jsのrenderFinalResultと
// 同じ集計方式：間違い直しラウンドがあった場合はfirstRoundScore/firstRoundTotalを本来の
// 結果として使う。これはAnswerRecord・History・Weaknessが元の解答を基準にしているのと
// 一致させるため）。
async function finishCurrentTestSetGroupAndAdvance() {
  const groupCorrect = state.quiz.retryMode ? state.quiz.firstRoundScore : state.quiz.score;
  const groupTotal = state.quiz.retryMode ? state.quiz.firstRoundTotal : state.quiz.quizQuestions.length;
  recordCurrentGroupResult(groupCorrect, groupTotal);

  // Phase2 Task14-3と同じ既存Attempt完了処理。TestSetの各グループも通常学習と同じ
  // Attempt/AnswerRecord経路を通っているため、History/Weaknessは無改修で反映される。
  try {
    completeAttempt(currentDomainAttemptId);
  } catch (domainError) {
    console.error("completeAttempt error（TestSet実行フローには影響しません）:", domainError);
  }

  if (hasNextGroup()) {
    const nextGroup = advanceToNextGroup();
    await startTestSetGroupQuiz(nextGroup.fieldId, nextGroup.questionIds);
    return;
  }

  const summary = finishRun();
  showTestSetCompletion(tssElements, summary);
  showTestSetStudentScreen(testSetStudentScreen, allScreens);
}

function retryQuiz() {
  restartQuiz(state);
  renderQuestion();
  showQuizScreen(quizScreen, allScreens);
}

function retryWrongOnlyFromResult() {
  if (!state.quiz.wrongQuestions.length) return;
  startRetryWrongRound(state);
  showQuizScreen(quizScreen, allScreens);
  renderQuestion();
}

function backToStart() {
  // Task56: TestSet実行中にQuiz画面から離脱した場合、通常学習のstart-screenではなく
  // 「学校のテスト対策」画面へ戻す。abortRun()を先に呼ぶとisRunnerActive()が
  // falseになり判定できなくなるため、判定結果を先に保持しておく。
  const wasTestSetRun = isRunnerActive();

  if (wasTestSetRun) {
    abortRun();
  }

  if (wasTestSetRun) {
    // 既存のgoToTestSetStudentScreen()をそのまま再利用する（studentIdガード込み）。
    // initTestSetStudentScreen()が呼ばれるため、school/grade選択・currentIndex・
    // 復習状態等のtssState/runner stateは残らず、次回開始時は必ずphy_001から
    // 新規開始できる（誤操作防止のため毎回リセットする既存方針、Task54と同じ）。
    //
    // UI改善: 「テスト対策へ戻る」はabandonAttemptProgressを呼ばない中断であり、
    // サーバー側progressはin_progressのまま残る（STEP14）。この直後にTestSet画面へ
    // 戻ってきた場合、更新済みのcurrentQuestionIndexで再度「前回の続きから」を
    // 表示できるよう、backToStart()の通常quiz分岐と同じくresume候補を取り直す。
    hideResumeCandidate();
    fetchResumeCandidateForStartScreen();
    goToTestSetStudentScreen();
    return;
  }

  resetStartScreenMessages({
    startError,
    answerResult
  });

  // Phase2 Task21-3: 苦手復習・復習推奨はhome-screenからstart-screenを経由せず直接
  // quiz-screenへ入るため、そこから結果画面を経て「開始画面へ戻る」を押した場合、
  // start-screen側の生徒入力欄が一度も同期されていない状態になり得る。既存の
  // syncStartScreenStudentDisplay()（Task20-C）を呼ぶだけで、選択処理自体は作り直さない。
  // 通常のstart-screen経由フローでは既に同じ値が入っているため、この呼び出しは
  // 実質的に無害（べき等）。
  syncStartScreenStudentDisplay();
  showStartScreen(startScreen, allScreens);

  // STEP18: 中断（このbackToStart自体、既存どおりcompleteAttempt/abandonAttemptProgressは
  // 呼ばない）直後に再び開始画面へ戻ってきた場合も、goToStartScreenFromHomeと同じく
  // resume候補を取り直す（resume済みセッションをさらに中断した場合に、新しい
  // currentQuestionIndexで再度resume表示できるようにするため）。
  hideResumeCandidate();
  fetchResumeCandidateForStartScreen();
}

function setupStudentAutocomplete() {
  studentNameInput.addEventListener("input", handleStudentInput);

  studentNameInput.addEventListener("focus", () => {
    renderStudentSuggestions(
      studentSuggestions,
      state.session.activeStudents.slice(0, 20),
      handleStudentSelect
    );
  });

  document.addEventListener("click", (event) => {
    if (!studentSuggestions.contains(event.target) && event.target !== studentNameInput) {
      studentSuggestions.classList.add("hidden");
    }
  });
}

function handleStudentInput() {
  const keyword = String(studentNameInput.value || "").trim().toLowerCase();

  studentIdInput.value = "";
  selectedStudentLabel.textContent = "";
  selectedStudentLabel.classList.add("hidden");

  state.session.studentId = "";
  state.session.studentName = "";

  const filtered = filterStudents(state.session.activeStudents, keyword);

  renderStudentSuggestions(
    studentSuggestions,
    filtered.slice(0, 20),
    handleStudentSelect
  );
}

function handleStudentSelect(student) {
  selectStudent({
    student,
    state,
    studentNameInput,
    studentIdInput,
    selectedStudentLabel,
    studentSuggestions
  });
}

// Phase2 Task20-A/B: ホーム画面の生徒選択・情報表示。
// 生徒検索・選択のロジック自体はservices/student-service.jsの既存関数
// （filterStudents/renderStudentSuggestions/selectStudent、上記setupStudentAutocomplete等と同じもの）
// をそのまま再利用し、別実装として複製しない。DOM要素だけがhome-screen用に異なる。
function setupHomeStudentAutocomplete() {
  homeStudentNameInput.addEventListener("input", handleHomeStudentInput);

  homeStudentNameInput.addEventListener("focus", () => {
    renderStudentSuggestions(
      homeStudentSuggestions,
      state.session.activeStudents.slice(0, 20),
      handleHomeStudentSelect
    );
  });

  document.addEventListener("click", (event) => {
    if (!homeStudentSuggestions.contains(event.target) && event.target !== homeStudentNameInput) {
      homeStudentSuggestions.classList.add("hidden");
    }
  });
}

function handleHomeStudentInput() {
  const keyword = String(homeStudentNameInput.value || "").trim().toLowerCase();

  homeStudentIdInput.value = "";
  homeSelectedStudentLabel.textContent = "";
  homeSelectedStudentLabel.classList.add("hidden");

  state.session.studentId = "";
  state.session.studentName = "";
  renderHomeForStudent("", homeElements, homePracticeCallbacks);

  const filtered = filterStudents(state.session.activeStudents, keyword);

  renderStudentSuggestions(
    homeStudentSuggestions,
    filtered.slice(0, 20),
    handleHomeStudentSelect
  );
}

function handleHomeStudentSelect(student) {
  selectStudent({
    student,
    state,
    studentNameInput: homeStudentNameInput,
    studentIdInput: homeStudentIdInput,
    selectedStudentLabel: homeSelectedStudentLabel,
    studentSuggestions: homeStudentSuggestions
  });

  renderHomeForStudent(state.session.studentId, homeElements, homePracticeCallbacks);

  // 生徒切替時は前の生徒のresume候補表示を即座にクリアする
  // （Home「苦手を復習」「復習する」はstart-screenを経由しないため、resume候補は
  // start-screen訪問を待たずここで取得しておく必要がある、STEP7）。
  hideResumeCandidate();

  // Phase5-4: 現在のMemoryStorage内容でHomeを即座に表示した後、裏で学習記録GASから
  // 過去のAttempt/AnswerRecordを取得しMemoryStorageへ復元する（fire-and-forget、
  // ここではawaitしない）。復元完了時に生徒が切り替わっていた場合、古い生徒のデータで
  // 現在のHome表示を上書きしないよう、再描画前に選択中studentIdの一致を確認する。
  const restoringStudentId = state.session.studentId;
  restoreStudentLearningRecords(restoringStudentId).then((result) => {
    if (result.ok && state.session.studentId === restoringStudentId) {
      renderHomeForStudent(state.session.studentId, homeElements, homePracticeCallbacks);
    }
    // STEP7: resume候補の判定(loadAttempt存在チェック、fetchResumeCandidateForStartScreen内)は
    // restoreStudentLearningRecordsによるAttempt Repository復元が終わった後でないと
    // 正しく行えないため、成否に関わらずこの直後に呼ぶ（内部でstudentId一致を再確認する）。
    fetchResumeCandidateForStartScreen();
  });
}

// Phase2 Task20-C: ホーム画面で選択済みのstudentId（state.session.studentId）は新しく
// 作らず、既存start-screen側の表示（studentNameInput/studentIdInput/selectedStudentLabel）
// だけを最小限同期する。student-service.jsの選択処理自体（selectStudent等）は呼び直さない。
function syncStartScreenStudentDisplay() {
  studentNameInput.value = state.session.studentName || "";
  studentIdInput.value = state.session.studentId || "";

  if (state.session.studentId) {
    selectedStudentLabel.textContent = `選択中：${state.session.studentId} ${state.session.studentName}`;
    selectedStudentLabel.classList.remove("hidden");
  }
}

function goToStartScreenFromHome() {
  if (!state.session.studentId) return;

  syncStartScreenStudentDisplay();
  showStartScreen(startScreen, allScreens);

  // STEP7: studentId確定・開始画面表示のタイミングでresume候補を取得する
  // （studentId不明時はfetchResumeCandidateForStartScreen自体が何もしない）。
  hideResumeCandidate();
  fetchResumeCandidateForStartScreen();
}

// STEP7/STEP8: 開始画面表示のたびに、その時点で選択中のstudentIdについて
// resume候補（getAttemptProgress）を取得する。生徒切替race対策として、
// 発行時のrequestId・studentIdが取得完了時点でも最新であることを確認してから
// 反映する（Phase5-4のrestoringStudentId確認と同じ考え方）。
async function fetchResumeCandidateForStartScreen() {
  const studentId = state.session.studentId;
  if (!studentId) return;

  const requestId = ++resumeCandidateRequestId;

  let result;
  try {
    result = await getAttemptProgress(studentId);
  } catch (error) {
    // STEP37: 取得失敗時もアプリ全体・新規開始は通常どおり利用可能なままにする。
    console.error("getAttemptProgress error（開始画面は通常どおり利用できます）:", error);
    return;
  }

  if (requestId !== resumeCandidateRequestId || state.session.studentId !== studentId) {
    return; // このリクエストは既に古い（生徒切替後）ため破棄する
  }

  if (!result.progress) {
    hideResumeCandidate();
    return;
  }

  // 復元先AttemptがRepositoryに存在しない場合（restoreStudentLearningRecords失敗等）は
  // resumeを提示しない（completeAttempt等が後で失敗する不整合な状態を避けるため）。
  if (!loadAttempt(result.progress.attemptId)) {
    console.error(
      "getAttemptProgressの再開候補に対応するAttemptがRepositoryに見つかりません（resumeを表示しません）:",
      result.progress.attemptId
    );
    hideResumeCandidate();
    return;
  }

  showResumeCandidate(result.progress);
}

// STEP5/6/10/11/12: resume候補の表示。内部値（sourceType/testSetId等）は表示せず、
// 既存SUBJECT_CONFIGのlabelのみを使う（新しいlabel mapは作らない）。
// sourceType==="testset"のcandidateはstart-screenではなくTestSet画面側へのみ出す
// （同じcandidateを複数画面へ常時表示しないため、STEP6）。
function showResumeCandidate(progress) {
  resumeCandidate = progress;
  resumeProgressBlock.classList.add("hidden");
  tssResumeBlock.classList.add("hidden");

  if (progress.sourceType === "testset") {
    showTestSetResumeCandidate(progress);
    return;
  }

  const subjectLabel = SUBJECT_CONFIG[progress.fieldId]?.label || progress.fieldId;
  const unitLabel = progress.unit && progress.unit !== "all" ? ` / ${progress.unit}` : "";
  resumeProgressText.textContent = `前回の続き：${subjectLabel}${unitLabel}`;

  resumeProgressError.textContent = "";
  closeGlobalConfirm();
  resumeProgressBlock.classList.remove("hidden");
}

// STEP5/7: TestSet専用のresume候補表示。TestSet名の解決には、resumeQuiz()のTestSet
// resumeで既に使っているloadTestSet()をそのまま再利用する（新規API追加なし）。
// 名称取得に失敗しても、続きから/この続きはやめる自体は利用可能なままにする。
async function showTestSetResumeCandidate(progress) {
  tssResumeError.textContent = "";
  tssResumeText.textContent = "前回のテスト対策の続き";
  closeGlobalConfirm();
  tssResumeBlock.classList.remove("hidden");

  if (!progress.testSetId) return;

  try {
    const { testSet } = await loadTestSet(progress.testSetId);
    // 表示準備中にresumeCandidateが差し替わっていた場合（生徒切替・discard等）は上書きしない。
    if (resumeCandidate === progress && testSet?.label) {
      tssResumeText.textContent = `前回の続き：${testSet.label}`;
    }
  } catch (error) {
    console.error("loadTestSet error（TestSet名の表示のみ失敗、resumeボタン自体は利用可能です）:", error);
  }
}

function hideResumeCandidate() {
  resumeCandidate = null;
  resumeProgressBlock.classList.add("hidden");
  tssResumeBlock.classList.add("hidden");
  closeGlobalConfirm();
  resumeProgressError.textContent = "";
  tssResumeError.textContent = "";
}

// STEP4/14/15: 画面非依存の共通確認モーダル（resume discard・新規開始競合の両方で使う、複製しない）。
function openGlobalConfirm(text, onYes, onCancel = () => {}) {
  globalConfirmError.textContent = "";
  globalConfirmText.textContent = text;
  globalConfirmYesAction = onYes;
  globalConfirmCancelAction = onCancel;
  globalConfirmModal.classList.remove("hidden");
}

function closeGlobalConfirm() {
  globalConfirmModal.classList.add("hidden");
  globalConfirmYesAction = null;
  globalConfirmCancelAction = null;
  globalConfirmError.textContent = "";
}

// STEP39/40: 連打対策（処理中はボタンをdisabledにする）。
async function handleGlobalConfirmYesClick() {
  const action = globalConfirmYesAction;
  if (!action) return;

  globalConfirmYesButton.disabled = true;
  globalConfirmCancelButton.disabled = true;
  try {
    await action();
  } finally {
    globalConfirmYesButton.disabled = false;
    globalConfirmCancelButton.disabled = false;
  }
}

function handleGlobalConfirmCancelClick() {
  const onCancel = globalConfirmCancelAction;
  closeGlobalConfirm();
  onCancel();
}

// start-screen・TestSet画面のどちらの「この続きはやめる」からも共通で使う
// （STEP9、abandonAttemptProgress経路は複製しない）。errorElementだけ呼び出し元で切り替える。
function performResumeDiscard(errorElement) {
  if (!resumeCandidate) return;

  const candidateAttemptId = resumeCandidate.attemptId;
  openGlobalConfirm("前回の続きからは再開できなくなります。よろしいですか？", async () => {
    try {
      await abandonAttemptProgress(candidateAttemptId);
    } catch (error) {
      // STEP16: 失敗時は候補を消したことにしない。
      console.error("abandonAttemptProgress error:", error);
      errorElement.textContent = "削除に失敗しました。通信環境を確認して、もう一度お試しください。";
      return;
    }
    closeGlobalConfirm();
    hideResumeCandidate();
  });
}

function handleResumeDiscardClick() {
  performResumeDiscard(resumeProgressError);
}

function handleTestSetResumeDiscardClick() {
  performResumeDiscard(tssResumeError);
}

// start-screen・TestSet画面のどちらの「続きから」からも共通で使う
// （STEP8、resumeQuiz()経路は複製しない）。連打対策のdisable対象ボタンだけ呼び出し元で切り替える。
async function performResumeContinue(buttonsToDisable) {
  if (!resumeCandidate) return;

  buttonsToDisable.forEach((button) => { button.disabled = true; });
  try {
    await resumeQuiz(resumeCandidate);
  } finally {
    buttonsToDisable.forEach((button) => { button.disabled = false; });
  }
}

async function handleResumeContinueClick() {
  await performResumeContinue([resumeContinueButton, resumeDiscardButton]);
}

async function handleTestSetResumeContinueClick() {
  await performResumeContinue([tssResumeContinueButton, tssResumeDiscardButton]);
}

// STEP20-STEP36: 「続きから」本体。新規Attempt/QuestionSetは一切生成せず、
// progress.attemptIdをそのまま使い回す。questionIds/wrongQuestionIdsの再抽選・
// 再shuffleは行わない（core/quiz-controller.jsのprepareResumedQuiz参照）。
async function resumeQuiz(progress) {
  resumeProgressError.textContent = "";
  startError.textContent = "";

  const questions = await filterManager.getNormalizedQuestionsForSubject(progress.fieldId);
  const answerRecords = loadAnswerRecordsByAttempt(progress.attemptId);

  // STEP33: TestSet resumeは、既存loadTestSet()と、生徒選択時に既に復元済みの
  // Attempt一覧からrunnerStateを再構築してから、通常のprepareResumedQuizへ合流する。
  if (progress.sourceType === "testset") {
    let testSetData;
    try {
      testSetData = await loadTestSet(progress.testSetId);
    } catch (error) {
      console.error("loadTestSet error（resume不可）:", error);
      resumeProgressError.textContent =
        "前回の続き（テスト対策）のデータ取得に失敗しました。通信環境を確認して、もう一度お試しください。";
      return;
    }

    const priorAttempts = loadAttemptsByStudent(state.session.studentId);
    const runnerResult = restoreRunnerState({
      testSet: testSetData.testSet,
      questions: testSetData.questions,
      resumeFieldId: progress.fieldId,
      priorAttempts
    });

    if (!runnerResult.ok) {
      resumeProgressError.textContent = runnerResult.errorMessage;
      return;
    }
  }

  const result = prepareResumedQuiz({ state, questions, progress, answerRecords });
  if (!result.ok) {
    // STEP21: questionId欠落・境界不正時はresumeを開始しない
    // （「この続きはやめる」は引き続き利用可能なまま）。
    resumeProgressError.textContent = result.errorMessage;
    return;
  }

  currentDomainAttemptId = progress.attemptId;
  restoreAttemptProgressContext(progress);

  // 学習記録GASのstartAttempt契約にはtotalCountが含まれない（gas-api-contract-v1.md §5.1）ため、
  // 復元直後のAttempt.totalCountは常に未確定(0)のままになる（非resumeの通常フローでは、
  // Attemptオブジェクトが生成時からページ内に残り続けるため顕在化しなかった問題）。
  // completeAttempt()が誤ったtotalCount=0を送信しないよう、progress.questionIds（開始時点の
  // 出題数、resumeでも再抽選しない値）から復元する。将来GAS側がtotalCountを返すようになった
  // 場合に備え、既に正しい値が入っている場合は上書きしない。
  const restoredAttempt = loadAttempt(progress.attemptId);
  if (restoredAttempt && !restoredAttempt.totalCount) {
    saveAttempt({ ...restoredAttempt, totalCount: progress.questionIds.length });
  }

  hideResumeCandidate();

  backToStartButton.textContent = isRunnerActive() ? "テスト対策へ戻る" : "開始画面へ戻る";
  showQuizScreen(quizScreen, allScreens);

  // STEP22: currentQuestionIndex===配列長（全問回答済み・次状態遷移直前）の場合は、
  // 既存goToNextQuestion()の境界判定（retry突入 or 終了）へそのまま委ねる
  // （新しい分岐を作らず、既存ロジックを完全に再利用する）。
  if (state.quiz.currentIndex >= state.quiz.quizQuestions.length) {
    goToNextQuestion();
  } else {
    await renderQuestion();
  }
}

// Phase5-1: 各画面から「ホームへ戻る」際に、Home画面の統計表示（学習履歴・苦手問題数等）を
// 最新化してから遷移する統一関数。renderHomeForStudentは同期・MemoryStorageのみ参照で
// GAS通信を行わないため（Phase5-0確定の永続化設計どおり、home-renderer.js/home-service.js
// 側は無変更）、無条件に呼び直してもGAS通信は増えない。studentId未選択時は
// renderHomeForStudentを呼ばず、既存のHome未選択状態表示（showHomeEmptyState）をそのまま
// 維持する（renderHomeForStudent自体も空文字列で同じ分岐を持つが、ここでは呼び出し自体を
// 省略し、意図を明確にする）。
function returnToHome() {
  if (state.session.studentId) {
    renderHomeForStudent(state.session.studentId, homeElements, homePracticeCallbacks);
  }
  showHomeScreen(homeScreen, allScreens);
}

// Phase2 Task23-4: ホーム画面の「学習履歴を見る」から、history-screenへ遷移する。
// state.session.studentId をそのまま使う（新しいstudentId用のstate・localStorage・
// sessionStorageは作らない）。描画自体はhistory-renderer.jsに委ねる（app.jsは
// 呼び出すだけで、履歴集計・DOM生成は一切行わない）。
function goToHistoryScreen() {
  if (!state.session.studentId) return;

  renderHistoryForStudent(state.session.studentId, historyElements);
  showHistoryScreen(historyScreen, allScreens);
}

// Task53: ホーム画面の「講師用」から、講師用問題選定画面（teacher-screen）へ遷移する。
// 生徒選択の有無に関わらずいつでも開ける（講師モードは生徒の学習フローと完全に別物のため、
// state.session.studentIdを条件にしない）。表示のたびにteacher-controller.js側で
// state・フォームをリセットする（PINも含め毎回再入力、誤操作防止のため）。
function goToTeacherScreen() {
  initTeacherScreen(teacherElements);
  initTeacherHistorySection(teacherHistoryElements);
  showTeacherScreen(teacherScreen, allScreens);
}

// Task54: ホーム画面の「学校のテスト対策」から、生徒用TestSet選択画面へ遷移する。
// studentId選択の要否はhome-history-button/goToHistoryScreenと同じ既存の無言ガード方式に
// 揃える（生徒未選択時は何もしない。home-renderer.jsのdisabled切替ロジックには触れない）。
// schoolId/gradeIdはstudentIdから自動判定しない（test-set-student-controller.js側で
// 生徒が毎回自己選択する）。
function goToTestSetStudentScreen() {
  if (!state.session.studentId) return;

  initTestSetStudentScreen(tssElements, startTestSetFromSelection);
  showTestSetStudentScreen(testSetStudentScreen, allScreens);
}

// Task55: 「このテスト対策を始める」から呼ばれるコールバック。
// TestSetをfieldIdごとのグループへ分割・事前検証し（features/test-set-runner/
// test-set-runner.js）、成功すれば最初のグループのQuizを開始する。
// QuestionSet/Attemptモデル自体は一切変更せず、既存の単一fieldId実行フロー
// （startTestSetGroupQuiz→beginAttemptAndShowQuiz、既存startPracticeSessionと同型）を
// グループの数だけ順番に呼び出す（Task50確定方針）。
// STEP6: 「このテスト対策を始める」＝TestSet実行の最初の1回だけをresume競合ガードの
// 対象にする。TestSet実行中の次グループ開始（finishCurrentTestSetGroupAndAdvance→
// startTestSetGroupQuiz）はこの関数を経由しないため、group1→group2遷移を誤って
// 「旧resume」と判定することはない。
//
// キャンセル時は{ok:true}を返す（test-set-student-controller.jsは ok:true の場合
// 「成功、画面遷移はapp.js側が行う」とみなして何もしないため、ボタンが再度押せる状態へ
// 戻るだけで、実際には何も開始されない＝キャンセルの意図どおりの挙動になる）。
// abandon失敗時は既存のerrorMessage表示経路(tss-confirm-step)へ理由を渡す。
async function startTestSetFromSelection(selectedTestSet) {
  return confirmAndAbandonResumeBeforeNewAttempt(() => executeStartTestSetFromSelection(selectedTestSet), {
    cancelResult: { ok: true },
    abandonFailResult: {
      ok: false,
      errorMessage: "前回の続きの削除に失敗しました。通信環境を確認して、もう一度お試しください。"
    }
  });
}

async function executeStartTestSetFromSelection(selectedTestSet) {
  const result = await startTestSetRun(selectedTestSet, filterManager.getNormalizedQuestionsForSubject);

  if (!result.ok) {
    return result;
  }

  const firstGroup = getCurrentGroup();
  await startTestSetGroupQuiz(firstGroup.fieldId, firstGroup.questionIds);

  return { ok: true };
}

// Task55: TestSetの1グループ（単一fieldId）分のQuizを開始する。
// features/home/home-practice-controller.jsのbuildHomePracticeQuizを使うstartPracticeSession
// と同じ構造（filterManagerで絞り込まず、既にactiveな問題一覧から対象questionIdだけを
// 抽出してstateへ直接設定→beginAttemptAndShowQuiz）。既存のstartQuiz/prepareQuizStartの
// 「単元・分野・N問ランダム抽出」ロジックは通常学習専用のままで、TestSetでは使わない
// （TestSetの問題集合は講師が選定した固定集合であり、勝手に別問題へ置換しない）。
async function startTestSetGroupQuiz(fieldId, questionIds) {
  const availableQuestions = await filterManager.getNormalizedQuestionsForSubject(fieldId);
  const matched = availableQuestions.filter((q) => questionIds.includes(q.questionId));

  state.session.subject = fieldId;
  state.session.unitFilter = "all";
  state.session.modeFilter = "all";
  state.session.subunitFilter = "all";
  state.session.requestedQuestionCount = matched.length;
  // TestSetは通常学習の「間違えた問題だけ復習」設定を引き継がない（別仕様、2026-08-30確定）。
  // state.session.retryWrongEnabledの初期値はtrue固定（core/state.js）で、通常学習の
  // startQuiz()を一度も経由せずTestSetへ直行した場合に前セッションの値が漏れ込む
  // （もしくは初期値trueのまま）ため、85問完走後に意図せず間違い直しラウンドへ突入し
  // TestSetが完了しない不具合があった。通常学習側のチェックボックス連動ロジック
  // （core/quiz-controller.jsのprepareQuizStart）は変更せず、TestSet専用の実行経路である
  // ここでだけ明示的にfalseへ固定する。
  state.session.retryWrongEnabled = false;

  resetQuizState(state);
  resetUiState(state);

  state.quiz.allQuestions = matched;
  state.quiz.quizQuestions = pickQuestions(matched, matched.length);

  await beginAttemptAndShowQuiz("testset", getRunnerTestSetId(), state.session.unitFilter);
}
