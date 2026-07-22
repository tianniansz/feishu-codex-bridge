import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const roots = ["src", "scripts", "test"];
const files = roots.flatMap((root) => collect(path.resolve(root))).filter((file) => /\.(m?js)$/.test(file));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log(`语法检查通过：${files.length} 个文件。`);

function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(fullPath) : [fullPath];
  });
}
