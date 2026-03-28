import fs from "node:fs";
import path from "node:path";

const SUPPORTED_SUFFIX = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".rst",
  ".adoc",
]);

function walkDocs(directoryPath, files) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      walkDocs(absolute, files);
      continue;
    }

    if (SUPPORTED_SUFFIX.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolute);
    }
  }
}

function expandEntry(repoRoot, rawEntry) {
  const absolute = path.isAbsolute(rawEntry)
    ? rawEntry
    : path.resolve(repoRoot, rawEntry);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return [absolute];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const files = [];
  walkDocs(absolute, files);
  return files.sort((left, right) => left.localeCompare(right));
}

function normalizePath(repoRoot, absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  if (!relative.startsWith("..")) {
    return relative.replaceAll("\\", "/");
  }

  return absolutePath.replaceAll("\\", "/");
}

export function expandDocumentEntries(repoRoot, entries) {
  const absoluteFiles = [];
  for (const entry of entries || []) {
    absoluteFiles.push(...expandEntry(repoRoot, entry));
  }

  const seen = new Set();
  return absoluteFiles
    .filter((absolutePath) => {
      const key = absolutePath.toLowerCase();
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((absolutePath) => ({
      absolutePath,
      relativePath: normalizePath(repoRoot, absolutePath),
    }));
}

export function readDocumentPackets(repoRoot, entries, options = {}) {
  const maxCharsPerFile = Number(options.maxCharsPerFile || 18000);
  const maxTotalChars = Number(options.maxTotalChars || 90000);
  let remaining = maxTotalChars;

  const packets = [];
  for (const file of expandDocumentEntries(repoRoot, entries)) {
    if (remaining <= 0) {
      break;
    }

    const fullText = fs.readFileSync(file.absolutePath, "utf8");
    const sliceLength = Math.max(0, Math.min(fullText.length, maxCharsPerFile, remaining));
    packets.push({
      path: file.relativePath,
      content: fullText.slice(0, sliceLength),
      truncated: sliceLength < fullText.length,
      chars: sliceLength,
    });
    remaining -= sliceLength;
  }

  return packets;
}
