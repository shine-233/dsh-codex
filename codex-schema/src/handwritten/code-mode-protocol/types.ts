// Typed code-mode-protocol subset used by DSH.
// The former mechanical serde translation flattened structs and produced
// duplicate members/unresolved references. Named wire faces below are the
// validated subset; the aggregate export remains for old consumers.

export type WireCellId = string;
export type CellId = string;
export type ToolName = string;
export type WireToolName = string;
export type ProtocolVersion = string;
export type Capability = string;
export type CodeModeToolKind = 'Function' | 'Namespace' | string;
export type WireToolKind = CodeModeToolKind;
export type SupportedProtocolVersions = ProtocolVersion[];
export type CapabilitySet = Capability[];

export interface ClientHelloErrorOverlappingCapability { None: 'OverlappingCapability'; }

export interface WireContentItemInputText { type: 'InputText'; text: string; }
export interface WireContentItemInputImage { type: 'InputImage'; imageUrl: string; }
export interface WireContentItemInputAudio { type: 'InputAudio'; audioUrl: string; }
export type WireContentItem = WireContentItemInputText | WireContentItemInputImage | WireContentItemInputAudio;

export interface WireRuntimeResponseYielded { None: 'Yielded'; cell_id: WireCellId; content_items: WireContentItem[]; }
export interface WireRuntimeResponseTerminated { None: 'Terminated'; cell_id: WireCellId; content_items: WireContentItem[]; }
export interface WireRuntimeResponseResult { None: 'Result'; cell_id: WireCellId; content_items: WireContentItem[]; error_text: string | null; }
export type WireRuntimeResponse = WireRuntimeResponseYielded | WireRuntimeResponseTerminated | WireRuntimeResponseResult;

export interface WireWaitOutcomeLiveCell { None: 'LiveCell'; }
export interface WireWaitOutcomeMissingCell { None: 'MissingCell'; }
export type WireWaitOutcome = WireWaitOutcomeLiveCell | WireWaitOutcomeMissingCell;
export interface InvalidSupportedProtocolVersionsDuplicate { None: 'Duplicate'; }

export interface FunctionCallOutputContentItemInputText { type: 'InputText'; text: string; }
export interface FunctionCallOutputContentItemInputImage { type: 'InputImage'; imageUrl: string; }
export interface FunctionCallOutputContentItemInputAudio { type: 'InputAudio'; audioUrl: string; }
export type FunctionCallOutputContentItem = FunctionCallOutputContentItemInputText | FunctionCallOutputContentItemInputImage | FunctionCallOutputContentItemInputAudio;

export interface WaitOutcomeLiveCell { None: 'LiveCell'; }
export interface WaitOutcomeMissingCell { None: 'MissingCell'; }
export type WaitOutcome = WaitOutcomeLiveCell | WaitOutcomeMissingCell;

export interface ExecuteToPendingOutcomePending { None: 'Pending'; cell_id: CellId; content_items: FunctionCallOutputContentItem[]; pending_tool_call_ids: string[]; }
export interface ExecuteToPendingOutcomeCompleted { None: 'Completed'; }
export type ExecuteToPendingOutcome = ExecuteToPendingOutcomePending | ExecuteToPendingOutcomeCompleted;
export interface WaitToPendingOutcomeLiveCell { None: 'LiveCell'; }
export interface WaitToPendingOutcomeMissingCell { None: 'MissingCell'; }
export type WaitToPendingOutcome = WaitToPendingOutcomeLiveCell | WaitToPendingOutcomeMissingCell;

export interface RuntimeResponseYielded { None: 'Yielded'; cell_id: CellId; content_items: FunctionCallOutputContentItem[]; }
export interface RuntimeResponseTerminated { None: 'Terminated'; cell_id: CellId; content_items: FunctionCallOutputContentItem[]; }
export interface RuntimeResponseResult { None: 'Result'; cell_id: CellId; content_items: FunctionCallOutputContentItem[]; error_text: string | null; }
export type RuntimeResponse = RuntimeResponseYielded | RuntimeResponseTerminated | RuntimeResponseResult;

export interface ToolDefinition {
  name: ToolName;
  description: string;
  kind: CodeModeToolKind;
  inputSchema?: unknown | null;
  outputSchema?: unknown | null;
}
export interface WireToolDefinition {
  name: WireToolName;
  description: string;
  kind: WireToolKind;
  input_schema?: unknown | null;
  output_schema?: unknown | null;
}

/** Compatibility export for consumers of the old flattened serde module. */
export interface codemodeprotocol_Structs {
  [field: string]: unknown;
  name?: string;
  description?: string;
  toolName?: ToolName;
  tool_name?: ToolName | WireToolName;
  kind?: CodeModeToolKind | WireToolKind;
  inputSchema?: unknown | null;
  outputSchema?: unknown | null;
  input_schema?: unknown | null;
  output_schema?: unknown | null;
  code?: string;
  source?: string;
  payload?: number[];
  supportedVersions?: SupportedProtocolVersions;
  requiredCapabilities?: CapabilitySet;
  optionalCapabilities?: CapabilitySet;
  selectedVersion?: ProtocolVersion;
  capabilities?: CapabilitySet;
  bulkConnectionToken?: string | null;
  maxYieldTimeMs?: number | null;
  maxHeapSizeBytes?: number | null;
  namespace?: string | null;
  tool_call_id?: string;
  runtime_tool_call_id?: string;
  enabled_tools?: Array<ToolDefinition | WireToolDefinition>;
  cell_id?: CellId | WireCellId;
  yield_time_ms?: number | null;
  max_output_tokens?: number | null;
  input?: unknown | null;
  capability?: Capability;
  max_yield_time_ms?: number | null;
  max_heap_size_bytes?: number | null;
}
