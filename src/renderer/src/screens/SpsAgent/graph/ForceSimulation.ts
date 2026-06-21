// ForceSimulation.ts — lightweight 2D force-directed layout engine.
// Euler integration solver for Coulomb repulsion, Hooke link attraction, and center gravity.

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  label: string;
  active?: boolean;
  fx?: number | null; // fixed position override (when dragging)
  fy?: number | null;
  icon?: string;
  isJournal?: boolean;
  isMatched?: boolean;
}

export interface SimEdge {
  source: string;
  target: string;
  type?: string;
}

export class ForceSimulation {
  nodes: SimNode[] = [];
  edges: SimEdge[] = [];
  width: number;
  height: number;

  // Physics constants
  charge = -760; // coulomb repulsion force
  linkStrength = 0.045; // spring stiffness
  linkRestLength = 132; // ideal spring distance
  gravity = 0.012; // gravity center-pull stiffness
  damping = 0.85; // velocity friction damping

  constructor(nodes: SimNode[], edges: SimEdge[], width = 640, height = 640) {
    this.width = width;
    this.height = height;
    this.setGraph(nodes, edges);
  }

  setGraph(nodes: SimNode[], edges: SimEdge[]) {
    // Preserve positions/velocities for existing nodes to maintain visual continuity.
    const prevMap = new Map<string, SimNode>();
    for (const n of this.nodes) {
      prevMap.set(n.id, n);
    }

    const cx = this.width / 2;
    const cy = this.height / 2;

    const count = Math.max(nodes.length, 1);
    const noLinkColumns = Math.max(
      1,
      Math.ceil(Math.sqrt(count * (this.width / Math.max(this.height, 1)))),
    );
    const noLinkRows = Math.max(1, Math.ceil(count / noLinkColumns));

    this.nodes = nodes.map((n, index) => {
      const prev = prevMap.get(n.id);
      if (prev) {
        return {
          ...n,
          x: prev.x,
          y: prev.y,
          vx: prev.vx,
          vy: prev.vy,
          fx: prev.fx,
          fy: prev.fy,
        };
      }
      const noLinkColumn = index % noLinkColumns;
      const noLinkRow = Math.floor(index / noLinkColumns);
      const noLinkX = ((noLinkColumn + 1) * this.width) / (noLinkColumns + 1);
      const noLinkY = ((noLinkRow + 1) * this.height) / (noLinkRows + 1);

      // Place new nodes deterministically instead of starting every label in
      // a tight center clump. Isolated graphs use a tidy island grid.
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const maxSpread = Math.min(this.width, this.height) * 0.44;
      const radius =
        count === 1 ? 0 : maxSpread * Math.sqrt((index + 1) / count);
      return {
        ...n,
        x: edges.length === 0 ? noLinkX : cx + Math.cos(angle) * radius,
        y: edges.length === 0 ? noLinkY : cy + Math.sin(angle) * radius * 0.78,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      };
    });

    this.edges = edges;
  }

  tick() {
    const nodes = this.nodes;
    const edges = this.edges;
    const n = nodes.length;

    // 1. Repel nodes (Coulomb's Law: F = k / d^2)
    for (let i = 0; i < n; i++) {
      const u = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const v = nodes[j];
        let dx = v.x - u.x;
        const dy = v.y - u.y;
        if (dx === 0) dx = 0.1; // avoid division by zero
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq) || 0.1;

        // Force is inversely proportional to distance squared
        const force = this.charge / Math.max(distSq, 100);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (u.fx === null) {
          u.vx += fx;
          u.vy += fy;
        }
        if (v.fx === null) {
          v.vx -= fx;
          v.vy -= fy;
        }
      }
    }

    // 2. Attract connected nodes (Hooke's Law: F = k * (d - d0))
    const nodeMap = new Map<string, SimNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    for (const edge of edges) {
      const u = nodeMap.get(edge.source);
      const v = nodeMap.get(edge.target);
      if (!u || !v) continue;

      let dx = v.x - u.x;
      const dy = v.y - u.y;
      if (dx === 0) dx = 0.1;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;

      const force = (dist - this.linkRestLength) * this.linkStrength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (u.fx === null) {
        u.vx += fx;
        u.vy += fy;
      }
      if (v.fx === null) {
        v.vx -= fx;
        v.vy -= fy;
      }
    }

    // 2.5. Collision resolution to prevent overlaps
    for (let i = 0; i < n; i++) {
      const u = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const v = nodes[j];
        let dx = v.x - u.x;
        const dy = v.y - u.y;
        if (dx === 0) dx = 0.1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const minDist = u.r + v.r + 64; // radii + label safety margin
        if (dist < minDist) {
          const overlap = minDist - dist;
          const forceX = (dx / dist) * overlap * 0.22;
          const forceY = (dy / dist) * overlap * 0.22;
          if (u.fx === null) {
            u.vx -= forceX;
            u.vy -= forceY;
          }
          if (v.fx === null) {
            v.vx += forceX;
            v.vy += forceY;
          }
        }
      }
    }

    // 3. Center pull and update positions (Euler integration)
    const cx = this.width / 2;
    const cy = this.height / 2;

    for (const node of nodes) {
      if (node.fx !== null && node.fx !== undefined) {
        node.x = node.fx;
        node.y = node.fy!;
        node.vx = 0;
        node.vy = 0;
      } else {
        // Center gravity, or a stable spread target for empty/no-link graphs.
        if (edges.length === 0 && n > 1) {
          const index = nodes.indexOf(node);
          const columns = Math.max(
            1,
            Math.ceil(Math.sqrt(n * (this.width / Math.max(this.height, 1)))),
          );
          const rows = Math.max(1, Math.ceil(n / columns));
          const column = index % columns;
          const row = Math.floor(index / columns);
          const targetX = ((column + 1) * this.width) / (columns + 1);
          const targetY = ((row + 1) * this.height) / (rows + 1);
          node.vx += (targetX - node.x) * 0.05;
          node.vy += (targetY - node.y) * 0.05;
        } else {
          node.vx += (cx - node.x) * this.gravity;
          node.vy += (cy - node.y) * this.gravity;
        }

        // Update position
        node.x += node.vx;
        node.y += node.vy;

        // Apply friction damping
        node.vx *= this.damping;
        node.vy *= this.damping;
      }
    }
  }
}
