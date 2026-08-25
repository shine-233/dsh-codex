// dsh-codex/codex-schema/src/handwritten/protocol/types.ts
var types_exports = {};

// dsh-codex/codex-schema/src/dsh-plugin.ts
var name = "codex-schema";
var inject = ["tools"];
function schemaInfo() {
  return {
    anchor: "openai/codex@970b7f2ff4f6",
    license: "Apache-2.0",
    surfaces: ["app-server-protocol/v2", "protocol", "exec-server-protocol", "code-mode-protocol", "history"],
    note: "types-only package; import types from @shine233/codex-schema in TS code"
  };
}
function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return;
  const defineTool = (d) => d;
  ctx.tools.register(defineTool({
    name: "codex_schema_info",
    description: "Provenance and coverage info for the ported openai/codex wire-protocol type contracts.",
    parameters: {},
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
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
