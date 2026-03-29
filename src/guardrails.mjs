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

const mandatoryEngineeringPrinciples = [
  "代码是唯一事实源；文档与代码不一致时，以当前代码、测试和真实目录结构为准。",
  "代码体积控制：文件/类超过 300 行、函数/方法超过 40 行时必须评估是否拆分；文件/类超过 400 行、函数/方法超过 60 行时，除生成代码、大型测试夹具、迁移脚本、协议常量表等例外外，必须在完成功能后按职责拆分。",
  "禁止通过压缩代码排版、删除必要空行、合并本应独立的函数、缩短命名等方式规避行数；允许按职责拆模块、拆子组件、拆 hooks/services/adapters/mappers、拆类型定义与常量文件；有冗余时应精简死代码、重复逻辑和过时注释。",
  "仅为复杂逻辑添加注释；新增公共函数必须写简洁 docstring。",
  "不添加不必要的抽象层。",
  "所有产出都必须达到专业级水准：编码任务要求架构清晰、代码健壮、UI 精致、交互流畅；非编码任务要求逻辑严密、结构清晰、表达专业、格式规范，不接受“能用就行”的交付。",
];

const defaultProjectConstraints = [
  "用户需求明确且当前任务可直接完成时，必须一次性完成本轮应交付的全部工作；禁止做一半后用“如果你要”“是否继续”等话术中途停下，只有真实歧义、关键信息缺失或必须用户决策时才允许确认。",
  "最终回复禁止添加“如果你要我可以继续”“如果你需要进一步…”“希望这对你有帮助”等客套收尾；完成就直接结束，只保留必要的结果、验证和剩余风险。",
  "所有文件修改必须使用当前环境提供的安全编辑方式，例如 apply_patch，而不是危险的原地批量命令。",
  "完成前必须主动运行验证；失败后先分析根因，再修复并重跑。",
  "不允许静默失败、静默降级、静默回退；遇到阻塞必须明确说明原因。",
];

export function listMandatoryGuardrails() {
  return [...mandatoryGuardrails];
}

export function listMandatoryEngineeringPrinciples() {
  return [...mandatoryEngineeringPrinciples];
}

export function hasCustomProjectConstraints(items = []) {
  return uniqueRules(items).length > 0;
}

export function resolveProjectConstraints(items = []) {
  const customRules = uniqueRules(items);
  return customRules.length ? customRules : [...defaultProjectConstraints];
}
