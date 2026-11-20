import { translations } from "./messages.js";

export { languages } from "./messages.js";
export const supportsLanguage = (code) => Object.hasOwn(translations, code);

export function detectLanguage(codes) {
  const supported = Object.keys(translations);
  for (const code of codes) {
    const normalized = code.toLowerCase();
    const exact = supported.find((key) => key.toLowerCase() === normalized);
    if (exact) return exact;
    const language = normalized.split("-")[0];
    if (language === "zh") {
      const traditional =
        normalized.startsWith("zh-hant") ||
        (!normalized.startsWith("zh-hans") &&
          /-(tw|hk|mo)(?:-|$)/.test(normalized));
      return traditional ? "zh-TW" : "zh-CN";
    }
    const regional = supported.find((key) => key.split("-")[0] === language);
    if (regional) return regional;
  }
  return "en";
}

export function translate(code, key, number) {
  const value = translations[code][key] ?? translations.en[key];
  return number === undefined ? value : value.replace("{n}", String(number));
}
