# Codex → DSH evidence audit (2026-09-10)

This report separates migration inventory from equivalence evidence. The historical ledger fields `status: implemented` and `status: distilled` describe where work landed; they do **not** prove crate-level or runtime equivalence.

## Audit scope and provenance

- Migration working tree: `main` at `166eefb`, ahead of `origin/main` by 21 commits when inspected; the tree contains modified and untracked implementation/tests, so results describe that working tree unless a built artifact is named.
- Historical ledger anchor: `openai/codex@970b7f2ff4f6`.
- Incremental review windows are now modeled separately in `inventory-provenance.json`, including the formerly missing `970b7f2..121f91f` window and the two recorded ranges through `adee0b0`.
- Local upstream checkout HEAD: `121f91fd5d9dc66017866ce9bdc49f1e182721df`; commits `970b7f2ff4f6` and `adee0b0` exist locally, but the working checkout is sparse (`protocol/src`, `shell-command/src`). Exact-revision source outside the sparse worktree was inspected through Git objects.
- DSH host inspected read-only: `deepseek-harness` at detached/grafted `d347e70` (`dsh-v0.1.3-alpha.1`), with local workspace/lock changes.
- The revision-aware manifest gate now passes exact set equality at both endpoints: **142** Cargo manifests at historical anchor `970b7f2ff4f6`, and **151** at `adee0b04`. The ledger has **153 temporal rows** because it retains the two crates removed before the endpoint (`mcp-server`, `mcp-server/tests/common`) and registers the three endpoint additions (`attachment-store`, `mxc-sandbox`, `windows-sandbox-service`). `guardian-context` and `utils/git-discovery` are explicitly post-anchor additions rather than false anchor requirements.
- No tests were executed as part of the initial row classification. Existing test files and consumers were inspected; validation run afterward is reported where named.

## Evidence classes

| Class | Required meaning |
|---|---|
| `runtime-equivalent` | Same explicitly scoped runtime contract through a real DSH consumer, with positive and fail-closed evidence. |
| `behavioral-subset` | A named subset is implemented and tested; omitted upstream behavior is explicit. |
| `structural-only` | Parser/schema/fixture/data-shape parity without runtime consumption proof. |
| `implemented-unconsumed` | Code exists, but no current mounted DSH lifecycle/service consumes it. |
| `blocked` | Portable value exists, but a named DSH authority/runtime/identity seam is absent. |
| `excluded` | Product-specific, cloud-bound, UI-only, native/vendor, or concretely superseded. |
| `unsupported-overclaim` | Current code or wording claims semantics that available evidence disproves. |

Importability, a tool registration, a unit test, or a committed `lib/index.js` alone is insufficient for `runtime-equivalent`.

## Current positive-row result

| Evidence class | Rows |
|---|---:|
| `runtime-equivalent` | 0 |
| `behavioral-subset` | 9 |
| `structural-only` | 6 |
| `implemented-unconsumed` | 37 |
| `unsupported-overclaim` | 1 |
| **Total** | **53** |

The 9 behavioral subsets are `apply-patch`, `collaboration-mode-templates`, `config`, `execpolicy`, `ext/skills`, `model-provider-info`, `prompts`, `rollout`, and `shell-command`. The 6 structural rows are `app-server-protocol`, `code-mode-protocol`, `exec-server-protocol`, `ext/extension-api`, `history`, and `protocol`. `sandboxing` is the unsupported overclaim: bundled binary presence is not a DSH sandbox integration.

## Positive-row matrix

| Path | Old status | Evidence class | Decisive evidence / limitation |
|---|---|---|---|
| `agent-graph-store` | distilled | implemented-unconsumed | `codex-session-kit/src/agentGraph.ts` is exported, but neither mounted session tool consumes its JSONL graph. |
| `app-server-protocol` | implemented | structural-only | Generated/schema material exists; `codex-schema` exposes metadata, not a DSH app-server wire path. |
| `apply-patch` | distilled | behavioral-subset | V4A parsing and in-memory planning are real; physical writes bypass `ctx.fs`, sandbox authority, and batch atomicity. |
| `code-mode-protocol` | distilled | structural-only | Handwritten validators have local tests; no code-runtime transport consumes them. |
| `collaboration-mode-templates` | implemented | behavioral-subset | Templates are available through `codex_prompts`; they are not automatically injected into DSH requests. |
| `config` | distilled | behavioral-subset | TOML parsing/conversion is consumed; emitted synthetic Loader rows are not current DSH settings. |
| `context-fragments` | distilled | implemented-unconsumed | Utility exists but has no mounted caller. |
| `diagnostics` | implemented | implemented-unconsumed | Sandbox diagnostics code is not used by the inventory-only plugin. |
| `exec-server-protocol` | distilled | structural-only | Standalone sketch/validators; no exec transport consumer. |
| `execpolicy` | distilled | behavioral-subset | Inspection tools and `tools/pre-execute` hook exist, but enforcement defaults to off and the pack does not enable it. |
| `ext/extension-api` | distilled | structural-only | Tested validators have no mounted extension transport. |
| `ext/guardian-v2` | distilled | implemented-unconsumed | Prompt construction only; no model review gate, retained authorization, scorer, or mounted caller. |
| `ext/history-notes` | distilled | implemented-unconsumed | Standalone JSONL store, not DSH Session state. |
| `ext/memories` | distilled | implemented-unconsumed | Standalone notes/memory backend, not consumed by DSH memory/session lifecycle. |
| `ext/skills` | distilled | behavioral-subset | Catalog, budget, and lexical selector are consumed; executor/read pagination and full upstream semantics are not. |
| `external-agent-migration` | distilled | implemented-unconsumed | Conversion helpers are exported but do not append valid DSH Session events. |
| `features` | distilled | implemented-unconsumed | Utility exists without mounted config/Loader caller. |
| `file-search` | distilled | implemented-unconsumed | Unmounted synchronous basename search; upstream ignore/parallel semantics are absent. |
| `history` | distilled | structural-only | Envelope validators exist without DSH Session-wire consumption. |
| `linux-sandbox` | implemented | implemented-unconsumed | Binary is inventoried only; no DSH `SandboxProvider` or launch path. |
| `memories/read` | distilled | implemented-unconsumed | `StructuredMemoryStore` is not called by mounted tools. |
| `memories/write` | distilled | implemented-unconsumed | Artifact storage exists; no LLM consolidation or DSH persistence integration. |
| `message-history` | distilled | implemented-unconsumed | Local capped JSONL store, not mounted. |
| `model-provider-info` | distilled | behavioral-subset | Selected provider keys are parsed; current DSH route/schema/serviceability semantics are absent. |
| `prompts` | distilled | behavioral-subset | List/get/build is consumed as a tool asset; not a system-prompt contribution, and asset-count claims need reconciliation. |
| `protocol` | distilled | structural-only | Selected generated/handwritten structures exist; the mounted schema plugin is metadata-only. |
| `response-debug-context` | distilled | implemented-unconsumed | Utility exists without a response lifecycle consumer. |
| `rollout` | distilled | behavioral-subset | Tolerant parsing/listing is consumed; replay/compression/metrics and valid DSH persistence/resume are absent. |
| `rollout-trace` | distilled | implemented-unconsumed | Diagnostic classifier is not mounted into telemetry or Session lifecycle. |
| `sandboxing` | distilled | unsupported-overclaim | No independent strategy implementation or DSH sandbox adapter; binary presence cannot support a runtime claim. |
| `shell-command` | distilled | behavioral-subset | Policy tools/hooks consume a conservative parser; 68 PowerShell vectors match, but this is not tree-sitter/AST parity and current evidence is dirty-tree. |
| `state` | distilled | implemented-unconsumed | SQLite/memory mirror is exported but not connected to DSH Session lifecycle. |
| `terminal-detection` | distilled | implemented-unconsumed | Utility exists without mounted caller. |
| `thread-store` | distilled | implemented-unconsumed | Local memory/JSONL stores are not DSH persistence or queue lifecycle. |
| `utils/absolute-path` | distilled | implemented-unconsumed | Package-local utility only. |
| `utils/approval-presets` | implemented | implemented-unconsumed | Not connected to DSH permission presets or approval services. |
| `utils/cache` | distilled | implemented-unconsumed | Package-local utility only. |
| `utils/elapsed` | distilled | implemented-unconsumed | Package-local utility only. |
| `utils/fuzzy-match` | distilled | implemented-unconsumed | Package-local utility only. |
| `utils/home-dir` | distilled | implemented-unconsumed | Codex-home helper is not used by config import. |
| `utils/json-to-toml` | distilled | implemented-unconsumed | Import flow does not consume it. |
| `utils/output-truncation` | distilled | implemented-unconsumed | Tested budgets are not applied to mounted tool results. |
| `utils/path-uri` | distilled | implemented-unconsumed | Package-local utility only. |
| `utils/path-utils` | distilled | implemented-unconsumed | Package-local utility only. |
| `utils/readiness` | distilled | implemented-unconsumed | No mounted lifecycle provider consumes it. |
| `utils/redacted-string` | distilled | implemented-unconsumed | Utility exists without mounted caller. |
| `utils/sandbox-summary` | implemented | implemented-unconsumed | Plugin independently lists paths/sizes and does not consume summary/integrity behavior. |
| `utils/stream-parser` | distilled | implemented-unconsumed | No mounted stream consumer. |
| `utils/string` | distilled | implemented-unconsumed | Package-local utility only. |
| `utils/template` | distilled | implemented-unconsumed | Package-local utility only. |
| `windows-sandbox-rs` | implemented | implemented-unconsumed | Binaries are inventoried only; no setup, ACL, launch, or `SandboxProvider` lifecycle. |
| `guardian-context` | distilled | implemented-unconsumed | Formatter exists but is not called by a Guardian execution service. |
| `utils/git-discovery` | distilled | implemented-unconsumed | No mounted caller or DSH workspace integration. |

## Exclusion audit status

The historical first pass partitioned the original 97 `EXCLUDED` rows as 78 provisionally defensible, one stale, and 18 pending. Exact Git-object review at `adee0b04fa27a8ba5d2e3612b900363cffe72930` supersedes that architecture-only pass. After registering the three previously missing endpoint crates, all **100 current excluded ledger rows** have an exact disposition:

| Exact disposition | Rows |
|---|---:|
| `split` | 37 |
| `blocked` | 13 |
| `excluded` | 38 |
| `migration-candidate` | 12 |
| **Total** | **100** |

These are source dispositions, not implementation promotions. `split` means a crate mixes product-specific surfaces with portable or blocked behavior. `migration-candidate` means the portable behavior can target an existing DSH seam, but no implementation or runtime equivalence is implied. `evidence-review.json` is the complete machine-checkable row partition.

### Exact-source tranche: E1/E2 (completed)

Git objects at exact upstream commit `adee0b04fa27a8ba5d2e3612b900363cffe72930` were inspected for all 20 E1 OpenAI-bound and E2 UI-form rows. The generic group rationales survive for only 2 rows; 14 crates mix excluded surfaces with portable implementation, and 4 portable/local crates are blocked by a named absent DSH seam.

| Adjudication | Rows |
|---|---|
| `split` | `agent-identity`, `analytics`, `backend-client`, `chatgpt`, `cloud-config`, `cloud-tasks-client`, `connectors`, `ext/image-generation`, `feedback`, `login`, `models-manager`, `workload-identity`, `cloud-tasks`, `tui` |
| `blocked` | `cloud-tasks-mock-client` (no remote-task backend seam), `ext/connectors` (no connector-app declaration seam), `responses-api-proxy` (no local Responses forwarding/dump seam), `realtime-webrtc` (no voice-host/GStreamer native audio seam) |
| `excluded` | `codex-backend-openapi-models` (generated Codex backend schemas), `ansi-escape` (Ratatui output coupling; only trivial tab expansion is independent) |

| Row | Exact disposition | Decisive exact-source result |
|---|---|---|
| `agent-identity` | split | Registration/JWKS transport is OpenAI-bound; key generation, JWT decode/signing, task-ID decryption, and retry classification are portable. |
| `analytics` | split | Delivery is service-specific; local fact models, capture, accepted-line diff metrics, deduplication, reducer, and flush logic are portable. |
| `backend-client` | split | Codex routes/account/quota schemas are excluded; task-response prompt/message/error/diff normalization is portable but schema-coupled. |
| `chatgpt` | split | `/wham/tasks` retrieval is specific; response diff extraction and local Git patch application are portable/overlapping. |
| `cloud-config` | split | ChatGPT fetching is excluded; bundle validation, managed-layer parsing, cache modes, and cancellable refresh are portable. |
| `cloud-tasks-client` | split | Codex HTTP adapter is excluded; async task-backend trait and task/attempt/diff/apply domain models are portable. |
| `cloud-tasks-mock-client` | blocked | Local in-memory task backend makes no cloud request; DSH has no remote-task backend seam for it to implement. |
| `codex-backend-openapi-models` | excluded | Generated mirror of Codex backend task/plan/workspace/quota/credit schemas with no independent provider-neutral implementation. |
| `connectors` | split | Cloud directory/accessibility is specific; metadata, policy, merge/filter, caching, snapshots, and runtime projection are portable. |
| `ext/connectors` | blocked | Local executor-plugin app-config loader; DSH Cordis runtime has no connector-app declaration seam. |
| `ext/image-generation` | split | Images API/tool integration is specific; artifact naming, identifier sanitization, bounded hints, and local result handling are portable. |
| `feedback` | split | Authenticated upload is specific; bounded attachment preparation, diagnostics, trace/log capture, and guardian-failure aggregation are portable. |
| `login` | split | ChatGPT OAuth/device/account behavior is specific; external auth, storage, PKCE, token flows, refresh recovery, and change tracking are portable. |
| `models-manager` | split | Bundled Codex/GPT catalog/prompts are specific; cache, TTL/ETag, limits, overrides, fallback metadata, and instruction customization are portable. |
| `responses-api-proxy` | blocked | Configurable local Responses-wire proxy, not strictly OpenAI-host-bound; DSH outbound proxy policy is not a forwarding/dump service. |
| `workload-identity` | split | JWT-bearer exchange, bounded I/O, single-flight refresh, caching, and invalidation are portable; ChatGPT enrichment fields are specific. |
| `realtime-webrtc` | blocked | Local bounded native-helper protocol makes no OpenAI call; DSH lacks packaged voice-host/GStreamer and native audio-session seam. |
| `ansi-escape` | excluded | Parser output is directly coupled to Ratatui types; only trivial tab expansion is independent. |
| `cloud-tasks` | split | Ratatui rendering is specific; environment/branch detection, attempt/apply state, diff scrolling, URL/time helpers, and orchestration are portable. |
| `tui` | split | Rendering/interaction is specific; transcript export, Markdown merge, mention codec, event buffering/replay, and table/fence parsing are portable. |

`split` does not promote a row to runtime equivalence. It means the old whole-crate exclusion is false and the ledger needs separate excluded and portable-subset/blocked dispositions. Examples include analytics local facts/reducer/diff metrics, connector policy/merge/filter/snapshot logic, model cache/TTL/ETag/override logic, workload-identity exchange/caching, and TUI-independent transcript/text/event algorithms. No standalone row in this tranche was promoted as a migration candidate: useful seams either live inside mixed crates or are currently host-blocked.

This exact tranche supersedes the first-pass provisional verdict for its rows.

### Exact-source tranche: E3/E4/native and E5 (completed)

The remaining original exclusions were inspected from exact Git objects, with the minimum necessary DSH service comparison. Decisive corrections include:

- `code-mode-host` and `code-mode-runtime` are `split`: Node containing V8 excludes only native bindings, not protocol negotiation, bounded admission, persistent cell state, callbacks, cancellation, timeout, or fail-closed lifecycle.
- `ext/git-attribution`, `arg0`, `utils/cli`, `config-schema`, and `process-hardening` are `split`, not generic Rust glue or bundled-binary implementation.
- `voice-host`, `stdio-to-uds`, `bwrap`, and `shell-escalation` are `blocked` on named native/helper/runtime seams. Inventorying a sandbox executable does not implement them.
- `utils/oss` is a migration candidate; E5 additionally exposes 11 candidates: `aws-auth`, `ext/goal`, `ext/queue`, `file-watcher`, `keyring-store`, `lmstudio`, `ollama`, `uds`, `utils/sleep-inhibitor`, `websocket-client`, and `worktree`.
- `mcp-server` and `mcp-server/tests/common` are historical rows removed by `531f3836`; they remain temporal inventory, not live endpoint source.

The three newly registered endpoint crates were also adjudicated: `attachment-store` and `mxc-sandbox` are excluded by concrete DSH architecture/runtime evidence; `windows-sandbox-service` is split because Codex package identity/lifecycle is product-specific while LocalSystem IPC, machine policy, privileged provisioning, and cleanup remain blocked on an absent DSH service authority.

## Five integration gates

| Gate | Current verified verdict | Promotion requirement |
|---|---|---|
| Aggregate publication | Source-tree link activation works through a test-injected sibling importer; bare-package registry install, offline multi-tarball, and offline single-tarball closure are unproven. On 2026-09-10, separate public-registry lookups for `dsh-codex-pack` and all 8 current unscoped component identities returned `E404` (9/9). This proves current public-name absence, not publishability or ownership. | Owned/publishable exact package identities plus a clean consumer using bare Node/Loader resolution and no sibling importer. |
| Rollout → Session | `toDshEvents()` returns generic `{type,payload}` inspection objects, not format-v2 events; no Session handle, durable flush, restart, or `ctx.agents.resume`. | Strict all-or-nothing mapping, host-valid event structure, single-writer persistence, full restart, resume, and reconstructed request proof. |
| Apply patch | Parser and memory planning work; raw `node:fs` mutations bypass DSH FS/sandbox, and model-controlled absolute `cwd` can replace the configured root. | Initially add/update only through `ctx.fs`, freshness guards, sandbox containment, and preflight rejection of delete/rename/mixed unsupported patches. |
| Subagent roster | Codex formatter and DSH discovery/prompt assembly exist separately; no mounted plugin joins them. | Agent-scoped `system-prompt/assemble` consumer using `ctx.subagents.listChildren`, bounded deterministic rendering, durable runtime context, restart/resume proof. |
| Config importer | Bounded TOML parsing works; output uses nonexistent `llm-route`/`llm-provider-*` ownership and performs no serviceability check. | One current settings-backed provider mapping, default-model persistence, credential separation, exact model resolution, prepared local call, and restart proof. |

## Validation after ledger closure

The completed evidence/provenance correction was validated against the same dirty migration working tree on 2026-09-10:

- `coverage.yaml` and `coverage.json`: **153/153** semantically consistent; positive evidence **53/53** and exact exclusion dispositions **100/100** partition cleanly.
- Revision-aware inventory: **142/142** manifests at `970b7f2ff4f6`; **151/151** manifests at `adee0b04fa27a8ba5d2e3612b900363cffe72930`. Targeted parent/child Git-object checks also confirmed every nontrivial presence epoch: introductions of `guardian-context`, `utils/git-discovery`, `attachment-store`, `mxc-sandbox`, and `windows-sandbox-service`; removal of both `mcp-server` rows; and the add/remove/reintroduce sequence for `realtime-webrtc`.
- All ten package suites: **493 passed / 0 failed**; all ten package typechecks completed with zero errors.
- Committed bundle check: **10 packages / 0 drift**. Aggregate preflight: **8 sibling modules**. Aggregate dry-pack: **27 files**, 28.9 kB packed / 90.6 kB unpacked.
- Built ledger-plugin smoke returned `total=153` and `EXCLUDED=100`; JSON parse, Python/Node syntax, and `git diff --check` passed. The only diff-check output was existing Git line-ending conversion warnings.

These results prove local source/build consistency, not runtime equivalence. No clean registry install, offline multi-tarball closure, offline single-tarball closure, durable Session import, DSH-FS patch execution, request-time roster consumption, or current settings/provider application was established by this validation.

## Claim rules

1. Do not translate the old 7/46 labels into a completion percentage.
2. Do not call a registered tool a host integration unless it traverses the owning DSH service and lifecycle.
3. Do not call binary inventory sandbox support.
4. Do not call YAML suggestions serviceable model configuration.
5. Do not call imported final text provider-native replay without stream/provenance/settlement evidence.
6. Promote rows only after tests have run against the named working tree and built artifacts.

