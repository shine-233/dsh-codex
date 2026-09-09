// src/handwritten/protocol/types.ts
var types_exports = {};

// src/dsh-plugin.ts
var name = "codex-schema";
var inject = ["tools"];
function schemaInfo() {
  return {
    anchor: "openai/codex@rust-v0.153.4 (d347e70 lineage: 042fb41b7c813ac7999105e886b2b7aa715b5081)",
    license: "Apache-2.0",
    surfaces: ["app-server-protocol/v2", "protocol", "exec-server-protocol", "code-mode-protocol", "history"],
    note: "types-only package; import types from @shine233/codex-schema in TS code"
  };
}
function apply(ctx, config = {}) {
  const c = ctx;
  if (!c?.tools?.register) return;
  const defineTool = (d) => d;
  c.tools.register(defineTool({
    name: "codex_schema_info",
    description: "Provenance and coverage info for the ported openai/codex wire-protocol type contracts.",
    parameters: {},
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: String(v) }] },
    async execute() {
      return JSON.stringify(schemaInfo(), null, 2);
    },
    timeoutMs: 3e3
  }));
}
export {
  apply,
  types_exports as handwritten,
  inject,
  name,
  schemaInfo
};
