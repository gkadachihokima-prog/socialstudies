#!/usr/bin/env node
/**
 * 問題CSV安全更新ワークフロー（Phase4A）。
 *
 * 目的:
 *   Google Sheetsからdownloadした問題CSVを import/questions/ へ置き、本スクリプト
 *   （または問題CSV更新.bat経由）を実行するだけで、既存validator
 *   （scripts/validate-questions.mjs, scripts/validate-test-set.mjs）による
 *   安全確認を経てから data/*.csv へ反映できるようにする（開発・運用ツール、
 *   ブラウザ実行時のruntimeコードは一切変更しない）。
 *
 * 実行方法:
 *   node scripts/update-question-csv.mjs           … 通常実行（検証成功時のみ反映）
 *   node scripts/update-question-csv.mjs --dry-run … 検証・diff表示のみ、正式data変更0
 *   node scripts/update-question-csv.mjs --help    … 使い方表示
 *
 * 安全原則（Phase4A設計監査で確定）:
 *   - 8科目の正本はconfig/subjects.jsのSUBJECT_CONFIG（独自の8科目mapを二重定義しない）。
 *   - CSVパースはcore/question-loader.jsのparseDelimitedText等をそのまま再利用する
 *     （3つ目のCSVパーサを実装しない）。
 *   - 問題内容・TestSet参照の妥当性は既存validate-questions.mjs/validate-test-set.mjsを
 *     正本とする（本スクリプトはimport CSVの実在性・命名・削除有無等のworkflow固有の
 *     安全策のみを持つ。validate-*.mjs自体は無改修）。
 *   - validate-*.mjsはトップレベルでmain()を無条件実行しCLIとしてprocess.exitするため、
 *     ESM importで直接呼ばず、必ず子プロセス（execFileSync、引数配列渡し）として実行する。
 *   - 検証（staging）が全て成功するまでdata/*.csvは1byteも変更しない。複数科目投入時は
 *     全科目の検証が成功して初めて全科目を反映する（部分反映を許可しない）。
 *   - 問題の削除・questionId変更・科目移動を検出した場合は反映せず停止する
 *     （このワークフローでは追加・内容変更のみを自動反映対象とする）。
 *   - git add/commit/pushは一切行わない（読み取り専用のdirty確認のみgitを利用する）。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  cpSync,
  renameSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

import { parseDelimitedText, detectDelimiter, splitDelimitedLine } from "../core/question-loader.js";
import { SUBJECT_CONFIG } from "../config/subjects.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_DIR = path.join(REPO_ROOT, "import", "questions");
const PROCESSED_DIR = path.join(IMPORT_DIR, "processed");

const MAX_CSV_SIZE_BYTES = 20 * 1024 * 1024; // 20MB（現行最大CSVの十分上、過剰制限しない）
const FIELD_IDS = Object.keys(SUBJECT_CONFIG); // 8科目、SUBJECT_CONFIGが単一の正本

const EXCLUDED_TOP_LEVEL_FOR_STAGING = new Set([".git", ".claude", ".vscode", "import", "node_modules"]);

// ---------------------------------------------------------------------------
// pure: filename -> fieldId 判定
// ---------------------------------------------------------------------------

/**
 * Google Sheetsのdownload形式（例: "LS総合テスト対策_問題マスター - civics (3).csv"）や
 * 単純なrename形式（例: "civics.csv"）から、正式8 fieldIdのいずれかを厳密一致で判定する。
 * 部分一致・曖昧一致は一切行わない（"civics_backup.csv"等は必ずnullを返す）。
 *
 * @param {string} filename - 拡張子込みのbasename
 * @returns {string|null} 一致したfieldId、なければnull
 */
export function detectFieldIdFromFilename(filename) {
  const withoutExt = String(filename || "").replace(/\.csv$/i, "");
  const withoutChromeSuffix = withoutExt.replace(/\s*\(\d+\)\s*$/, "");

  const candidates = [withoutChromeSuffix];
  const lastDashIndex = withoutChromeSuffix.lastIndexOf(" - ");
  if (lastDashIndex !== -1) {
    candidates.push(withoutChromeSuffix.slice(lastDashIndex + 3));
  }

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const match = FIELD_IDS.find((fieldId) => fieldId.toLowerCase() === trimmed.toLowerCase());
    if (match) return match;
  }

  return null;
}

// ---------------------------------------------------------------------------
// pure: 生ヘッダー抽出（parseDelimitedTextはheader自体を返さないため、
// 既存question-loader.jsのdetectDelimiter/splitDelimitedLineを使って
// 同じ正規化方針でheader行だけを取り出す）
// ---------------------------------------------------------------------------

export function extractRawHeader(text) {
  const normalized = String(text || "")
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;

  const delimiter = detectDelimiter(lines[0]);
  return splitDelimitedLine(lines[0], delimiter).map((h) => h.trim());
}

// ---------------------------------------------------------------------------
// pure: questionId単位の意味的diff（scripts/compare-question-csv.mjsと同じ思想）
// ---------------------------------------------------------------------------

export function computeQuestionDiff(productionRows, importRows) {
  const prodById = new Map(productionRows.map((r) => [r.questionId, r]));
  const importById = new Map(importRows.map((r) => [r.questionId, r]));

  const added = [...importById.keys()].filter((id) => !prodById.has(id)).sort();
  const deleted = [...prodById.keys()].filter((id) => !importById.has(id)).sort();
  const modified = [];
  const unchanged = [];

  for (const [id, prodRow] of prodById) {
    const importRow = importById.get(id);
    if (!importRow) continue;
    const keys = Object.keys(prodRow);
    const isSame = keys.every((key) => String(prodRow[key] ?? "") === String(importRow[key] ?? ""));
    (isSame ? unchanged : modified).push(id);
  }

  modified.sort();
  unchanged.sort();

  return {
    beforeCount: productionRows.length,
    afterCount: importRows.length,
    added,
    deleted,
    modified,
    unchanged
  };
}

export function findDuplicateQuestionIds(rows) {
  const seen = new Map();
  rows.forEach((r) => {
    const id = String(r.questionId ?? "");
    seen.set(id, (seen.get(id) || 0) + 1);
  });
  return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

export function findEmptyQuestionIdRows(rows) {
  return rows.filter((r) => !String(r.questionId ?? "").trim()).length;
}

// ---------------------------------------------------------------------------
// pure: validator出力の安全なparse（脆いregex依存を最小化しつつ、
// 実際の合計行フォーマット以外は「判定不能」として安全側に倒す）
// ---------------------------------------------------------------------------

export function parseValidatorSummary(stdout) {
  const match = String(stdout || "").match(/Warning\s+(\d+)件\s*\/\s*Error\s+(\d+)件\s*\/\s*Critical\s+(\d+)件/);
  if (!match) return null;
  return { warning: Number(match[1]), error: Number(match[2]), critical: Number(match[3]) };
}

// ---------------------------------------------------------------------------
// I/O・プロセス関連ヘルパー
// ---------------------------------------------------------------------------

function isValidUtf8(buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function runValidatorScript(absoluteScriptPath, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [absoluteScriptPath], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      exitCode: typeof error.status === "number" ? error.status : -1,
      stdout: typeof error.stdout === "string" ? error.stdout : String(error.stdout ?? ""),
      stderr: typeof error.stderr === "string" ? error.stderr : String(error.stderr ?? error.message ?? "")
    };
  }
}

/**
 * validate-questions.mjs / validate-test-set.mjsを子プロセスとして実行し、
 * Warning/Error/Criticalが全て0の場合のみ安全とみなす。
 * 出力形式が想定と異なる場合は「判定不能」として必ず失敗扱いにする（成功を推測しない）。
 */
function checkValidatorClean(scriptAbsolutePath, cwd, label) {
  const result = runValidatorScript(scriptAbsolutePath, cwd);
  const counts = parseValidatorSummary(result.stdout);

  if (counts === null) {
    return {
      ok: false,
      message: `${label}の出力形式を認識できませんでした（判定不能のため安全側で停止します）。`,
      raw: result
    };
  }

  if (counts.warning > 0 || counts.error > 0 || counts.critical > 0) {
    return {
      ok: false,
      message: `${label}: Warning${counts.warning}件 / Error${counts.error}件 / Critical${counts.critical}件`,
      raw: result,
      counts
    };
  }

  if (result.exitCode !== 0) {
    // 集計は0件なのにexit codeが異常＝スクリプト自体の異常終了（例外等）の可能性があるため、
    // 「0件だろう」と推測せず安全側で停止する。
    return {
      ok: false,
      message: `${label}が異常終了しました（exit code=${result.exitCode}）。`,
      raw: result
    };
  }

  return { ok: true, counts, raw: result };
}

function isGitDirty(relativePath) {
  try {
    const output = execFileSync("git", ["status", "--porcelain", "--", relativePath], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });
    return output.trim().length > 0;
  } catch (error) {
    // gitコマンド自体が使えない環境では、安全側として「確認できない=dirty扱い」にはせず、
    // 警告だけ出して続行する（開発環境には常にgitがある前提だが、念のため落ちない）。
    console.error("git status確認に失敗しました（このチェックのみスキップします）:", error.message);
    return false;
  }
}

function readCsvRows(absolutePath) {
  const text = readFileSync(absolutePath, "utf8");
  return { text, rows: parseDelimitedText(text) };
}

function formatDateForFilename(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function resolveProcessedPath(fieldId, now) {
  const base = `${formatDateForFilename(now)}_${fieldId}.csv`;
  let candidatePath = path.join(PROCESSED_DIR, base);
  let suffix = 2;
  while (existsSync(candidatePath)) {
    candidatePath = path.join(PROCESSED_DIR, `${formatDateForFilename(now)}_${fieldId}-${suffix}.csv`);
    suffix += 1;
  }
  return candidatePath;
}

// ---------------------------------------------------------------------------
// CLI引数
// ---------------------------------------------------------------------------

function parseCliArgs(argv) {
  const args = argv.slice(2);
  let dryRun = false;
  let help = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      console.error(`不明なオプションです: ${arg}`);
      console.error("使い方: node scripts/update-question-csv.mjs [--dry-run]");
      process.exitCode = 1;
      return null;
    }
  }

  return { dryRun, help };
}

function printHelp() {
  console.log("使い方:");
  console.log("  node scripts/update-question-csv.mjs           通常実行（検証成功時のみ正式反映）");
  console.log("  node scripts/update-question-csv.mjs --dry-run 検証・差分表示のみ（正式data変更0）");
}

// ---------------------------------------------------------------------------
// import/questions/ 走査
// ---------------------------------------------------------------------------

function scanImportCandidates() {
  if (!existsSync(IMPORT_DIR)) {
    return { ok: false, message: `import/questions/ フォルダが見つかりません: ${IMPORT_DIR}` };
  }

  const entries = readdirSync(IMPORT_DIR, { withFileTypes: true });
  const csvEntries = entries.filter((e) => e.isFile() && /\.csv$/i.test(e.name));

  if (csvEntries.length === 0) {
    return { ok: true, candidates: [], empty: true };
  }

  const byFieldId = new Map();
  const unknownFiles = [];
  const nonRegularFiles = [];

  for (const entry of csvEntries) {
    const absolutePath = path.join(IMPORT_DIR, entry.name);
    const stat = statSync(absolutePath);

    if (!stat.isFile()) {
      nonRegularFiles.push(entry.name);
      continue;
    }

    const fieldId = detectFieldIdFromFilename(entry.name);
    if (!fieldId) {
      unknownFiles.push(entry.name);
      continue;
    }

    if (!byFieldId.has(fieldId)) byFieldId.set(fieldId, []);
    byFieldId.get(fieldId).push({ filename: entry.name, absolutePath, size: stat.size });
  }

  if (nonRegularFiles.length > 0) {
    return { ok: false, message: `通常ファイルではない項目が見つかりました: ${nonRegularFiles.join(", ")}` };
  }

  if (unknownFiles.length > 0) {
    return {
      ok: false,
      message:
        `import/questions/内に、科目を判別できないCSVがあります: ${unknownFiles.join(", ")}\n` +
        `ファイル名に正式な科目名（${FIELD_IDS.join("/")}）が含まれているか確認してください。`
    };
  }

  const duplicateFieldIds = [...byFieldId.entries()].filter(([, files]) => files.length > 1);
  if (duplicateFieldIds.length > 0) {
    const detail = duplicateFieldIds
      .map(([fieldId, files]) => `${fieldId}: ${files.map((f) => f.filename).join(", ")}`)
      .join(" / ");
    return { ok: false, message: `同一科目のCSVが複数あります（自動選択しません）: ${detail}` };
  }

  const candidates = [...byFieldId.entries()].map(([fieldId, files]) => ({ fieldId, ...files[0] }));
  candidates.sort((a, b) => FIELD_IDS.indexOf(a.fieldId) - FIELD_IDS.indexOf(b.fieldId));

  return { ok: true, candidates, empty: false };
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

function main() {
  const args = parseCliArgs(process.argv);
  if (!args) return;
  if (args.help) {
    printHelp();
    return;
  }

  console.log("========================================");
  console.log(args.dryRun ? "問題CSV確認（--dry-run）" : "問題CSV更新");
  console.log("========================================");
  if (args.dryRun) {
    console.log("【確認のみ】正式CSVは変更しません。");
  }
  console.log("");

  // STEP2: import scan
  const scanResult = scanImportCandidates();
  if (!scanResult.ok) {
    console.log(`更新できませんでした。\n理由:\n${scanResult.message}\n\n正式CSVは変更していません。`);
    process.exitCode = 1;
    return;
  }

  if (scanResult.empty) {
    console.log("更新するCSVがありません（import/questions/ が空です）。");
    process.exitCode = 0;
    return;
  }

  const candidates = scanResult.candidates;
  console.log(`検出したCSV：${candidates.length}科目`);
  candidates.forEach((c) => {
    console.log(`  ・${SUBJECT_CONFIG[c.fieldId]?.label || c.fieldId}（${c.fieldId}） ${c.filename}`);
  });
  console.log("");

  // STEP5: regular file / size / UTF-8
  for (const candidate of candidates) {
    if (candidate.size === 0) {
      console.log(`更新できませんでした。\n理由:\n${candidate.filename} が空（0byte）です。\n\n正式CSVは変更していません。`);
      process.exitCode = 1;
      return;
    }
    if (candidate.size > MAX_CSV_SIZE_BYTES) {
      console.log(
        `更新できませんでした。\n理由:\n${candidate.filename} のサイズが上限（${MAX_CSV_SIZE_BYTES / 1024 / 1024}MB）を超えています。\n\n正式CSVは変更していません。`
      );
      process.exitCode = 1;
      return;
    }
    const buffer = readFileSync(candidate.absolutePath);
    if (!isValidUtf8(buffer)) {
      console.log(
        `更新できませんでした。\n理由:\n${candidate.filename} がUTF-8として正しく読み取れません（文字化けの可能性）。\n\n正式CSVは変更していません。`
      );
      process.exitCode = 1;
      return;
    }
  }

  // STEP6: dirty guard（対象科目のproduction CSVのみ）
  for (const candidate of candidates) {
    const relativeCsvPath = SUBJECT_CONFIG[candidate.fieldId].csvPath.replace(/^\.\//, "");
    if (isGitDirty(relativeCsvPath)) {
      console.log(
        `更新できませんでした。\n理由:\n${relativeCsvPath} に未commitの変更があります。\n先にその変更をcommitまたは復元してから、再度お試しください。\n\n正式CSVは変更していません。`
      );
      process.exitCode = 1;
      return;
    }
  }

  // STEP7: production/import header比較 ＋ STEP8-10: parse・diff・削除guard
  const plans = [];

  for (const candidate of candidates) {
    const relativeCsvPath = SUBJECT_CONFIG[candidate.fieldId].csvPath.replace(/^\.\//, "");
    const productionAbsolutePath = path.join(REPO_ROOT, relativeCsvPath);

    if (!existsSync(productionAbsolutePath)) {
      console.log(`更新できませんでした。\n理由:\n正式CSVが見つかりません: ${relativeCsvPath}\n\n正式CSVは変更していません。`);
      process.exitCode = 1;
      return;
    }

    const productionText = readFileSync(productionAbsolutePath, "utf8");
    const importText = readFileSync(candidate.absolutePath, "utf8");

    const productionHeader = extractRawHeader(productionText);
    const importHeader = extractRawHeader(importText);

    if (!importHeader) {
      console.log(`更新できませんでした。\n理由:\n${candidate.filename} にヘッダー行がありません。\n\n正式CSVは変更していません。`);
      process.exitCode = 1;
      return;
    }

    if (JSON.stringify(productionHeader) !== JSON.stringify(importHeader)) {
      console.log(
        `更新できませんでした。\n理由:\n${candidate.filename} の列構成が現在の${SUBJECT_CONFIG[candidate.fieldId].label}CSVと一致しません。\n` +
          `期待: ${productionHeader.join(",")}\n実際: ${importHeader.join(",")}\n\n正式CSVは変更していません。`
      );
      process.exitCode = 1;
      return;
    }

    const productionRows = parseDelimitedText(productionText);
    const importRows = parseDelimitedText(importText);

    if (importRows.length === 0) {
      console.log(`更新できませんでした。\n理由:\n${candidate.filename} に問題データが1件もありません。\n\n正式CSVは変更していません。`);
      process.exitCode = 1;
      return;
    }

    const importDuplicates = findDuplicateQuestionIds(importRows);
    if (importDuplicates.length > 0) {
      console.log(
        `更新できませんでした。\n理由:\n${candidate.filename} 内でquestionIdが重複しています: ${importDuplicates.slice(0, 20).join(", ")}\n\n正式CSVは変更していません。`
      );
      process.exitCode = 1;
      return;
    }

    if (findEmptyQuestionIdRows(importRows) > 0) {
      console.log(`更新できませんでした。\n理由:\n${candidate.filename} にquestionIdが空の行があります。\n\n正式CSVは変更していません。`);
      process.exitCode = 1;
      return;
    }

    const diff = computeQuestionDiff(productionRows, importRows);

    if (diff.deleted.length > 0) {
      console.log(
        `更新を中止しました。\n\n${SUBJECT_CONFIG[candidate.fieldId].label}で${diff.deleted.length}問の削除を検出しました。\n` +
          `削除されるquestionId：\n${diff.deleted.slice(0, 20).join(", ")}${diff.deleted.length > 20 ? ` ...ほか${diff.deleted.length - 20}件` : ""}\n\n` +
          `問題の削除・ID変更は自動更新しません。\n正式CSVは変更していません。\nClaude Codeで内容を確認してください。`
      );
      process.exitCode = 1;
      return;
    }

    plans.push({
      ...candidate,
      relativeCsvPath,
      productionAbsolutePath,
      productionText,
      importText,
      hasChange: diff.added.length > 0 || diff.modified.length > 0,
      diff
    });
  }

  console.log("差分：");
  plans.forEach((p) => {
    console.log(`【${SUBJECT_CONFIG[p.fieldId].label}】`);
    console.log(`  現在：${p.diff.beforeCount}問 → 更新後：${p.diff.afterCount}問`);
    console.log(`  追加：${p.diff.added.length}問 / 変更：${p.diff.modified.length}問 / 変更なし：${p.diff.unchanged.length}問`);
  });
  console.log("");

  // STEP11-15: staging生成・反映・validation
  console.log("更新後の問題データを安全確認しています……");
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "ls-question-import-"));

  try {
    cpSync(REPO_ROOT, tempRoot, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(REPO_ROOT, src);
        if (rel === "") return true;
        const topLevel = rel.split(path.sep)[0];
        return !EXCLUDED_TOP_LEVEL_FOR_STAGING.has(topLevel);
      }
    });

    for (const plan of plans) {
      const stagingCsvPath = path.join(tempRoot, plan.relativeCsvPath);
      writeFileSync(stagingCsvPath, plan.importText, "utf8");
    }

    const stagingQuestionsResult = checkValidatorClean(
      path.join(tempRoot, "scripts", "validate-questions.mjs"),
      tempRoot,
      "問題チェック"
    );
    if (!stagingQuestionsResult.ok) {
      console.log(`問題チェック：NG\n\n${stagingQuestionsResult.message}\n\n正式CSVは変更していません。`);
      if (stagingQuestionsResult.raw?.stdout) console.log(stagingQuestionsResult.raw.stdout);
      process.exitCode = 1;
      return;
    }
    console.log("問題チェック：OK");

    const stagingTestSetResult = checkValidatorClean(
      path.join(tempRoot, "scripts", "validate-test-set.mjs"),
      tempRoot,
      "TestSetチェック"
    );
    if (!stagingTestSetResult.ok) {
      console.log(`TestSetチェック：NG\n\n${stagingTestSetResult.message}\n\n正式CSVは変更していません。`);
      if (stagingTestSetResult.raw?.stdout) console.log(stagingTestSetResult.raw.stdout);
      process.exitCode = 1;
      return;
    }
    console.log("TestSetチェック：OK");
    console.log("");

    if (args.dryRun) {
      console.log("【確認のみ】検証はすべて成功しました。正式CSV・import CSVとも変更していません。");
      process.exitCode = 0;
      return;
    }

    // STEP17-18: 元Buffer保持 ＋ 変更ありtargetだけsafe write
    const writtenPlans = plans.filter((p) => p.hasChange);
    const backups = writtenPlans.map((p) => ({ path: p.productionAbsolutePath, original: p.productionText }));

    function rollbackWrites() {
      backups.forEach((b) => writeFileSync(b.path, b.original, "utf8"));
    }

    if (writtenPlans.length > 0) {
      console.log("正式CSVを更新しています……");
      try {
        for (const plan of writtenPlans) {
          const tmpPath = `${plan.productionAbsolutePath}.update-tmp`;
          writeFileSync(tmpPath, plan.importText, "utf8");
          renameSync(tmpPath, plan.productionAbsolutePath);
        }
      } catch (writeError) {
        console.error("正式CSVの書込みに失敗しました:", writeError.message);
        rollbackWrites();
        console.log("正式CSVを元の状態へ戻しました。正式問題は更新されていません。\nimport CSVはそのまま残しています。");
        process.exitCode = 1;
        return;
      }

      // STEP19-21: repository本体でのpost-write validation
      const repoQuestionsResult = checkValidatorClean(
        path.join(REPO_ROOT, "scripts", "validate-questions.mjs"),
        REPO_ROOT,
        "問題チェック（反映後）"
      );
      const repoTestSetResult = repoQuestionsResult.ok
        ? checkValidatorClean(path.join(REPO_ROOT, "scripts", "validate-test-set.mjs"), REPO_ROOT, "TestSetチェック（反映後）")
        : null;

      if (!repoQuestionsResult.ok || !repoTestSetResult?.ok) {
        console.error("更新後の安全確認に失敗しました。正式CSVを元の状態へ戻します。");
        rollbackWrites();

        const verifyAfterRollback = checkValidatorClean(
          path.join(REPO_ROOT, "scripts", "validate-questions.mjs"),
          REPO_ROOT,
          "問題チェック（rollback後）"
        );
        if (!verifyAfterRollback.ok) {
          console.log(
            "重大エラー：正式CSVの復元に失敗した可能性があります。\n" +
              "以下のファイルをGitから復元してください：\n" +
              writtenPlans.map((p) => `  - ${p.relativeCsvPath}`).join("\n") +
              "\n\nこの状態ではcommit/pushしないでください。"
          );
          process.exitCode = 2;
          return;
        }

        console.log(
          "更新後の安全確認に失敗しました。\n正式CSVを元の状態へ戻しました。正式問題は更新されていません。\nimport CSVはそのまま残しています。"
        );
        process.exitCode = 1;
        return;
      }

      console.log("問題チェック：OK");
      console.log("TestSetチェック：OK");
    } else {
      console.log("正式CSVへの反映は不要でした（更新内容がすべて既存と同じです）。");
    }
    console.log("");

    // STEP22: processed移動（全candidate対象、変更の有無に関わらず）
    mkdirSync(PROCESSED_DIR, { recursive: true });
    const now = new Date();
    let processedMoveFailed = false;

    for (const plan of plans) {
      try {
        const destPath = resolveProcessedPath(plan.fieldId, now);
        renameSync(plan.absolutePath, destPath);
      } catch (moveError) {
        processedMoveFailed = true;
        console.error(`${plan.filename} の処理済みフォルダへの移動に失敗しました:`, moveError.message);
      }
    }

    console.log("========================================");
    console.log(writtenPlans.length > 0 ? "更新完了" : "変更なし");
    console.log("========================================");
    plans.forEach((p) => {
      const label = SUBJECT_CONFIG[p.fieldId].label;
      if (p.hasChange) {
        console.log(`${label}：${p.diff.beforeCount}問 → ${p.diff.afterCount}問（追加${p.diff.added.length}・変更${p.diff.modified.length}）`);
      } else {
        console.log(`${label}：変更はありませんでした。`);
      }
    });
    console.log("");

    if (processedMoveFailed) {
      console.log(
        "問題CSVの更新自体は完了しています。\nただし、処理済みフォルダへのCSV移動に失敗しました。\n" +
          "次回実行前に import/questions/ 内を確認してください。\n正式CSVを再度変更する必要はありません。"
      );
      process.exitCode = 1;
      return;
    }

    console.log("処理済みCSVは import/questions/processed/ へ移動しました。");
    console.log("");
    console.log("次は Claude Code へ「問題CSVを更新したので、差分確認してcommit/pushして」と依頼してください。");
    process.exitCode = 0;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const isMainModule = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main();
}
