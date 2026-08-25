// @ts-nocheck
// 机械翻译件：语义待复核（见 README M1 状态）
// Mechanical serde->TS translation from openai/codex code-mode-protocol (Apache-2.0).
export interface ClientHelloErrorOverlappingCapability { None: 'OverlappingCapability';  }
export interface WireContentItemInputText { type: 'InputText';     text: string; }
export interface WireContentItemInputImage { type: 'InputImage';     imageUrl: string; }
export interface WireContentItemInputAudio { type: 'InputAudio';     audioUrl: string; }
export interface WireRuntimeResponseYielded { None: 'Yielded';     cell_id: WireCellId;     content_items: WireContentItem[]; }
export interface WireRuntimeResponseTerminated { None: 'Terminated';     cell_id: WireCellId;     content_items: WireContentItem[]; }
export interface WireRuntimeResponseResult { None: 'Result';     cell_id: WireCellId;     content_items: WireContentItem[];     error_text: string | null; }
export interface WireWaitOutcomeLiveCell { None: 'LiveCell';  }
export interface WireWaitOutcomeMissingCell { None: 'MissingCell';  }
export interface InvalidSupportedProtocolVersionsDuplicate { None: 'Duplicate';  }
export interface FunctionCallOutputContentItemInputText { type: 'InputText';     text: string; }
export interface FunctionCallOutputContentItemInputImage { type: 'InputImage';     imageUrl: string; }
export interface FunctionCallOutputContentItemInputAudio { type: 'InputAudio';     audioUrl: string; }
export interface WaitOutcomeLiveCell { None: 'LiveCell';  }
export interface WaitOutcomeMissingCell { None: 'MissingCell';  }
export interface ExecuteToPendingOutcomePending { None: 'Pending';     cell_id: CellId;     content_items: FunctionCallOutputContentItem[];     pending_tool_call_ids: string[]; }
export interface ExecuteToPendingOutcomeCompleted { None: 'Completed';  }
export interface WaitToPendingOutcomeLiveCell { None: 'LiveCell';  }
export interface WaitToPendingOutcomeMissingCell { None: 'MissingCell';  }
export interface RuntimeResponseYielded { None: 'Yielded';     cell_id: CellId;     content_items: FunctionCallOutputContentItem[]; }
export interface RuntimeResponseTerminated { None: 'Terminated';     cell_id: CellId;     content_items: FunctionCallOutputContentItem[]; }
export interface RuntimeResponseResult { None: 'Result';     cell_id: CellId;     content_items: FunctionCallOutputContentItem[];     error_text: string | null; }

export interface codemodeprotocol_Structs {

  name: string;
  toolName: ToolName;
  description: string;
  kind: CodeModeToolKind;
  inputSchema?: unknown | null;
  outputSchema?: unknown | null;
  name: string;
  description: string;
  yield_time_ms?: number | null;
  max_output_tokens?: number | null;
  code: string;
  yield_time_ms?: number | null;
  max_output_tokens?: number | null;

  tool_name: ToolName;
  global_name: string;
  description: string;
  kind: CodeModeToolKind;
  payload: number[];
  supportedVersions: SupportedProtocolVersions;
  requiredCapabilities: CapabilitySet;
  optionalCapabilities: CapabilitySet;
  supportedVersions: SupportedProtocolVersions;
  requiredCapabilities: CapabilitySet;
  optionalCapabilities: CapabilitySet;
  selectedVersion: ProtocolVersion;
  capabilities: CapabilitySet;
  bulkConnectionToken?: string | null;

  maxYieldTimeMs?: number | null;
  maxHeapSizeBytes?: number | null;
  name: string;
  namespace?: string | null;

  name: string;
  tool_name: WireToolName;
  description: string;
  kind: WireToolKind;
  input_schema?: unknown | null;
  output_schema?: unknown | null;
  tool_call_id: string;
  enabled_tools: WireToolDefinition[];
  source: string;
  yield_time_ms?: number | null;
  max_output_tokens?: number | null;
  cell_id: WireCellId;
  yield_time_ms: number;

  cell_id: WireCellId;
  runtime_tool_call_id: string;
  tool_name: WireToolName;
  tool_kind: WireToolKind;
  input?: unknown | null;
  capability: Capability;

  tool_call_id: string;
  enabled_tools: ToolDefinition[];
  source: string;
  yield_time_ms?: number | null;
  max_output_tokens?: number | null;
  cell_id: CellId;
  yield_time_ms: number;
  cell_id: CellId;
  cell_id: CellId;
  runtime_tool_call_id: string;
  tool_name: ToolName;
  tool_kind: CodeModeToolKind;
  input?: unknown | null;
  max_yield_time_ms?: number | null;
  max_heap_size_bytes?: number | null;
}
