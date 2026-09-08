// Distilled from openai/codex agent graph + multi-agent v2 roster handling
// (Apache-2.0, anchors rust-v0.153.4 and d665e3bbc): persisted nodes and
// spawn edges, plus bounded cold-resume context for loaded/unloaded children.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ThreadSpawnEdgeStatus = 'running' | 'completed' | 'failed'

export interface AgentNode {
  agentId: string
  label: string
  createdAt: number
  /** Canonical full path when the host uses multi-agent v2 (for example /root/worker). */
  agentPath?: string
}
export interface SpawnEdge { parentId: string; childId: string; status: ThreadSpawnEdgeStatus }

type AgentGraphOperation =
  | ({ op: 'node' } & AgentNode)
  | ({ op: 'edge' } & SpawnEdge)
  | { op: 'edge-status'; childId: string; status: ThreadSpawnEdgeStatus }

export const MAX_ENVIRONMENT_SUBAGENTS = 8
export const MAX_ENVIRONMENT_SUBAGENT_BYTES = 1024
const ROSTER_WRAPPER_BYTES = Buffer.byteLength('  <subagents>\n  </subagents>\n')

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** In-memory graph + JSONL event log (ops: spawn-node / spawn-edge / set-status). */
export class AgentGraphStore {
  private nodes = new Map<string, AgentNode>()
  private edges: SpawnEdge[] = []
  private log: AgentGraphOperation[] = []

  constructor(private filePath?: string) {
    if (filePath && existsSync(filePath)) {
      for (const line of readFileSync(filePath, 'utf8').split('\n').filter(Boolean)) {
        try { this.replay(JSON.parse(line)) } catch { /* tolerate bad lines */ }
      }
    }
  }

  private replay(op: AgentGraphOperation): void {
    this.log.push(op)
    if (op.op === 'node') this.nodes.set(op.agentId, op)
    if (op.op === 'edge') this.edges.push(op)
    if (op.op === 'edge-status') {
      for (let i = this.edges.length - 1; i >= 0; i--) {
        if (this.edges[i].childId === op.childId && this.edges[i].status === 'running') {
          this.edges[i].status = op.status
          break
        }
      }
    }
  }

  private persist(op: AgentGraphOperation): void {
    if (!this.filePath) return
    if (!existsSync(this.filePath)) mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(op) + '\n', { flag: 'a' })
  }

  addAgent(agentId: string, label: string, agentPath?: string): AgentNode {
    const node: AgentNode = { agentId, label, createdAt: Date.now(), ...(agentPath ? { agentPath } : {}) }
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

  /**
   * Render persisted direct children for multi-agent v2 environment context.
   * Loaded children sort first; both groups sort by full path. The returned
   * lines fit inside the upstream 8-agent / 1,024-byte roster envelope.
   */
  formatEnvironmentContextSubagents(parentId: string, loadedAgentIds: Iterable<string>): string {
    const parentPath = this.nodes.get(parentId)?.agentPath
    if (typeof parentPath !== 'string') return ''

    const childPathPrefix = `${parentPath}/`
    const loaded = new Set(loadedAgentIds)
    const childrenById = new Map<string, AgentNode>()
    for (const edge of this.childrenOf(parentId)) {
      const node = this.nodes.get(edge.childId)
      if (typeof node?.agentPath !== 'string' || !node.agentPath.startsWith(childPathPrefix)) continue
      const relativePath = node.agentPath.slice(childPathPrefix.length)
      if (relativePath && !relativePath.includes('/')) childrenById.set(node.agentId, node)
    }
    const children = [...childrenById.values()].sort((left, right) => {
      const loadedOrder = Number(!loaded.has(left.agentId)) - Number(!loaded.has(right.agentId))
      if (loadedOrder) return loadedOrder
      if (left.agentPath! < right.agentPath!) return -1
      if (left.agentPath! > right.agentPath!) return 1
      return 0
    })

    const lines: string[] = []
    let renderedBytes = ROSTER_WRAPPER_BYTES
    for (const child of children) {
      if (lines.length === MAX_ENVIRONMENT_SUBAGENTS) break
      const line = `<agent name="${escapeXmlAttribute(child.agentPath!)}" />`
      const lineBytes = Buffer.byteLength(`    ${line}\n`)
      if (renderedBytes + lineBytes <= MAX_ENVIRONMENT_SUBAGENT_BYTES) {
        renderedBytes += lineBytes
        lines.push(line)
      }
    }
    return lines.join('\n')
  }

  childrenOf(agentId: string): SpawnEdge[] { return this.edges.filter((e) => e.parentId === agentId) }
  nodeCount(): number { return this.nodes.size }
  edgeCount(): number { return this.edges.length }
}
