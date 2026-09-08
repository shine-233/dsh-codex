// Handwritten, compatibility-oriented subset of the openai/codex history wire
// shapes (Apache-2.0). Payloads that are not consumed by DSH remain unknown;
// this file does not claim full upstream history schema coverage.
import type { ResponseItem } from '../../generated/app-server-protocol/ResponseItem.js'
import type { ThreadId } from '../../generated/app-server-protocol/ThreadId.js'
import type { RealtimeItem, TokenUsageRecord } from '../protocol/types.js'

export type PathBuf = string
export interface CodexHarnessMetadata { [field: string]: unknown }
export interface McpResourceOrigin {
  call_id: string; turn_id?: string | null; tool: string; connector_id: string
  link_id?: string | null; uri: string; ambiguous_account?: boolean
}
export interface McpResourceOriginCheckpoint {
  origins: McpResourceOrigin[]; turns: string[]; current_turn_id?: string | null
}
export interface ResponseItemEnvelope { type: string; payload?: unknown; [field: string]: unknown }

export interface RolloutItemSessionMeta { None: 'SessionMeta'; payload?: unknown }
export interface RolloutItemResponseItem { None: 'ResponseItem'; payload?: ResponseItem }
export interface RolloutItemInterAgentCommunication { None: 'InterAgentCommunication'; payload?: unknown }
export interface RolloutItemInterAgentCommunicationMetadata {
  None: 'InterAgentCommunicationMetadata'; trigger_turn: boolean; payload?: unknown
}
export interface RolloutItemCompacted { None: 'Compacted'; payload?: unknown }
export interface RolloutItemTurnContext { None: 'TurnContext'; payload?: unknown }
export interface RolloutItemWorldState { None: 'WorldState'; payload?: unknown }
export interface RolloutItemSecurityRiskScore { None: 'SecurityRiskScore'; payload?: unknown }
export interface RolloutItemEventMsg { None: 'EventMsg'; payload?: unknown }
export interface RolloutItemTokenUsageRecord { None: 'TokenUsageRecord'; payload: TokenUsageRecord }
export interface RolloutItemRealtimeItem { None: 'RealtimeItem'; payload: RealtimeItem }
export type RolloutItem =
  | RolloutItemSessionMeta | RolloutItemResponseItem | RolloutItemInterAgentCommunication
  | RolloutItemInterAgentCommunicationMetadata | RolloutItemCompacted | RolloutItemTurnContext
  | RolloutItemWorldState | RolloutItemSecurityRiskScore | RolloutItemEventMsg
  | RolloutItemTokenUsageRecord | RolloutItemRealtimeItem

export interface InitialHistoryResumed { None: 'Resumed' }
export interface InitialHistoryForked { None: 'Forked' }
export type InitialHistory = InitialHistoryResumed | InitialHistoryForked
export interface WindowIdWireLegacyWindowNumber { None: 'LegacyWindowNumber'; window_number?: number }
export type WindowIdWire = string | WindowIdWireLegacyWindowNumber
export interface LegacyRolloutItemResponseItem { type: 'ResponseItem'; payload?: ResponseItem }
export interface LegacyRolloutItemCompacted { type: 'Compacted'; payload?: unknown }
export type LegacyRolloutItem = LegacyRolloutItemResponseItem | LegacyRolloutItemCompacted

export interface HistoryItemRecord { item: ResponseItem; metadata?: CodexHarnessMetadata | null; client_authored: boolean }
export interface CompactedHistoryRecord { message: string; replacement_history?: ResponseItemEnvelope[] | null; mcp_resource_origins?: McpResourceOriginCheckpoint | null }
export interface RolloutWindowRecord { window_number?: number | null; first_window_id?: string | null; previous_window_id?: string | null; window_id?: string | null; timestamp: string; ordinal?: number | null }
export interface InitialHistoryRecord { conversation_id: ThreadId; history: RolloutItem[]; rollout_path?: PathBuf | null; replacementHistory: ResponseItem[] }
/** Compatibility aggregate retained for callers importing the former symbol. */
export type history_Structs = HistoryItemRecord | CompactedHistoryRecord | RolloutWindowRecord | InitialHistoryRecord
