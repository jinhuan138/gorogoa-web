export async function readJson(file, baseUrl) {
  const response = await fetch(new URL(file, baseUrl));
  if (!response.ok) {
    throw new Error(`资源加载失败 ${file} (${response.status})`);
  }
  return response.json();
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
