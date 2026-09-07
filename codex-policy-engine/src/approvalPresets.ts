// Port of openai/codex utils/approval-presets (Apache-2.0, rust-v0.153.4):
// built-in presets pairing an approval policy with a permission profile.
// These are the decision faces dsh's approval gate uses when the profile is
// derived from a preset instead of explicit rules.
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'
export type PermissionProfile = 'read-only' | 'workspace' | 'danger-full-access'

export interface ApprovalPreset {
  id: string
  label: string
  description: string
  approval: ApprovalPolicy
  activePermissionProfile: PermissionProfile
  permissionProfile: PermissionProfile
}

export const BUILT_IN_PRESETS: ApprovalPreset[] = [
  {
    id: 'read-only',
    label: 'Read Only',
    description: 'The agent can read files and answer questions; nothing is written.',
    approval: 'untrusted',
    activePermissionProfile: 'read-only',
    permissionProfile: 'read-only',
  },
  {
    id: 'workspace',
    label: 'Workspace Write',
    description: 'The agent can read files and make edits in the workspace.',
    approval: 'on-failure',
    activePermissionProfile: 'workspace',
    permissionProfile: 'workspace',
  },
  {
    id: 'danger-full-access',
    label: 'Danger Full Access',
    description: 'The agent can do anything without asking. Only use in a sandbox.',
    approval: 'never',
    activePermissionProfile: 'danger-full-access',
    permissionProfile: 'danger-full-access',
  },
]

export function presetById(id: string): ApprovalPreset | null {
  return BUILT_IN_PRESETS.find((p) => p.id === id) ?? null
}
