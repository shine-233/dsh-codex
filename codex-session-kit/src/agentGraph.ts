// Distilled from openai/codex agent-graph-store (Apache-2.0, rust-v0.153.4):
// agent nodes + spawn edges with status, persisted as JSONL (append-only log
// with a rebuilt graph view).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ThreadSpawnEdgeStatus = 'running' | 'completed' | 'failed'

export interface AgentNode { agentId: string; label: string; createdAt: number }
export interface SpawnEdge { parentId: string; childId: string; status: ThreadSpawnEdgeStatus }

/** In-memory graph + JSONL event log (ops: spawn-node / spawn-edge / set-status). */
export class AgentGraphStore {
  private nodes = new Map<string, AgentNode>()
  private edges: SpawnEdge[] = []
  private log: { op: string; [k: string]: unknown }[] = []

  constructor(private filePath?: string) {
    if (filePath && existsSync(filePath)) {
      for (const line of readFileSync(filePath, 'utf8').split('\n').filter(Boolean)) {
        try { this.replay(JSON.parse(line)) } catch { /* tolerate bad lines */ }
      }
    }
  }

  private replay(op: { op: string }): void {
    this.log.push(op)
    if (op.op === 'node') this.nodes.set(op.agentId as string, op as unknown as AgentNode)
    if (op.op === 'edge') this.edges.push(op as unknown as SpawnEdge)
    if (op.op === 'edge-status') {
      for (let i = this.edges.length - 1; i >= 0; i--) {
        if (this.edges[i].childId === op.childId && this.edges[i].status === 'running') {
          this.edges[i].status = op.status as ThreadSpawnEdgeStatus
          break
        }
      }
    }
  }

  private persist(op: { op: string }): void {
    if (!this.filePath) return
    if (!existsSync(this.filePath)) mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(op) + '\n', { flag: 'a' })
  }

  addAgent(agentId: string, label: string): AgentNode {
    const node: AgentNode = { agentId, label, createdAt: Date.now() }
    this.nodes.set(agentId, node)
    this.persist({ op: 'node', ...node })
    return node
  }

  addSpawnEdge(parentId: string, childId: string, status: ThreadSpawnEdgeStatus = 'running'): SpawnEdge {
    const edge: SpawnEdge = { parentId, childId, status }
    this.edges.push(edge)
    this.persist({ op: 'edge', ...edge })
    return edge
  }

  setEdgeStatus(childId: string, status: ThreadSpawnEdgeStatus): void {
    for (let i = this.edges.length - 1; i >= 0; i--) {
      if (this.edges[i].childId === childId) { this.edges[i].status = status; break }
    }
    this.persist({ op: 'edge-status', childId, status })
  }

  childrenOf(agentId: string): SpawnEdge[] { return this.edges.filter((e) => e.parentId === agentId) }
  nodeCount(): number { return this.nodes.size }
  edgeCount(): number { return this.edges.length }
}
