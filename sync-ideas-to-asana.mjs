#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";
const DEFAULT_SOURCE_REPO_PATH = path.resolve("./source-bussines-idea");
const LOCAL_SOURCE_REPO_FALLBACK_PATH = path.resolve("../bussines_idea");
const DEFAULT_SOURCE_REPO_URL = "https://github.com/akina910/bussines_idea";
const SYNCED_TASK_NAME_PATTERN = /^\[(BI-\d+)\]\s+/;
const TASK_MANAGED_MARKER = "Managed-By: idea-asana-sync";
const STATUS_SECTION_FALLBACK_NAME = "未分類";
const TRUE_BOOLEAN_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_BOOLEAN_VALUES = new Set(["0", "false", "no", "off"]);
const SOURCE_REPO_ALLOWED_PATH_PREFIXES = ["ideas/", "notes/", "handoff/"];
const SOURCE_REPO_IDEA_PATH_PREFIX = "ideas/";
const SOURCE_REPO_KNOWN_PLACEHOLDERS = new Set(["-", "—", "–", "未作成", "未設定", "N/A", "n/a"]);
const SOURCE_REPO_INDEX_RELATIVE_PATH = path.join("status", "project-index.md");
const ASANA_SECTION_NAME_MAX_LEN = 80;
const ASANA_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const ASANA_RETRYABLE_METHODS = new Set(["GET", "PUT"]);
const DEFAULT_ASANA_API_MAX_RETRIES = 3;
const DEFAULT_ASANA_API_RETRY_BASE_MS = 500;

async function main() {
  const doctorMode = process.argv.includes("--doctor");
  const strictDoctorMode = doctorMode && process.argv.includes("--strict");
  const dryRun = process.argv.includes("--dry-run") || doctorMode;
  const config = loadConfig({ dryRun });
  const indexPath = path.join(config.sourceRepoPath, "status", "project-index.md");
  const indexMarkdown = await fs.readFile(indexPath, "utf8");
  const rows = parseIndexTable(indexMarkdown);
  const ideas = await Promise.all(rows.map((row) => hydrateIdea(row, config)));
  const projectGid = extractProjectGidFromUrl(config.projectUrl);
  if (doctorMode) {
    const report = buildDoctorReport(config, ideas, projectGid, { strict: strictDoctorMode });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (strictDoctorMode && !report.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (!dryRun && !projectGid) {
    throw new Error("ASANA_PROJECT_URL から project GID を読めませんでした。");
  }
  const asana = config.asanaToken
    ? createAsanaClient(config.asanaToken, {
        maxRetries: config.asanaApiMaxRetries,
        retryBaseMs: config.asanaApiRetryBaseMs,
      })
    : null;

  const resolveSectionGidByName = asana
    ? createSectionResolver(asana, projectGid)
    : async () => null;
  async function resolveSectionGid(idea) {
    const targetSectionName = resolveTargetSectionName(idea, config);
    if (!targetSectionName) {
      return null;
    }
    return resolveSectionGidByName(targetSectionName);
  }

  let existingTaskByIdeaId = new Map();
  let duplicateTasksToRemove = [];
  let orphanedTasksToRemove = [];
  let reconciliationPreview = {
    available: false,
    reason: explainReconciliationUnavailable({ hasToken: Boolean(config.asanaToken), projectGid }),
    orphanedTasksToRemove: [],
    duplicateTasksToRemove: [],
  };

  if (asana && projectGid) {
    const tasks = await listProjectTasks(asana, projectGid);
    const reconciliationPlan = planTaskReconciliation(tasks, ideas);
    existingTaskByIdeaId = reconciliationPlan.existingTaskByIdeaId;
    duplicateTasksToRemove = reconciliationPlan.duplicateTasksToRemove;
    orphanedTasksToRemove = reconciliationPlan.orphanedTasksToRemove;
    reconciliationPreview = {
      available: true,
      orphanedTasksToRemove: orphanedTasksToRemove.map(serializeTaskPreview),
      duplicateTasksToRemove: duplicateTasksToRemove.map(serializeTaskPreview),
    };
  }

  if (dryRun) {
    const dryRunOutput = {
      projectGid,
      ideas: ideas.map((idea) => ({
        ...idea,
        _section: resolveTargetSectionName(idea, config),
        _taskAction: describeDryRunTaskAction(existingTaskByIdeaId.get(idea.id), idea),
        _sectionAction: describeDryRunSectionAction(
          existingTaskByIdeaId.get(idea.id),
          projectGid,
          resolveTargetSectionName(idea, config),
        ),
      })),
      reconciliation: reconciliationPreview,
    };
    process.stdout.write(`${JSON.stringify(dryRunOutput, null, 2)}\n`);
    return;
  }

  const results = [];
  for (const task of orphanedTasksToRemove) {
    await removeTaskFromProject(asana, task.gid, projectGid);
    results.push({ action: "removed-missing", taskGid: task.gid, taskName: task.name });
  }

  for (const task of duplicateTasksToRemove) {
    await removeTaskFromProject(asana, task.gid, projectGid);
    results.push({ action: "removed-duplicate", taskGid: task.gid, taskName: task.name });
  }

  for (const idea of ideas) {
    const targetSectionGid = await resolveSectionGid(idea);
    const existing = existingTaskByIdeaId.get(idea.id);
    if (existing) {
      const needsContentUpdate = !areTaskContentsEqual(existing, idea);
      const needsSectionUpdate = targetSectionGid
        ? getTaskSectionGid(existing, projectGid) !== targetSectionGid
        : false;

      if (needsContentUpdate) {
        await updateTask(asana, existing.gid, idea);
      }
      if (needsSectionUpdate) {
        await addTaskToSection(asana, targetSectionGid, existing.gid);
      }
      results.push({
        action: needsContentUpdate || needsSectionUpdate ? "updated" : "unchanged",
        id: idea.id,
        taskGid: existing.gid,
        contentUpdated: needsContentUpdate,
        sectionUpdated: needsSectionUpdate,
      });
      continue;
    }

    const created = await createTask(asana, projectGid, idea, targetSectionGid);
    results.push({ action: "created", id: idea.id, taskGid: created.gid });
  }

  process.stdout.write(`${JSON.stringify({ projectGid, results }, null, 2)}\n`);
}

function loadConfig({ dryRun }) {
  const asanaToken = process.env.ASANA_ACCESS_TOKEN || null;
  const projectUrl = process.env.ASANA_PROJECT_URL || null;

  if (!dryRun && !asanaToken) {
    throw new Error("ASANA_ACCESS_TOKEN が必要です。");
  }

  if (!dryRun && !projectUrl) {
    throw new Error("ASANA_PROJECT_URL が必要です。");
  }

  const sectionName = normalizeSectionName(process.env.ASANA_SECTION_NAME, { fallback: null });
  const useStatusSections = parseBooleanFlag(process.env.ASANA_USE_STATUS_SECTIONS, {
    defaultValue: true,
  });
  const statusSectionMap = parseStatusSectionMap(process.env.ASANA_STATUS_SECTION_MAP_JSON);

  if (useStatusSections && sectionName) {
    console.warn(
      "[warn] ASANA_USE_STATUS_SECTIONS が有効なため ASANA_SECTION_NAME は無視されます。",
    );
  }
  if (!useStatusSections && statusSectionMap.size > 0) {
    console.warn(
      "[warn] ASANA_STATUS_SECTION_MAP_JSON は ASANA_USE_STATUS_SECTIONS=true のときのみ有効です。",
    );
  }

  return {
    asanaToken,
    projectUrl,
    sectionName,
    useStatusSections,
    statusSectionMap,
    sourceRepoPath: resolveSourceRepoPath(
      process.env.SOURCE_REPO_PATH || process.env.BUSSINES_IDEA_REPO_PATH || null,
    ),
    sourceRepoUrl:
      (
        process.env.SOURCE_REPO_URL ||
        process.env.BUSSINES_IDEA_REPO_URL ||
        DEFAULT_SOURCE_REPO_URL
      ).replace(/\/$/, ""),
    asanaApiMaxRetries: parseNonNegativeInteger(
      process.env.ASANA_API_MAX_RETRIES,
      DEFAULT_ASANA_API_MAX_RETRIES,
      { envName: "ASANA_API_MAX_RETRIES" },
    ),
    asanaApiRetryBaseMs: parseNonNegativeInteger(
      process.env.ASANA_API_RETRY_BASE_MS,
      DEFAULT_ASANA_API_RETRY_BASE_MS,
      { envName: "ASANA_API_RETRY_BASE_MS" },
    ),
  };
}

export function parseNonNegativeInteger(value, fallback, { envName = "value" } = {}) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${envName} は 0 以上の整数で指定してください。`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${envName} は 0 以上の整数で指定してください。`);
  }

  return parsed;
}

export function resolveSourceRepoPath(explicitPath) {
  if (explicitPath) {
    return explicitPath;
  }

  const candidates = [DEFAULT_SOURCE_REPO_PATH, LOCAL_SOURCE_REPO_FALLBACK_PATH];
  const detected = candidates.find((candidate) =>
    existsSync(path.join(candidate, SOURCE_REPO_INDEX_RELATIVE_PATH)),
  );
  return detected || DEFAULT_SOURCE_REPO_PATH;
}

export function parseBooleanFlag(value, { defaultValue = false } = {}) {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (TRUE_BOOLEAN_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_BOOLEAN_VALUES.has(normalized)) {
    return false;
  }

  return defaultValue;
}

export function normalizeSectionName(sectionName, { fallback = STATUS_SECTION_FALLBACK_NAME } = {}) {
  if (typeof sectionName !== "string") {
    return fallback;
  }

  const normalized = sectionName.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  if (normalized.length > ASANA_SECTION_NAME_MAX_LEN) {
    return `${normalized.slice(0, ASANA_SECTION_NAME_MAX_LEN - 1)}…`;
  }

  return normalized;
}

export function parseStatusSectionMap(rawJson) {
  if (!rawJson || !rawJson.trim()) {
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("ASANA_STATUS_SECTION_MAP_JSON は JSON オブジェクトで指定してください。");
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("ASANA_STATUS_SECTION_MAP_JSON は JSON オブジェクトで指定してください。");
  }

  const statusSectionMap = new Map();
  for (const [status, sectionName] of Object.entries(parsed)) {
    const normalizedStatus = normalizeSectionName(status, { fallback: null });
    const normalizedSectionName = normalizeSectionName(sectionName, { fallback: null });
    if (!normalizedStatus || !normalizedSectionName) {
      continue;
    }
    statusSectionMap.set(normalizedStatus, normalizedSectionName);
  }

  return statusSectionMap;
}

export function resolveTargetSectionName(idea, config) {
  if (config.useStatusSections) {
    const normalizedStatus = normalizeSectionName(idea?.status);
    const canonicalStatus = canonicalizeStatusForSection(normalizedStatus);
    const mappedSection =
      config.statusSectionMap?.get(normalizedStatus) ||
      config.statusSectionMap?.get(canonicalStatus);
    return normalizeSectionName(mappedSection || canonicalStatus);
  }

  return normalizeSectionName(config.sectionName, { fallback: null });
}

export function buildDoctorReport(config, ideas, projectGid, { strict = false } = {}) {
  const targetSections = [...new Set(ideas.map((idea) => resolveTargetSectionName(idea, config)).filter(Boolean))];
  const missingIdeaFiles = ideas
    .filter((idea) => idea.sourceFileMissing)
    .map((idea) => ({ id: idea.id, path: idea.ideaPath }));
  const issues = buildDoctorIssues({ config, ideas, projectGid, missingIdeaFiles, strict });

  return {
    ok: issues.length === 0,
    strict,
    issues,
    sourceRepoPath: config.sourceRepoPath,
    sourceRepoUrl: config.sourceRepoUrl,
    asana: {
      hasAccessToken: Boolean(config.asanaToken),
      projectGid,
      projectUrlValid: config.projectUrl ? Boolean(projectGid) : !strict,
    },
    sections: {
      useStatusSections: config.useStatusSections,
      fixedSectionName: config.useStatusSections ? null : config.sectionName,
      statusSectionMapSize: config.statusSectionMap?.size || 0,
      targetSections,
    },
    source: {
      ideaCount: ideas.length,
      missingIdeaFiles,
    },
  };
}

function buildDoctorIssues({ config, ideas, projectGid, missingIdeaFiles, strict }) {
  const issues = [];

  if (!config.sourceRepoPath) {
    issues.push("SOURCE_REPO_PATH を解決できませんでした。");
  }
  if (ideas.length === 0) {
    issues.push("status/project-index.md から同期対象 idea を1件も読めませんでした。");
  }
  if (config.projectUrl && !projectGid) {
    issues.push("ASANA_PROJECT_URL から project GID を解決できませんでした。");
  }

  if (strict) {
    if (!config.projectUrl) {
      issues.push("strict doctor では ASANA_PROJECT_URL が必要です。");
    }
    if (missingIdeaFiles.length > 0) {
      issues.push(`strict doctor では missing idea file が 0 件である必要があります。現在 ${missingIdeaFiles.length} 件です。`);
    }
  }

  return issues;
}

export function canonicalizeStatusForSection(status) {
  const normalizedStatus = normalizeSectionName(status);
  const primaryToken = normalizedStatus
    .split(/[・|｜/]/)
    .map((item) => item.trim())
    .find(Boolean);
  const withoutTrailingParen = primaryToken?.replace(/\s*[（(][^）)]*[）)]\s*$/, "");
  return normalizeSectionName(withoutTrailingParen || normalizedStatus);
}

export function extractProjectGidFromUrl(projectUrl) {
  if (!projectUrl) {
    return null;
  }

  const match = projectUrl.match(/\/(?:0|project)\/(\d+)(?:\/|$)/);
  return match?.[1] || null;
}

export function parseIndexTable(markdown) {
  const lines = markdown.split("\n");
  const tableStart = lines.findIndex((line) => line.startsWith("| ID |"));
  if (tableStart === -1) {
    throw new Error("status/project-index.md の table を読めませんでした。");
  }

  const rows = [];
  for (let i = tableStart + 2; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line || !line.startsWith("|")) {
      break;
    }

    const cells = splitMarkdownTableRow(line);

    if (cells.length < 11) {
      continue;
    }

    rows.push({
      id: cells[0],
      title: cells[1],
      type: cells[2],
      oneLine: cells[3],
      status: cells[4],
      implementation: cells[5],
      splitRepo: stripCode(cells[6]),
      nextAction: cells[7],
      ideaPath: stripCode(cells[8]),
      notesPath: stripCode(cells[9]),
      handoffPath: stripCode(cells[10]),
    });
  }

  return rows;
}

export function splitMarkdownTableRow(line) {
  const cells = [];
  let cell = "";
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      cell += char === "|" ? "|" : `\\${char}`;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += char;
  }

  if (escaped) {
    cell += "\\";
  }
  cells.push(cell.trim());

  if (line.trimStart().startsWith("|")) {
    cells.shift();
  }
  if (line.trimEnd().endsWith("|")) {
    cells.pop();
  }

  return cells;
}

function stripCode(value) {
  return value.replace(/^`|`$/g, "");
}

export function normalizeSourceRepoRelativePath(
  repoPath,
  { allowedPrefixes = SOURCE_REPO_ALLOWED_PATH_PREFIXES } = {},
) {
  if (typeof repoPath !== "string") {
    return null;
  }

  const normalizedRepoPath = repoPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  if (!normalizedRepoPath) {
    return null;
  }

  if (
    SOURCE_REPO_KNOWN_PLACEHOLDERS.has(normalizedRepoPath) ||
    /^[-—–]+$/.test(normalizedRepoPath)
  ) {
    return null;
  }

  const isAllowedRepoPath = allowedPrefixes.some((prefix) => normalizedRepoPath.startsWith(prefix));
  if (!isAllowedRepoPath) {
    return null;
  }

  const segments = normalizedRepoPath.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || !segment)) {
    return null;
  }

  return normalizedRepoPath;
}

export async function hydrateIdea(row, config) {
  const ideaMarkdown = await readOptionalSourceFile(config.sourceRepoPath, row.ideaPath);
  const summary = ideaMarkdown ? (extractSection(ideaMarkdown, "一言") || row.oneLine) : row.oneLine;

  return {
    ...row,
    summary,
    taskName: `[${row.id}] ${row.title}`,
    notes: buildTaskNotes({ ...row, summary }, config),
    sourceFileMissing: !ideaMarkdown,
  };
}

async function readOptionalSourceFile(sourceRepoPath, repoPath) {
  const normalizedRepoPath = normalizeSourceRepoRelativePath(repoPath, {
    allowedPrefixes: [SOURCE_REPO_IDEA_PATH_PREFIX],
  });
  if (!normalizedRepoPath) {
    console.warn(`[warn] source idea path is invalid; using project-index row fallback: ${repoPath}`);
    return null;
  }

  const resolvedRepoRoot = path.resolve(sourceRepoPath);
  const resolvedFilePath = path.resolve(resolvedRepoRoot, normalizedRepoPath);
  const relativePath = path.relative(resolvedRepoRoot, resolvedFilePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    console.warn(
      `[warn] source idea path escapes source repo; using project-index row fallback: ${normalizedRepoPath}`,
    );
    return null;
  }

  try {
    return await fs.readFile(resolvedFilePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.warn(
        `[warn] source idea file is missing; using project-index row fallback: ${normalizedRepoPath}`,
      );
      return null;
    }
    throw error;
  }
}

export function extractSection(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return null;
  }

  const collected = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      break;
    }
    if (line.trim()) {
      collected.push(line.trim());
    }
  }

  return collected.join(" ").trim() || null;
}

const NEXT_ACTION_MAX_LEN = 200;
const NEXT_ACTION_SUFFIX = "…(詳細はhandoffを参照)";

export function truncateNextAction(text) {
  if (!text || text.length <= NEXT_ACTION_MAX_LEN) {
    return text;
  }
  return `${text.slice(0, NEXT_ACTION_MAX_LEN - NEXT_ACTION_SUFFIX.length)}${NEXT_ACTION_SUFFIX}`;
}

export function extractIdeaIdFromTaskName(taskName) {
  return taskName?.match(SYNCED_TASK_NAME_PATTERN)?.[1] || null;
}

export function isManagedSyncTask(task) {
  const ideaId = extractIdeaIdFromTaskName(task.name);
  if (!ideaId || !task.notes) {
    return false;
  }

  if (task.notes.includes(TASK_MANAGED_MARKER)) {
    return true;
  }

  return (
    task.notes.includes(`ID: ${ideaId}`) &&
    task.notes.includes("\nidea: ") &&
    task.notes.includes("\nnotes: ") &&
    task.notes.includes("\nhandoff: ")
  );
}

function compareTasksForRetention(a, b) {
  const createdAtDiff = getTaskCreatedAtTimestamp(a) - getTaskCreatedAtTimestamp(b);
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return String(a.gid).localeCompare(String(b.gid));
}

function getTaskCreatedAtTimestamp(task) {
  const timestamp = Date.parse(task.created_at || "");
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

export function planTaskReconciliation(tasks, ideas) {
  const sourceIdeaIds = new Set(ideas.map((idea) => idea.id));
  const existingTaskByIdeaId = new Map();
  const duplicateTasksToRemove = [];
  const orphanedTasksToRemove = [];

  for (const task of tasks) {
    const ideaId = extractIdeaIdFromTaskName(task.name);
    if (!ideaId || !isManagedSyncTask(task)) {
      continue;
    }

    if (!sourceIdeaIds.has(ideaId)) {
      orphanedTasksToRemove.push(task);
      continue;
    }

    if (existingTaskByIdeaId.has(ideaId)) {
      const currentTask = existingTaskByIdeaId.get(ideaId);
      const keeper = compareTasksForRetention(currentTask, task) <= 0 ? currentTask : task;
      const duplicate = keeper === currentTask ? task : currentTask;
      existingTaskByIdeaId.set(ideaId, keeper);
      duplicateTasksToRemove.push(duplicate);
      continue;
    }

    existingTaskByIdeaId.set(ideaId, task);
  }

  return {
    existingTaskByIdeaId,
    duplicateTasksToRemove,
    orphanedTasksToRemove,
  };
}

export function summarizeDryRunOutput(dryRunOutput) {
  const ideas = Array.isArray(dryRunOutput?.ideas) ? dryRunOutput.ideas : [];
  const reconciliation = dryRunOutput?.reconciliation || {};

  return {
    projectGid: dryRunOutput?.projectGid || null,
    ideaCount: ideas.length,
    taskActions: countBy(ideas, "_taskAction"),
    sectionActions: countBy(
      ideas.filter((idea) => idea._sectionAction),
      "_sectionAction",
    ),
    targetSections: [...new Set(ideas.map((idea) => idea._section).filter(Boolean))].sort(),
    reconciliation: {
      available: Boolean(reconciliation.available),
      reason: reconciliation.reason || null,
      orphanedTasksToRemove: Array.isArray(reconciliation.orphanedTasksToRemove)
        ? reconciliation.orphanedTasksToRemove
        : [],
      duplicateTasksToRemove: Array.isArray(reconciliation.duplicateTasksToRemove)
        ? reconciliation.duplicateTasksToRemove
        : [],
    },
  };
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item?.[key];
    if (!value) {
      continue;
    }
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

export function buildDryRunMarkdownSummary(dryRunOutput) {
  const summary = summarizeDryRunOutput(dryRunOutput);
  const lines = [
    "## Asana dry-run summary",
    "",
    `- projectGid: ${summary.projectGid || "未設定"}`,
    `- ideaCount: ${summary.ideaCount}`,
    `- targetSections: ${summary.targetSections.length ? summary.targetSections.join(", ") : "なし"}`,
    "",
    "### Task actions",
    "",
    buildCountTable(summary.taskActions, ["created", "updated", "unchanged"]),
    "",
    "### Section actions",
    "",
    buildCountTable(summary.sectionActions, ["assigned", "moved", "unchanged"]),
    "",
    "### Reconciliation",
    "",
  ];

  if (!summary.reconciliation.available) {
    lines.push(
      `- status: unavailable`,
      `- reason: ${summary.reconciliation.reason || "不明"}`,
    );
  } else {
    lines.push(
      `- status: available`,
      `- orphanedTasksToRemove: ${summary.reconciliation.orphanedTasksToRemove.length}`,
      `- duplicateTasksToRemove: ${summary.reconciliation.duplicateTasksToRemove.length}`,
    );
    lines.push(...formatTaskPreviewList("Orphaned tasks", summary.reconciliation.orphanedTasksToRemove));
    lines.push(...formatTaskPreviewList("Duplicate tasks", summary.reconciliation.duplicateTasksToRemove));
  }

  return `${lines.join("\n")}\n`;
}

function buildCountTable(counts, orderedKeys) {
  const keys = [
    ...orderedKeys,
    ...Object.keys(counts || {}).filter((key) => !orderedKeys.includes(key)).sort(),
  ];
  const lines = ["| action | count |", "|---|---:|"];
  for (const key of keys) {
    lines.push(`| ${key} | ${counts?.[key] || 0} |`);
  }
  return lines.join("\n");
}

function formatTaskPreviewList(title, tasks) {
  if (!tasks.length) {
    return [];
  }

  const previewLimit = 20;
  const lines = ["", `#### ${title}`, ""];
  for (const task of tasks.slice(0, previewLimit)) {
    lines.push(`- ${task.name || "(no name)"} (${task.gid || "no gid"})`);
  }
  if (tasks.length > previewLimit) {
    lines.push(`- ...and ${tasks.length - previewLimit} more`);
  }
  return lines;
}

export function areTaskContentsEqual(task, idea) {
  return task?.name === idea.taskName && task?.notes === idea.notes;
}

export function getTaskSectionGid(task, projectGid) {
  if (!task?.memberships || !projectGid) {
    return null;
  }

  const membership = task.memberships.find((item) => item.project?.gid === projectGid);
  return membership?.section?.gid || null;
}

function getTaskSectionName(task, projectGid) {
  if (!task?.memberships || !projectGid) {
    return null;
  }

  const membership = task.memberships.find((item) => item.project?.gid === projectGid);
  return membership?.section?.name || null;
}

function describeDryRunTaskAction(existingTask, idea) {
  if (!existingTask) {
    return "created";
  }

  return areTaskContentsEqual(existingTask, idea) ? "unchanged" : "updated";
}

function describeDryRunSectionAction(existingTask, projectGid, targetSectionName) {
  if (!targetSectionName) {
    return null;
  }

  if (!existingTask) {
    return "assigned";
  }

  return getTaskSectionName(existingTask, projectGid) === targetSectionName ? "unchanged" : "moved";
}

function explainReconciliationUnavailable({ hasToken, projectGid }) {
  if (!hasToken && !projectGid) {
    return "ASANA_ACCESS_TOKEN と ASANA_PROJECT_URL が未設定のため、既存 task の削除候補は計算できません。";
  }
  if (!hasToken) {
    return "ASANA_ACCESS_TOKEN が未設定のため、既存 task の削除候補は計算できません。";
  }
  if (!projectGid) {
    return "ASANA_PROJECT_URL から project GID を解決できないため、既存 task の削除候補は計算できません。";
  }
  return null;
}

function serializeTaskPreview(task) {
  return {
    gid: task.gid,
    name: task.name,
    created_at: task.created_at || null,
  };
}

export function buildSourceRepoFileUrl(sourceRepoUrl, repoPath) {
  const rawRepoPath = typeof repoPath === "string" ? repoPath.trim().replace(/\\/g, "/") : null;
  const normalizedRepoPath = normalizeSourceRepoRelativePath(repoPath);
  const isKnownPlaceholder =
    rawRepoPath &&
    (SOURCE_REPO_KNOWN_PLACEHOLDERS.has(rawRepoPath) || /^[-—–]+$/.test(rawRepoPath));
  if (rawRepoPath && !normalizedRepoPath && !isKnownPlaceholder) {
    console.warn(
      `[warn] source repo path is not linkable; ignoring value: ${rawRepoPath}`,
    );
  }

  if (!normalizedRepoPath) {
    return null;
  }

  return `${sourceRepoUrl}/blob/main/${normalizedRepoPath}`;
}

export function buildTaskNotes(idea, config) {
  const ideaUrl = buildSourceRepoFileUrl(config.sourceRepoUrl, idea.ideaPath);
  const notesUrl = buildSourceRepoFileUrl(config.sourceRepoUrl, idea.notesPath);
  const handoffUrl = buildSourceRepoFileUrl(config.sourceRepoUrl, idea.handoffPath);
  const lines = [
    TASK_MANAGED_MARKER,
    `ID: ${idea.id}`,
    `タイプ: ${formatTaskFieldValue(idea.type)}`,
    `状態: ${formatTaskFieldValue(idea.status)}`,
    `実装: ${formatTaskFieldValue(idea.implementation)}`,
    `分離repo: ${formatTaskFieldValue(idea.splitRepo)}`,
    "",
    "要約",
    formatTaskFieldValue(idea.summary),
    "",
    `次アクション: ${truncateNextAction(formatTaskFieldValue(idea.nextAction))}`,
    "",
  ];

  if (ideaUrl) {
    lines.push(`idea: ${ideaUrl}`);
  }
  if (notesUrl) {
    lines.push(`notes: ${notesUrl}`);
  }
  if (handoffUrl) {
    lines.push(`handoff: ${handoffUrl}`);
  }

  return lines.join("\n");
}

export function formatTaskFieldValue(value, { fallback = "未設定" } = {}) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    !normalized ||
    SOURCE_REPO_KNOWN_PLACEHOLDERS.has(normalized) ||
    /^[-—–]+$/.test(normalized)
  ) {
    return fallback;
  }

  return normalized;
}

export function createAsanaClient(
  token,
  {
    fetchImpl = fetch,
    maxRetries = DEFAULT_ASANA_API_MAX_RETRIES,
    retryBaseMs = DEFAULT_ASANA_API_RETRY_BASE_MS,
    sleepImpl = sleep,
  } = {},
) {
  return async function request(method, endpoint, { body, query } = {}) {
    const retryEligible = isAsanaRetryEligibleRequest(method, endpoint);
    const url = new URL(`${ASANA_BASE_URL}${endpoint}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify({ data: body }) : undefined,
        });
      } catch (error) {
        if (retryEligible && attempt < maxRetries) {
          await sleepImpl(computeRetryDelayMs(attempt, retryBaseMs));
          continue;
        }
        throw new Error(`Asana API network error: ${error instanceof Error ? error.message : String(error)}`);
      }

      const payload = await parseAsanaPayload(response);
      if (response.ok) {
        return payload;
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const shouldRetry =
        retryEligible &&
        ASANA_RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt < maxRetries;
      if (shouldRetry) {
        await sleepImpl(retryAfterMs ?? computeRetryDelayMs(attempt, retryBaseMs));
        continue;
      }

      throw new Error(`Asana API error: ${response.status} ${JSON.stringify(payload)}`);
    }

    throw new Error("Asana API error: retry loop reached an unexpected state");
  };
}

export function isAsanaRetryEligibleRequest(method, endpoint) {
  const normalizedMethod = String(method || "").toUpperCase();

  // Explicitly block non-idempotent create endpoints even if method policy changes later.
  if (endpoint === "/tasks" || /^\/projects\/[^/]+\/sections$/.test(endpoint)) {
    return false;
  }

  return ASANA_RETRYABLE_METHODS.has(normalizedMethod);
}

export function computeRetryDelayMs(attempt, retryBaseMs) {
  return retryBaseMs * Math.pow(2, attempt);
}

export function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) {
    return null;
  }

  const seconds = Number.parseInt(retryAfterHeader, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(retryAfterHeader);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - Date.now());
}

async function parseAsanaPayload(response) {
  const text = await response.text();
  if (!text) {
    return { data: null };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function listProjectTasks(asana, projectGid) {
  return paginateAsanaCollection(asana, `/projects/${projectGid}/tasks`, {
    query: {
      opt_fields: "gid,name,completed,created_at,notes,memberships.project.gid,memberships.section.gid,memberships.section.name",
      limit: 100,
    },
  });
}

export async function paginateAsanaCollection(asana, endpoint, { query } = {}) {
  const items = [];
  let offset = null;

  do {
    const response = await asana("GET", endpoint, {
      query: {
        ...query,
        ...(offset ? { offset } : {}),
      },
    });

    items.push(...(response.data || []));
    offset = response.next_page?.offset || null;
  } while (offset);

  return items;
}

export function createSectionResolver(asana, projectGid) {
  const sectionCache = new Map();
  let isLoaded = false;

  return async (sectionName) => {
    if (!sectionName) {
      return null;
    }

    if (!isLoaded) {
      const sections = await paginateAsanaCollection(asana, `/projects/${projectGid}/sections`, {
        query: { opt_fields: "gid,name" },
      });
      for (const section of sections) {
        if (section?.name && section?.gid) {
          sectionCache.set(section.name, section.gid);
        }
      }
      isLoaded = true;
    }

    if (sectionCache.has(sectionName)) {
      return sectionCache.get(sectionName);
    }

    const created = await asana("POST", `/projects/${projectGid}/sections`, {
      body: { name: sectionName },
    });
    const sectionGid = created.data.gid;
    sectionCache.set(sectionName, sectionGid);
    return sectionGid;
  };
}

async function createTask(asana, projectGid, idea, sectionGid) {
  const body = {
    name: idea.taskName,
    notes: idea.notes,
    projects: [projectGid],
  };

  if (sectionGid) {
    body.memberships = [{ project: projectGid, section: sectionGid }];
  }

  const response = await asana("POST", "/tasks", { body });
  return response.data;
}

async function updateTask(asana, taskGid, idea) {
  const response = await asana("PUT", `/tasks/${taskGid}`, {
    body: {
      name: idea.taskName,
      notes: idea.notes,
    },
  });
  return response.data;
}

async function addTaskToSection(asana, sectionGid, taskGid) {
  await asana("POST", `/sections/${sectionGid}/addTask`, {
    body: { task: taskGid },
  });
}

async function removeTaskFromProject(asana, taskGid, projectGid) {
  await asana("POST", `/tasks/${taskGid}/removeProject`, {
    body: { project: projectGid },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
