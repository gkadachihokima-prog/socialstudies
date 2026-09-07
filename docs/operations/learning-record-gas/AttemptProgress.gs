// AttemptProgress.gs
//
// 学習記録専用GAS（Attempt/AnswerRecord専用、docs/specification/gas-api-contract-v1.md 5章）
// への追加分。進行中学習状態 attempt_progress シートに対する3つの新規action
// （saveAttemptProgress/getAttemptProgress/abandonAttemptProgress）を実装する。
//
// 【本番実装との統合について】
// 本ファイルは、ユーザーが本番Apps Scriptエディタの「コード.gs」「SheetHelpers.gs」全文を
// 確認・提示した内容に基づいて、本番実装へ完全に準拠する形で作成した統合準備版である。
// 以下の既存シンボルは本ファイル内で再定義せず、本番のコード.gs/SheetHelpers.gsに
// 既に存在するものをそのまま呼び出す（Apps Scriptは同一プロジェクト内の全.gsファイルが
// 単一のグローバルスコープを共有するため、本ファイルを同一プロジェクトへ追加するだけで、
// 以下のシンボルへ直接アクセスできる）。
//
//   定数: SHEET_NAMES, ATTEMPTS_HEADERS, ANSWER_RECORDS_HEADERS, DATE_HEADERS,
//         SOURCE_TYPE_VALUES, LOCK_WAIT_MS
//   関数: getValidatedSheet_, readRowsAsObjects_, findRowIndexByKey_, loadRowByIndex_,
//         writeRow_, appendRow_, stripRowMeta_, normalizeString_, toBoolean_,
//         toFiniteNumberOrNull_, jsonResponse, errorResult_
//
// 【SheetHelpers.gsへの必要な変更（2箇所のみ、末尾追加）】
// 1. SHEET_NAMES オブジェクトへ ATTEMPT_PROGRESS: 'attempt_progress' を追加
// 2. DATE_HEADERS 配列へ 'updatedAt' を追加
// （詳細はdocs/operations/learning-record-gas/README.md参照。両方とも既存の
//   attempts/answer_recordsの書込み挙動には影響しない末尾追加のみ）
//
// 【重要・Phase3C前提でのretryWrongEnabled 14列化に伴う本番反映時の注意】
// getValidatedSheet_()は、既存シートのヘッダー行がATTEMPT_PROGRESS_HEADERSと
// 完全一致しない場合throwする仕様（getOrCreateAttemptProgressSheet_()参照）。
// 本番Spreadsheetのattempt_progressシートが既に13列ヘッダーで作成済み・
// 実データが存在する場合、本ファイルを14列版へ更新して単純にdeployすると、
// 既存シートとのヘッダー不一致により、既存データの有無に関わらず
// saveAttemptProgress/getAttemptProgress/abandonAttemptProgressの全リクエストが
// 即座にエラーになる。したがって本番反映前に必ず、
//   (a) 本番attempt_progressシートの現在の行数・既存in_progress/abandoned件数を確認し、
//   (b) 既存行がある場合は、ヘッダー行（1行目）へ手動で"retryWrongEnabled"列を
//       retryRoundとstatusの間へ挿入し、既存データ行のこの列は空欄のまま残す
//       （trueやfalseで機械的に補完しない。空欄はtoBoolean_()により安全にfalse
//       として読み出されるのみで、実際の値をClaude側が推測して書き込むことはしない）、
//   (c) その後に本ファイル(14列版)のコードをdeployする
// という順序を踏むこと。既存行が0件であることを確認できた場合のみ、
// ヘッダー行の手動編集は不要（次回保存時に自動生成される14列ヘッダーがそのまま正本になる）。
//
// 【findRowIndexByKey_の仕様（本番確認済み）】
// readRowsAsObjects_() が各行オブジェクトへ __row: index + 2 という内部メタキーを付与し、
// findRowIndexByKey_() は一致した行の __row（= Spreadsheet上の実際の行番号、1-based。
// ヘッダー=1行目、最初のデータ行=2）を返す（見つからない場合は -1）。
// loadRowByIndex_() / writeRow_() も同じ「Spreadsheet実行番号」をそのまま受け取る
// （0-based/1-based変換は一切挟まない）。findRowIndexByKey_の第3/第4引数は
// キー列名の配列・キー値の配列（複合キー対応）: findRowIndexByKey_(sheet, headers,
// ['attemptId'], [attemptId]) のように呼ぶ。
//
// 【LockService（本番パターンに完全準拠）】
// var lock = LockService.getScriptLock();
// if (!lock.tryLock(LOCK_WAIT_MS)) {
//   return errorResult_('サーバーが混み合っています。しばらくしてから再度お試しください。');
// }
// try { ... } finally { lock.releaseLock(); }
// 独自のタイムアウト値・独自のエラー文言は持たない。
//
// 【ルーティング（既存コード.gsのdoGet/doPostへの追加イメージ）】
// 既存の分岐がif/elseチェーンかswitch文か等の正確な構文は未確認のため、
// 「既存のgetStudentHistory/startAttempt等の分岐と同じ形式・同じ場所に追加する」という
// 前提で示す。実際の追加時は、既存の分岐スタイルに合わせて書式を揃えること。
//
// function doGet(e) {
//   var action = e.parameter.action;
//   ...(既存: action === "getStudentHistory" の分岐)...
//   if (action === "getAttemptProgress") {
//     return jsonResponse(handleGetAttemptProgress(e.parameter.studentId));
//   }
//   ...(既存のdefault/エラー処理)...
// }
//
// function doPost(e) {
//   var body = JSON.parse(e.postData.contents);
//   var action = body.action;
//   ...(既存: startAttempt/saveAnswerRecord/completeAttempt の分岐)...
//   if (action === "saveAttemptProgress") {
//     return jsonResponse(handleSaveAttemptProgress(body));
//   }
//   if (action === "abandonAttemptProgress") {
//     return jsonResponse(handleAbandonAttemptProgress(body));
//   }
//   ...(既存のdefault/エラー処理)...
// }
//
// 公開handler名は、既存のhandleStartAttempt/handleSaveAnswerRecord/handleCompleteAttempt/
// handleGetStudentHistoryと同じ命名規則（末尾アンダースコアなし）に統一する。
// 内部専用のhelper（progress固有）のみ末尾アンダースコアを付ける（既存の非公開helperと
// 同じ命名規則）。

// ---------------------------------------------------------------------------
// progress固有定数（ATTEMPT_PROGRESS_HEADERSのみ。シート名・日時列はSheetHelpers.gs側の
// SHEET_NAMES.ATTEMPT_PROGRESS / DATE_HEADERSへ末尾追加する前提のため、ここでは持たない）
// ---------------------------------------------------------------------------

// Phase3C前提（retryWrongEnabled 14列化）: retryRoundの直後・statusの直前へ追加。
// resume時に「中断前に選択されていたretry可否設定」を正確に復元するために必須
// （retryRoundからの再計算・sourceTypeからの推測はしない。Phase3C監査で、
// retryRound===0で中断されたAttemptについてはretryWrongEnabledをどこからも
// 導出できないことが判明したため、正本として保存する列を新設した）。
var ATTEMPT_PROGRESS_HEADERS = [
  "attemptId",
  "studentId",
  "fieldId",
  "unit",
  "sourceType",
  "testSetId",
  "questionIds",
  "currentQuestionIndex",
  "wrongQuestionIds",
  "retryRound",
  "retryWrongEnabled",
  "status",
  "startedAt",
  "updatedAt"
];

// Phase3B-1で確定した2値のみ（正常完了はAttempt.completedを正とし、statusへは追加しない）。
var ATTEMPT_PROGRESS_STATUS_VALUES_ = ["in_progress", "abandoned"];

// ---------------------------------------------------------------------------
// シート取得（新規は自動生成、既存は既存helper getValidatedSheet_ で検証）
// ---------------------------------------------------------------------------

function getOrCreateAttemptProgressSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  // 存在確認自体は、アプリ固有helperではなくApps Script標準APIのみで行う
  // （getValidatedSheet_は「シート不存在時」にthrowする仕様のため、そこへは頼らず、
  // 事前に標準APIで存在確認してから、既存シートの場合のみgetValidatedSheet_へ
  // ヘッダー検証を委譲する）。
  var existing = spreadsheet.getSheetByName(SHEET_NAMES.ATTEMPT_PROGRESS);
  if (!existing) {
    var created = spreadsheet.insertSheet(SHEET_NAMES.ATTEMPT_PROGRESS);
    created.appendRow(ATTEMPT_PROGRESS_HEADERS);
    return created;
  }

  return getValidatedSheet_(SHEET_NAMES.ATTEMPT_PROGRESS, ATTEMPT_PROGRESS_HEADERS);
}

// ---------------------------------------------------------------------------
// Attempt参照（既存helperのみを使用、progress固有の重複実装をしない）
// ---------------------------------------------------------------------------

// 新規progress作成時のみ呼ぶ。attemptId実在確認とstudentId一致確認を1回のシートアクセスで行う。
function verifyAttemptOwnershipForNewProgress_(attemptId, studentId) {
  var attemptsSheet = getValidatedSheet_(SHEET_NAMES.ATTEMPTS, ATTEMPTS_HEADERS);
  var attemptRowIndex = findRowIndexByKey_(attemptsSheet, ATTEMPTS_HEADERS, ["attemptId"], [attemptId]);
  if (attemptRowIndex < 0) {
    throw new Error("該当attemptIdがattemptsに存在しません: " + attemptId);
  }

  var attemptRow = loadRowByIndex_(attemptsSheet, ATTEMPTS_HEADERS, attemptRowIndex);
  if (normalizeString_(attemptRow.studentId) !== normalizeString_(studentId)) {
    throw new Error(
      "attemptId=" + attemptId + "のstudentIdが一致しません（attempts側: " +
      attemptRow.studentId + "、リクエスト側: " + studentId + "）。"
    );
  }

  return attemptRow;
}

// getAttemptProgressの候補除外用。対応Attemptのcompletedを確認する。
function isAttemptCompleted_(attemptId) {
  var attemptsSheet = getValidatedSheet_(SHEET_NAMES.ATTEMPTS, ATTEMPTS_HEADERS);
  var attemptRowIndex = findRowIndexByKey_(attemptsSheet, ATTEMPTS_HEADERS, ["attemptId"], [attemptId]);
  if (attemptRowIndex < 0) return false;

  var attemptRow = loadRowByIndex_(attemptsSheet, ATTEMPTS_HEADERS, attemptRowIndex);
  return toBoolean_(attemptRow.completed);
}

// ---------------------------------------------------------------------------
// JSON配列validation（progress固有、既存helperに相当機能が無いため独自実装）
// ---------------------------------------------------------------------------

function parseJsonStringArray_(raw, fieldName) {
  if (typeof raw !== "string") {
    throw new Error(fieldName + "は文字列(JSON配列)である必要があります。");
  }

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(fieldName + "が不正なJSONです: " + error.message);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(fieldName + "はJSON配列である必要があります。");
  }

  for (var i = 0; i < parsed.length; i += 1) {
    if (typeof parsed[i] !== "string" || !parsed[i]) {
      throw new Error(fieldName + "の要素はすべて空でない文字列である必要があります。");
    }
  }

  return parsed;
}

function hasDuplicates_(array) {
  var seen = {};
  for (var i = 0; i < array.length; i += 1) {
    if (Object.prototype.hasOwnProperty.call(seen, array[i])) {
      return true;
    }
    seen[array[i]] = true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// saveAttemptProgress用validation
// ---------------------------------------------------------------------------

function validateSaveAttemptProgressPayload_(payload) {
  var attemptId = normalizeString_(payload.attemptId);
  var studentId = normalizeString_(payload.studentId);
  var fieldId = normalizeString_(payload.fieldId);
  var unit = normalizeString_(payload.unit); // 任意。weak_review/dormant_review等は空欄許容
  var sourceType = normalizeString_(payload.sourceType);
  var testSetId = normalizeString_(payload.testSetId);
  var status = normalizeString_(payload.status);

  if (!attemptId) throw new Error("attemptIdは必須です。");
  if (!studentId) throw new Error("studentIdは必須です。");
  if (!fieldId) throw new Error("fieldIdは必須です。");

  // 既存handleStartAttemptはsourceType空欄を許容する（レガシーAttempt互換のため）が、
  // attempt_progressは新設テーブルでレガシーデータが存在せず、再開時の分岐に
  // sourceTypeが必要なため必須とする（progress固有のより厳格な制約として意図的に導入。
  // Attempt本体の仕様は一切変更しない）。
  if (SOURCE_TYPE_VALUES.indexOf(sourceType) === -1) {
    throw new Error("sourceTypeが不正です: " + sourceType);
  }

  // 既存handleStartAttemptと完全に同じルール: testset/testset_review以外はtestSetId指定禁止。
  // Phase3D-4A前提: testset_review（学校別TestSetの全group完了後に行う、fieldId単位の
  // 誤答復習Attempt。domain-model-v1.md 3.11.3節）もtestSetId必須の対象に含める
  // （testset_reviewもtestset同様、必ず元TestSetのtestSetIdを持つため）。
  if ((sourceType === "testset" || sourceType === "testset_review") && !testSetId) {
    throw new Error("sourceType=testset/testset_reviewの場合、testSetIdは必須です。");
  }
  if (sourceType !== "testset" && sourceType !== "testset_review" && testSetId) {
    throw new Error("sourceType=testset/testset_review以外ではtestSetIdを指定できません。");
  }

  if (ATTEMPT_PROGRESS_STATUS_VALUES_.indexOf(status) === -1) {
    throw new Error("statusが不正です: " + status);
  }

  var questionIdsArray = parseJsonStringArray_(payload.questionIds, "questionIds");
  if (questionIdsArray.length < 1) {
    throw new Error("questionIdsは1件以上必要です。");
  }
  if (hasDuplicates_(questionIdsArray)) {
    // 通常学習(CSV由来・questionId重複はvalidate-questions.mjsで拒否済み)・TestSet
    // (saveTestSetがquestionId重複を拒否)・weak/dormant review(questionId単位のMapから
    // 生成)のいずれも、正規の経路ではquestionIdsに重複が発生しない
    // （features/weakness/weakness-quiz-bridge.js等、Web側実コードで確認済み）。
    throw new Error("questionIdsに重複があります。");
  }

  var wrongQuestionIdsArray = parseJsonStringArray_(payload.wrongQuestionIds || "[]", "wrongQuestionIds");
  if (hasDuplicates_(wrongQuestionIdsArray)) {
    // core/answer-controller.jsのwrongQuestions追加処理は既に重複除外済み
    // （同一questionIdを2回pushしない）ため、正規の経路では重複しない。
    throw new Error("wrongQuestionIdsに重複があります。");
  }

  var currentQuestionIndex = toFiniteNumberOrNull_(payload.currentQuestionIndex);
  if (currentQuestionIndex === null || currentQuestionIndex < 0 || Math.floor(currentQuestionIndex) !== currentQuestionIndex) {
    throw new Error("currentQuestionIndexは0以上の整数である必要があります。");
  }

  var retryRound = toFiniteNumberOrNull_(payload.retryRound);
  if (retryRound === null || retryRound < 0 || Math.floor(retryRound) !== retryRound) {
    throw new Error("retryRoundは0以上の整数である必要があります。");
  }

  // Phase3C前提: retryWrongEnabledは開始時に確定するAttempt単位の設定値のsnapshotであり、
  // retryRoundから再計算しない・真偽値以外（"true"/"false"等の文字列）を正本化しない。
  if (typeof payload.retryWrongEnabled !== "boolean") {
    throw new Error("retryWrongEnabledはtrue/falseのいずれかで必須です。");
  }
  var retryWrongEnabled = payload.retryWrongEnabled;

  // index==配列長は「現在ラウンドの全問回答済み・次状態遷移直前」として有効(エラーにしない)。
  var targetArrayLength = retryRound === 0 ? questionIdsArray.length : wrongQuestionIdsArray.length;
  if (currentQuestionIndex > targetArrayLength) {
    throw new Error(
      "currentQuestionIndex(" + currentQuestionIndex + ")が対象配列の長さ(" +
      targetArrayLength + ")を超えています。"
    );
  }

  return {
    attemptId: attemptId,
    studentId: studentId,
    fieldId: fieldId,
    unit: unit,
    sourceType: sourceType,
    testSetId: testSetId,
    questionIds: questionIdsArray,
    currentQuestionIndex: currentQuestionIndex,
    wrongQuestionIds: wrongQuestionIdsArray,
    retryRound: retryRound,
    retryWrongEnabled: retryWrongEnabled,
    status: status
  };
}

// ---------------------------------------------------------------------------
// 公開handle関数（doGet/doPostから呼ばれる想定。既存handleStartAttempt等と同じ
// 命名規則＝末尾アンダースコアなし）
// ---------------------------------------------------------------------------

/**
 * POST action=saveAttemptProgress
 */
function handleSaveAttemptProgress(payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return errorResult_("サーバーが混み合っています。しばらくしてから再度お試しください。");
  }

  try {
    var normalized;
    try {
      normalized = validateSaveAttemptProgressPayload_(payload);
    } catch (validationError) {
      return errorResult_(validationError.message);
    }

    var sheet = getOrCreateAttemptProgressSheet_();
    var rowIndex = findRowIndexByKey_(sheet, ATTEMPT_PROGRESS_HEADERS, ["attemptId"], [normalized.attemptId]);
    var nowIso = new Date().toISOString();

    if (rowIndex < 0) {
      // 新規行 → このタイミングでのみAttempt実在・所有者確認を行う
      // （既存行の更新では再確認しない。1問ごとに呼ばれる想定の性能と、Attemptが
      // 削除されない既存設計を踏まえた判断）。
      try {
        verifyAttemptOwnershipForNewProgress_(normalized.attemptId, normalized.studentId);
      } catch (ownershipError) {
        return errorResult_(ownershipError.message);
      }

      var startedAt = payload.startedAt ? String(payload.startedAt) : nowIso;
      appendRow_(sheet, ATTEMPT_PROGRESS_HEADERS, {
        attemptId: normalized.attemptId,
        studentId: normalized.studentId,
        fieldId: normalized.fieldId,
        unit: normalized.unit,
        sourceType: normalized.sourceType,
        testSetId: normalized.testSetId,
        questionIds: JSON.stringify(normalized.questionIds),
        currentQuestionIndex: normalized.currentQuestionIndex,
        wrongQuestionIds: JSON.stringify(normalized.wrongQuestionIds),
        retryRound: normalized.retryRound,
        retryWrongEnabled: normalized.retryWrongEnabled,
        status: normalized.status,
        startedAt: startedAt,
        updatedAt: nowIso
      });
      return { ok: true };
    }

    // 既存行 → studentId一致確認(attempts再走査ではなく、既存progress行との比較)。
    var existingRow = loadRowByIndex_(sheet, ATTEMPT_PROGRESS_HEADERS, rowIndex);
    if (normalizeString_(existingRow.studentId) !== normalized.studentId) {
      return errorResult_(
        "attemptId=" + normalized.attemptId + "のstudentIdが既存progressと一致しません。"
      );
    }

    // startedAtは書き換えない(初回保存時の値を維持)。retryWrongEnabledは
    // Attempt単位で不変の設定値だが、クライアントは毎回同じ値を送ってくる想定のため
    // (features/progress/progress-model.jsのcontextから都度組み立てる)、他の列と同様に
    // 毎回書き込む(値の再計算・retryRoundからの推測は行わない)。
    writeRow_(sheet, ATTEMPT_PROGRESS_HEADERS, rowIndex, {
      attemptId: normalized.attemptId,
      studentId: normalized.studentId,
      fieldId: normalized.fieldId,
      unit: normalized.unit,
      sourceType: normalized.sourceType,
      testSetId: normalized.testSetId,
      questionIds: JSON.stringify(normalized.questionIds),
      currentQuestionIndex: normalized.currentQuestionIndex,
      wrongQuestionIds: JSON.stringify(normalized.wrongQuestionIds),
      retryRound: normalized.retryRound,
      retryWrongEnabled: normalized.retryWrongEnabled,
      status: normalized.status,
      startedAt: existingRow.startedAt,
      updatedAt: nowIso
    });
    return { ok: true };
  } catch (error) {
    return errorResult_(String(error && error.message ? error.message : error));
  } finally {
    lock.releaseLock();
  }
}

/**
 * GET action=getAttemptProgress&studentId=...
 */
function handleGetAttemptProgress(studentId) {
  var trimmedStudentId = normalizeString_(studentId);
  if (!trimmedStudentId) {
    return errorResult_("studentIdが空です。");
  }

  try {
    var sheet = getOrCreateAttemptProgressSheet_();
    var rows = readRowsAsObjects_(sheet, ATTEMPT_PROGRESS_HEADERS);

    var candidates = rows.filter(function (row) {
      if (normalizeString_(row.studentId) !== trimmedStudentId) return false;
      // statusはsaveAttemptProgress側のvalidateSaveAttemptProgressPayload_で
      // 常にnormalizeString_(payload.status)を経由してから書き込まれるため、
      // 読み取り側は厳密一致で問題ない（studentIdはHTTPリクエストから都度渡される
      // 外部入力のため正規化するが、statusは自身の保存経路で既に正規化済みの値）。
      if (row.status !== "in_progress") return false;
      if (isAttemptCompleted_(row.attemptId)) return false; // 正常完了済みは候補から除外
      return true;
    });

    if (candidates.length === 0) {
      return { ok: true, progress: null };
    }

    // updatedAt降順、同値の場合はattemptId降順で決定的にtie-break。
    candidates.sort(function (a, b) {
      if (a.updatedAt !== b.updatedAt) {
        return a.updatedAt < b.updatedAt ? 1 : -1;
      }
      return a.attemptId < b.attemptId ? 1 : -1;
    });

    var latest = stripRowMeta_(candidates[0]); // __row を除外
    latest.questionIds = JSON.parse(latest.questionIds);
    latest.wrongQuestionIds = JSON.parse(latest.wrongQuestionIds);

    return { ok: true, progress: latest };
  } catch (error) {
    return errorResult_(String(error && error.message ? error.message : error));
  }
}

/**
 * POST action=abandonAttemptProgress
 */
function handleAbandonAttemptProgress(payload) {
  var attemptId = normalizeString_(payload.attemptId);
  if (!attemptId) {
    return errorResult_("attemptIdは必須です。");
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return errorResult_("サーバーが混み合っています。しばらくしてから再度お試しください。");
  }

  try {
    var sheet = getOrCreateAttemptProgressSheet_();
    var rowIndex = findRowIndexByKey_(sheet, ATTEMPT_PROGRESS_HEADERS, ["attemptId"], [attemptId]);
    if (rowIndex < 0) {
      // 既存archiveTestSet相当の実コードは未確認のため「既存と同じ」とは断定しない。
      // Phase3A/3B-1で確定した独自方針(存在しないIDはエラー、既にabandoned済みは冪等成功)を維持する。
      return errorResult_("該当attemptIdのprogressが見つかりません: " + attemptId);
    }

    var existingRow = loadRowByIndex_(sheet, ATTEMPT_PROGRESS_HEADERS, rowIndex);
    writeRow_(sheet, ATTEMPT_PROGRESS_HEADERS, rowIndex, {
      attemptId: existingRow.attemptId,
      studentId: existingRow.studentId,
      fieldId: existingRow.fieldId,
      unit: existingRow.unit,
      sourceType: existingRow.sourceType,
      testSetId: existingRow.testSetId,
      questionIds: existingRow.questionIds,
      currentQuestionIndex: existingRow.currentQuestionIndex,
      wrongQuestionIds: existingRow.wrongQuestionIds,
      retryRound: existingRow.retryRound,
      // Phase3C前提: abandon時もretryWrongEnabledの値を維持する(意味変更なし)。
      retryWrongEnabled: existingRow.retryWrongEnabled,
      status: "abandoned",
      startedAt: existingRow.startedAt,
      updatedAt: new Date().toISOString()
    });

    return { ok: true };
  } catch (error) {
    return errorResult_(String(error && error.message ? error.message : error));
  } finally {
    lock.releaseLock();
  }
}
