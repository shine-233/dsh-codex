// src/dsh-plugin.ts
import { existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";
var name = "codex-sandbox-bin";
var inject = ["tools"];
var ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "bin");
var PLATFORM_DIRS = { win32: "windows", linux: "linux", darwin: "darwin" };
function binPaths() {
  const key = `${PLATFORM_DIRS[platform()] ?? platform()}-${arch()}`;
  const dir = join(ROOT, key);
  const out = { platformKey: key, dir, binaries: {} };
  if (!existsSync(dir)) return out;
  for (const f of readdirSafe(dir)) {
    const full = join(dir, f);
    out.binaries[f] = { path: full, bytes: statSync(full).size };
  }
  return out;
}
function readdirSafe(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}
function apply(ctx, _config = {}) {
  if (!ctx?.tools?.register) return;
  const defineTool = (d) => d;
  ctx.tools.register(defineTool({
    name: "codex_sandbox_status",
    description: "Report which vendored codex sandbox executables are present for this platform (linux sandbox / windows command-runner), with absolute paths ready for sandbox-policy config.",
    parameters: {},
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
    async execute() {
      const info = binPaths();
      return JSON.stringify({ ...info, available: Object.keys(info.binaries).length > 0 }, null, 2);
    },
    timeoutMs: 3e3
  }));
}
export {
  apply,
  binPaths,
  inject,
  name
};
