#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";
const DEFAULT_SOURCE_REPO_PATH = path.resolve("./source-bussines-idea");
const DEFAULT_SOURCE_REPO_URL = "https://github.com/akina910/bussines_idea";
const SYNCED_TASK_NAME_PATTERN = /^\[(BI-\d+)\]\s+/;
const TASK_MANAGED_MARKER = "Managed-By: idea-asana-sync";
const SOURCE_REPO_ALLOWED_PATH_PREFIXES = ["ideas/", "notes/", "handoff/"];
const SOURCE_REPO_KNOWN_PLACEHOLDERS = new Set(["-", "—", "–", "未作成", "未設定", "N/A", "n/a"]);

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const config = loadConfig({ dryRun });
  const indexPath = path.join(config.sourceRepoPath, "status", "project-index.md");
  const indexMarkdown = await fs.readFile(indexPath, "utf8");
  const rows = parseIndexTable(indexMarkdown);
  const ideas = await Promise.all(rows.map((row) => hydrateIdea(row, config)));
  const projectGid = extractProjectGidFromUrl(config.projectUrl);
  if (!dryRun && !projectGid) {
    throw new Error("ASANA_PROJECT_URL から project GID を読めませんでした。");
  }
  const asana = config.asanaToken ? createAsanaClient(config.asanaToken) : null;

  // sectionGid cache: status (or fixed name) → gid
  const sectionCache = new Map();
  async function resolveSectionGid(idea) {
    if (config.useStatusSections) {
      const key = idea.status || "未分類";
      if (!sectionCache.has(key)) {
        sectionCache.set(key, await ensureSection(asana, projectGid, key));
      }
      return sectionCache.get(key);
    }
    if (config.sectionName) {
      if (!sectionCache.has(config.sectionName)) {
        sectionCache.set(config.sectionName, await ensureSection(asana, projectGid, config.sectionName));
      }
      return sectionCache.get(config.sectionName);
    }
    return null;
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
        _section: config.useStatusSections ? (idea.status || "未分類") : (config.sectionName || null),
        _taskAction: existingTaskByIdeaId.has(idea.id) ? "updated" : "created",
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
      await updateTask(asana, existing.gid, idea);
      if (targetSectionGid) {
        await addTaskToSection(asana, targetSectionGid, existing.gid);
      }
      results.push({ action: "updated", id: idea.id, taskGid: existing.gid });
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

  return {
    asanaToken,
    projectUrl,
    sectionName: process.env.ASANA_SECTION_NAME || null,
    useStatusSections: process.env.ASANA_USE_STATUS_SECTIONS === "true",
    sourceRepoPath:
      process.env.SOURCE_REPO_PATH ||
      process.env.BUSSINES_IDEA_REPO_PATH ||
      DEFAULT_SOURCE_REPO_PATH,
    sourceRepoUrl:
      (
        process.env.SOURCE_REPO_URL ||
        process.env.BUSSINES_IDEA_REPO_URL ||
        DEFAULT_SOURCE_REPO_URL
      ).replace(/\/$/, ""),
  };
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

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

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

function stripCode(value) {
  return value.replace(/^`|`$/g, "");
}

async function hydrateIdea(row, config) {
  const ideaMarkdown = await fs.readFile(path.join(config.sourceRepoPath, row.ideaPath), "utf8");
  const summary = extractSection(ideaMarkdown, "一言") || row.oneLine;

  return {
    ...row,
    summary,
    taskName: `[${row.id}] ${row.title}`,
    notes: buildTaskNotes({ ...row, summary }, config),
  };
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
  if (typeof repoPath !== "string") {
    return null;
  }

  const normalizedRepoPath = repoPath.trim().replace(/^\.\/+/, "");
  if (!normalizedRepoPath) {
    return null;
  }

  if (
    SOURCE_REPO_KNOWN_PLACEHOLDERS.has(normalizedRepoPath) ||
    /^[-—–]+$/.test(normalizedRepoPath)
  ) {
    return null;
  }

  const isAllowedRepoPath = SOURCE_REPO_ALLOWED_PATH_PREFIXES.some((prefix) =>
    normalizedRepoPath.startsWith(prefix),
  );
  if (!isAllowedRepoPath) {
    console.warn(
      `[warn] source repo path is not linkable; ignoring value: ${normalizedRepoPath}`,
    );
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
    `タイプ: ${idea.type}`,
    `状態: ${idea.status}`,
    `実装: ${idea.implementation}`,
    `分離repo: ${idea.splitRepo}`,
    "",
    "要約",
    idea.summary,
    "",
    `次アクション: ${truncateNextAction(idea.nextAction)}`,
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

function createAsanaClient(token) {
  return async function request(method, endpoint, { body, query } = {}) {
    const url = new URL(`${ASANA_BASE_URL}${endpoint}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify({ data: body }) : undefined,
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(`Asana API error: ${response.status} ${JSON.stringify(json)}`);
    }

    return json;
  };
}

async function listProjectTasks(asana, projectGid) {
  return paginateAsanaCollection(asana, `/projects/${projectGid}/tasks`, {
    query: { opt_fields: "gid,name,completed,created_at,notes", limit: 100 },
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

async function ensureSection(asana, projectGid, sectionName) {
  const sections = await paginateAsanaCollection(asana, `/projects/${projectGid}/sections`, {
    query: { opt_fields: "gid,name" },
  });

  const existing = sections.find((section) => section.name === sectionName);
  if (existing) {
    return existing.gid;
  }

  const created = await asana("POST", `/projects/${projectGid}/sections`, {
    body: { name: sectionName },
  });

  return created.data.gid;
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
