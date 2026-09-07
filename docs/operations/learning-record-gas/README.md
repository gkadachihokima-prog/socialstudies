# 学習記録GAS `attempt_progress` 運用手順書（Phase3B-1）

- 作成日: 2026-09-01（火）
- 位置づけ: Attempt/AnswerRecord専用GAS（学習記録GAS、`docs/specification/gas-api-contract-v1.md` 5章）へ追加する、進行中学習状態（`attempt_progress`）保存基盤の正本コピー。本ファイル自体はこのリポジトリの実行環境からは一切参照されない（ビルド・アプリ本体のどこからもimportされない）。あくまで、別プロジェクトの学習記録Apps Scriptへ手動で反映するためのソースを、このリポジトリで版管理しておくための保管場所（`docs/operations/learning-summary/`と同じ位置づけ）。
- **本番反映状況（2026-09-01（火）時点）: 反映済み・本番実API試験完了。** 詳細は6.1節参照。
- **Phase3D-4A前提での更新（ローカル実装・未反映）**: `SOURCE_TYPE_VALUES`（0節参照）へ`testset_review`を追加し、`AttemptProgress.gs`の`validateSaveAttemptProgressPayload_`のtestSetId必須/禁止ルールを`testset`/`testset_review`両対応へ拡張した。0節の「4値」という記載は本番導入前の時点の記録であり、Phase3D-4A本番反映後は5値（`normal`/`weak_review`/`dormant_review`/`testset`/`testset_review`）となる。詳細は`docs/operations/learning-record-gas/TestSetReviewSourceType.gs`参照。

---

## 0. 前提

学習記録GASの中核（`コード.gs`/`SheetHelpers.gs`）は、`docs/operations/learning-summary/README.md` 10節に記録済みのとおり**clasp管理外・Apps Scriptエディタでの直接編集**という運用であり、本リポジトリには実物のコピーが存在しない。私（Claude Code）自身が本番Apps Scriptプロジェクトへアクセスする手段も無い（`scriptId`不明、clasp v3にはプロジェクト一覧を列挙するコマンドが無い）。

ユーザーが本番Apps Scriptエディタの`コード.gs`/`SheetHelpers.gs`を直接確認し、以下の事実を提供いただいたことで、`AttemptProgress.gs`を**本番実装へ完全準拠する形へ確定**した。

| 項目 | 本番の実際の値・仕様 |
|---|---|
| `doGet(e)` | 現在`getStudentHistory`のみ処理 |
| `doPost(e)` | 現在`startAttempt`/`saveAnswerRecord`/`completeAttempt`を処理 |
| 共通レスポンス | `jsonResponse(result)` |
| 共通エラー | `errorResult_(message)` |
| 既存handler命名 | `handleStartAttempt`/`handleSaveAnswerRecord`/`handleCompleteAttempt`/`handleGetStudentHistory`（**末尾アンダースコアなし**） |
| `SHEET_NAMES` | `{ ATTEMPTS: 'attempts', ANSWER_RECORDS: 'answer_records' }` |
| `ATTEMPTS_HEADERS`/`ANSWER_RECORDS_HEADERS`/`SOURCE_TYPE_VALUES`/`LOCK_WAIT_MS` | 既存定数として存在（`SOURCE_TYPE_VALUES`は`normal`/`weak_review`/`dormant_review`/`testset`の4値、`LOCK_WAIT_MS`は`10000`＝10秒） |
| `DATE_HEADERS` | `['startedAt', 'completedAt', 'answeredAt']` |
| `getValidatedSheet_(name, headers)` | `getActiveSpreadsheet()`→`getSheetByName()`。シート不存在なら`throw`。ヘッダー完全一致確認、不一致なら`throw`。 |
| `readRowsAsObjects_(sheet, headers)` | 各データ行を、`headers`をキーとしたオブジェクトへ変換。各行へ内部メタキー`__row: index + 2`（Spreadsheet実行番号、1-based）を付与。 |
| `findRowIndexByKey_(sheet, headers, keyNames[], keyValues[])` | 複合キー対応（配列で渡す）。一致行の`__row`（Spreadsheet実行番号、1-based）を返す。見つからなければ`-1`。 |
| `loadRowByIndex_(sheet, headers, rowIndex)` | `row.__row === rowIndex`で照合し該当行オブジェクトを返す。`rowIndex`はSpreadsheet実行番号（`findRowIndexByKey_`の返り値をそのまま渡せる）。 |
| `writeRow_(sheet, headers, rowIndex, rowObject)` | `sheet.getRange(rowIndex, 1, 1, headers.length)`を使用。`DATE_HEADERS`に含まれる列は`setNumberFormat('@')`でテキスト形式を強制。 |
| `appendRow_`/`stripRowMeta_`/`normalizeString_`/`toFiniteNumberOrNull_` | 既存helperとして存在 |
| `toBoolean_(value)` | `return value === true;`（厳密一致） |
| LockServiceパターン | `var lock = LockService.getScriptLock(); if (!lock.tryLock(LOCK_WAIT_MS)) { return errorResult_('サーバーが混み合っています。しばらくしてから再度お試しください。'); } try { ... } finally { lock.releaseLock(); }`（**`tryLock`、`waitLock`ではない**） |
| `handleStartAttempt`の`sourceType`仕様 | 空欄なら許容、値がある場合のみ`SOURCE_TYPE_VALUES`でvalidation |
| `handleStartAttempt`の`testSetId`仕様 | `sourceType==="testset"`のときのみ必須、それ以外は指定禁止 |

`AttemptProgress.gs`・付随するローカルテスト（`getValidatedSheet_`等の低レベルhelper）はすべて上記の確定仕様に合わせて実装・検証済み。

**残る限界**: `handleStartAttempt`/`handleSaveAnswerRecord`/`handleCompleteAttempt`/`handleGetStudentHistory`という既存4APIの**ビジネスロジック本体の実ソースコード**は受領しておらず、STEP22の統合テストではAPI契約（`gas-api-contract-v1.md` 5.1-5.4節）と上記の確定済みhelper仕様から組み立てた近似実装で代替した。したがって「既存4API回帰」の結果は、`SheetHelpers.gs`の共通処理を介した構造的な非破壊性（`attempt_progress`追加によって既存のシート操作パターンが壊れないこと）の確認であり、本番の実際のビジネスロジックとバイト単位で一致することの証明ではない。

## 1. 目的

生徒が学習途中でブラウザを閉じる・タブレットの電源が落ちる・明示的に中断する、といった事態が起きても、将来「続きから」を実現できるよう、進行中学習状態の正本を学習記録GAS側へ保存する基盤（GAS側のみ）を用意する。

Web側（`app.js`等）からのprogress送信・中断ボタン・続きからUI・localStorage・最後の生徒候補表示・複数単元連続学習・前回学習からの復習は、**すべてPhase3B-1のスコープ外**（Phase3B-2以降）。

## 2. 責務分離

| シート | 責務 |
|---|---|
| `attempts`（既存） | 1回の学習Attemptそのもの。無変更。 |
| `answer_records`（既存） | 1問ごとの確定した回答。無変更。 |
| `attempt_progress`（新規） | 未完了Attemptの再開に必要な進行状態。 |

`Attempt`へ大量の列を追加する方式、`QuestionSet`自体を新しい正本として全面的にGAS化する方式は、いずれも今回不採用とした。

### 2.1 `SHEET_NAMES`/`DATE_HEADERS`は末尾へ追加する（最終判断）

本番`コード.gs`/`SheetHelpers.gs`の実際の構文を確認できたため、以下2箇所を**末尾へ追加**する（前回検討していた「一切変更しない」方針から変更）。

1. `SHEET_NAMES`オブジェクトへ`ATTEMPT_PROGRESS: 'attempt_progress'`を追加
2. `DATE_HEADERS`配列へ`'updatedAt'`を追加

**安全性の根拠**: `writeRow_`は、書き込み対象シートの`headers`引数（例：`ATTEMPTS_HEADERS`）に実際に含まれる列名についてのみ`DATE_HEADERS`との一致を確認して`setNumberFormat`を適用する。`attempts`/`answer_records`の`headers`には`updatedAt`という列名自体が存在しないため、`DATE_HEADERS`へ`updatedAt`を追加しても、既存2シートへの書込み時にこの列名が一致することはなく、既存の書込み挙動（フォーマット適用箇所）は一切変化しない。`SHEET_NAMES`への追加も、既存の`SHEET_NAMES.ATTEMPTS`/`SHEET_NAMES.ANSWER_RECORDS`参照箇所には影響しない末尾追加のみ。

## 3. `attempt_progress`シート正式列（14列、Phase3C前提で13列から拡張）

既存`attempts`/`answer_records`の列命名規則（`docs/specification/data-schema-v1.md` 10.1/10.2節）に合わせ、camelCaseで統一。

| # | 列名 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| 1 | `attemptId` | string | 必須 | `attempts.attemptId`と同一。主キー。 |
| 2 | `studentId` | string | 必須 | `attempts.studentId`と一致することを新規行作成時に確認。 |
| 3 | `fieldId` | string | 必須 | `history`/`physics`等。 |
| 4 | `unit` | string | 任意 | 学習開始時に選択された単元。`weak_review`/`dormant_review`等、単一unitで表現できない起点では空欄を許容。 |
| 5 | `sourceType` | string | 必須 | `normal`/`testset`/`weak_review`/`dormant_review`のいずれか（既存`SOURCE_TYPE_VALUES`をそのまま再利用）。 |
| 6 | `testSetId` | string | `sourceType="testset"`のみ必須 | それ以外は**指定禁止**（既存`handleStartAttempt`と同じルール）。 |
| 7 | `questionIds` | JSON配列文字列 | 必須（1件以上、重複不可） | 開始時点の出題順snapshot。順序を保持し、sort・重複除去はしない。 |
| 8 | `currentQuestionIndex` | 整数（0-based） | 必須 | **「次に表示すべき問題のindex」**。開始直後は0。全問回答済みは配列長と同値（有効な状態、エラーではない）。 |
| 9 | `wrongQuestionIds` | JSON配列文字列 | 必須（空配列可、重複不可） | retry対象問題の順序付き配列。retry未開始は`[]`。 |
| 10 | `retryRound` | 整数（0以上） | 必須 | 0=通常ラウンド、1=1回目retry。将来2以上へ拡張可能（今回のvalidationで上限は設けない）。 |
| 11 | `retryWrongEnabled` | boolean | 必須（Phase3C前提で新設） | 学習開始時点で選択されていたretry可否設定のsnapshot。`retryRound`やGET時点の状態から再計算・推測しない（`sourceType==="testset"`は既存仕様どおり常に`false`、それ以外はUI選択値をそのまま保存）。Phase3Cの「中断→続きから再開」機能で、再開後の判定を中断前と同一にするために保存する。 |
| 12 | `status` | string | 必須 | `in_progress` / `abandoned`の2値のみ。 |
| 13 | `startedAt` | ISO8601文字列 | 必須 | 初回保存時のみ確定。以降のupdateで書き換えない。`DATE_HEADERS`対象（既存）。 |
| 14 | `updatedAt` | ISO8601文字列 | 必須 | 常にGASサーバー時刻で上書き（クライアント指定値は無視）。`DATE_HEADERS`対象（2.1節の追加により）。 |

`Attempt.completed`は`attempt_progress`へ重複保存しない（`attempts`シートを都度参照する）。

**本番反映時の注意（`retryWrongEnabled`列追加、Phase3C前提）**: 既存の13列版が本番稼働中に14列版へコード更新すると、本番Spreadsheetのヘッダー行（1行目）が13列のままではヘッダー不一致により`getValidatedSheet_`が全リクエストをエラーにする。**コードdeploy前に、本番Spreadsheetの現在の行数・既存in_progress/abandoned件数を確認し、既存データがある場合はヘッダー行へ`retryWrongEnabled`列（`retryRound`と`status`の間）を手動追加してから、その後にコードをdeployすること**（詳細は`AttemptProgress.gs`冒頭コメント参照）。既存データ行がある場合、その行の`retryWrongEnabled`セルは空欄のまま残す（true/falseで機械的に補完しない。空欄は`toBoolean_()`により安全に`false`として読み出されるのみ）。

## 4. 新規API（3本）

### 4.1 `saveAttemptProgress`（POST・書込み、公開handler名: `handleSaveAttemptProgress`）

`attemptId`主キーでupsert。新規行作成時のみ`attempts`シートでのAttempt実在・`studentId`一致確認を行う（既存行の更新では`attempts`を再走査せず、既存`attempt_progress`行自身の`studentId`との一致のみ確認する＝1問ごとに呼ばれる想定の性能面と、Attemptが作成後削除されない既存設計を踏まえた判断）。

冪等（同一`attemptId`への複数回送信は行を増殖させず、既存行を更新する）。

`sourceType`/`testSetId`は既存`handleStartAttempt`と完全に同じルール（`testset`のときのみ`testSetId`必須、それ以外は指定禁止）。`attempt_progress`はレガシーデータの無い新設テーブルのため、`sourceType`自体は（`Attempt`本体と異なり）常に必須とする。

LockServiceは既存`tryLock(LOCK_WAIT_MS)`パターンへ完全準拠。取得失敗時は`errorResult_("サーバーが混み合っています。しばらくしてから再度お試しください。")`を返す（`services/learning-record-service.js`の`TRANSIENT_ERROR_SIGNATURE`と文言を完全一致させており、Phase3B-2で配線した際に既存のクライアント側リトライ判定がそのまま機能する）。

### 4.2 `getAttemptProgress`（GET・読み取り、公開handler名: `handleGetAttemptProgress`）

`studentId`完全一致・`status="in_progress"`・対応する`attempts.completed !== true`の候補のうち、`updatedAt`降順（同値時は`attemptId`降順で決定的にtie-break）で最新1件のみを返す。0件時は`{ok:true, progress:null}`。

候補表示用の軽量APIと詳細取得用APIには分割せず、1本でフルprogress（`questionIds`/`wrongQuestionIds`を配列へparse済みで含む、内部メタキー`__row`は`stripRowMeta_`で除外済み）を返す。

### 4.3 `abandonAttemptProgress`（POST・書込み、公開handler名: `handleAbandonAttemptProgress`）

`status`を`abandoned`へ更新するのみ。物理削除しない。`Attempt`/`AnswerRecord`は一切変更しない。既に`abandoned`済みへの再リクエストも成功扱い（冪等）。該当`attemptId`が存在しない場合はエラー（既存`archiveTestSet`の実ソースは未確認のため「同じ」とは断定しないが、独自方針として維持）。

## 5. 本番GASへの反映方法（未実施・具体手順）

GAS初心者でも迷わない粒度で、ファイル単位に分けて示す。**この手順は「保存」までで、まだ「デプロイ」は行わない**。

### STEP1: 新規ファイル`AttemptProgress`を作る

1. 本番学習記録GASのApps Scriptエディタを開く
2. 左側のファイル一覧の「+」→「スクリプト」を選ぶ
3. ファイル名を`AttemptProgress`とする（`.gs`拡張子は自動）

### STEP2: `AttemptProgress.gs`全文を貼る

`docs/operations/learning-record-gas/AttemptProgress.gs`の内容を**冒頭のコメントも含めて全文**コピーし、STEP1で作った空ファイルへ貼り付けて保存する（まだこの時点では他のファイルとは連携していない）。

### STEP3: `コード.gs`を変更する

`コード.gs`を開き、`doGet(e)`関数の中の、既存`getStudentHistory`を処理している部分の近くに以下を追加する。

```javascript
if (action === "getAttemptProgress") {
  return jsonResponse(handleGetAttemptProgress(e.parameter.studentId));
}
```

次に、`doPost(e)`関数の中の、既存`startAttempt`/`saveAnswerRecord`/`completeAttempt`を処理している部分の近くに以下を追加する。

```javascript
if (action === "saveAttemptProgress") {
  return jsonResponse(handleSaveAttemptProgress(body));
}
if (action === "abandonAttemptProgress") {
  return jsonResponse(handleAbandonAttemptProgress(body));
}
```

（`body`は既存コードが`JSON.parse(e.postData.contents)`等で作っている、POSTボディをパース済みのオブジェクトの変数名に読み替える。既存の`action`分岐は一切削除・変更しない。）

### STEP4: `SheetHelpers.gs`を変更する

`SHEET_NAMES`の定義を探し、末尾へ1行追加する。

```javascript
var SHEET_NAMES = {
  ATTEMPTS: 'attempts',
  ANSWER_RECORDS: 'answer_records',
  ATTEMPT_PROGRESS: 'attempt_progress'   // ← この1行を追加
};
```

次に`DATE_HEADERS`の定義を探し、末尾へ1要素追加する。

```javascript
var DATE_HEADERS = [
  'startedAt',
  'completedAt',
  'answeredAt',
  'updatedAt'   // ← この1要素を追加
];
```

これ以外は`SheetHelpers.gs`を一切変更しない。

### STEP5: 保存する

`コード.gs`・`SheetHelpers.gs`・`AttemptProgress.gs`の3ファイルすべてを保存する（Ctrl+S、または各ファイルタブの保存操作）。

**ここでいったん停止**。デプロイ・本番HTTP試験・cleanupは次の指示で行う。保存が完了したら、その旨を報告いただければ、次に「保存後コード確認→deploy→実API試験→cleanup」へ進める。

## 6. テスト結果（ローカルNode vmサンドボックス、2026-09-01（火）実施）

本番Spreadsheet・本番GASには一切接続していない。0節の確定仕様に基づき`SheetHelpers.gs`相当のhelper（`getValidatedSheet_`等）を高精度に再現し、既存4APIハンドラも契約書＋伝えられた挙動に基づく近似実装で用意したうえで、`AttemptProgress.gs`の実ソースをそのままNode vmで実行して検証した。

- **STEP22（既存4API実行）**: `startAttempt`→`saveAnswerRecord`→`getStudentHistory`→`completeAttempt`→`getStudentHistory`の一連の流れを実際に実行し、レスポンス・シート内容ともに正常。`attempt_progress`シートの存在が既存4APIの動作へ影響しないことも確認。
- **A〜T（20項目）＋STEP25（シート自動生成）＋STEP26（ヘッダー不一致安全停止）＋STEP27（`completeAttempt`実行後の`getAttemptProgress`除外）**: 全項目OK。

**限界（0節参照）**: 既存4APIのビジネスロジック本体は近似実装であり、本番の実際のロジックとの完全な一致はローカルテストの範囲外。6.1節の本番実API試験でこの限界を解消済み。

## 6.1 本番実API試験結果（2026-09-01（火）実施）

専用テストstudentId `TEST_PROGRESS_001`（既存データ0件を確認してから使用）・専用テストAttempt3件（`TEST_PROGRESS_ATTEMPT_A`/`B`/`C`）を用いて、本番Web App・本番Spreadsheetに対して実施。

- `saveAttemptProgress`: 初回保存・同一`attemptId`への更新（行が増殖しないこと）・6種類のvalidation異常系（存在しないattemptId／studentId不一致／不正status／currentQuestionIndex範囲外／`sourceType=normal`での`testSetId`指定／`sourceType=testset`での`testSetId`欠落）すべて想定どおり成功・拒否を確認。
- `abandonAttemptProgress`: 初回成功・再abandonの冪等成功を確認。
- `getAttemptProgress`: **本番統合直後に重大な不具合を発見**（下記参照）。修正後、正常系（`in_progress`かつ`Attempt.completed=false`の候補を正しく返す）・`completed=true`のAttemptが候補から除外されることを確認。
- 既存4API（`startAttempt`/`saveAnswerRecord`/`completeAttempt`/`getStudentHistory`）: 本番実データで一連の流れを実行し、レスポンス形状・状態遷移とも無破壊であることを確認。
- cleanup: `TEST_PROGRESS_001`関連の全データ（`attempts`3件・`answer_records`1件・`attempt_progress`3件）を完全一致条件のみで削除し、削除後0件・対象外データ件数不変（`attempts`32件・`answer_records`595件・`attempt_progress`0件、いずれも削除前後で不変）を確認済み。

### 発見した不具合と修正（本番`コード.gs`側、運用上の再発防止事項）

本番`コード.gs`への手動統合時、`doGet`の`getAttemptProgress`分岐が誤って**パラメータオブジェクト全体**を渡しており、`getAttemptProgress`が常に`{ok:true, progress:null}`を返す不具合が発生した。

```javascript
// 誤り（本番で実際に発生した統合ミス）
return jsonResponse(handleGetAttemptProgress(e.parameter));

// 正しい（AttemptProgress.gsのhandleGetAttemptProgress(studentId)は文字列を受け取る設計）
return jsonResponse(handleGetAttemptProgress(e.parameter.studentId));
```

`handleGetStudentHistory(e.parameter)`（パラメータオブジェクトを渡す設計）と混同しやすいため、**今後同様のGET系handlerを追加する際は、そのhandlerが「オブジェクト」と「文字列等の単一値」のどちらを引数に取る設計かを都度確認すること**。

## 7. Phase3B-1で実施済みのこと

- 本番Apps Scriptへのコード反映（`AttemptProgress.gs`新規追加、`コード.gs`2箇所追加＋上記1箇所修正、`SheetHelpers.gs`2箇所追加）
- Web App deploy
- 本番HTTP試験（既存4APIとの統合含む、6.1節参照）
- テストデータ作成・cleanup（6.1節参照）
- git commit / git push（本README含む）

## 8. Phase3B-1のスコープ外（次Phase以降、今回は未着手）

Web側（`app.js`等）からのprogress送信・Attempt開始時のprogress保存・1問回答ごとのprogress保存・retry時のprogress保存・中断ボタン・続きからUI・localStorage・最後の生徒候補表示・複数単元連続学習は、すべてPhase3B-2以降のスコープ。今回は着手しない。

## 9. 将来の発展余地

`docs/operations/learning-summary/README.md` 10節と同様、学習記録GAS全体のclasp管理への移行は今回のスコープ外（大規模なリポジトリ構成変更を避けるため）。
