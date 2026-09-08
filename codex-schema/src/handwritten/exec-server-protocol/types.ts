// Typed exec-server protocol contracts distilled from openai/codex.
// The original serde translation flattened several structs into one interface;
// these declarations preserve the wire variants without suppressing type errors.

export type PathUri = string;
export type ProcessId = number | string;

export interface EnvironmentConfigLayer { source: string; baseDir: PathUri; toml: string; }
export interface EnvironmentConfigLayerStack { layers: EnvironmentConfigLayer[]; cloudInsertionIndex: number; }
export type ExecServerNetworkProtocol = 'http' | 'https' | 'tcp' | string;

export interface ExecServerNetworkPolicyRequest {
  protocol: ExecServerNetworkProtocol;
  host: string;
  port: number;
  processId?: ProcessId;
  timestamp?: string;
  scope?: string;
  method?: string | null;
  client?: string | null;
}

export interface ExecServerNetworkPolicyDecisionDeny { type: 'Deny'; reason: string; }
export interface ExecServerNetworkPolicyDecisionAsk { type: 'Ask'; reason: string; }
export type ExecServerNetworkPolicyDecision = ExecServerNetworkPolicyDecisionDeny | ExecServerNetworkPolicyDecisionAsk;

export interface NetworkPolicyDecisionRecord {
  request: ExecServerNetworkPolicyRequest;
  decision: ExecServerNetworkPolicyDecision;
  policyOverride: boolean;
}
export interface NetworkPolicyAuditRecord {
  protocol: ExecServerNetworkProtocol;
  host: string;
  port: number;
  processId: ProcessId;
  timestamp: string;
  scope: string;
  decision: string;
  source: string;
  reason: string;
}
export interface ExecServerConfigSnapshot {
  cwd: PathUri;
  configPaths: string[][];
  requirementsPaths: string[][];
  userHomeDir?: PathUri | null;
  codexHomeDir: PathUri;
  hostname?: string | null;
  config: EnvironmentConfigLayerStack;
  requirements: EnvironmentConfigLayerStack;
}

export interface ExecServerShellInfo { name: string; path: string; }

/**
 * Compatibility metadata returned by exec-server initialization and environment/info.
 * providerId is an opaque optional build identity, not an artifact checksum or attestation.
 */
export interface EnvironmentInfo {
  shell: ExecServerShellInfo;
  executorVersion: string;
  providerId?: string;
  cwd?: PathUri | null;
  userHomeDir?: PathUri | null;
  platformOs?: string | null;
}

export interface RequestIdString { None: 'String'; }
export interface RequestIdInteger { None: 'Integer'; }
export type RequestId = RequestIdString | RequestIdInteger;
export interface W3cTraceContext { traceparent?: string; tracestate?: string; }

export interface JSONRPCMessageRequest {
  None: 'Request'; id?: RequestId; method?: string; params?: unknown; trace?: W3cTraceContext;
}
export interface JSONRPCMessageNotification {
  None: 'Notification'; method?: string; params?: unknown; trace?: W3cTraceContext;
}
export interface JSONRPCErrorError { code: number; message: string; data?: unknown; }
export interface JSONRPCMessageResponse {
  None: 'Response'; id?: RequestId; result?: unknown; error?: JSONRPCErrorError;
}
export interface JSONRPCMessageError { None: 'Error'; id?: RequestId; error: JSONRPCErrorError; }
export type JSONRPCMessage = JSONRPCMessageRequest | JSONRPCMessageNotification | JSONRPCMessageResponse | JSONRPCMessageError;
export interface JSONRPCResponseEnvelope { id: RequestId; result: unknown; }
export interface JSONRPCErrorEnvelope { id: RequestId; error: JSONRPCErrorError; }

/** Compatibility namespace for the former mechanical serde struct module. */
export interface execserverprotocol_Structs {
  configSnapshot: ExecServerConfigSnapshot;
  networkPolicy: NetworkPolicyDecisionRecord;
  networkAudit: NetworkPolicyAuditRecord;
  request: JSONRPCMessageRequest;
  notification: JSONRPCMessageNotification;
  response: JSONRPCMessageResponse;
  error: JSONRPCMessageError;
}
