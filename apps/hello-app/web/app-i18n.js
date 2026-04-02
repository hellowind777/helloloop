import { EN_STRINGS } from "./app-locales-en.js";
import { ZH_STRINGS } from "./app-locales-zh.js";

export const STRINGS = {
  "zh-CN": ZH_STRINGS,
  "en-US": EN_STRINGS,
};

export function resolveLocale() {
  const persisted = localStorage.getItem("hello-app-locale");
  if (persisted && STRINGS[persisted]) {
    return persisted;
  }
  return navigator.language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

export function resolveTheme() {
  const persisted = localStorage.getItem("hello-app-theme");
  return persisted === "dark" ? "dark" : "light";
}

export function translate(locale, key) {
  return STRINGS[locale]?.[key] || STRINGS["zh-CN"][key] || key;
}

export function formatDate(locale, value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
