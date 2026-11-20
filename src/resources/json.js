import { markJsonParsed } from "./startup-timing.js";

export async function readJson(file, baseUrl) {
  const url = new URL(file, baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`资源加载失败 ${file} (${response.status})`);
  }
  const data = await response.json();
  markJsonParsed(url.href);
  return data;
}

export function createResources(baseUrl) {
  let creditsRequest;
  return {
    read: (file) => readJson(file, baseUrl),
    loadCredits() {
      creditsRequest ??= readJson("assets/data/credits.json", baseUrl).catch(
        (error) => {
          creditsRequest = undefined;
          throw error;
        },
      );
      return creditsRequest;
    },
  };
}
