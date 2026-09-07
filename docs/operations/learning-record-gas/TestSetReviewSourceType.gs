// TestSetReviewSourceType.gs
//
// Phase3D-4A前提: 学校別TestSetの「全group通常問題完了後の誤答自動復習」（Phase3D-4、
// Web側フローはPhase3D-4Bで実装）のための、新規sourceType `testset_review` を
// 既存のLearning Record GAS（コード.gs/SheetHelpers.gs/AttemptProgress.gs）へ
// 安全に受け入れさせるための基盤のみを追加する。
//
// 【Phase3D-4設計監査で確定した前提】
// TestSetは複数fieldIdを横断できる（docs/architecture/ls-total-test-system-design-v1.md
// 9.8節）。したがって全group誤答を1つのAttemptへ集約することはできず、誤答復習は
// fieldId単位（＝groupと同じ単位）で複数のAttemptに分けて実行する（詳細は
// docs/specification/domain-model-v1.md 3.11.3節）。
//
// 【なぜsourceType="testset"を再利用できないか（実コード確認済み）】
// app.jsのresumeQuiz()/showResumeCandidate()はsourceType==="testset"を検出すると
// 必ずrestoreRunnerState()（TestSet通常group復元専用）へ合流させる。復習Attemptの
// fieldIdは元groupと同じ値になり得るため、testsetのまま保存すると「通常group3の
// 再開」と誤認される危険がある。したがって専用のsourceType="testset_review"を新設する。
//
// 【本ファイルの本番反映範囲（今回はローカル実装のみ、本番未反映）】
// 1. SheetHelpers.gs: SOURCE_TYPE_VALUES配列へ 'testset_review' を追加（1箇所のみ）。
// 2. コード.gs: handleStartAttempt内のtestSetId必須/禁止ルールをtestset/testset_review
//    両対応へ拡張（下記、本番実コードに基づく貼り替え可能な完成版）。
// 3. docs/operations/learning-record-gas/AttemptProgress.gs: 同じルールを
//    validateSaveAttemptProgressPayload_へ反映済み（本ファイルとは別コミット済みの変更）。
//
// 【今回変更しないこと】
// - handleSaveAnswerRecord・handleGetStudentHistory・handleCompleteAttempt：
//   いずれもsourceTypeを新規に検証・分岐しない（handleCompleteAttemptはexistingの
//   sourceTypeをそのままwriteRow_で書き戻すのみ、docs/operations/learning-record-gas/
//   AttemptInitialWrongQuestionIds.gsで確認済み）。変更不要。
// - ATTEMPTS_HEADERS・ANSWER_RECORDS_HEADERS・ATTEMPT_PROGRESS_HEADERS：列追加0。
// - Spreadsheet：列追加0、既存データへの値補完0。
// - TestSet専用GAS（school_master/test_set/test_set_questions）：無関係、変更0。
//
// 【Phase3D-4A時点でtestset_reviewを実際に送信するWeb側経路は存在しない】
// 本番反映しても、既存Webが新しいsourceTypeを送ることは無い（Phase3D-4Bで実装）。
// そのため本番反映は「将来のPhase3D-4B Web実装より先に完了させておく」という
// 位置づけであり、反映直後の既存4種類（normal/weak_review/dormant_review/testset）の
// 挙動には一切影響しない（後述の互換性マトリクス参照）。

// ---------------------------------------------------------------------------
// 【SheetHelpers.gsへの変更（1箇所のみ、末尾追加）】
// ---------------------------------------------------------------------------
//
// 変更前（本番実コード、Phase3D-2前提での確認時に受領・確認済み）:
//
// var SOURCE_TYPE_VALUES = ['normal', 'weak_review', 'dormant_review', 'testset'];
//
// 変更後:
//
// var SOURCE_TYPE_VALUES = ['normal', 'weak_review', 'dormant_review', 'testset', 'testset_review'];
//
// 【安全性の根拠】SOURCE_TYPE_VALUESはコード.gsのhandleStartAttempt・
// AttemptProgress.gsのvalidateSaveAttemptProgressPayload_の両方から共有参照される
// 単一の配列定数（docs/operations/learning-record-gas/README.md 0節で確認済み）。
// 末尾へ1値追加するだけであり、既存4値の判定（indexOf比較）には一切影響しない。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 【既存 handleStartAttempt 全文差し替え（本番実コードに基づく、貼り替え可能な完成版）】
// ---------------------------------------------------------------------------
//
// 変更点は以下の3箇所（testSetId必須/禁止ルールの対象をtestset/testset_review
// 両方へ拡張、および13列化に伴うwriteRow_全列書き直し方式での既存値消失防止）。
// それ以外の必須項目チェック・LockService・レスポンス形式は一切変更しない。
//
// 【initialWrongQuestionIds消失防止について】
// ATTEMPTS_HEADERSは13列（Phase3D-2前提でinitialWrongQuestionIdsを末尾追加済み）。
// writeRow_はheaders.map()で全列を毎回書き直す方式のため、valuesByHeaderに
// initialWrongQuestionIdsのキーが無いと空文字列で上書きされてしまう
// （docs/operations/learning-record-gas/AttemptInitialWrongQuestionIds.gs参照）。
// 既存Attemptへの再start（同一attemptIdでのstartAttempt再送信）が発生した場合に
// completeAttempt済みのinitialWrongQuestionIdsを消さないよう、既存行の値を
// 明示的に引き継ぐ。新規行は明示的に空文字列（＝未記録）とする。

function handleStartAttempt(body) {
  var attemptId = normalizeString_(body.attemptId);
  var studentId = normalizeString_(body.studentId);
  var questionSetId = normalizeString_(body.questionSetId);
  var questionSetVersion = toFiniteNumberOrNull_(body.questionSetVersion);
  var fieldId = normalizeString_(body.fieldId);
  var sourceType = normalizeString_(body.sourceType);
  var testSetId = normalizeString_(body.testSetId);
  var startedAt = normalizeString_(body.startedAt);

  if (!attemptId || !studentId || !questionSetId || questionSetVersion === null || !fieldId) {
    return errorResult_('attemptId/studentId/questionSetId/questionSetVersion/fieldIdは必須です。');
  }
  if (sourceType && SOURCE_TYPE_VALUES.indexOf(sourceType) === -1) {
    return errorResult_('sourceTypeの値が不正です。');
  }
  // Phase3D-4A前提: testset_review（fieldId単位のTestSet誤答復習Attempt）もtestsetと
  // 同じくtestSetId必須とする（元TestSetのtestSetIdを必ず持つため）。
  if ((sourceType === 'testset' || sourceType === 'testset_review') && !testSetId) {
    return errorResult_('sourceType=testset/testset_reviewの場合testSetIdが必須です。');
  }
  if (sourceType !== 'testset' && sourceType !== 'testset_review' && testSetId) {
    return errorResult_('sourceType=testset/testset_review以外ではtestSetIdを指定できません。');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return errorResult_('サーバーが混み合っています。しばらくしてから再度お試しください。');
  }

  try {
    var sheet = getValidatedSheet_(SHEET_NAMES.ATTEMPTS, ATTEMPTS_HEADERS);
    var existingRowIndex = findRowIndexByKey_(sheet, ATTEMPTS_HEADERS, ['attemptId'], [attemptId]);

    if (existingRowIndex > 0) {
      var existing = loadRowByIndex_(sheet, ATTEMPTS_HEADERS, existingRowIndex);
      if (normalizeString_(existing.studentId) !== studentId) {
        return errorResult_('既存のattemptIdは別のstudentIdに紐づいています。');
      }

      writeRow_(sheet, ATTEMPTS_HEADERS, existingRowIndex, {
        attemptId: attemptId,
        studentId: studentId,
        questionSetId: questionSetId,
        questionSetVersion: questionSetVersion,
        fieldId: fieldId,
        sourceType: sourceType,
        testSetId: testSetId,
        startedAt: startedAt,
        completedAt: existing.completedAt,
        completed: toBoolean_(existing.completed),
        score: existing.score,
        totalCount: existing.totalCount,
        initialWrongQuestionIds: existing.initialWrongQuestionIds
      });
    } else {
      appendRow_(sheet, ATTEMPTS_HEADERS, {
        attemptId: attemptId,
        studentId: studentId,
        questionSetId: questionSetId,
        questionSetVersion: questionSetVersion,
        fieldId: fieldId,
        sourceType: sourceType,
        testSetId: testSetId,
        startedAt: startedAt,
        completedAt: '',
        completed: false,
        score: '',
        totalCount: '',
        initialWrongQuestionIds: ''
      });
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// 【変更不要な既存関数（確認のみ、貼り替え対象外）】
// handleSaveAnswerRecord・handleCompleteAttempt・handleGetStudentHistory：
// いずれもsourceTypeへ新規の検証・分岐を持たないため、testset_review追加による
// 変更は不要（handleCompleteAttemptはexisting.sourceTypeをそのまま書き戻すのみ）。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 【互換性マトリクス（実コードに基づく確定、推定なし）】
//
// A. 旧Web（sourceTypeにnormal/weak_review/dormant_review/testsetのみ送信）
//    × 旧GAS（testset_review未対応）: 影響なし。
// B. 旧Web × 新GAS（本ファイル反映後）: 新GASはtestset_reviewを知っているが、
//    旧Webはそれを送信する経路が無い（Phase3D-4B未実装のため）。
//    既存4種類のsourceTypeに対する挙動は一切変更されない
//    （SOURCE_TYPE_VALUESへの追加はindexOf判定に無影響、testSetIdルールの拡張は
//    `|| sourceType === 'testset_review'`という追加条件のみで、既存の
//    `sourceType === 'testset'`分岐の真偽値を変えない）。→ 安全。
// C. 新Web（Phase3D-4B、testset_reviewを送信）× 旧GAS: 現時点では発生しない
//    （Phase3D-4B自体が未実装のため）。将来Phase3D-4Bを公開する前に、
//    本ファイルのGAS反映を先に完了させることを必須条件とする
//    （docs/specification配下の設計監査記録どおり）。
// D. 新Web × 新GAS: Phase3D-4Bで実装・検証する。
// ---------------------------------------------------------------------------
