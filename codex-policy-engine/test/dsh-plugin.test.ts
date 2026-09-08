import { describe, expect, it, vi } from 'vitest';
import {
  apply,
  type ExtensionDecisionAdapter,
  type ExtensionDecisionInput,
  type ExtensionRuntimeObserver,
} from '../src/index';
import { Policy } from '../src/policy';

const publicDecisionAdapter: ExtensionDecisionAdapter = {
  decide(input: ExtensionDecisionInput) {
    return input.signal.aborted
      ? { kind: 'deny', reason: 'cancelled' }
      : { kind: 'delegate' };
  },
};
const publicRuntimeObserver: ExtensionRuntimeObserver = { observe() {} };
void publicDecisionAdapter;
void publicRuntimeObserver;

function harness(config = {}) {
  const tools = new Map<string, any>();
  let preExecute: ((exec: any, next: () => unknown) => unknown) | undefined;
  let resultObserver: ((exec: any, result: unknown) => unknown) | undefined;
  const ctx = {
    tools: { register(tool: any) { tools.set(tool.name, tool); } },
    on(event: string, listener: any) {
      if (event === 'tools/pre-execute') preExecute = listener;
      if (event === 'tools/result') resultObserver = listener;
    },
  };
  apply(ctx, config);
  return {
    tools,
    run(exec: any, next = vi.fn(() => ({ kind: 'next' }))) {
      if (!preExecute) throw new Error('pre-execute listener was not registered');
      return { result: preExecute(exec, next), next };
    },
    observe(exec: any, result: unknown) {
      if (!resultObserver) throw new Error('result listener was not registered');
      return resultObserver(exec, result);
    },
  };
}

describe('dsh plugin adapter', () => {
  it('runs the dangerous-command inspection tool without a ReferenceError', async () => {
    const { tools } = harness();
    const tool = tools.get('codex_command_safety_check');
    const result = JSON.parse(await tool.execute({ command: 'rm -rf /' }));

    expect(result.match).toBe('ForcedRm');
    expect(result.command).toBe('rm -rf /');
  });

  it('passes non-command tools through the waterfall', () => {
    const h = harness({ mode: 'enforce' });
    const { result, next } = h.run({ name: 'read_file', arguments: {} });

    expect(result).toEqual({ kind: 'next' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('maps policy decisions to allow, deny, and ask', () => {
    const h = harness({
      mode: 'enforce',
      commandTools: ['shell'],
      rules: [
        { first: 'git', decision: 'Allow' },
        { first: 'shutdown', decision: 'Forbidden' },
      ],
    });

    expect(h.run({ name: 'shell', arguments: { command: 'git status' } }).result).toEqual({ kind: 'next' });
    expect(h.run({ name: 'shell', arguments: { command: 'shutdown now' } }).result).toMatchObject({ kind: 'deny' });
    expect(h.run({ name: 'shell', arguments: { command: 'echo hello' } }).result).toMatchObject({ kind: 'ask' });
  });

  it('caches static policy evaluation by canonical command without caching approval', () => {
    const check = vi.spyOn(Policy.prototype, 'check');
    const h = harness({ mode: 'enforce', commandTools: ['shell'] });

    const first = h.run({ name: 'shell', arguments: { command: '/bin/bash -lc "echo hello"' } }).result;
    const second = h.run({ name: 'shell', arguments: { command: 'bash -c "echo hello"' } }).result;
    const third = h.run({ name: 'shell', arguments: { command: 'echo different' } }).result;

    expect(first).toMatchObject({ kind: 'ask' });
    expect(second).toMatchObject({ kind: 'ask' });
    expect(third).toMatchObject({ kind: 'ask' });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('maps call-scoped extension decisions without bypassing the waterfall', async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({ kind: 'delegate' })
      .mockResolvedValueOnce({ kind: 'ask', reason: 'review this call' })
      .mockResolvedValueOnce({ kind: 'deny', reason: 'blocked by extension' });
    const h = harness({ decisionAdapter: { decide } });
    const base = {
      callId: 'call-1', rootCallId: 'root-1', name: 'shell',
      arguments: { command: 'echo hello' }, signal: new AbortController().signal,
    };

    const delegated = h.run(base);
    expect(await delegated.result).toEqual({ kind: 'next' });
    expect(delegated.next).toHaveBeenCalledOnce();
    expect(await h.run({ ...base, callId: 'call-2' }).result).toEqual({ kind: 'ask', reason: 'review this call' });
    expect(await h.run({ ...base, callId: 'call-3' }).result).toEqual({ kind: 'deny', reason: 'blocked by extension' });
    expect(decide).toHaveBeenNthCalledWith(1, expect.objectContaining({
      callId: 'call-1', rootCallId: 'root-1', toolName: 'shell', signal: base.signal,
    }));
  });

  it('fails closed when extension identity is missing or evaluation fails', async () => {
    const missing = harness({ decisionAdapter: { decide: vi.fn() } });
    expect(await missing.run({ name: 'shell', arguments: {} }).result).toMatchObject({ kind: 'deny' });

    const failing = harness({ decisionAdapter: { decide: () => { throw new Error('review unavailable'); } } });
    const result = await failing.run({
      callId: 'call-1', rootCallId: 'root-1', name: 'shell', arguments: {},
      signal: new AbortController().signal,
    }).result;
    expect(result).toEqual({
      kind: 'deny', reason: '[codex-policy-engine] extension decision failed closed: review unavailable',
    });
  });

  it('observes final runtime results separately from approval decisions', async () => {
    const observe = vi.fn();
    const h = harness({ runtimeObserver: { observe } });
    const result = Object.freeze({ isError: false, value: 'done' });

    h.observe({ callId: 'call-7', rootCallId: 'root-7', name: 'shell' }, result);
    await vi.waitFor(() => expect(observe).toHaveBeenCalledOnce());
    expect(observe).toHaveBeenCalledWith({
      callId: 'call-7', rootCallId: 'root-7', toolName: 'shell', result,
    });
  });
});
