import type { GraphNode, GraphEdge, TransactionGraph } from "@/lib/types"

// Minimal directed multigraph utility (NetworkX-equivalent subset in TS).
// Supports the traversal + structural metrics the intelligence engines need.
export class DirectedGraph {
  nodes = new Map<string, GraphNode>()
  edges: GraphEdge[] = []
  private out = new Map<string, GraphEdge[]>()
  private inc = new Map<string, GraphEdge[]>()

  addNode(node: GraphNode) {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node)
    else this.nodes.set(node.id, { ...this.nodes.get(node.id)!, ...node })
    if (!this.out.has(node.id)) this.out.set(node.id, [])
    if (!this.inc.has(node.id)) this.inc.set(node.id, [])
  }

  addEdge(edge: GraphEdge) {
    this.edges.push(edge)
    if (!this.out.has(edge.source)) this.out.set(edge.source, [])
    if (!this.inc.has(edge.target)) this.inc.set(edge.target, [])
    this.out.get(edge.source)!.push(edge)
    this.inc.get(edge.target)!.push(edge)
  }

  outEdges(id: string): GraphEdge[] {
    return this.out.get(id) ?? []
  }
  inEdges(id: string): GraphEdge[] {
    return this.inc.get(id) ?? []
  }
  outDegree(id: string): number {
    return this.outEdges(id).length
  }
  inDegree(id: string): number {
    return this.inEdges(id).length
  }

  // BFS to bounded depth from a root; returns depth map (prevents infinite tracing).
  bfsDepth(root: string, maxDepth: number): Map<string, number> {
    const depth = new Map<string, number>([[root, 0]])
    const queue: string[] = [root]
    while (queue.length) {
      const cur = queue.shift()!
      const d = depth.get(cur)!
      if (d >= maxDepth) continue
      for (const e of this.outEdges(cur)) {
        if (!depth.has(e.target)) {
          depth.set(e.target, d + 1)
          queue.push(e.target)
        }
      }
    }
    return depth
  }

  // Return the subgraph reachable within maxDepth of root.
  subgraphWithinDepth(root: string, maxDepth: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const depth = this.bfsDepth(root, maxDepth)
    const nodes: GraphNode[] = []
    for (const [id, d] of depth) {
      const n = this.nodes.get(id)
      if (n) nodes.push({ ...n, depth: d })
    }
    const idSet = new Set(depth.keys())
    const edges = this.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target))
    return { nodes, edges }
  }

  // Weighted longest-path style flow tracing to leaf/exit nodes.
  tracePaths(root: string, maxDepth: number): GraphEdge[][] {
    const paths: GraphEdge[][] = []
    const walk = (node: string, depth: number, acc: GraphEdge[], visited: Set<string>) => {
      if (depth >= maxDepth) {
        if (acc.length) paths.push([...acc])
        return
      }
      const outs = this.outEdges(node).filter((e) => !visited.has(e.id))
      if (outs.length === 0) {
        if (acc.length) paths.push([...acc])
        return
      }
      for (const e of outs) {
        visited.add(e.id)
        acc.push(e)
        walk(e.target, depth + 1, acc, visited)
        acc.pop()
        visited.delete(e.id)
      }
    }
    walk(root, 0, [], new Set())
    return paths
  }
}

export function buildGraph(nodes: GraphNode[], edges: GraphEdge[]): DirectedGraph {
  const g = new DirectedGraph()
  nodes.forEach((n) => g.addNode(n))
  edges.forEach((e) => g.addEdge(e))
  return g
}

// Deterministic layered layout for SVG rendering (root at left, by depth).
export function layoutGraph(
  graph: TransactionGraph,
  width = 1000,
  height = 620,
): Record<string, { x: number; y: number }> {
  const g = buildGraph(graph.nodes, graph.edges)
  const depthMap = g.bfsDepth(graph.rootAddress, graph.depth + 2)
  const byDepth = new Map<number, string[]>()
  for (const node of graph.nodes) {
    const d = depthMap.get(node.id) ?? node.depth ?? 0
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(node.id)
  }
  const maxDepth = Math.max(1, ...Array.from(byDepth.keys()))
  const pos: Record<string, { x: number; y: number }> = {}
  const marginX = 90
  const usableW = width - marginX * 2
  for (const [d, ids] of byDepth) {
    const x = marginX + (usableW * d) / maxDepth
    const count = ids.length
    ids.forEach((id, i) => {
      const y = count === 1 ? height / 2 : 60 + ((height - 120) * i) / (count - 1)
      pos[id] = { x, y }
    })
  }
  return pos
}
