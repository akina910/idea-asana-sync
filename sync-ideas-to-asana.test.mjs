import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  areTaskContentsEqual,
  buildSourceRepoFileUrl,
  buildTaskNotes,
  createSectionResolver,
  extractProjectGidFromUrl,
  formatTaskFieldValue,
  normalizeSectionName,
  parseBooleanFlag,
  getTaskSectionGid,
  hydrateIdea,
  parseIndexTable,
  parseStatusSectionMap,
  extractSection,
  extractIdeaIdFromTaskName,
  isManagedSyncTask,
  paginateAsanaCollection,
  planTaskReconciliation,
  resolveTargetSectionName,
  truncateNextAction,
} from "./sync-ideas-to-asana.mjs";

// ---------------------------------------------------------------------------
// extractProjectGidFromUrl
// ---------------------------------------------------------------------------
describe("extractProjectGidFromUrl", () => {
  it("extracts GID from a standard project URL", () => {
    assert.equal(
      extractProjectGidFromUrl("https://app.asana.com/0/1234567890/list"),
      "1234567890",
    );
  });

  it("extracts GID from a /project/ style URL", () => {
    assert.equal(
      extractProjectGidFromUrl("https://app.asana.com/project/9876543210"),
      "9876543210",
    );
  });

  it("returns null for null input", () => {
    assert.equal(extractProjectGidFromUrl(null), null);
  });

  it("returns null for a URL without a numeric GID", () => {
    assert.equal(extractProjectGidFromUrl("https://app.asana.com/home"), null);
  });
});

// ---------------------------------------------------------------------------
// Section config helpers
// ---------------------------------------------------------------------------
describe("parseBooleanFlag", () => {
  it("accepts common truthy values", () => {
    assert.equal(parseBooleanFlag("true"), true);
    assert.equal(parseBooleanFlag("TRUE"), true);
    assert.equal(parseBooleanFlag("1"), true);
    assert.equal(parseBooleanFlag(" yes "), true);
    assert.equal(parseBooleanFlag("On"), true);
  });

  it("returns false for non-truthy values", () => {
    assert.equal(parseBooleanFlag("false"), false);
    assert.equal(parseBooleanFlag("0"), false);
    assert.equal(parseBooleanFlag(""), false);
    assert.equal(parseBooleanFlag(undefined), false);
    assert.equal(parseBooleanFlag(null), false);
  });
});

describe("normalizeSectionName", () => {
  it("trims and collapses internal whitespace", () => {
    assert.equal(normalizeSectionName("  着手中   （要確認）  "), "着手中 （要確認）");
  });

  it("falls back when input is empty", () => {
    assert.equal(normalizeSectionName("   "), "未分類");
  });

  it("can use custom fallback", () => {
    assert.equal(normalizeSectionName("", { fallback: null }), null);
  });

  it("truncates section names longer than 80 characters", () => {
    const long = "a".repeat(120);
    const normalized = normalizeSectionName(long);
    assert.equal(normalized.length, 80);
    assert.ok(normalized.endsWith("…"));
  });
});

describe("parseStatusSectionMap", () => {
  it("parses a JSON object and normalizes keys/values", () => {
    const map = parseStatusSectionMap('{"  手動ローンチ実行待ち ":" 要対応 ","分離済み":"完了"}');
    assert.equal(map.get("手動ローンチ実行待ち"), "要対応");
    assert.equal(map.get("分離済み"), "完了");
  });

  it("returns an empty map for empty input", () => {
    assert.equal(parseStatusSectionMap("").size, 0);
    assert.equal(parseStatusSectionMap(undefined).size, 0);
  });

  it("throws for non-object JSON", () => {
    assert.throws(() => parseStatusSectionMap("[]"), /JSON オブジェクト/);
    assert.throws(() => parseStatusSectionMap('"text"'), /JSON オブジェクト/);
  });
});

describe("resolveTargetSectionName", () => {
  it("uses mapped section name when status-sections mode is enabled", () => {
    const section = resolveTargetSectionName(
      { status: "手動ローンチ実行待ち" },
      {
        useStatusSections: true,
        sectionName: null,
        statusSectionMap: new Map([["手動ローンチ実行待ち", "要対応"]]),
      },
    );
    assert.equal(section, "要対応");
  });

  it("falls back to normalized status when no map entry exists", () => {
    const section = resolveTargetSectionName(
      { status: "  分離済み " },
      {
        useStatusSections: true,
        sectionName: null,
        statusSectionMap: new Map(),
      },
    );
    assert.equal(section, "分離済み");
  });

  it("uses fixed section in legacy mode", () => {
    const section = resolveTargetSectionName(
      { status: "分離済み" },
      {
        useStatusSections: false,
        sectionName: "入口",
        statusSectionMap: new Map(),
      },
    );
    assert.equal(section, "入口");
  });

  it("caps long status-derived section names to 80 chars", () => {
    const longStatus = "手動対応".repeat(30);
    const section = resolveTargetSectionName(
      { status: longStatus },
      {
        useStatusSections: true,
        sectionName: null,
        statusSectionMap: new Map(),
      },
    );
    assert.equal(section.length, 80);
    assert.ok(section.endsWith("…"));
  });
});


// ---------------------------------------------------------------------------
// hydrateIdea
// ---------------------------------------------------------------------------
describe("hydrateIdea", () => {
  it("falls back to the project-index summary when the source idea file is missing", async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => {
      warnings.push(message);
    };

    try {
      const idea = await hydrateIdea(
        {
          id: "BI-074",
          title: "AI Search Visibility Console",
          type: "External",
          status: "分離済み",
          implementation: "未着手",
          splitRepo: "ai-search-visibility-console",
          oneLine: "AI検索での露出を可視化するSaaS。",
          nextAction: "MVPを切る",
          ideaPath: "ideas/BI-074-ai-search-visibility-console.md",
          notesPath: "—",
          handoffPath: "—",
        },
        {
          sourceRepoPath: "/tmp/idea-asana-sync-missing-source",
          sourceRepoUrl: "https://github.com/example/repo",
        },
      );

      assert.equal(idea.summary, "AI検索での露出を可視化するSaaS。");
      assert.equal(idea.sourceFileMissing, true);
      assert.match(idea.notes, /AI検索での露出を可視化するSaaS。/);
      assert.deepEqual(warnings, [
        "[warn] source idea file is missing; using project-index row fallback: ideas/BI-074-ai-search-visibility-console.md",
      ]);
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// buildSourceRepoFileUrl / buildTaskNotes
// ---------------------------------------------------------------------------
describe("buildSourceRepoFileUrl", () => {
  it("builds a blob URL for a normal repo path", () => {
    assert.equal(
      buildSourceRepoFileUrl("https://github.com/example/repo", "notes/BI-001.md"),
      "https://github.com/example/repo/blob/main/notes/BI-001.md",
    );
  });

  it("returns null for placeholder values", () => {
    assert.equal(buildSourceRepoFileUrl("https://github.com/example/repo", "—"), null);
    assert.equal(buildSourceRepoFileUrl("https://github.com/example/repo", "-"), null);
    assert.equal(buildSourceRepoFileUrl("https://github.com/example/repo", "–"), null);
    assert.equal(buildSourceRepoFileUrl("https://github.com/example/repo", "未作成"), null);
    assert.equal(buildSourceRepoFileUrl("https://github.com/example/repo", "N/A"), null);
  });

  it("allows leading ./ and trims surrounding whitespace", () => {
    assert.equal(
      buildSourceRepoFileUrl("https://github.com/example/repo", " ./handoff/BI-001.md "),
      "https://github.com/example/repo/blob/main/handoff/BI-001.md",
    );
  });

  it("returns null and warns for unknown non-linkable values", () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => {
      warnings.push(message);
    };

    try {
      assert.equal(buildSourceRepoFileUrl("https://github.com/example/repo", "misc/BI-001.md"), null);
    } finally {
      console.warn = originalWarn;
    }

    assert.deepEqual(warnings, [
      "[warn] source repo path is not linkable; ignoring value: misc/BI-001.md",
    ]);
  });
});

describe("buildTaskNotes", () => {
  const baseIdea = {
    id: "BI-005",
    type: "Internal",
    status: "分離済み",
    implementation: "公開中",
    splitRepo: "idea-asana-sync",
    summary: "要約",
    nextAction: "次の一手",
    ideaPath: "ideas/BI-005.md",
  };
  const config = {
    sourceRepoUrl: "https://github.com/example/repo",
  };

  it("omits notes and handoff links when the source paths are placeholders", () => {
    const notes = buildTaskNotes(
      {
        ...baseIdea,
        notesPath: "—",
        handoffPath: "未作成",
      },
      config,
    );

    assert.match(notes, /idea: https:\/\/github\.com\/example\/repo\/blob\/main\/ideas\/BI-005\.md/);
    assert.doesNotMatch(notes, /\nnotes: /);
    assert.doesNotMatch(notes, /\nhandoff: /);
  });

  it("includes notes and handoff links when the source paths are valid", () => {
    const notes = buildTaskNotes(
      {
        ...baseIdea,
        notesPath: "notes/BI-005.md",
        handoffPath: "handoff/BI-005.md",
      },
      config,
    );

    assert.match(notes, /\nnotes: https:\/\/github\.com\/example\/repo\/blob\/main\/notes\/BI-005\.md/);
    assert.match(notes, /\nhandoff: https:\/\/github\.com\/example\/repo\/blob\/main\/handoff\/BI-005\.md/);
  });

  it("normalizes missing and placeholder values to avoid undefined in task body", () => {
    const notes = buildTaskNotes(
      {
        ...baseIdea,
        type: undefined,
        status: "-",
        implementation: "  ",
        splitRepo: "—",
        summary: "",
        nextAction: undefined,
        notesPath: "—",
        handoffPath: "—",
      },
      config,
    );

    assert.match(notes, /タイプ: 未設定/);
    assert.match(notes, /状態: 未設定/);
    assert.match(notes, /実装: 未設定/);
    assert.match(notes, /分離repo: 未設定/);
    assert.match(notes, /\n要約\n未設定\n/);
    assert.match(notes, /次アクション: 未設定/);
    assert.doesNotMatch(notes, /undefined/);
  });
});

describe("formatTaskFieldValue", () => {
  it("returns normalized text for regular values", () => {
    assert.equal(formatTaskFieldValue("  手動 対応  "), "手動 対応");
  });

  it("returns fallback for placeholders and non-string input", () => {
    assert.equal(formatTaskFieldValue(" - "), "未設定");
    assert.equal(formatTaskFieldValue("未作成"), "未設定");
    assert.equal(formatTaskFieldValue(undefined), "未設定");
    assert.equal(formatTaskFieldValue("", { fallback: "なし" }), "なし");
  });
});

// ---------------------------------------------------------------------------
// areTaskContentsEqual / getTaskSectionGid
// ---------------------------------------------------------------------------
describe("areTaskContentsEqual", () => {
  it("returns true when both name and notes already match the desired task", () => {
    const idea = {
      taskName: "[BI-005] Asana 入口アイディア同期ツール",
      notes: "Managed-By: idea-asana-sync\nID: BI-005",
    };

    assert.equal(
      areTaskContentsEqual(
        {
          name: "[BI-005] Asana 入口アイディア同期ツール",
          notes: "Managed-By: idea-asana-sync\nID: BI-005",
        },
        idea,
      ),
      true,
    );
  });

  it("returns false when either name or notes differ", () => {
    const idea = {
      taskName: "[BI-005] Asana 入口アイディア同期ツール",
      notes: "Managed-By: idea-asana-sync\nID: BI-005",
    };

    assert.equal(
      areTaskContentsEqual(
        {
          name: "[BI-005] 別名タスク",
          notes: "Managed-By: idea-asana-sync\nID: BI-005",
        },
        idea,
      ),
      false,
    );
    assert.equal(
      areTaskContentsEqual(
        {
          name: "[BI-005] Asana 入口アイディア同期ツール",
          notes: "別の本文",
        },
        idea,
      ),
      false,
    );
  });
});

describe("getTaskSectionGid", () => {
  it("returns the section gid for the target project membership", () => {
    const sectionGid = getTaskSectionGid(
      {
        memberships: [
          {
            project: { gid: "other-project" },
            section: { gid: "other-section" },
          },
          {
            project: { gid: "target-project" },
            section: { gid: "target-section" },
          },
        ],
      },
      "target-project",
    );

    assert.equal(sectionGid, "target-section");
  });

  it("returns null when the task is not in the target project or section is absent", () => {
    assert.equal(getTaskSectionGid({ memberships: [] }, "target-project"), null);
    assert.equal(
      getTaskSectionGid(
        {
          memberships: [{ project: { gid: "target-project" } }],
        },
        "target-project",
      ),
      null,
    );
  });
});

// ---------------------------------------------------------------------------
// truncateNextAction
// ---------------------------------------------------------------------------
describe("truncateNextAction", () => {
  const SUFFIX = "…(詳細はhandoffを参照)";

  it("returns short text unchanged", () => {
    const short = "短い次アクション";
    assert.equal(truncateNextAction(short), short);
  });

  it("returns text of exactly 200 chars unchanged", () => {
    const exact = "a".repeat(200);
    assert.equal(truncateNextAction(exact), exact);
  });

  it("truncates text longer than 200 chars to ≤200 chars including suffix", () => {
    const long = "a".repeat(300);
    const result = truncateNextAction(long);
    assert.ok(result.length <= 200, `expected ≤200 chars, got ${result.length}`);
    assert.ok(result.endsWith(SUFFIX));
  });

  it("total length is exactly 200 when input is 201 chars", () => {
    const input = "b".repeat(201);
    const result = truncateNextAction(input);
    assert.equal(result.length, 200);
    assert.ok(result.endsWith(SUFFIX));
  });

  it("handles null/undefined gracefully", () => {
    assert.equal(truncateNextAction(null), null);
    assert.equal(truncateNextAction(undefined), undefined);
  });

  it("handles empty string", () => {
    assert.equal(truncateNextAction(""), "");
  });
});

// ---------------------------------------------------------------------------
// extractIdeaIdFromTaskName
// ---------------------------------------------------------------------------
describe("extractIdeaIdFromTaskName", () => {
  it("extracts an idea ID from the synced task name", () => {
    assert.equal(extractIdeaIdFromTaskName("[BI-005] Asana 入口アイディア同期ツール"), "BI-005");
  });

  it("returns null for non-synced task names", () => {
    assert.equal(extractIdeaIdFromTaskName("手動タスク"), null);
  });
});

// ---------------------------------------------------------------------------
// isManagedSyncTask
// ---------------------------------------------------------------------------
describe("isManagedSyncTask", () => {
  it("detects tasks managed by the current marker", () => {
    assert.equal(
      isManagedSyncTask({
        name: "[BI-005] Asana 入口アイディア同期ツール",
        notes: "Managed-By: idea-asana-sync\nID: BI-005\nidea: https://example.com",
      }),
      true,
    );
  });

  it("detects legacy managed tasks from the structured notes", () => {
    assert.equal(
      isManagedSyncTask({
        name: "[BI-005] Asana 入口アイディア同期ツール",
        notes: [
          "ID: BI-005",
          "要約",
          "idea: https://example.com/idea",
          "notes: https://example.com/notes",
          "handoff: https://example.com/handoff",
        ].join("\n"),
      }),
      true,
    );
  });

  it("ignores prefix-only tasks without ownership evidence", () => {
    assert.equal(
      isManagedSyncTask({
        name: "[BI-005] 手動で作った task",
        notes: "ID: BI-005\n雑メモだけある",
      }),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// extractSection
// ---------------------------------------------------------------------------
describe("extractSection", () => {
  const markdown = `# Title

## 一言
これは要約です。
複数行あり。

## 核
別のセクション
`;

  it("extracts the named section content", () => {
    const result = extractSection(markdown, "一言");
    assert.equal(result, "これは要約です。 複数行あり。");
  });

  it("returns null when section is not found", () => {
    assert.equal(extractSection(markdown, "存在しない"), null);
  });

  it("stops at the next heading", () => {
    const result = extractSection(markdown, "一言");
    assert.ok(!result.includes("別のセクション"));
  });

  it("returns null when section exists but is empty", () => {
    const md = `## 空\n\n## 次\nContent\n`;
    assert.equal(extractSection(md, "空"), null);
  });
});

// ---------------------------------------------------------------------------
// parseIndexTable
// ---------------------------------------------------------------------------
describe("parseIndexTable", () => {
  const minimalTable = `# project-index

| ID | タイトル | タイプ | 一言 | 状態 | 実装 | 分離repo | 次アクション | idea | notes | handoff |
|----|----------|--------|------|------|------|----------|-------------|------|-------|---------|
| BI-001 | テストプロジェクト | Internal | 短い説明 | 着手中 | - | - | 次は〇〇をする | \`ideas/BI-001.md\` | \`notes/BI-001.md\` | \`handoff/BI-001.md\` |
`;

  it("parses a single row correctly", () => {
    const rows = parseIndexTable(minimalTable);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.id, "BI-001");
    assert.equal(row.title, "テストプロジェクト");
    assert.equal(row.type, "Internal");
    assert.equal(row.status, "着手中");
    assert.equal(row.nextAction, "次は〇〇をする");
    assert.equal(row.ideaPath, "ideas/BI-001.md");
    assert.equal(row.notesPath, "notes/BI-001.md");
    assert.equal(row.handoffPath, "handoff/BI-001.md");
  });

  it("strips backtick code formatting from file paths", () => {
    const rows = parseIndexTable(minimalTable);
    assert.ok(!rows[0].ideaPath.includes("`"));
  });

  it("strips backtick code formatting from splitRepo", () => {
    const rows = parseIndexTable(minimalTable.replace("| - | 次は〇〇をする |", "| `repo-name` | 次は〇〇をする |"));
    assert.equal(rows[0].splitRepo, "repo-name");
  });

  it("parses multiple rows", () => {
    const md = `| ID | タイトル | タイプ | 一言 | 状態 | 実装 | 分離repo | 次アクション | idea | notes | handoff |
|----|----------|--------|------|------|------|----------|-------------|------|-------|---------|
| BI-001 | A | T | O | 着手中 | - | - | N1 | \`ideas/a.md\` | \`notes/a.md\` | \`handoff/a.md\` |
| BI-002 | B | T | O | 分離済み | - | - | N2 | \`ideas/b.md\` | \`notes/b.md\` | \`handoff/b.md\` |
`;
    const rows = parseIndexTable(md);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].id, "BI-002");
    assert.equal(rows[1].status, "分離済み");
  });

  it("throws when table header is not found", () => {
    assert.throws(
      () => parseIndexTable("# No table here\n\nJust text."),
      /table を読めませんでした/,
    );
  });

  it("skips rows with fewer than 11 cells", () => {
    const md = `| ID | タイトル | タイプ | 一言 | 状態 | 実装 | 分離repo | 次アクション | idea | notes | handoff |
|----|----------|--------|------|------|------|----------|-------------|------|-------|---------|
| BI-001 | A | T | O |
| BI-002 | B | T | O | 分離済み | - | - | N2 | \`ideas/b.md\` | \`notes/b.md\` | \`handoff/b.md\` |
`;
    const rows = parseIndexTable(md);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "BI-002");
  });
});

// ---------------------------------------------------------------------------
// paginateAsanaCollection
// ---------------------------------------------------------------------------
describe("paginateAsanaCollection", () => {
  it("collects items across multiple pages", async () => {
    const calls = [];
    const asana = async (_method, _endpoint, { query } = {}) => {
      calls.push(query);
      if (!query?.offset) {
        return {
          data: [{ gid: "1" }, { gid: "2" }],
          next_page: { offset: "page-2" },
        };
      }

      return {
        data: [{ gid: "3" }],
        next_page: null,
      };
    };

    const items = await paginateAsanaCollection(asana, "/projects/123/tasks", {
      query: { limit: 100, opt_fields: "gid,name" },
    });

    assert.deepEqual(items, [{ gid: "1" }, { gid: "2" }, { gid: "3" }]);
    assert.deepEqual(calls, [
      { limit: 100, opt_fields: "gid,name" },
      { limit: 100, opt_fields: "gid,name", offset: "page-2" },
    ]);
  });

  it("returns a single page when next_page is absent", async () => {
    const asana = async () => ({
      data: [{ gid: "only" }],
    });

    const items = await paginateAsanaCollection(asana, "/projects/123/sections");
    assert.deepEqual(items, [{ gid: "only" }]);
  });
});

describe("createSectionResolver", () => {
  it("loads sections once and reuses cache for existing and newly-created sections", async () => {
    const calls = [];
    const asana = async (method, endpoint, { query, body } = {}) => {
      calls.push({ method, endpoint, query, body });
      if (method === "GET" && endpoint === "/projects/proj-1/sections") {
        return {
          data: [{ gid: "sec-existing", name: "分離済み" }],
          next_page: null,
        };
      }
      if (method === "POST" && endpoint === "/projects/proj-1/sections") {
        return {
          data: { gid: "sec-created", name: body.name },
        };
      }
      throw new Error("unexpected call");
    };

    const resolveSectionGid = createSectionResolver(asana, "proj-1");
    const existing1 = await resolveSectionGid("分離済み");
    const existing2 = await resolveSectionGid("分離済み");
    const created1 = await resolveSectionGid("着手中");
    const created2 = await resolveSectionGid("着手中");

    assert.equal(existing1, "sec-existing");
    assert.equal(existing2, "sec-existing");
    assert.equal(created1, "sec-created");
    assert.equal(created2, "sec-created");

    assert.equal(
      calls.filter((call) => call.method === "GET" && call.endpoint === "/projects/proj-1/sections").length,
      1,
    );
    assert.equal(
      calls.filter((call) => call.method === "POST" && call.endpoint === "/projects/proj-1/sections").length,
      1,
    );
  });
});

// ---------------------------------------------------------------------------
// planTaskReconciliation
// ---------------------------------------------------------------------------
describe("planTaskReconciliation", () => {
  it("keeps the oldest managed task, removes duplicates, and removes orphaned synced tasks", () => {
    const tasks = [
      {
        gid: "newer-1",
        name: "[BI-001] Alpha",
        created_at: "2026-04-12T00:00:00.000Z",
        notes: "Managed-By: idea-asana-sync\nID: BI-001",
      },
      {
        gid: "older-1",
        name: "[BI-001] Alpha duplicate",
        created_at: "2026-04-01T00:00:00.000Z",
        notes: "Managed-By: idea-asana-sync\nID: BI-001",
      },
      {
        gid: "keep-2",
        name: "[BI-002] Beta",
        created_at: "2026-04-03T00:00:00.000Z",
        notes: "Managed-By: idea-asana-sync\nID: BI-002",
      },
      {
        gid: "orphan-1",
        name: "[BI-999] Old project",
        created_at: "2026-03-01T00:00:00.000Z",
        notes: "Managed-By: idea-asana-sync\nID: BI-999",
      },
      { gid: "manual-1", name: "手動メモ task" },
      {
        gid: "manual-prefixed",
        name: "[BI-003] 人手管理 task",
        created_at: "2026-04-10T00:00:00.000Z",
        notes: "ID: BI-003\n手動メモ",
      },
    ];
    const ideas = [{ id: "BI-001" }, { id: "BI-002" }, { id: "BI-003" }];

    const plan = planTaskReconciliation(tasks, ideas);

    assert.equal(plan.existingTaskByIdeaId.get("BI-001")?.gid, "older-1");
    assert.equal(plan.existingTaskByIdeaId.get("BI-002")?.gid, "keep-2");
    assert.equal(plan.existingTaskByIdeaId.has("BI-003"), false);
    assert.deepEqual(
      plan.duplicateTasksToRemove.map((task) => task.gid),
      ["newer-1"],
    );
    assert.deepEqual(
      plan.orphanedTasksToRemove.map((task) => task.gid),
      ["orphan-1"],
    );
  });

  it("ignores non-synced tasks when deciding removals", () => {
    const tasks = [
      { gid: "manual-1", name: "Manual follow-up" },
      { gid: "manual-2", name: "[misc] something else" },
    ];

    const plan = planTaskReconciliation(tasks, [{ id: "BI-001" }]);

    assert.equal(plan.existingTaskByIdeaId.size, 0);
    assert.deepEqual(plan.duplicateTasksToRemove, []);
    assert.deepEqual(plan.orphanedTasksToRemove, []);
  });
});
