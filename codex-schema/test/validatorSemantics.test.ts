import { describe, it, expect } from 'vitest';
import { validateExtensionToolSpec } from '../src/handwritten/extension-api/validate';
import { validateRolloutItem } from '../src/handwritten/history/validate';
import {
  validateUserInput, validateParsedCommand, validateRawFileSystemPath,
  validateEnvironmentConfigState, validateReasoningEffort,
} from '../src/handwritten/protocol/validate';
import { validateNetworkPolicyDecision, validateRequestId, validateJSONRPCMessage } from '../src/handwritten/exec-server-protocol/validate';
import {
  validateWireContentItem, validateWireRuntimeResponse,
  validateWaitOutcome, validateExecuteToPendingOutcome,
} from '../src/handwritten/code-mode-protocol/validate';

/**
 * Semantic-lock suite: pins the CURRENT guard behavior (ok/variant/type
 * classes incl. the un-asserted corners) before the P2-2 zod formalization.
 * These assertions must hold identically after the rewrite.
 */
describe('SEMLOCK extension-api', () => {
  it('non-objects (incl. arrays) → variant null', () => {
    for (const bad of ['x', null, 42, [], true]) {
      const r = validateExtensionToolSpec(bad);
      expect(r.ok).toBe(false);
      expect(r.variant).toBeNull();
    }
  });
  it('object shape: variant tool_spec on both pass and field-fail', () => {
    expect(validateExtensionToolSpec({}).variant).toBe('tool_spec');
    expect(validateExtensionToolSpec({ name: 'a.b-c_d9', description: 'd', inputSchema: {}, deferLoading: true }).ok).toBe(true);
  });
  it('name regex, inputSchema object-lax (arrays pass), deferLoading boolean', () => {
    expect(validateExtensionToolSpec({ name: 'bad name!', description: 'd', inputSchema: {}, deferLoading: true }).ok).toBe(false);
    expect(validateExtensionToolSpec({ name: '', description: 'd', inputSchema: {}, deferLoading: true }).ok).toBe(false);
    expect(validateExtensionToolSpec({ name: 'ok', description: 'd', inputSchema: [], deferLoading: true }).ok).toBe(true);
    expect(validateExtensionToolSpec({ name: 'ok', description: 'd', inputSchema: null, deferLoading: true }).ok).toBe(false);
    expect(validateExtensionToolSpec({ name: 'ok', description: 'd', inputSchema: {}, deferLoading: 0 }).ok).toBe(false);
    expect(validateExtensionToolSpec({ name: 'ok', description: 'd', inputSchema: {}, deferLoading: false, extra: 1 }).ok).toBe(true);
  });
});

describe('SEMLOCK history envelope', () => {
  it('non-object / missing / non-string type', () => {
    expect(validateRolloutItem('x').error).toBe('line is not an object');
    expect(validateRolloutItem({}).error).toBe('missing string `type`');
    expect(validateRolloutItem({ type: 123 }).type).toBeNull();
  });
  it('session_meta payload-optional; others require payload member', () => {
    expect(validateRolloutItem({ type: 'session_meta' }).ok).toBe(true);
    const r = validateRolloutItem({ type: 'response_item' });
    expect(r.ok).toBe(false);
    expect(r.type).toBe('response_item');
  });
  it('token_usage_record / realtime_item payloads must be objects (arrays fail); event_msg payload lax', () => {
    expect(validateRolloutItem({ type: 'token_usage_record', payload: 'x' }).ok).toBe(false);
    expect(validateRolloutItem({ type: 'realtime_item', payload: [] }).ok).toBe(false);
    expect(validateRolloutItem({ type: 'event_msg', payload: 42 }).ok).toBe(true);
  });
  it('unknown type → type null; extra keys tolerated', () => {
    expect(validateRolloutItem({ type: 'mystery_kind', payload: {} }).type).toBeNull();
    expect(validateRolloutItem({ type: 'compacted', payload: null, junk: 1 }).ok).toBe(true);
  });
});

describe('SEMLOCK protocol', () => {
  it('UserInput presence-vs-typed fields', () => {
    expect(validateUserInput({ type: 'LocalImage' }).ok).toBe(false);
    expect(validateUserInput({ type: 'LocalImage', path: null }).ok).toBe(true);
    expect(validateUserInput({ type: 'LocalImage', path: undefined }).ok).toBe(false);
    expect(validateUserInput({ type: 'Text', text: 123 }).ok).toBe(false);
    expect(validateUserInput({ type: 'Mention', name: 'n', path: 7 }).ok).toBe(false);
    expect(validateUserInput({ type: 'Skill', name: 's' }).ok).toBe(false);
  });
  it('ParsedCommand optional fields accept null but not other non-strings', () => {
    expect(validateParsedCommand({ type: 'ListFiles', cmd: 'ls', path: null }).ok).toBe(true);
    expect(validateParsedCommand({ type: 'Search', cmd: 'g', query: 5 }).ok).toBe(false);
    expect(validateParsedCommand({ type: 'Unknown', cmd: null }).ok).toBe(false);
  });
  it('RawFileSystemPath: Path tag-only; Special presence (null ok)', () => {
    expect(validateRawFileSystemPath({ type: 'Path', anything: 1 }).ok).toBe(true);
    expect(validateRawFileSystemPath({ type: 'Special' }).ok).toBe(false);
    expect(validateRawFileSystemPath({ type: 'Special', value: null }).ok).toBe(true);
  });
  it('EnvironmentConfigState: None-tagged, 4 variants, tag-only', () => {
    expect(validateEnvironmentConfigState({ None: 'Pending' }).variant).toBe('Pending');
    expect(validateEnvironmentConfigState({ None: 'Ready', extra: 1 }).ok).toBe(true);
    expect(validateEnvironmentConfigState('x').ok).toBe(false);
    expect(validateEnvironmentConfigState({ None: 123 }).variant).toBeNull();
  });
  it('ReasoningEffort: string variants / Custom object / others fail', () => {
    expect(validateReasoningEffort('XHigh').variant).toBe('XHigh');
    expect(validateReasoningEffort({ Custom: 'x' }).variant).toBe('Custom');
    expect(validateReasoningEffort({ Custom: 1 }).ok).toBe(false);
    expect(validateReasoningEffort(42).ok).toBe(false);
    expect(validateReasoningEffort(['High']).ok).toBe(false);
  });
});

describe('SEMLOCK exec-server-protocol', () => {
  it('NetworkPolicyDecision: isStr reason (null fails); unknown variant tagged', () => {
    expect(validateNetworkPolicyDecision({ type: 'Deny', reason: null }).ok).toBe(false);
    expect(validateNetworkPolicyDecision({ type: 'Ask', reason: 'r' }).variant).toBe('Ask');
    expect(validateNetworkPolicyDecision({ type: 'Allow' }).variant).toBe('Allow');
  });
  it('RequestId: None-tagged String|Integer; missing tag → unknown-variant error path', () => {
    expect(validateRequestId({ None: 'String' }).variant).toBe('String');
    expect(validateRequestId({}).variant).toBeNull();
  });
  it('JSONRPCMessage Response: defined-check (explicit undefined fails, error:{} passes)', () => {
    expect(validateJSONRPCMessage({ None: 'Response', result: undefined }).ok).toBe(false);
    expect(validateJSONRPCMessage({ None: 'Response', error: {} }).ok).toBe(true);
    expect(validateJSONRPCMessage({ None: 'Error', error: { code: '1', message: 'm' } }).ok).toBe(false);
    expect(validateJSONRPCMessage({ None: 'Error', error: { code: 1 } }).ok).toBe(false);
    expect(validateJSONRPCMessage({ None: 'Notification' }).variant).toBe('Notification');
  });
});

describe('SEMLOCK code-mode-protocol', () => {
  it('WireContentItem typed payloads (null fails)', () => {
    expect(validateWireContentItem({ type: 'InputText', text: null }).ok).toBe(false);
  });
  it('requireFields is key-presence: explicit undefined passes, missing fails', () => {
    expect(validateWireRuntimeResponse({ None: 'Result', cell_id: 'c', content_items: [], error_text: undefined }).ok).toBe(true);
    expect(validateWireRuntimeResponse({ None: 'Yielded', cell_id: 'c' }).ok).toBe(false);
    expect(validateExecuteToPendingOutcome({ None: 'Completed', junk: 1 }).ok).toBe(true);
    expect(validateWaitOutcome({ None: 'LiveCell', junk: 1 }).variant).toBe('LiveCell');
  });
});
