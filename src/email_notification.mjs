import net from "node:net";
import tls from "node:tls";

import { tailText } from "./common.mjs";

function resolveSecret(configValue = "", envKey = "") {
  if (String(configValue || "").trim()) {
    return String(configValue || "").trim();
  }
  if (String(envKey || "").trim()) {
    return String(process.env[String(envKey).trim()] || "").trim();
  }
  return "";
}

function dotStuff(text = "") {
  return String(text || "")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function formatAddressList(items = []) {
  return items.join(", ");
}

function buildMessage({ from, to, subject, text }) {
  return [
    `From: ${from}`,
    `To: ${formatAddressList(to)}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(text),
  ].join("\r\n");
}

function createLineReader(socket) {
  let buffer = "";
  const lines = [];
  const waiters = [];

  const flush = () => {
    while (true) {
      const separatorIndex = buffer.indexOf("\n");
      if (separatorIndex < 0) {
        return;
      }
      const line = buffer.slice(0, separatorIndex + 1).replace(/\r?\n$/, "");
      buffer = buffer.slice(separatorIndex + 1);
      if (waiters.length) {
        waiters.shift()?.resolve(line);
      } else {
        lines.push(line);
      }
    }
  };

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    flush();
  });
  socket.on("error", (error) => {
    while (waiters.length) {
      waiters.shift()?.reject(error);
    }
  });
  socket.on("close", () => {
    const error = new Error("SMTP 连接已关闭。");
    while (waiters.length) {
      waiters.shift()?.reject(error);
    }
  });

  return async function readLine() {
    if (lines.length) {
      return lines.shift();
    }
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  };
}

async function readResponse(readLine) {
  const firstLine = await readLine();
  const lines = [firstLine];
  while (/^\d{3}-/.test(lines.at(-1) || "")) {
    lines.push(await readLine());
  }
  const lastLine = lines.at(-1) || "";
  const code = Number(lastLine.slice(0, 3));
  return {
    code,
    message: lines.join("\n"),
    lines,
  };
}

async function expectResponse(readLine, expectedCodes) {
  const response = await readResponse(readLine);
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP 返回异常：${response.message}`);
  }
  return response;
}

function writeCommand(socket, command) {
  socket.write(`${command}\r\n`);
}

function createSocket(host, port, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutSeconds || 30) * 1000);
  const commonOptions = {
    host,
    port,
    rejectUnauthorized: options.rejectUnauthorized !== false,
  };

  return new Promise((resolve, reject) => {
    const socket = options.secure
      ? tls.connect(commonOptions, () => resolve(socket))
      : net.createConnection({ host, port }, () => resolve(socket));
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      socket.destroy(new Error("SMTP 连接超时。"));
    });
    socket.on("error", reject);
  });
}

async function upgradeToStartTls(socket, host, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutSeconds || 30) * 1000);
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket,
      servername: host,
      rejectUnauthorized: options.rejectUnauthorized !== false,
    }, () => resolve(tlsSocket));
    tlsSocket.setTimeout(timeoutMs);
    tlsSocket.on("timeout", () => {
      tlsSocket.destroy(new Error("SMTP STARTTLS 升级超时。"));
    });
    tlsSocket.on("error", reject);
  });
}

async function authenticateIfNeeded(socket, readLine, smtp, capabilities = "") {
  const username = resolveSecret(smtp.username, smtp.usernameEnv);
  const password = resolveSecret(smtp.password, smtp.passwordEnv);
  if (!username && !password) {
    return;
  }

  const supported = String(capabilities || "").toUpperCase();
  if (supported.includes("AUTH LOGIN")) {
    writeCommand(socket, "AUTH LOGIN");
    await expectResponse(readLine, [334]);
    writeCommand(socket, Buffer.from(username, "utf8").toString("base64"));
    await expectResponse(readLine, [334]);
    writeCommand(socket, Buffer.from(password, "utf8").toString("base64"));
    await expectResponse(readLine, [235]);
    return;
  }

  const payload = Buffer.from(`\u0000${username}\u0000${password}`, "utf8").toString("base64");
  writeCommand(socket, `AUTH PLAIN ${payload}`);
  await expectResponse(readLine, [235]);
}

async function connectAndSend({ smtp, from, to, subject, text }) {
  let socket = await createSocket(smtp.host, smtp.port, smtp);
  let readLine = createLineReader(socket);

  try {
    await expectResponse(readLine, [220]);
    writeCommand(socket, "EHLO helloloop.local");
    let hello = await expectResponse(readLine, [250]);

    if (!smtp.secure && smtp.starttls) {
      writeCommand(socket, "STARTTLS");
      await expectResponse(readLine, [220]);
      socket = await upgradeToStartTls(socket, smtp.host, smtp);
      readLine = createLineReader(socket);
      writeCommand(socket, "EHLO helloloop.local");
      hello = await expectResponse(readLine, [250]);
    }

    await authenticateIfNeeded(socket, readLine, smtp, hello.message);
    writeCommand(socket, `MAIL FROM:<${from}>`);
    await expectResponse(readLine, [250]);
    for (const recipient of to) {
      writeCommand(socket, `RCPT TO:<${recipient}>`);
      await expectResponse(readLine, [250, 251]);
    }
    writeCommand(socket, "DATA");
    await expectResponse(readLine, [354]);
    socket.write(`${buildMessage({ from, to, subject, text })}\r\n.\r\n`);
    await expectResponse(readLine, [250]);
    writeCommand(socket, "QUIT");
    await expectResponse(readLine, [221]);
  } finally {
    socket.end();
  }
}

function buildNotificationBody({
  context,
  engine,
  phase,
  failure,
  result,
  recoveryHistory,
  runDir,
}) {
  const lines = [
    "HelloLoop 已暂停本轮自动恢复，等待人工介入。",
    "",
    `仓库：${context.repoRoot}`,
    `运行目录：${runDir}`,
    `执行引擎：${engine}`,
    `阶段：${phase}`,
    `错误分类：${failure?.family || "unknown"}`,
    `错误代码：${failure?.code || "unknown_failure"}`,
    "",
    "恢复记录：",
    ...(Array.isArray(recoveryHistory) && recoveryHistory.length
      ? recoveryHistory.map((item) => (
        `- 第 ${item.recoveryIndex} 次：等待 ${item.delaySeconds} 秒；探测 ${item.probeStatus || "unknown"}；任务 ${item.taskStatus || "unknown"}`
      ))
      : ["- 无"]),
    "",
    "错误原因：",
    failure?.reason || "未提供。",
    "",
    "stderr 尾部：",
    tailText(result.stderr, 80) || "无",
    "",
    "stdout 尾部：",
    tailText(result.stdout, 80) || "无",
  ];
  return lines.join("\n").trim();
}

export function resolveEmailNotificationConfig(globalConfig = {}) {
  const email = globalConfig?.notifications?.email || {};
  const smtp = email.smtp || {};
  const to = Array.isArray(email.to) ? email.to.filter(Boolean) : [];
  const from = String(email.from || "").trim() || resolveSecret(smtp.username, smtp.usernameEnv);

  if (email.enabled !== true) {
    return {
      enabled: false,
      reason: "邮件通知未启用。",
    };
  }
  if (!to.length) {
    return {
      enabled: false,
      reason: "邮件通知已启用，但未配置收件人。",
    };
  }
  if (!from) {
    return {
      enabled: false,
      reason: "邮件通知已启用，但未配置发件人。",
    };
  }
  if (!String(smtp.host || "").trim()) {
    return {
      enabled: false,
      reason: "邮件通知已启用，但未配置 SMTP host。",
    };
  }

  return {
    enabled: true,
    to,
    from,
    smtp: {
      host: String(smtp.host || "").trim(),
      port: Number(smtp.port || (smtp.secure ? 465 : 25)),
      secure: smtp.secure === true,
      starttls: smtp.starttls === true,
      username: String(smtp.username || "").trim(),
      usernameEnv: String(smtp.usernameEnv || "").trim(),
      password: String(smtp.password || "").trim(),
      passwordEnv: String(smtp.passwordEnv || "").trim(),
      timeoutSeconds: Number(smtp.timeoutSeconds || 30),
      rejectUnauthorized: smtp.rejectUnauthorized !== false,
    },
  };
}

export async function sendRuntimeStopNotification({
  globalConfig,
  context,
  engine,
  phase,
  failure,
  result,
  recoveryHistory,
  runDir,
}) {
  const resolved = resolveEmailNotificationConfig(globalConfig);
  if (!resolved.enabled) {
    return {
      attempted: false,
      delivered: false,
      reason: resolved.reason,
    };
  }

  const subject = `[HelloLoop] 自动恢复已暂停：${engine} / ${phase}`;
  const text = buildNotificationBody({
    context,
    engine,
    phase,
    failure,
    result,
    recoveryHistory,
    runDir,
  });

  await connectAndSend({
    smtp: resolved.smtp,
    from: resolved.from,
    to: resolved.to,
    subject,
    text,
  });

  return {
    attempted: true,
    delivered: true,
    subject,
    recipients: resolved.to,
  };
}
