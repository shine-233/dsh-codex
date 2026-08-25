// @ts-nocheck
// 机械翻译件：语义待复核（见 README M1 状态）
// Mechanical serde->TS translation from openai/codex exec-server-protocol (Apache-2.0).
export interface ExecServerNetworkPolicyDecisionDeny { type: 'Deny';     reason: string; }
export interface ExecServerNetworkPolicyDecisionAsk { type: 'Ask';     reason: string; }
export interface RequestIdString { None: 'String';  }
export interface RequestIdInteger { None: 'Integer';  }
export interface JSONRPCMessageRequest { None: 'Request';  }
export interface JSONRPCMessageNotification { None: 'Notification';  }
export interface JSONRPCMessageResponse { None: 'Response';  }
export interface JSONRPCMessageError { None: 'Error';  }

export interface execserverprotocol_Structs {
  cwd: PathUri;
  configPaths: string[][];
  requirementsPaths: string[][];
  userHomeDir?: PathUri | null;
  codexHomeDir: PathUri;
  hostname?: string | null;
  config: EnvironmentConfigLayerStack;
  requirements: EnvironmentConfigLayerStack;
  layers: EnvironmentConfigLayer[];
  cloudInsertionIndex: number;
  source: string;
  baseDir: PathUri;
  toml: string;
  processId: ProcessId;
  request: ExecServerNetworkPolicyRequest;
  protocol: ExecServerNetworkProtocol;
  host: string;
  port: number;
  processId: ProcessId;
  timestamp: string;
  scope: string;
  decision: string;
  source: string;
  reason: string;
  protocol: ExecServerNetworkProtocol;
  host: string;
  port: number;
  method?: string | null;
  client?: string | null;
  policyOverride: boolean;

  decision: ExecServerNetworkPolicyDecision;
  id: RequestId;
  method: string;
  params?: unknown | null;
  trace?: W3cTraceContext | null;
  method: string;
  params?: unknown | null;
  id: RequestId;
  result: Result;
  error: JSONRPCErrorError;
  id: RequestId;
  code: number;
  data?: unknown | null;
  message: string;
}
