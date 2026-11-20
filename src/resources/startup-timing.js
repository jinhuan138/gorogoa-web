const STEP_PREFIX = "startup:";
const JSON_PREFIX = "json:";

const milliseconds = (value) => Math.round(value);
const kilobytes = (bytes) => Math.round(bytes / 1024);

export function markStartup(step) {
  performance.mark(STEP_PREFIX + step);
}

export function markJsonParsed(url) {
  performance.mark(JSON_PREFIX + url);
}

function startupSteps() {
  let previous = 0;
  return performance
    .getEntriesByType("mark")
    .filter((mark) => mark.name.startsWith(STEP_PREFIX))
    .map((mark) => {
      const row = {
        阶段: mark.name.slice(STEP_PREFIX.length),
        时刻: milliseconds(mark.startTime),
        距上一阶段: milliseconds(mark.startTime - previous),
      };
      previous = mark.startTime;
      return row;
    });
}

function jsonFiles() {
  return performance
    .getEntriesByType("mark")
    .filter((mark) => mark.name.startsWith(JSON_PREFIX))
    .map((parsed) => {
      const url = parsed.name.slice(JSON_PREFIX.length);
      const [download] = performance.getEntriesByName(url, "resource");
      return {
        文件: new URL(url).pathname.split("/").pop(),
        传输KB: kilobytes(download.transferSize),
        原始KB: kilobytes(download.decodedBodySize),
        下载: milliseconds(download.responseEnd - download.startTime),
        解析含排队: milliseconds(parsed.startTime - download.responseEnd),
      };
    });
}

/** 首个完整棋盘画出后调用；地址带 ?timing 时输出启动耗时，单位毫秒。 */
export function reportStartup() {
  markStartup("first-board");
  if (!new URLSearchParams(location.search).has("timing")) return;
  console.group("启动耗时（毫秒，从页面导航开始计）");
  console.table(startupSteps());
  console.table(jsonFiles());
  console.groupEnd();
}
