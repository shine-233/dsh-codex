// Mechanical serde->TS translation from openai/codex protocol (Apache-2.0).
// Stable handwritten union members used by DSH. The former flattened
// protocol_Structs aggregate was not type-safe (duplicate fields); it is now
// an open compatibility record until each upstream struct is named.
export type PlanType = 'Known' | 'Unknown' | string;
export type PathBuf = string;
export type PathUri = string;
export type FileSystemSpecialPath = string;
export type TokenUsage = Record<string, unknown>;
export type RealtimeItemContent = unknown;
export interface ProviderAccountChatgpt { None: 'Chatgpt'; email: string | null; plan_type: PlanType; }
export interface ProviderAccountAmazonBedrock { None: 'AmazonBedrock'; uses_codex_managed_credentials: boolean; }
export interface PlanTypeKnown { None: 'Known'; }
export interface PlanTypeUnknown { None: 'Unknown'; }
export interface CapabilityRootLocationEnvironment { type: 'Environment'; }
export interface DynamicToolSpecFunction { type: 'Function'; }
export interface DynamicToolSpecNamespace { type: 'Namespace'; }
export interface DynamicToolNamespaceToolFunction { type: 'Function'; }
export interface EnvironmentConfigStateReady { None: 'Ready'; }
export interface EnvironmentConfigStateFailed { None: 'Failed'; }
export interface EnvironmentConfigStateFromThread { None: 'FromThread'; }
export interface ExecutedToolCallArgumentsRaw { None: 'Raw'; serde_json: unknown; }
export interface ReasoningEffortCustom { None: 'Custom'; }
export interface ReasoningEffortPersistent { None: 'Persistent'; }
export interface TokenUsageRecord {
  thread_id: string; turn_id: string; session_id: string; root_turn_id: string;
  response_id: string; usage: TokenUsage; turn_token_usage: TokenUsage;
  thread_token_usage: TokenUsage;
}
export interface RealtimeItem { id: string; realtime_session_id: string; content: RealtimeItemContent; }
export interface ParsedCommandRead { type: 'Read'; cmd: string; name: string; path: PathBuf; }
export interface ParsedCommandListFiles { type: 'ListFiles'; cmd: string; path: string | null; }
export interface ParsedCommandSearch { type: 'Search'; cmd: string; query: string | null; path: string | null; }
export interface ParsedCommandUnknown { type: 'Unknown'; cmd: string; }
export interface FileSystemPathPath { None: 'Path'; path: PathUri; }
export interface FileSystemPathGlobPattern { None: 'GlobPattern'; pattern: string; }
export interface FileSystemPathSpecial { None: 'Special'; value: FileSystemSpecialPath; }
export interface RawFileSystemPathPath { type: 'Path'; }
export interface RawFileSystemPathGlobPattern { type: 'GlobPattern'; pattern: string; }
export interface RawFileSystemPathSpecial { type: 'Special'; value: FileSystemSpecialPath; }
export interface UserInputText { type: 'Text'; text: string; }
export interface UserInputImage { type: 'Image'; imageUrl: string; }
export interface UserInputLocalImage { type: 'LocalImage'; path: unknown; }
export interface UserInputAudio { type: 'Audio'; audioUrl: string; }
export interface UserInputLocalAudio { type: 'LocalAudio'; path: unknown; }
export interface UserInputSkill { type: 'Skill'; name: string; path: unknown; }
export interface UserInputMention { type: 'Mention'; name: string; path: string; }
/** Compatibility aggregate for consumers importing the old flattened output. */
export interface protocol_Structs { [field: string]: unknown; }
