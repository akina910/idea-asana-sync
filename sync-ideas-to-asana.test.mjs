import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractProjectGidFromUrl,
  parseIndexTable,
  extractSection,
  paginateAsanaCollection,
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
