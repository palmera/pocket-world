// A panel mesh: vertices as unit-sphere vectors + face vertex-index loops.
// (Same shape the design/coloring code uses; kept dependency-free here.)
export interface Mesh {
  v: number[][];
  f: number[][];
}
