import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function readTextIfExists(filePath, fallback = "") {
  return fileExists(filePath) ? readText(filePath) : fallback;
}

export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

export function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function appendText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, content, "utf8");
}

export function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function nowIso() {
  return new Date().toISOString();
}

export function timestampForFile(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function sanitizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "task";
}

export function tailText(text, maxLines = 60) {
  const normalized = String(text || "").replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n").trim();
}

export function formatList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function resolveFrom(rootDir, ...segments) {
  return path.join(rootDir, ...segments);
}

export function normalizeRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll("\\", "/");
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}
