問題CSVの更新手順
====================

1. Google Sheetsから対象科目のCSVをダウンロードする（ファイル名のリネームは不要）
2. ダウンロードしたCSVをこのフォルダ（import/questions/）へ置く
3. リポジトリ直下の「問題CSV更新.bat」をダブルクリックする
4. 画面の表示を確認する（削除が検出された場合は反映されません）
5. 更新できたら、Claude Codeへ「問題CSVを更新したので、差分確認してcommit/pushして」と依頼する

詳しい手順・注意点は docs/operations/question-csv-update.md を参照してください。
