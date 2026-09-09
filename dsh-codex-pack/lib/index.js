// src/index.ts
import { readFileSync as readFileSync3, existsSync as existsSync3 } from "node:fs";
import { join as join3 } from "node:path";

// src/preflight.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
function validatePackLayout(root) {
  const errors = [];
  const modules = [];
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) return { ok: false, errors: ["manifest.json not found"], modules };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false, errors: ["manifest.json is not valid JSON"], modules };
  }
  for (const [key, packageName] of Object.entries(manifest.modules ?? {})) {
    const localDir = join(root, "..", packageName.split("/").pop().replace(/^@[^/]+\//, ""));
    if (!existsSync(localDir)) errors.push(`${key}: sibling package missing (${localDir})`);
    else modules.push(key);
  }
  if (!existsSync(join(root, "cordis.patch.yml"))) errors.push("cordis.patch.yml missing");
  if (!existsSync(join(root, "docs", "MOUNT_POINTS.md"))) errors.push("docs/MOUNT_POINTS.md missing");
  return { ok: errors.length === 0, errors, modules };
}

// src/profileWriter.ts
import { copyFileSync, existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join as join2, relative } from "node:path";
var defaultFileOps = {
  exists: existsSync2,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  read: (path) => readFileSync2(path, "utf8"),
  write: (path, contents) => writeFileSync(path, contents, "utf8"),
  copy: copyFileSync,
  rename: renameSync,
  unlink: unlinkSync
};
function temporaryPath(path) {
  return `${path}.codex-tmp-${process.pid}-${randomUUID()}`;
}
function writeProfile(plan, profileDir, mode = "dry-run", options = {}) {
  const ops = { ...defaultFileOps, ...options.fileOps ?? {} };
  const packageJsonPath = join2(profileDir, "package.json");
  const patchPath = join2(profileDir, "cordis.patch.yml");
  if (!ops.exists(packageJsonPath)) throw new Error(`profile package.json not found: ${packageJsonPath}`);
  const packageText = ops.read(packageJsonPath);
  const pkg = JSON.parse(packageText);
  const dependencies = { ...pkg.dependencies ?? {} };
  for (const packageName of plan.bundles) {
    const sibling = join2(plan.root, "..", packageName.split("/").pop());
    dependencies[packageName] = `link:${relative(profileDir, sibling).replace(/\\/g, "/")}`;
  }
  const bundles = Array.from(/* @__PURE__ */ new Set([...pkg.dsh?.profile?.bundles ?? [], ...plan.bundles]));
  const nextPkg = { ...pkg, dependencies, dsh: { ...pkg.dsh ?? {}, profile: { ...pkg.dsh?.profile ?? {}, bundles } } };
  const patchText = ops.read(plan.patchPath);
  const nextJson = `${JSON.stringify(nextPkg, null, 2)}
`;
  const hasPatch = ops.exists(patchPath);
  const currentPatch = hasPatch ? ops.read(patchPath) : void 0;
  const packageChanged = nextJson !== packageText;
  const patchChanged = currentPatch !== patchText;
  if (hasPatch && currentPatch.trim().length > 0 && patchChanged && !options.overwritePatch) {
    throw new Error(`existing cordis.patch.yml differs: ${patchPath}; pass overwritePatch: true to replace it`);
  }
  const changed = packageChanged || !hasPatch || patchChanged;
  if (mode !== "apply" || !changed) {
    return { mode, packageJsonPath, patchPath, dependencyCount: plan.bundles.length, bundles, changed };
  }
  ops.mkdir(profileDir);
  const packageTemp = temporaryPath(packageJsonPath);
  const patchTemp = temporaryPath(patchPath);
  const packageRollback = temporaryPath(packageJsonPath);
  const patchRollback = temporaryPath(patchPath);
  const packageBackup = `${packageJsonPath}.bak`;
  const patchBackup = `${patchPath}.bak`;
  let packageReplaced = false;
  let patchReplaced = false;
  try {
    ops.write(packageTemp, nextJson);
    if (patchChanged) ops.write(patchTemp, patchText);
    ops.copy(packageJsonPath, packageRollback);
    if (!ops.exists(packageBackup)) ops.copy(packageJsonPath, packageBackup);
    if (hasPatch) {
      ops.copy(patchPath, patchRollback);
      if (patchChanged && !ops.exists(patchBackup)) ops.copy(patchPath, patchBackup);
    }
    if (packageChanged) {
      packageReplaced = true;
      ops.rename(packageTemp, packageJsonPath);
    }
    if (patchChanged) {
      patchReplaced = true;
      ops.rename(patchTemp, patchPath);
    }
  } catch (error) {
    try {
      if (packageReplaced) ops.copy(packageRollback, packageJsonPath);
      if (patchReplaced) {
        if (hasPatch) ops.copy(patchRollback, patchPath);
        else if (ops.exists(patchPath)) ops.unlink(patchPath);
      } else if (!hasPatch && ops.exists(patchPath)) {
        ops.unlink(patchPath);
      }
    } catch (rollbackError) {
      throw new Error(`profile installation failed and rollback failed: ${String(rollbackError)}`, { cause: error });
    }
    throw error;
  } finally {
    for (const path of [packageTemp, patchTemp, packageRollback, patchRollback]) {
      if (ops.exists(path)) ops.unlink(path);
    }
  }
  return { mode, packageJsonPath, patchPath, dependencyCount: plan.bundles.length, bundles, changed };
}

// src/index.ts
function loadLedger(ledgerJsonPath) {
  if (!existsSync3(ledgerJsonPath)) throw new Error(`ledger not found: ${ledgerJsonPath}`);
  return JSON.parse(readFileSync3(ledgerJsonPath, "utf8"));
}
function summarizeByModule(ledger) {
  const byModule = /* @__PURE__ */ new Map();
  for (const e of ledger.entries) {
    if (!e.dest || e.dest === "EXCLUDED") continue;
    const m = byModule.get(e.dest) ?? { dest: e.dest, implemented: 0, distilled: 0, designOnly: 0, upstreamLines: 0 };
    m.upstreamLines += e.lines ?? 0;
    if (e.status === "implemented") m.implemented++;
    else if (e.status === "distilled") m.distilled++;
    else m.designOnly++;
    byModule.set(e.dest, m);
  }
  return [...byModule.values()].sort((a, b) => b.upstreamLines - a.upstreamLines);
}
function pendingAdmissions(ledger) {
  return ledger.entries.filter((e) => e.code === "E0-pending-admission");
}
function statusReport(ledger) {
  const lines = [];
  lines.push(`codex\u2192dsh \u79FB\u690D\u5957\u4EF6\u72B6\u6001 (anchor: ${ledger.meta?.anchor_commit ?? "unknown"})`);
  lines.push("");
  for (const m of summarizeByModule(ledger)) {
    lines.push(
      `${m.dest}: \u5DF2\u5B9E\u73B0 ${m.implemented} \xB7 \u84B8\u998F ${m.distilled} \xB7 \u4EC5\u8BBE\u8BA1 ${m.designOnly} (\u4E0A\u6E38 ${m.upstreamLines} \u884C)`
    );
  }
  const pending = pendingAdmissions(ledger);
  if (pending.length) {
    lines.push("");
    lines.push(`\u5F85\u51C6\u5165 (E0): ${pending.map((e) => e.path).join(", ")}`);
  }
  return lines.join("\n");
}
function buildInstallPlan(root) {
  const preflight = validatePackLayout(root);
  if (!preflight.ok) throw new Error(`pack preflight failed: ${preflight.errors.join("; ")}`);
  const manifest = JSON.parse(readFileSync3(join3(root, "manifest.json"), "utf8"));
  return {
    root,
    dependencies: { ...manifest.modules },
    bundles: Object.values(manifest.modules),
    patchPath: join3(root, "cordis.patch.yml")
  };
}
function install(root = process.cwd()) {
  return buildInstallPlan(root);
}
export {
  buildInstallPlan,
  install,
  loadLedger,
  pendingAdmissions,
  statusReport,
  summarizeByModule,
  validatePackLayout,
  writeProfile
};
