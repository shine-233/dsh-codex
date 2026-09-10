// src/index.ts
import { readFileSync as readFileSync3, existsSync as existsSync3 } from "node:fs";
import { join as join3 } from "node:path";

// src/preflight.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
function readJson(path, label, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    errors.push(`${label} is not valid JSON`);
    return void 0;
  }
}
function exportedEntry(pkg) {
  const resolveTarget = (target) => {
    if (typeof target === "string") return target;
    if (!target || typeof target !== "object") return void 0;
    const conditions = target;
    return resolveTarget(conditions.import) ?? resolveTarget(conditions.node) ?? resolveTarget(conditions.default) ?? resolveTarget(conditions.require);
  };
  const root = pkg.exports && typeof pkg.exports === "object" ? pkg.exports["."] : pkg.exports;
  return resolveTarget(root) ?? (typeof pkg.main === "string" ? pkg.main : void 0);
}
function parsePatchEntries(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label} missing (${path})`);
    return void 0;
  }
  let parsed;
  try {
    parsed = load(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    return void 0;
  }
  if (!Array.isArray(parsed)) {
    errors.push(`${label} top level must be an array`);
    return void 0;
  }
  const entries = [];
  parsed.forEach((operation, operationIndex) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      errors.push(`${label} operation ${operationIndex + 1} must be an object`);
      return;
    }
    const keys = Object.keys(operation);
    if (keys.length !== 1 || keys[0] !== "insert") {
      errors.push(`${label} operation ${operationIndex + 1} must contain only insert`);
      return;
    }
    const insert = operation.insert;
    if (!Array.isArray(insert)) {
      errors.push(`${label} operation ${operationIndex + 1} insert must be an array`);
      return;
    }
    insert.forEach((entry, entryIndex) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`${label} insert ${entryIndex + 1} must be an object`);
        return;
      }
      const record = entry;
      if (typeof record.id !== "string" || typeof record.name !== "string") {
        errors.push(`${label} insert ${entryIndex + 1} requires string id and name`);
        return;
      }
      entries.push({ id: record.id, name: record.name });
    });
  });
  return entries;
}
function validatePackLayout(root) {
  const errors = [];
  const modules = [];
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) return { ok: false, errors: ["manifest.json not found"], modules };
  const manifest = readJson(manifestPath, "manifest.json", errors);
  if (!manifest) return { ok: false, errors, modules };
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    errors.push("manifest.json name must be a non-empty string");
  }
  if (!manifest.modules || typeof manifest.modules !== "object" || Array.isArray(manifest.modules)) {
    errors.push("manifest.json modules must be an object");
  } else if (Object.keys(manifest.modules).length === 0) {
    errors.push("manifest.json modules must not be empty");
  }
  const packPackage = readJson(join(root, "package.json"), "pack package.json", errors);
  if (packPackage && packPackage.name !== manifest.name) {
    errors.push(`pack package name mismatch: manifest=${String(manifest.name)} package.json=${String(packPackage.name)}`);
  }
  if (packPackage) {
    const packEntry = exportedEntry(packPackage);
    if (!packEntry) errors.push("pack package has no runtime export or main entry");
    else if (!existsSync(join(root, packEntry))) errors.push(`pack built entry missing (${join(root, packEntry)})`);
  }
  const packPatchDeclaration = packPackage?.dsh?.bundle?.patch;
  if (typeof packPatchDeclaration !== "string") errors.push("pack package.json declares no dsh.bundle.patch");
  const aggregatePath = typeof packPatchDeclaration === "string" ? join(root, packPatchDeclaration) : join(root, "cordis.patch.yml");
  const aggregateEntries = parsePatchEntries(aggregatePath, "aggregate patch", errors);
  const packageNames = [];
  const seenPackageNames = /* @__PURE__ */ new Set();
  for (const [key, value] of Object.entries(manifest.modules ?? {})) {
    if (typeof value !== "string") {
      errors.push(`${key}: package name must be a string`);
      continue;
    }
    const packageName = value;
    if (seenPackageNames.has(packageName)) {
      errors.push(`${key}: duplicate package name ${packageName}`);
      continue;
    }
    seenPackageNames.add(packageName);
    const localDir = join(root, "..", packageName);
    const packagePath = join(localDir, "package.json");
    if (!existsSync(packagePath)) {
      errors.push(`${key}: sibling package missing (${localDir})`);
      continue;
    }
    const pkg = readJson(packagePath, `${key} package.json`, errors);
    if (!pkg) continue;
    if (pkg.name !== packageName) {
      errors.push(`${key}: package name mismatch: manifest=${packageName} package.json=${String(pkg.name)}`);
    }
    const entry = exportedEntry(pkg);
    if (!entry) errors.push(`${key}: package has no runtime export or main entry`);
    else if (!existsSync(join(localDir, entry))) errors.push(`${key}: built entry missing (${join(localDir, entry)})`);
    const patchDeclaration = pkg.dsh?.bundle?.patch;
    if (typeof patchDeclaration !== "string") {
      errors.push(`${key}: package declares no dsh.bundle.patch`);
    } else {
      const componentEntries = parsePatchEntries(
        join(localDir, patchDeclaration),
        `${key} bundle patch`,
        errors
      );
      if (componentEntries && (componentEntries.length !== 1 || componentEntries[0].id !== packageName || componentEntries[0].name !== packageName)) {
        errors.push(`${key}: bundle patch must insert exactly ${packageName} with matching id and name`);
      }
    }
    packageNames.push(packageName);
    modules.push(key);
  }
  if (aggregateEntries) {
    const expectedEntries = packageNames.map((name) => ({ id: name, name }));
    if (JSON.stringify(aggregateEntries) !== JSON.stringify(expectedEntries)) {
      const found = aggregateEntries.map((entry) => `${entry.id}:${entry.name}`).join(", ");
      errors.push(`aggregate patch modules differ: expected ${packageNames.join(", ")}; found ${found}`);
    }
  }
  const mountPointsDoc = typeof manifest.mountPointsDoc === "string" ? manifest.mountPointsDoc : "docs/MOUNT_POINTS.md";
  if (!existsSync(join(root, mountPointsDoc))) errors.push(`${mountPointsDoc} missing`);
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
  if (!ops.exists(packageJsonPath)) throw new Error(`profile package.json not found: ${packageJsonPath}`);
  const packageText = ops.read(packageJsonPath);
  const pkg = JSON.parse(packageText);
  const dependencies = { ...pkg.dependencies ?? {} };
  for (const [packageName, packageDir] of Object.entries(plan.dependencies)) {
    dependencies[packageName] = `link:${relative(profileDir, packageDir).replace(/\\/g, "/")}`;
  }
  const bundles = Array.from(/* @__PURE__ */ new Set([...pkg.dsh?.profile?.bundles ?? [], ...plan.bundles]));
  const nextPkg = { ...pkg, dependencies, dsh: { ...pkg.dsh ?? {}, profile: { ...pkg.dsh?.profile ?? {}, bundles } } };
  const nextJson = `${JSON.stringify(nextPkg, null, 2)}
`;
  const changed = nextJson !== packageText;
  if (mode !== "apply" || !changed) {
    return { mode, packageJsonPath, dependencyCount: Object.keys(plan.dependencies).length, bundles, changed };
  }
  ops.mkdir(profileDir);
  const packageTemp = temporaryPath(packageJsonPath);
  const packageRollback = temporaryPath(packageJsonPath);
  const packageBackup = `${packageJsonPath}.bak`;
  let packageReplaced = false;
  try {
    ops.write(packageTemp, nextJson);
    ops.copy(packageJsonPath, packageRollback);
    if (!ops.exists(packageBackup)) ops.copy(packageJsonPath, packageBackup);
    packageReplaced = true;
    ops.rename(packageTemp, packageJsonPath);
  } catch (error) {
    try {
      if (packageReplaced) ops.copy(packageRollback, packageJsonPath);
    } catch (rollbackError) {
      throw new Error(`profile installation failed and rollback failed: ${String(rollbackError)}`, { cause: error });
    }
    throw error;
  } finally {
    for (const path of [packageTemp, packageRollback]) {
      if (ops.exists(path)) ops.unlink(path);
    }
  }
  return { mode, packageJsonPath, dependencyCount: Object.keys(plan.dependencies).length, bundles, changed };
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
  const dependencies = Object.fromEntries(
    Object.values(manifest.modules).map((packageName) => [packageName, join3(root, "..", packageName)])
  );
  dependencies[manifest.name] = root;
  return {
    root,
    dependencies,
    bundles: [manifest.name],
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
