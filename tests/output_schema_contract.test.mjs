import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function readSchema(schemaName) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "templates", schemaName), "utf8"),
  );
}

function assertStrictStructuredOutputSchema(schema, trail = "root") {
  if (!schema || typeof schema !== "object") {
    return;
  }

  const typeList = Array.isArray(schema.type)
    ? schema.type
    : (schema.type ? [schema.type] : []);
  const objectLike = typeList.includes("object") || (!typeList.length && schema.properties);

  if (objectLike && schema.properties) {
    const keys = Object.keys(schema.properties);
    assert.equal(
      schema.additionalProperties,
      false,
      `${trail} 必须显式 additionalProperties=false`,
    );
    assert.deepEqual(
      [...(schema.required || [])].sort(),
      [...keys].sort(),
      `${trail} 的 required 必须覆盖全部 properties`,
    );
    for (const [key, child] of Object.entries(schema.properties)) {
      assertStrictStructuredOutputSchema(child, `${trail}.properties.${key}`);
    }
  }

  if (schema.items) {
    assertStrictStructuredOutputSchema(schema.items, `${trail}.items`);
  }

  if (Array.isArray(schema.anyOf)) {
    for (const [index, child] of schema.anyOf.entries()) {
      assertStrictStructuredOutputSchema(child, `${trail}.anyOf[${index}]`);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    for (const [index, child] of schema.oneOf.entries()) {
      assertStrictStructuredOutputSchema(child, `${trail}.oneOf[${index}]`);
    }
  }
}

test("analysis 输出 schema 符合 Codex Structured Outputs 严格模式要求", () => {
  assertStrictStructuredOutputSchema(readSchema("analysis-output.schema.json"));
});

test("task review 输出 schema 符合 Codex Structured Outputs 严格模式要求", () => {
  assertStrictStructuredOutputSchema(readSchema("task-review-output.schema.json"));
});
