import { geodesicSubdivide, icosahedron } from "../engine/geometry/solids";
import { normalize } from "../engine/geometry/vec";
import { type FreeGraph } from "../engine/freestyle/freestyleGraph";
import { extractSphereFaces } from "../engine/freestyle/sphereGraph";
import { panelKey } from "./habitats";

export type RandomWorldStyle = "jelly" | "tiny";

export interface RandomWorldData {
  graph: FreeGraph;
  paints: Record<string, string>;
}

const PALETTES: Record<RandomWorldStyle, readonly string[]> = {
  jelly: ["strawberry", "blueberry", "lemon", "grape", "lime"],
  tiny: ["meadow", "water", "sand", "lava", "stone"],
};

const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function faceNeighbours(faces: number[][]): number[][] {
  const owners = new Map<string, number[]>();
  faces.forEach((face, faceIndex) => {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      const current = owners.get(key) ?? [];
      current.push(faceIndex);
      owners.set(key, current);
    });
  });
  const neighbours = faces.map(() => [] as number[]);
  for (const shared of owners.values()) {
    if (shared.length !== 2) continue;
    neighbours[shared[0]].push(shared[1]);
    neighbours[shared[1]].push(shared[0]);
  }
  return neighbours;
}

function growConnectedOwnership(
  neighbours: number[][],
  labels: readonly string[],
  random: () => number,
): Map<number, string> {
  const free = shuffled(neighbours.map((_, index) => index), random);
  const ownership = new Map<number, string>();
  labels.forEach((label, index) => ownership.set(free[index], label));
  while (ownership.size < neighbours.length) {
    let grew = false;
    for (const label of labels) {
      const territory = [...ownership.entries()].filter(([, value]) => value === label).map(([face]) => face);
      const boundary = shuffled(territory.flatMap((face) => neighbours[face].filter((next) => !ownership.has(next))), random);
      if (boundary.length) {
        ownership.set(boundary[0], label);
        grew = true;
      }
    }
    if (!grew) throw new Error("Random world could not grow connected regions");
  }
  return ownership;
}

function organicPanelGraph(random: () => number): FreeGraph {
  // A dense underlying field lets a coastline wander through many short arcs.
  // The editable panels are compact connected blobs, while the five painted
  // ecosystems merge across many of them. That gives a flowing world without
  // asking one very large polygon to span half a sphere.
  const fine = geodesicSubdivide(icosahedron(), 8);
  const triangleNeighbours = faceNeighbours(fine.faces);
  const clusterCount = 52 + Math.floor(random() * 13);
  const clusterLabels = Array.from({ length: clusterCount }, (_, index) => `blob-${index}`);
  const clusterOfTriangle = growConnectedOwnership(triangleNeighbours, clusterLabels, random);
  const boundary = new Map<string, { a: number; b: number; triangles: number[] }>();
  fine.faces.forEach((face, triangle) => face.forEach((a, index) => {
    const b = face[(index + 1) % face.length];
    const key = edgeKey(a, b);
    const edge = boundary.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), triangles: [] };
    edge.triangles.push(triangle);
    boundary.set(key, edge);
  }));
  return {
    verts: fine.vertices.map((vertex) => [...normalize(vertex)]),
    edges: [...boundary.values()]
      .filter((edge) => edge.triangles.length === 2 && clusterOfTriangle.get(edge.triangles[0]) !== clusterOfTriangle.get(edge.triangles[1]))
      .map((edge) => [edge.a, edge.b]),
  };
}

// Builds a fully editable starter planet. Organic panel blobs are painted from
// five connected territories, so it reads as a tiny hand-drawn world rather
// than a regular geometric ball.
export function createRandomWorld(style: RandomWorldStyle, random = Math.random): RandomWorldData {
  const graph = organicPanelGraph(random);
  const faces = extractSphereFaces(graph.verts, graph.edges);
  const palette = shuffled(PALETTES[style], random);
  const neighbours = faceNeighbours(faces);
  const ownership = growConnectedOwnership(neighbours, palette, random);

  return {
    graph,
    paints: Object.fromEntries([...ownership.entries()].map(([faceIndex, paint]) => [panelKey(faces[faceIndex]), paint])),
  };
}
