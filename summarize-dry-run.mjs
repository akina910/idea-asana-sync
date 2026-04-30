#!/usr/bin/env node

import fs from "node:fs/promises";
import { buildDryRunMarkdownSummary } from "./sync-ideas-to-asana.mjs";

async function main() {
  const input = process.argv[2] ? await fs.readFile(process.argv[2], "utf8") : await readStdin();
  const dryRunOutput = JSON.parse(input);
  process.stdout.write(buildDryRunMarkdownSummary(dryRunOutput));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
