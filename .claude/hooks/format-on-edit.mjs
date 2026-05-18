#!/usr/bin/env node
// PostToolUse hook: runs prettier --write then eslint --fix on edited files.
// Exit 2 surfaces unfixed errors back to Claude so it can correct them.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

const filePath = input?.tool_input?.file_path;
if (!filePath) process.exit(0);

if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) process.exit(0);
if (/[\\/](node_modules|\.next|\.claude[\\/]worktrees)[\\/]/.test(filePath)) {
  process.exit(0);
}

const quoted = `"${filePath.replace(/"/g, '\\"')}"`;
let errorOutput = "";

try {
  execSync(`pnpm exec prettier --write --log-level=warn ${quoted}`, {
    stdio: "pipe",
  });
} catch (e) {
  errorOutput += `Prettier failed on ${filePath}:\n`;
  errorOutput += (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
  errorOutput += "\n";
}

try {
  execSync(`pnpm exec eslint --fix --max-warnings 0 ${quoted}`, {
    stdio: "pipe",
  });
} catch (e) {
  errorOutput += `ESLint reported issues on ${filePath} (auto-fixable ones were applied):\n`;
  errorOutput += (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
  errorOutput += "\n";
}

if (errorOutput) {
  process.stderr.write(errorOutput);
  process.exit(2);
}
