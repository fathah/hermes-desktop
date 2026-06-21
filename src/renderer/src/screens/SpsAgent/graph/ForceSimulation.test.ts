import { describe, expect, it } from "vitest";
import { ForceSimulation, type SimNode, type SimEdge } from "./ForceSimulation";

describe("ForceSimulation", () => {
  const nodes: SimNode[] = [
    { id: "A", x: 0, y: 0, vx: 0, vy: 0, r: 10, label: "Node A" },
    { id: "B", x: 0, y: 0, vx: 0, vy: 0, r: 10, label: "Node B" },
    { id: "C", x: 0, y: 0, vx: 0, vy: 0, r: 10, label: "Node C" },
  ];

  const edges: SimEdge[] = [{ source: "A", target: "B" }];

  it("initializes linked graphs with deterministic spread and zero velocities", () => {
    const sim = new ForceSimulation(nodes, edges, 600, 400);
    const replay = new ForceSimulation(nodes, edges, 600, 400);
    expect(sim.nodes).toHaveLength(3);

    for (const [index, node] of sim.nodes.entries()) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(600);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(400);
      expect(node.x).toBeCloseTo(replay.nodes[index].x);
      expect(node.y).toBeCloseTo(replay.nodes[index].y);
      expect(node.vx).toBe(0);
      expect(node.vy).toBe(0);
    }

    const nearCenter = sim.nodes.filter(
      (node) => Math.abs(node.x - 300) <= 20 && Math.abs(node.y - 200) <= 20,
    );
    const distinctPositions = new Set(
      sim.nodes.map((node) => `${Math.round(node.x)}:${Math.round(node.y)}`),
    );
    expect(nearCenter).toHaveLength(0);
    expect(distinctPositions.size).toBe(sim.nodes.length);
  });

  it("places isolated graphs on a readable grid", () => {
    const isolatedNodes: SimNode[] = [
      ...nodes,
      { id: "D", x: 0, y: 0, vx: 0, vy: 0, r: 10, label: "Node D" },
    ];

    const sim = new ForceSimulation(isolatedNodes, [], 600, 400);

    expect(sim.nodes[0].x).toBeCloseTo(150);
    expect(sim.nodes[0].y).toBeCloseTo(400 / 3);
    expect(sim.nodes[1].x).toBeCloseTo(300);
    expect(sim.nodes[1].y).toBeCloseTo(400 / 3);
    expect(sim.nodes[2].x).toBeCloseTo(450);
    expect(sim.nodes[2].y).toBeCloseTo(400 / 3);
    expect(sim.nodes[3].x).toBeCloseTo(150);
    expect(sim.nodes[3].y).toBeCloseTo((400 * 2) / 3);
  });

  it("updates positions and velocities when ticked", () => {
    const sim = new ForceSimulation(nodes, edges, 600, 400);
    const initialPos = sim.nodes.map((n) => ({ x: n.x, y: n.y }));

    sim.tick();

    // After 1 tick, the nodes should have moved due to repulsion, center gravity, etc.
    const tickedPos = sim.nodes.map((n) => ({ x: n.x, y: n.y }));
    for (let i = 0; i < sim.nodes.length; i++) {
      expect(tickedPos[i].x).not.toBe(initialPos[i].x);
      expect(tickedPos[i].y).not.toBe(initialPos[i].y);
      expect(sim.nodes[i].vx).not.toBe(0);
      expect(sim.nodes[i].vy).not.toBe(0);
    }
  });

  it("attracts nodes connected by links", () => {
    // We configure linkStrength to be high to easily see convergence
    const sim = new ForceSimulation(nodes, edges, 600, 400);
    sim.linkStrength = 0.5;

    // Spread them far apart
    sim.nodes[0].x = 100;
    sim.nodes[0].y = 200;
    sim.nodes[1].x = 500;
    sim.nodes[1].y = 200;

    const initialDist = Math.abs(sim.nodes[0].x - sim.nodes[1].x); // 400

    sim.tick();

    const tickedDist = Math.abs(sim.nodes[0].x - sim.nodes[1].x);
    // Linked nodes should have been pulled closer together
    expect(tickedDist).toBeLessThan(initialDist);
  });

  it("respects fixed coordinates when dragging (fx, fy)", () => {
    const sim = new ForceSimulation(nodes, edges, 600, 400);
    const dragNode = sim.nodes[0];

    dragNode.fx = 450;
    dragNode.fy = 250;

    sim.tick();

    expect(dragNode.x).toBe(450);
    expect(dragNode.y).toBe(250);
    expect(dragNode.vx).toBe(0);
    expect(dragNode.vy).toBe(0);

    // Let go
    dragNode.fx = null;
    dragNode.fy = null;

    sim.tick();

    // Should start moving again
    expect(dragNode.x).not.toBe(450);
    expect(dragNode.y).not.toBe(250);
  });
});
