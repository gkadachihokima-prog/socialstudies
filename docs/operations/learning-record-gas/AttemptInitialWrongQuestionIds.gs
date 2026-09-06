// AttemptInitialWrongQuestionIds.gs
//
// 学習記録専用GAS（Attempt/AnswerRecord専用、docs/specification/gas-api-contract-v1.md 5章）
// への追加分。Phase3D-2前提（誤答履歴基盤）: attempts シートへ新規列
// `initialWrongQuestionIds`（そのAttemptの通常ラウンドで一度でも誤答した問題のquestionId配列、
// JSON配列文字列。未記録は空文字列）を追加し、既存 handleCompleteAttempt がこの値を
// 受け取って保存できるようにする。
//
// 【本ファイルの位置づけ・改訂履歴】
// 初版（未反映）は既存コード.gs/SheetHelpers.gsの実ソース未受領のまま、確認済みの
// helper仕様からの推定で書いていた。本改訂版は、ユーザーから提示された本番の実際の
// コード.gs（doGet/doPost/jsonResponse/errorResult_）・SheetHelpers.gs（SHEET_NAMES/
// ATTEMPTS_HEADERS/ANSWER_RECORDS_HEADERS/DATE_HEADERS/SOURCE_TYPE_VALUES/LOCK_WAIT_MS/
// getValidatedSheet_/readRowsAsObjects_/findRowIndexByKey_/loadRowByIndex_/writeRow_/
// appendRow_/stripRowMeta_/normalizeString_/toBoolean_/toFiniteNumberOrNull_/
// handleStartAttempt/handleSaveAnswerRecord/handleCompleteAttempt/handleGetStudentHistory
// の全文）に基づき、推定を排して確定した内容へ全面的に書き直したもの。
//
// 【実コード確認で確定した重要事実】
// 1. ATTEMPTS_HEADERS の実際の値は、docs/specification/data-schema-v1.md 10.1節の記載と
//    完全一致していた（12列: attemptId, studentId, questionSetId, questionSetVersion,
//    fieldId, sourceType, testSetId, startedAt, completedAt, completed, score, totalCount）。
// 2. writeRow_(sheet, headers, rowIndex, valuesByHeader) は、headers.map(header =>
//    valuesByHeader[header]) で「headers配列の全列」を毎回まとめて書き直す方式であり、
//    valuesByHeader に存在しないキー（undefined）は '' （空文字列）として書き込まれる
//    （sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowValues]) が
//    headers.length分の全列を1回のsetValuesで上書きするため、部分更新ではない）。
//    このため、ATTEMPTS_HEADERSへ列を追加した場合、既存のhandleStartAttempt/
//    handleCompleteAttemptのvaluesByHeaderオブジェクトに新列のキーを明示的に含めない限り、
//    その列は毎回 '' で上書きされる。
// 3. handleCompleteAttempt は body から attemptId/completedAt/score/totalCount の
//    4フィールドのみを明示的に読み取り、他のキー（今回のinitialWrongQuestionIds等）は
//    一切参照しない実装だった。→ 新Web × 旧GAS は、body内の未知キーが単に無視されるだけで
//    completeAttempt自体は成功することが実コードで確定した（以前の「推定」から確定へ）。
// 4. handleCompleteAttempt の writeRow_ 呼び出しは、既存行(existing)から
//    attemptId/studentId/questionSetId/questionSetVersion/fieldId/sourceType/testSetId/
//    startedAtを明示的にコピーしたうえで、completedAt/completed/score/totalCountだけを
//    新しい値へ差し替える実装だった。initialWrongQuestionIdsを追加する場合も、この
//    「既存値をコピーしつつ新しいフィールドだけ差し替える」既存パターンにそのまま従う。
// 5. handleGetStudentHistory は readRowsAsObjects_(attemptsSheet, ATTEMPTS_HEADERS) の
//    結果を stripRowMeta_ するだけで、フィールドを選別・変換せずそのまま返す実装だった。
//    → ATTEMPTS_HEADERSへ列を追加するだけで、handleGetStudentHistory自体のコード変更は
//    一切不要であることが実コードで確定した（以前の「推定」から確定へ）。
// 6. readRowsAsObjects_ は sheet.getRange(...).getValues() の生値をそのままheader名で
//    詰めるだけ（GAS標準仕様により、空セルは''として返る）。→ 旧Attempt（新列が空欄）は
//    getStudentHistoryで initialWrongQuestionIds: '' として返り、Web側
//    normalizeQuestionIdList('') が null（情報不明）へ正規化する。JSON配列文字列
//    （例: '["Q2","Q4"]'）もパースされず生文字列のまま返る（Web側で JSON.parse する）。
// 7-b. handleCompleteAttempt の既存パターンは、attemptId/studentId/questionSetId/
//      questionSetVersion/fieldId/sourceType/testSetId/startedAt を existing から
//      明示的にコピーして「保持」するが、initialWrongQuestionIds は保持せず、
//      毎回そのリクエストのvalidateInitialWrongQuestionIdsField_(body.initialWrongQuestionIds)の
//      結果（省略時は''）でそのまま上書きする（既存フィールドと同じ「existingからコピーして
//      保持する」方式には、あえてしない）。これは同一attemptIdへ2回目のcompleteAttemptが
//      発行された場合（例: app.jsのretryWrongOnlyFromResult()経由で、間違い直しラウンド後に
//      同一attemptIdへ再度completeAttemptが呼ばれるケース）、Web側が2回目も同じ
//      state.quiz.wrongQuestions由来の値を毎回計算して送るため実害は無いが、
//      仮にWeb側が2回目の呼び出しでinitialWrongQuestionIdsを省略した場合は
//      1回目の値が''へ巻き戻る、という設計上の仕様として明記しておく（Node vm検証
//      real-gas-verify.mjsのケース6/7で実際に確認済み）。
// 7. getValidatedSheet_ は sheet.getRange(1, 1, 1, expectedHeaders.length).getValues()[0]
//    でヘッダー行の「expectedHeaders.length分だけ」を読んで完全一致比較する。
//    → 本番Spreadsheetへ13列目のヘッダーセルを先に追加しても、旧GASコード（12列版の
//    ATTEMPTS_HEADERSのまま）は最初の12列だけを見るため影響を受けない（安全）。
//    一方、新GASコード（13列版）を先にdeployし、Spreadsheet側がまだ12列のままだと、
//    getValidatedSheet_が即座にthrowし、startAttempt/completeAttempt/getStudentHistory
//    のすべてがエラーになる。→ 「Spreadsheet列追加 → GAS deploy」の順序が必須（逆順は不可）。
//
// 【Web側との対応】
// - features/history/attempt-model.js の normalizeQuestionIdList() が、この列の生セル値
//   （JSON配列文字列 or 空文字列）をWeb側で読み解く。
// - features/history/learning-record-sync-integration.js の syncCompleteAttempt() が、
//   completeAttempt送信時にこのJSON配列文字列（またはnullの場合は空文字列）を組み立てて送る。
//
// 【旧Web/新Web・旧GAS/新GAS 互換性（実コード確認により確定・断定）】
// - 旧Web（キー自体を送らない）× 新GAS: body.initialWrongQuestionIdsがundefined。
//   validateInitialWrongQuestionIdsField_()がundefinedを許容し''を返す。completeAttempt
//   は従来どおり成功する。
// - 新Web（JSON配列文字列を送る）× 旧GAS: handleCompleteAttemptがbodyから明示的に
//   参照するのはattemptId/completedAt/score/totalCountの4つのみであることが実コードで
//   確認済み。initialWrongQuestionIdsキーは単に無視され、completeAttempt自体は成功する
//   （ただし列自体が旧GAS側のATTEMPTS_HEADERSに無いため、当然保存もされない）。
// - 旧Web × 旧GAS: 影響なし。
// - 新Web × 新GAS: 本ファイルのhandleCompleteAttempt改訂版で正常に保存される。
// 上記の非対称性（新Web×旧GASは「データが黙って保存されないだけ」で安全側）を踏まえ、
// 本番反映順序は「Spreadsheet列追加 → GAS deploy → Web deploy」を推奨する。

// ---------------------------------------------------------------------------
// 【SheetHelpers.gsへの変更（1箇所のみ、末尾追加）】
// ---------------------------------------------------------------------------
//
// 変更前（本番実コード、確認済み）:
//
// var ATTEMPTS_HEADERS = [
//   'attemptId', 'studentId', 'questionSetId', 'questionSetVersion', 'fieldId',
//   'sourceType', 'testSetId', 'startedAt', 'completedAt', 'completed', 'score', 'totalCount'
// ];
//
// 変更後:
//
// var ATTEMPTS_HEADERS = [
//   'attemptId', 'studentId', 'questionSetId', 'questionSetVersion', 'fieldId',
//   'sourceType', 'testSetId', 'startedAt', 'completedAt', 'completed', 'score', 'totalCount',
//   'initialWrongQuestionIds'
// ];
//
// 【本番Spreadsheet側（コードdeployより必ず先に実施）】
// 本番attemptsシートのヘッダー行（1行目）のM列（12列目totalCountの次）へ、手動で
// "initialWrongQuestionIds" を追加する。既存行のこの列は空欄のまま残す（値の補完をしない）。
// ATTEMPT_PROGRESSのretryWrongEnabled 14列化時と同じ手順（README.md 3節参照）。
// ---------------------------------------------------------------------------

/**
 * completeAttempt payload の initialWrongQuestionIds フィールドを検証し、
 * attempts シートへ書き込むべき文字列（JSON配列文字列、または未記録を表す空文字列）を返す。
 * normalizeString_ と同じ「undefined/null/空文字列は空文字列」という既存の正規化方針に
 * 合わせたうえで、非空の場合のみJSON配列としての妥当性を検証する。
 *
 * @param {*} rawValue - body.initialWrongQuestionIds
 * @returns {string}
 */
function validateInitialWrongQuestionIdsField_(rawValue) {
  var normalized = normalizeString_(rawValue);
  if (!normalized) {
    return '';
  }

  var parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new Error('initialWrongQuestionIdsが不正なJSONです: ' + error.message);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('initialWrongQuestionIdsはJSON配列である必要があります。');
  }

  var seen = {};
  for (var i = 0; i < parsed.length; i += 1) {
    var id = parsed[i];
    if (typeof id !== 'string' || !id) {
      throw new Error('initialWrongQuestionIdsの要素はすべて空でない文字列である必要があります。');
    }
    if (Object.prototype.hasOwnProperty.call(seen, id)) {
      throw new Error('initialWrongQuestionIdsに重複があります: ' + id);
    }
    seen[id] = true;
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// 【handleCompleteAttempt 全文差し替え（本番実コードに基づく、貼り替え可能な完成版）】
// ---------------------------------------------------------------------------
//
// 変更点は以下の2箇所のみ:
//   (a) 既存4フィールドのvalidation直後に、initialWrongQuestionIdsのvalidationを追加
//       （validation失敗時はscore/totalCount等も一切保存せず、completeAttempt全体を
//       失敗として返す。既存のvalidateSaveAttemptProgressPayload_と同じ「1項目でも
//       不正なら全体を保存しない」という既存の設計方針に合わせる）。
//   (b) writeRow_へ渡す行オブジェクトへ initialWrongQuestionIds を追加。
// score/totalCount/completedAt/completed及びexistingからのコピー方式は一切変更しない。

function handleCompleteAttempt(body) {
  var attemptId = normalizeString_(body.attemptId);
  var completedAt = normalizeString_(body.completedAt);
  var score = toFiniteNumberOrNull_(body.score);
  var totalCount = toFiniteNumberOrNull_(body.totalCount);

  if (!attemptId || !completedAt || score === null || totalCount === null) {
    return errorResult_('attemptId/completedAt/score/totalCountは必須です。');
  }

  var initialWrongQuestionIds;
  try {
    initialWrongQuestionIds = validateInitialWrongQuestionIdsField_(body.initialWrongQuestionIds);
  } catch (validationError) {
    return errorResult_(validationError.message);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return errorResult_('サーバーが混み合っています。しばらくしてから再度お試しください。');
  }

  try {
    var sheet = getValidatedSheet_(SHEET_NAMES.ATTEMPTS, ATTEMPTS_HEADERS);
    var existingRowIndex = findRowIndexByKey_(sheet, ATTEMPTS_HEADERS, ['attemptId'], [attemptId]);
    if (existingRowIndex < 0) {
      return errorResult_('該当attemptIdが存在しません。startAttemptが未実施です。');
    }

    var existing = loadRowByIndex_(sheet, ATTEMPTS_HEADERS, existingRowIndex);

    writeRow_(sheet, ATTEMPTS_HEADERS, existingRowIndex, {
      attemptId: existing.attemptId,
      studentId: existing.studentId,
      questionSetId: existing.questionSetId,
      questionSetVersion: existing.questionSetVersion,
      fieldId: existing.fieldId,
      sourceType: existing.sourceType,
      testSetId: existing.testSetId,
      startedAt: existing.startedAt,
      completedAt: completedAt,
      completed: true,
      score: score,
      totalCount: totalCount,
      initialWrongQuestionIds: initialWrongQuestionIds
    });

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// 【handleStartAttempt / handleGetStudentHistory / handleSaveAnswerRecord】
// 変更不要（実コード確認済み）。
//
// - handleGetStudentHistory: readRowsAsObjects_(attemptsSheet, ATTEMPTS_HEADERS)が
//   ATTEMPTS_HEADERSの全列を機械的にobject化するだけで、フィールドを選別しない。
//   ATTEMPTS_HEADERSへの列追加だけで自動的にレスポンスへ含まれる。コード変更不要。
//
// - handleStartAttempt: 新規行(appendRow_)・既存行更新(writeRow_)のいずれも
//   valuesByHeaderにinitialWrongQuestionIdsを含めないため、この列は常に''で
//   書き込まれる。これは意図した挙動として許容する（Attempt開始時点では
//   まだ通常ラウンドの誤答は確定していないため、''=未記録が正しい初期状態であり、
//   後続のcompleteAttemptが実際の値で上書きする）。
//
//   ただし、handleStartAttemptの「既存行更新」分岐（同一attemptIdへの再送信、
//   ネットワーク再試行等で発生しうる）が、既にcompleteAttempt済みのAttemptに対して
//   実行された場合、initialWrongQuestionIdsが''へ巻き戻る余地は理論上ゼロではない。
//   ただし、Web側の呼び出し順序（syncStartAttemptの完了を待ってからでないと
//   syncSaveAnswerRecord/syncCompleteAttemptを送信しない直列queue設計、
//   features/history/learning-record-sync-integration.js）により、同一attemptIdに
//   対してstartAttemptがcompleteAttemptより後に実行される経路は現状存在しないため、
//   実害は無いと判断し、handleStartAttemptは変更しない（対称性のためだけに
//   existing.initialWrongQuestionIdsを明示コピーする変更も可能だが、今回は
//   最小変更を優先し見送る。将来Web側の呼び出し順序が変わった場合は要再監査）。
//
// - handleSaveAnswerRecord: answer_recordsシートのみ操作するため無関係・無変更。
// ---------------------------------------------------------------------------
