function normalizeRule(rule) {
  return String(rule || "").trim();
}

function uniqueRules(items) {
  const result = [];
  const seen = new Set();

  for (const item of items || []) {
    const normalized = normalizeRule(item);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

const mandatoryGuardrails = [
  "所有 shell 操作优先使用结构化命令与参数，避免字符串拼接命令。",
  "涉及路径的 shell 操作必须正确引用路径，避免空格、中文、特殊字符造成路径逃逸。",
  "涉及多路径或多子命令时必须拆成多次独立执行，禁止把多个路径操作拼接进单条命令。",
  "Windows 环境禁止使用 cmd /c、cmd.exe、Start-Process cmd 或任何 cmd 嵌套命令；只允许 pwsh、bash（如 Git Bash）或 powershell 这类安全 shell。",
  "涉及删除、移动、覆盖等危险文件操作前，必须先确认目标路径位于当前仓库或用户明确允许的目录内。",
  "禁止执行 EHRB 高风险命令或其等价危险操作，例如 rm -rf /、git reset --hard、DROP DATABASE、FLUSHALL 等。",
  "不得把密钥、令牌、.env、PII、真实绝对隐私路径写入代码、日志、文档和最终输出。",
  "目标实现必须兼容 Windows、macOS、Linux，禁止硬编码平台专属路径分隔符或 shell 语法。",
];

const defaultProjectConstraints = [
  "代码是事实源；文档与代码冲突时，以当前代码、测试和真实目录结构为准。",
  "产出必须达到专业级水准：架构清晰、实现完整、表达专业，不接受“能用就行”的交付。",
  "所有文件修改必须使用当前环境提供的安全编辑方式，例如 apply_patch，而不是危险的原地批量命令。",
  "不得通过压缩代码、删除必要空行、缩短命名来规避体积控制；单文件超过 400 行后按职责拆分。",
  "不添加不必要的抽象层；仅为复杂逻辑添加必要注释，新增公共函数补简洁说明。",
  "完成前必须主动运行验证；失败后先分析根因，再修复并重跑。",
  "不允许静默失败、静默降级、静默回退；遇到阻塞必须明确说明原因。",
];

export function listMandatoryGuardrails() {
  return [...mandatoryGuardrails];
}

export function hasCustomProjectConstraints(items = []) {
  return uniqueRules(items).length > 0;
}

export function resolveProjectConstraints(items = []) {
  const customRules = uniqueRules(items);
  return customRules.length ? customRules : [...defaultProjectConstraints];
}
