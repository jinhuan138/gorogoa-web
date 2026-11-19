import { translations } from "./messages.js";

export { languages } from "./messages.js";
export const supportsLanguage = (code) => Object.hasOwn(translations, code);

export function translate(code, key, number) {
  const value = translations[code][key] ?? translations.en[key];
  return number === undefined ? value : value.replace("{n}", String(number));
}
