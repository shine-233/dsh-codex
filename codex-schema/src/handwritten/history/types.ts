// @ts-nocheck
// 机械翻译件：语义待复核（见 README M1 状态）
// Mechanical serde->TS translation from openai/codex history (Apache-2.0).
export interface RolloutItemSessionMeta { None: 'SessionMeta';  }
export interface RolloutItemResponseItem { None: 'ResponseItem';  }
export interface RolloutItemInterAgentCommunication { None: 'InterAgentCommunication';  }
export interface RolloutItemInterAgentCommunicationMetadata { None: 'InterAgentCommunicationMetadata';     trigger_turn: boolean; }
export interface RolloutItemCompacted { None: 'Compacted';  }
export interface RolloutItemTurnContext { None: 'TurnContext';  }
export interface RolloutItemWorldState { None: 'WorldState';  }
export interface RolloutItemSecurityRiskScore { None: 'SecurityRiskScore';  }
export interface RolloutItemEventMsg { None: 'EventMsg';  }
export interface InitialHistoryResumed { None: 'Resumed';  }
export interface InitialHistoryForked { None: 'Forked';  }
export interface WindowIdWireLegacyWindowNumber { None: 'LegacyWindowNumber';  }
export interface LegacyRolloutItemResponseItem { type: 'ResponseItem';  }
export interface LegacyRolloutItemCompacted { type: 'Compacted';  }

export interface history_Structs {
  item: ResponseItem;
  metadata?: CodexHarnessMetadata | null;
  client_authored: boolean;
  message: string;
  replacement_history?: ResponseItemEnvelope[] | null;
  mcp_resource_origins?: McpResourceOriginCheckpoint | null;
  window_number?: number | null;
  first_window_id?: string | null;
  previous_window_id?: string | null;
  window_id?: string | null;
  timestamp: string;
  ordinal?: number | null;
  item: RolloutItem;
  conversation_id: ThreadId;
  history: RolloutItem[];
  rollout_path?: PathBuf | null;
  replacementHistory: ResponseItem[];
}
