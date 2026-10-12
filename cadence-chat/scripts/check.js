import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", file], {
        stdio: "inherit",
      });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const dir of ["server", "public/js", "scripts", "tests"]) await walk(dir);
console.log("All JavaScript files passed syntax checks.");
