# 問題CSV安全更新ワークフロー（Phase4A）

正本は`scripts/update-question-csv.mjs`（`問題CSV更新.bat`から実行）。既存の
`scripts/validate-questions.mjs`/`scripts/validate-test-set.mjs`は無改修のまま利用する。

## 通常の更新手順

1. Google Sheetsから対象科目のCSVをダウンロードする（ファイル名のリネームは不要。
   ダウンロード時の名前にファイル名に科目名が含まれていれば認識される）
2. ダウンロードしたCSVを`import/questions/`へ置く
3. リポジトリ直下の`問題CSV更新.bat`をダブルクリックする
4. 画面の表示を確認する
5. 更新できたら、Claude Codeへ「問題CSVを更新したので、差分確認してcommit/pushして」と依頼する

## このワークフローが自動反映するもの・しないもの

- 自動反映する：問題の追加、既存questionIdを維持したままの内容変更
- 自動反映しない：問題の削除、questionIdの変更、科目間の移動、列構成（ヘッダー）の変更
  → いずれかを検出した場合は正式CSVを一切変更せずに停止する。Claude Codeへ相談すること

## 失敗時の扱い

検証（問題チェック・TestSetチェック）が1件でもWarning/Error/Criticalを出した場合、
正式な`data/*.csv`は1byteも変更しない。複数科目を同時に投入した場合も同様で、
1科目でも検証に失敗すればすべての科目が反映されない（部分反映はしない）。

正式CSVへ反映した直後にも同じ検証を再実行し、それでも失敗した場合は反映前の内容へ
自動的に戻す。万一の復元失敗のみ、Gitからの手動復元が必要になる（画面にファイルパスを表示する）。

## 開発者向けオプション

```
node scripts/update-question-csv.mjs --dry-run
```

検証・差分表示のみを行い、正式CSV・import CSVとも一切変更しない。

## 運用しない機能（意図的に実装していない）

- `import/questions/`へCSVを置いただけでの自動反映（フォルダ監視はしない）
- `git add`/`commit`/`push`の自動化（このワークフローは正式CSVの更新のみ担当する）
- `--allow-delete`等の削除許可オプション（削除・ID変更は都度Claude Codeで確認する）
