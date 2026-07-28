export function parseTaskQuery(text = "tasks") {
  let rest = String(text || "").trim().replace(/^tasks\b/i, "").trim();
  let page = 1;
  let project = "";

  rest = rest.replace(/(?:^|\s)(?:page|页)[:：]?\s*(\d+)(?=\s|$)/i, (_, value) => {
    page = Math.max(1, Number(value));
    return " ";
  });

  rest = rest.replace(/(?:^|\s)(?:project|项目)[:：]([^\s]+)(?=\s|$)/i, (_, value) => {
    project = value.trim();
    return " ";
  });

  const trailingPage = rest.match(/^(?:(.*?)\s+)?(\d+)$/);
  if (trailingPage) {
    rest = trailingPage[1] || "";
    page = Math.max(1, Number(trailingPage[2]));
  }

  return {
    query: rest.replace(/\s+/g, " ").trim(),
    project,
    page
  };
}

export function browseTasks(threads = [], {
  query = "",
  project = "",
  page = 1,
  pageSize = 8,
  taskMetadata = {},
  projectStore = null
} = {}) {
  const queryNeedle = normalize(query);
  const projectNeedle = normalize(project);
  const filtered = threads.filter((thread) => {
    const metadata = taskMetadata[thread.id] || {};
    const projectInfo = projectStore?.projectForThread?.(thread, { metadata: taskMetadata }) || {};
    const projectName = metadata.projectName || projectInfo.name || "";
    const matchesProject = !projectNeedle || normalize(projectName).includes(projectNeedle);
    const haystack = [
      metadata.title,
      thread.name,
      thread.title,
      thread.preview,
      projectName
    ].map(normalize).join("\n");
    return matchesProject && (!queryNeedle || haystack.includes(queryNeedle));
  });

  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || 8));
  const pageCount = Math.max(1, Math.ceil(filtered.length / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pageCount);
  const offset = (safePage - 1) * safePageSize;

  return {
    threads: filtered.slice(offset, offset + safePageSize),
    total: filtered.length,
    page: safePage,
    pageCount,
    pageSize: safePageSize,
    query,
    project
  };
}

function normalize(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}
