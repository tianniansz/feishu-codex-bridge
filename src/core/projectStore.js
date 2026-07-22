import path from "node:path";

export const DEFAULT_PROJECT = Object.freeze({
  id: 0,
  name: "默认（未分类）",
  cwd: ""
});

export class DeveloperProjectStore {
  constructor({ allowedRoots = [] } = {}) {
    this.allowedRoots = allowedRoots.map((root) => normalizeCwd(path.resolve(root))).filter(Boolean);
  }

  filterThreads(threads = [], metadata = {}) {
    return threads.filter((thread) => {
      const saved = metadata[thread.id] || {};
      return this.isAllowed(saved.projectCwd || thread.cwd || thread.workspacePath || "");
    });
  }

  isAllowed(cwd) {
    const candidate = normalizeCwd(cwd);
    if (!candidate) return false;
    return this.allowedRoots.some((root) => isWithin(root, candidate));
  }

  listProjects({ threads = [], metadata = {} } = {}) {
    const projects = new Map();

    for (const root of this.allowedRoots) {
      projects.set(root.toLowerCase(), { id: 0, name: projectNameFromCwd(root), cwd: root });
    }

    for (const thread of this.filterThreads(threads, metadata)) {
      const saved = metadata[thread.id] || {};
      const cwd = normalizeCwd(saved.projectCwd || thread.cwd || thread.workspacePath || "");
      if (!cwd) continue;
      projects.set(cwd.toLowerCase(), {
        id: 0,
        name: saved.projectName || projectNameFromCwd(cwd),
        cwd
      });
    }

    return [...projects.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((project, index) => ({ ...project, id: index + 1 }));
  }

  getProject(projectId, { projects = [] } = {}) {
    const id = Number(projectId);
    return projects.find((project) => project.id === id) || null;
  }

  projectForThread(thread, { metadata = {}, projects = [] } = {}) {
    const saved = metadata[thread?.id] || {};
    if (saved.projectName && this.isAllowed(saved.projectCwd)) {
      return {
        id: Number(saved.projectId || 0),
        name: saved.projectName,
        cwd: saved.projectCwd || ""
      };
    }

    const cwd = normalizeCwd(thread?.cwd || thread?.workspacePath || "");
    if (!this.isAllowed(cwd)) return DEFAULT_PROJECT;
    return projects.find((project) => sameCwd(project.cwd, cwd)) || {
      id: 0,
      name: projectNameFromCwd(cwd),
      cwd
    };
  }

  formatProjectList({ projects = [] } = {}) {
    const list = projects.length ? projects : [DEFAULT_PROJECT];
    return [
      "请选择项目：",
      "",
      ...list.map((project) => `${project.id}. ${project.name}`),
      "",
      "请直接回复项目编号。",
      "",
      "输入 exit 或 取消 可退出新建流程。"
    ].join("\n");
  }
}

export function normalizeCwd(value = "") {
  return String(value || "").trim().replace(/[\\/]+$/, "");
}

export function projectNameFromCwd(cwd = "") {
  const normalized = normalizeCwd(cwd);
  if (!normalized) return DEFAULT_PROJECT.name;
  return path.basename(normalized.replace(/\\/g, path.sep)) || normalized;
}

function sameCwd(left = "", right = "") {
  return normalizeCwd(left).toLowerCase() === normalizeCwd(right).toLowerCase();
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
