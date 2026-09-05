import { sphericalArea } from "../engine/freestyle/sphereGraph";
import { ECOSYSTEMS, type Terrain } from "./ecosystems";

export interface EdgeOwner {
  a: number;
  b: number;
  faces: number[];
}

export interface TerrainHabitat {
  terrain: Terrain;
  faces: number[];
  area: number;
  unlockedScenes: number;
}

export interface TerrainBorderContact {
  a: number;
  b: number;
  leftFace: number;
  rightFace: number;
}

export function panelKey(face: readonly number[]): string {
  return [...face].sort((a, b) => a - b).join(",");
}

export function isTerrain(value: string | undefined): value is Terrain {
  return value === "meadow" || value === "water" || value === "sand" || value === "lava" || value === "stone";
}

// The first little discovery appears immediately. A larger region earns a new
// discovery roughly every 0.5 steradians, until its ten-scene catalogue is
// full. This intentionally responds to visible land mass, not panel count.
export function unlockedSceneCount(area: number, available: number): number {
  return Math.min(available, Math.max(1, 1 + Math.floor(Math.max(0, area) / 0.5)));
}

// Same-colour neighbours are one habitat, regardless of how many panels the
// child used to draw it. Area is measured on the unit sphere (steradians).
export function findTerrainHabitats(
  faces: readonly number[][],
  verts: number[][],
  edgeOwners: Iterable<EdgeOwner>,
  paints: ReadonlyMap<string, string>,
): TerrainHabitat[] {
  const terrainOf = faces.map((face) => paints.get(panelKey(face)));
  const neighbours = faces.map(() => [] as number[]);
  for (const edge of edgeOwners) {
    if (edge.faces.length !== 2) continue;
    const [left, right] = edge.faces;
    if (terrainOf[left] && terrainOf[left] === terrainOf[right] && isTerrain(terrainOf[left])) {
      neighbours[left].push(right);
      neighbours[right].push(left);
    }
  }

  const visited = new Set<number>();
  const habitats: TerrainHabitat[] = [];
  for (let start = 0; start < faces.length; start++) {
    const terrain = terrainOf[start];
    if (visited.has(start) || !isTerrain(terrain)) continue;
    const component: number[] = [];
    const pending = [start];
    visited.add(start);
    while (pending.length) {
      const current = pending.pop()!;
      component.push(current);
      for (const next of neighbours[current]) {
        if (!visited.has(next)) {
          visited.add(next);
          pending.push(next);
        }
      }
    }
    const area = component.reduce((sum, faceIndex) => sum + Math.abs(sphericalArea(verts, faces[faceIndex])), 0);
    habitats.push({
      terrain,
      faces: component,
      area,
      unlockedScenes: unlockedSceneCount(area, ECOSYSTEMS[terrain].length),
    });
  }
  return habitats;
}

// One authored interaction belongs to one connected pair of habitats, even
// when their coastline has many panel edges. It keeps a detailed planet from
// turning every boundary segment into the same repeated prop.
export function findTerrainBorderContacts(
  faces: readonly number[][],
  verts: number[][],
  edgeOwners: Iterable<EdgeOwner>,
  paints: ReadonlyMap<string, string>,
): TerrainBorderContact[] {
  const edges = [...edgeOwners];
  const habitats = findTerrainHabitats(faces, verts, edges, paints);
  const habitatForFace = new Map<number, number>();
  habitats.forEach((habitat, habitatIndex) => habitat.faces.forEach((face) => habitatForFace.set(face, habitatIndex)));
  const contacts = new Map<string, TerrainBorderContact>();
  for (const edge of edges) {
    if (edge.faces.length !== 2) continue;
    const [leftFace, rightFace] = edge.faces;
    const leftHabitat = habitatForFace.get(leftFace);
    const rightHabitat = habitatForFace.get(rightFace);
    if (leftHabitat === undefined || rightHabitat === undefined || leftHabitat === rightHabitat) continue;
    const leftTerrain = habitats[leftHabitat].terrain;
    const rightTerrain = habitats[rightHabitat].terrain;
    if (leftTerrain === rightTerrain) continue;
    const key = leftHabitat < rightHabitat ? `${leftHabitat}:${rightHabitat}` : `${rightHabitat}:${leftHabitat}`;
    if (!contacts.has(key)) contacts.set(key, { a: edge.a, b: edge.b, leftFace, rightFace });
  }
  return [...contacts.values()];
}
