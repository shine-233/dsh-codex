// @ts-nocheck
// 机械翻译件：语义待复核（见 README M1 状态）
// Mechanical serde->TS translation from openai/codex protocol (Apache-2.0).
export interface ProviderAccountChatgpt { None: 'Chatgpt';     email: string | null;     plan_type: PlanType; }
export interface ProviderAccountAmazonBedrock { None: 'AmazonBedrock';     uses_codex_managed_credentials: boolean; }
export interface PlanTypeKnown { None: 'Known';  }
export interface PlanTypeUnknown { None: 'Unknown';  }
export interface CapabilityRootLocationEnvironment { type: 'Environment';  }
export interface DynamicToolSpecFunction { type: 'Function';  }
export interface DynamicToolSpecNamespace { type: 'Namespace';  }
export interface DynamicToolNamespaceToolFunction { type: 'Function';  }
export interface EnvironmentConfigStateReady { None: 'Ready';  }
export interface EnvironmentConfigStateFailed { None: 'Failed';  }
export interface ExecutedToolCallArgumentsRaw { None: 'Raw';     serde_json: unknown /* :Value */; }
export interface ReasoningEffortCustom { None: 'Custom';  }
export interface ParsedCommandRead { type: 'Read';     cmd: string;     name: string;     path: PathBuf; }
export interface ParsedCommandListFiles { type: 'ListFiles';     cmd: string;     path: string | null; }
export interface ParsedCommandSearch { type: 'Search';     cmd: string;     query: string | null;     path: string | null; }
export interface ParsedCommandUnknown { type: 'Unknown';     cmd: string; }
export interface FileSystemPathPath { None: 'Path';     path: PathUri; }
export interface FileSystemPathGlobPattern { None: 'GlobPattern';     pattern: string; }
export interface FileSystemPathSpecial { None: 'Special';     value: FileSystemSpecialPath; }
export interface RawFileSystemPathPath { type: 'Path';  }
export interface RawFileSystemPathGlobPattern { type: 'GlobPattern';     pattern: string; }
export interface RawFileSystemPathSpecial { type: 'Special';     value: FileSystemSpecialPath; }
export interface UserInputText { type: 'Text';     text: string; }
export interface UserInputImage { type: 'Image';     imageUrl: string; }
export interface UserInputLocalImage { type: 'LocalImage';     path: unknown /* std::path::PathBuf */; }
export interface UserInputAudio { type: 'Audio';     audioUrl: string; }
export interface UserInputLocalAudio { type: 'LocalAudio';     path: unknown /* std::path::PathBuf */; }
export interface UserInputSkill { type: 'Skill';     name: string;     path: unknown /* std::path::PathBuf */; }
export interface UserInputMention { type: 'Mention';     name: string;     path: string; }

export interface protocol_Structs {
  reason: RefreshTokenFailedReason;
  message: string;

  id: string;
  location: CapabilityRootLocation;
  name: string;
  description: string;
  inputSchema: unknown;
  deferLoading: boolean;
  name: string;
  description: string;
  tools: DynamicToolNamespaceTool[];
  callId: string;
  turnId: string;
  startedAtMs: number;
  namespace?: string | null;
  tool: string;
  arguments: unknown;
  contentItems: DynamicToolCallOutputContentItem[];
  success: boolean;
  namespace?: string | null;
  name: string;
  description: string;
  inputSchema: unknown;
  deferLoading?: boolean | null;
  exposeToContext?: boolean | null;
  allow_login_shell: boolean;
  permission_profile: PermissionProfileSnapshot;
  shell_environment_policy: ShellEnvironmentPolicy;
  exec_policy?: RequirementsExecPolicy | null;
  mcp_policy?: EnvironmentMcpPolicy | null;
  network_policy?: EnvironmentNetworkPolicy | null;
  selected_capability_roots: SelectedCapabilityRoot[];
  source: HttpError;
  source: HttpError;
  request_id?: string | null;
  status: StatusCode;
  body: string;
  user_message?: string | null;
  url?: string | null;
  cf_ray?: string | null;
  request_id?: string | null;
  identity_authorization_error?: string | null;
  identity_error_code?: string | null;
  status: StatusCode;
  request_id?: string | null;
  plan_type?: PlanType | null;
  resets_at?: unknown /* DateTime<Utc> */ | null;
  rate_limits?: RateLimitSnapshot | null;
  promo_message?: string | null;
  rate_limit_reached_type?: RateLimitReachedType | null;
  text: T;
  truncated_after_lines?: number | null;
  exit_code: number;
  stdout: unknown /* StreamOutput<String> */;
  stderr: unknown /* StreamOutput<String> */;
  aggregated_output: unknown /* StreamOutput<String> */;
  duration: Duration;
  timed_out: boolean;
  entries: MemoryCitationEntry[];
  rolloutIds: string[];
  path: string;
  lineStart: number;
  lineEnd: number;
  note: string;
  name: string;
  arguments: ExecutedToolCallArguments;
  original_bytes: number;
  max_bytes: number;
  omitted_calls?: number | null;
  original_name_bytes?: number | null;
  decision: NetworkPolicyDecision;
  source: NetworkDecisionSource;
  protocol?: NetworkApprovalProtocol | null;
  host?: string | null;
  reason?: string | null;
  port?: number | null;

  effort: ReasoningEffort;
  description: string;
  id: string;
  migration_config_key: string;
  model_link?: string | null;
  upgrade_copy?: string | null;
  migration_markdown?: string | null;
  message: string;
  id: string;
  name: string;
  description: string;
  id: string;
  model: string;
  display_name: string;
  description: string;
  model_specialty?: string | null;
  default_reasoning_effort: ReasoningEffort;
  supported_reasoning_efforts: ReasoningEffortPreset[];
  supports_personality: boolean;
  additional_speed_tiers: string[];
  service_tiers: ModelServiceTier[];
  default_service_tier?: string | null;
  is_default: boolean;
  upgrade?: ModelUpgrade | null;
  show_in_picker: boolean;
  multi_agent_version?: MultiAgentVersion | null;
  availability_nux?: ModelAvailabilityNux | null;
  supported_in_api: boolean;
  input_modalities: InputModality[];

  'Freeform';


  mode: TruncationMode;
  limit: number;
  slug: string;
  display_name: string;
  description?: string | null;
  default_reasoning_level?: ReasoningEffort | null;
  supported_reasoning_levels: ReasoningEffortPreset[];
  shell_type: ConfigShellToolType;
  visibility: ModelVisibility;
  supported_in_api: boolean;
  priority: number;
  additional_speed_tiers: string[];
  service_tiers: ModelServiceTier[];
  default_service_tier?: string | null;
  availability_nux?: ModelAvailabilityNux | null;
  upgrade?: ModelInfoUpgrade | null;
  model_messages?: ModelMessages | null;
  include_skills_usage_instructions: boolean;
  include_plugin_usage_instructions: boolean;
  include_apps_usage_instructions: boolean;
  supports_reasoning_summary_parameter: boolean;
  default_reasoning_summary: ReasoningSummary;
  support_verbosity: boolean;
  default_verbosity?: Verbosity | null;
  apply_patch_tool_type?: ApplyPatchToolType | null;
  web_search_tool_type: WebSearchToolType;
  truncation_policy: TruncationPolicyConfig;
  supports_image_detail_original: boolean;
  context_window?: number | null;
  max_context_window?: number | null;
  auto_compact_token_limit?: number | null;
  comp_hash?: string | null;
  effective_context_window_percent: number;
  experimental_supported_tools: string[];
  input_modalities: InputModality[];
  used_fallback_model_metadata: boolean;
  supports_search_tool: boolean;
  use_responses_lite: boolean;
  node_repl_auto_review_required: boolean;
  node_repl_disabled: boolean;
  auto_review_model_override?: string | null;
  model_specialty?: string | null;
  instructions_template?: string | null;
  instructions_variables?: ModelInstructionsVariables | null;
  approvals?: ApprovalMessages | null;
  collaboration_modes?: CollaborationModeMessages | null;
  auto_review?: AutoReviewMessages | null;
  permissions?: PermissionMessages | null;
  multi_agent?: MultiAgentMessages | null;
  token_budget?: ModelTokenBudgetConfig | null;
  guardian_v2?: GuardianV2ModelConfig | null;
  reminder_threshold_tokens: number;
  reminder_message_template: string;
  guidance_message: string;
  auto_compact_fallback_prompt: string;
  auto_compact_fallback_buffer_tokens: number;
  on_request?: string | null;
  on_request_auto_review?: string | null;
  never?: string | null;
  unless_trusted?: string | null;
  default?: string | null;
  plan?: string | null;
  policy?: string | null;
  policy_template?: string | null;
  rejection_instructions?: string | null;
  timeout_instructions?: string | null;
  danger_full_access?: string | null;
  workspace_write?: string | null;
  read_only?: string | null;
  role?: MultiAgentRoleMessages | null;
  mode?: MultiAgentModeMessages | null;
  root?: string | null;
  subagent?: string | null;
  explicit?: string | null;
  hint_text?: string | null;
  personality_default?: string | null;
  personality_friendly?: string | null;
  personality_pragmatic?: string | null;
  model: string;
  migration_markdown: string;
  model: unknown /* &'a ModelInfo */;
  base_instructions: string;
  base_instructions?: string | null;
  model: ModelInfo;
  classifier_instructions?: string | null;
  review_threshold_basis_points?: number | null;
  max_tool_call_lag?: number | null;
  reasoning_effort?: ReasoningEffort | null;
  transcript?: GuardianV2TranscriptModelConfig | null;
  max_action_tokens?: number | null;
  max_classifier_instruction_tokens?: number | null;
  reuse_parent_compaction?: boolean | null;
  max_parent_compaction_tokens?: number | null;
  sources?: string[] | null;
  include_images?: boolean | null;
  max_message_entry_tokens?: number | null;
  max_tool_entry_tokens?: number | null;
  max_message_transcript_tokens?: number | null;
  max_tool_transcript_tokens?: number | null;
  max_recent_non_user_entries?: number | null;
  permission_profile: PermissionProfile;
  active_permission_profile?: ActivePermissionProfile | null;
  profile_workspace_roots: AbsolutePathBuf[];
  path: FileSystemPath;
  access: FileSystemAccessMode;
  missing_path_behavior?: FileSystemSandboxEntryMissingPathBehavior | null;
  path: RawFileSystemPath;
  access: FileSystemAccessMode;
  missing_path_behavior?: FileSystemSandboxEntryMissingPathBehavior | null;
  'Skip';
  kind: FileSystemSandboxKind;
  globScanMaxDepth?: number | null;
  entries: FileSystemSandboxEntry[];

  kind: FileSystemSandboxKind;
  glob_scan_max_depth?: number | null;
  entries: RawFileSystemSandboxEntry[];
  path: AbsolutePathBuf;
  access: FileSystemAccessMode;
  has_full_disk_read_access: boolean;
  has_full_disk_write_access: boolean;
  include_platform_defaults: boolean;
  readable_roots: AbsolutePathBuf[];
  writable_roots: WritableRoot[];
  unreadable_roots: AbsolutePathBuf[];
  unreadable_globs: string[];


  step: string;
  status: StepStatus;
  explanation?: string | null;
  plan: PlanItemArg[];
  network?: NetworkPermissions | null;
  fileSystem?: FileSystemPermissions | null;
  reason?: string | null;
  permissions: RequestPermissionProfile;
  permissions: RequestPermissionProfile;
  scope: PermissionGrantScope;
  strict_auto_review: boolean;
  call_id: string;
  turn_id: string;
  started_at_ms: number;
  reason?: string | null;
  permissions: RequestPermissionProfile;
  cwd?: AbsolutePathBuf | null;
  name: string;
  namespace?: string | null;
  byte_range: ByteRange;
  placeholder?: string | null;
  start: number;
  end: number;
}
