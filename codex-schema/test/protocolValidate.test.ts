import { describe, it, expect } from 'vitest';
import {
  validateUserInput, validateParsedCommand, validateRawFileSystemPath,
  validateEnvironmentConfigState, validateReasoningEffort,
} from '../src/handwritten/protocol/validate';
import {
  validateEnvironmentInfo,
  validateNetworkPolicyDecision,
  validateRequestId,
  validateJSONRPCMessage,
} from '../src/handwritten/exec-server-protocol/validate';
import {
  validateWireContentItem, validateWireRuntimeResponse, validateRuntimeResponse,
  validateWaitOutcome, validateExecuteToPendingOutcome, validateFunctionCallOutputContentItem,
} from '../src/handwritten/code-mode-protocol/validate';

describe('protocol validators (M1 → executable)', () => {
  it('UserInput: accepts all seven variants, rejects missing fields', () => {
    expect(validateUserInput({ type: 'Text', text: 'hi' }).ok).toBe(true);
    expect(validateUserInput({ type: 'Image', imageUrl: 'u' }).ok).toBe(true);
    expect(validateUserInput({ type: 'Skill', name: 's', path: 'p' }).ok).toBe(true);
    expect(validateUserInput({ type: 'Text' }).ok).toBe(false);
    expect(validateUserInput({ type: 'Mystery' }).ok).toBe(false);
    expect(validateUserInput('x').ok).toBe(false);
  });
  it('ParsedCommand: four variants', () => {
    expect(validateParsedCommand({ type: 'Read', cmd: 'ls' }).ok).toBe(true);
    expect(validateParsedCommand({ type: 'Search', cmd: 'grep', query: 'x', path: null }).ok).toBe(true);
    expect(validateParsedCommand({ type: 'Unknown' }).ok).toBe(false);
  });
  it('RawFileSystemPath: GlobPattern requires pattern', () => {
    expect(validateRawFileSystemPath({ type: 'Path' }).ok).toBe(true);
    expect(validateRawFileSystemPath({ type: 'GlobPattern' }).ok).toBe(false);
    expect(validateRawFileSystemPath({ type: 'GlobPattern', pattern: '*.ts' }).ok).toBe(true);
  });
  it('EnvironmentConfigState includes the 0.153.4 FromThread variant', () => {
    expect(validateEnvironmentConfigState({ None: 'FromThread' }).ok).toBe(true);
    expect(validateEnvironmentConfigState({ None: 'Ready' }).ok).toBe(true);
    expect(validateEnvironmentConfigState({ None: 'Bogus' }).ok).toBe(false);
  });
  it('ReasoningEffort: full 0.153.4 variant set incl. Persistent and Custom payload', () => {
    expect(validateReasoningEffort('High').ok).toBe(true);
    expect(validateReasoningEffort('Persistent').ok).toBe(true);
    expect(validateReasoningEffort({ Custom: 'extreme' }).ok).toBe(true);
    expect(validateReasoningEffort('Bogus').ok).toBe(false);
  });
});

describe('exec-server-protocol validators (M1 → executable)', () => {
  it('EnvironmentInfo accepts legacy metadata and optional opaque providerId', () => {
    const legacy = {
      shell: { name: 'powershell', path: 'powershell.exe' },
      executorVersion: '0.0.0',
      cwd: null,
    };
    expect(validateEnvironmentInfo(legacy).ok).toBe(true);
    expect(validateEnvironmentInfo({
      ...legacy,
      providerId: 'sha256:e0a0cebe63ab8189ffe3eed378ccf6aa89ef15bc75e39dbbf1fc55951ec6888b',
    }).ok).toBe(true);
    expect(validateEnvironmentInfo({ ...legacy, providerId: 42 }).ok).toBe(false);
    expect(validateEnvironmentInfo({ executorVersion: '1.2.3' }).ok).toBe(false);
  });
  it('NetworkPolicyDecision: Deny/Ask both require reason', () => {
    expect(validateNetworkPolicyDecision({ type: 'Deny', reason: 'r' }).ok).toBe(true);
    expect(validateNetworkPolicyDecision({ type: 'Ask' }).ok).toBe(false);
    expect(validateNetworkPolicyDecision({ type: 'Allow' }).ok).toBe(false);
  });
  it('RequestId: String/Integer', () => {
    expect(validateRequestId({ None: 'String' }).ok).toBe(true);
    expect(validateRequestId({ None: 'Integer' }).ok).toBe(true);
    expect(validateRequestId({ None: 'Float' }).ok).toBe(false);
  });
  it('JSONRPCMessage: Response needs result/error; Error needs code+message', () => {
    expect(validateJSONRPCMessage({ None: 'Request' }).ok).toBe(true);
    expect(validateJSONRPCMessage({ None: 'Response', result: {} }).ok).toBe(true);
    expect(validateJSONRPCMessage({ None: 'Response' }).ok).toBe(false);
    expect(validateJSONRPCMessage({ None: 'Error', error: { code: 1, message: 'm' } }).ok).toBe(true);
    expect(validateJSONRPCMessage({ None: 'Error', error: { message: 'm' } }).ok).toBe(false);
  });
});

describe('code-mode-protocol validators (M1 → executable)', () => {
  it('WireContentItem: three variants with typed payloads', () => {
    expect(validateWireContentItem({ type: 'InputText', text: 'x' }).ok).toBe(true);
    expect(validateWireContentItem({ type: 'InputImage' }).ok).toBe(false);
  });
  it('WireRuntimeResponse: variants carry cell_id + content_items; Result adds error_text', () => {
    const base = { cell_id: 'c1', content_items: [] };
    expect(validateWireRuntimeResponse({ None: 'Yielded', ...base }).ok).toBe(true);
    expect(validateWireRuntimeResponse({ None: 'Result', ...base }).ok).toBe(false);
    expect(validateWireRuntimeResponse({ None: 'Result', ...base, error_text: null }).ok).toBe(true);
    expect(validateRuntimeResponse({ None: 'Terminated', ...base }).ok).toBe(true);
  });
  it('Wait/Execute outcomes', () => {
    expect(validateWaitOutcome({ None: 'LiveCell' }).ok).toBe(true);
    expect(validateExecuteToPendingOutcome({ None: 'Pending', cell_id: 'c', content_items: [], pending_tool_call_ids: [] }).ok).toBe(true);
    expect(validateExecuteToPendingOutcome({ None: 'Pending' }).ok).toBe(false);
    expect(validateFunctionCallOutputContentItem({ type: 'InputAudio', audioUrl: 'a' }).ok).toBe(true);
  });
});
