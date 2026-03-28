#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";
const DEFAULT_SOURCE_REPO_PATH = path.resolve("./source-bussines-idea");
const DEFAULT_SOURCE_REPO_URL = "https://github.com/akina910/bussines_idea";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const config = loadConfig({ dryRun });
  const indexPath = path.join(config.sourceRepoPath, "status", "project-index.md");
  const indexMarkdown = await fs.readFile(indexPath, "utf8");
  const rows = parseIndexTable(indexMarkdown);
  const ideas = await Promise.all(rows.map((row) => hydrateIdea(row, config)));

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(ideas, null, 2)}\n`);
    return;
  }

  const asana = createAsanaClient(config.asanaToken);
  const projectGid = extractProjectGidFromUrl(config.projectUrl);
  if (!projectGid) {
    throw new Error("ASANA_PROJECT_URL から project GID を読めませんでした。");
  }

  const sectionGid = config.sectionName
    ? await ensureSection(asana, projectGid, config.sectionName)
    : null;
  const tasks = await listProjectTasks(asana, projectGid);

  const results = [];
  for (const idea of ideas) {
    const existing = tasks.find((task) => task.name.startsWith(`[${idea.id}] `));
    if (existing) {
      await updateTask(asana, existing.gid, idea);
      if (sectionGid) {
        await addTaskToSection(asana, sectionGid, existing.gid);
      }
      results.push({ action: "updated", id: idea.id, taskGid: existing.gid });
      continue;
    }

    const created = await createTask(asana, projectGid, idea, sectionGid);
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
    sourceRepoPath: process.env.BUSSINES_IDEA_REPO_PATH || DEFAULT_SOURCE_REPO_PATH,
    sourceRepoUrl: (process.env.BUSSINES_IDEA_REPO_URL || DEFAULT_SOURCE_REPO_URL).replace(/\/$/, ""),
  };
}

function extractProjectGidFromUrl(projectUrl) {
  if (!projectUrl) {
    return null;
  }

  const match = projectUrl.match(/\/(?:0|project)\/(\d+)(?:\/|$)/);
  return match?.[1] || null;
}

function parseIndexTable(markdown) {
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
      splitRepo: cells[6],
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

function extractSection(markdown, heading) {
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

function buildTaskNotes(idea, config) {
  const ideaUrl = `${config.sourceRepoUrl}/blob/main/${idea.ideaPath}`;
  const notesUrl = `${config.sourceRepoUrl}/blob/main/${idea.notesPath}`;
  const handoffUrl = `${config.sourceRepoUrl}/blob/main/${idea.handoffPath}`;

  return [
    `ID: ${idea.id}`,
    `タイプ: ${idea.type}`,
    `状態: ${idea.status}`,
    `実装: ${idea.implementation}`,
    `分離repo: ${idea.splitRepo}`,
    "",
    "要約",
    idea.summary,
    "",
    `次アクション: ${idea.nextAction}`,
    "",
    `idea: ${ideaUrl}`,
    `notes: ${notesUrl}`,
    `handoff: ${handoffUrl}`,
  ].join("\n");
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

    return json.data;
  };
}

async function listProjectTasks(asana, projectGid) {
  return asana("GET", `/projects/${projectGid}/tasks`, {
    query: { opt_fields: "gid,name,completed", limit: 100 },
  });
}

async function ensureSection(asana, projectGid, sectionName) {
  const sections = await asana("GET", `/projects/${projectGid}/sections`, {
    query: { opt_fields: "gid,name" },
  });

  const existing = sections.find((section) => section.name === sectionName);
  if (existing) {
    return existing.gid;
  }

  const created = await asana("POST", `/projects/${projectGid}/sections`, {
    body: { name: sectionName },
  });

  return created.gid;
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

  return asana("POST", "/tasks", { body });
}

async function updateTask(asana, taskGid, idea) {
  return asana("PUT", `/tasks/${taskGid}`, {
    body: {
      name: idea.taskName,
      notes: idea.notes,
    },
  });
}

async function addTaskToSection(asana, sectionGid, taskGid) {
  await asana("POST", `/sections/${sectionGid}/addTask`, {
    body: { task: taskGid },
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
