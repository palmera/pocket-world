// Conservative broad phase only: exact spherical predicates still decide
// intersections. The sagitta bounds the whole minor arc, not just its chord.
export type ArcBounds = { min: number[]; max: number[] };
export function arcBounds(a: readonly number[], b: readonly number[]): ArcBounds {
  const cosine = Math.max(-1, Math.min(1, a[0]*b[0]+a[1]*b[1]+a[2]*b[2]));
  const padding = 1 - Math.sqrt((1 + cosine) / 2) + 4e-6;
  return {
    min: a.map((v, i) => Math.min(v, b[i]) - padding),
    max: a.map((v, i) => Math.max(v, b[i]) + padding),
  };
}

export function* overlappingArcs(bounds: ArcBounds[]): Generator<[number, number]> {
  const order = bounds.map((_, i) => i).sort((a,b) => bounds[a].min[0]-bounds[b].min[0]);
  for (let i=0; i<order.length; i++) {
    const a = bounds[order[i]];
    for (let j=i+1; j<order.length; j++) {
      const b = bounds[order[j]];
      if (b.min[0] > a.max[0]) break;
      if (a.min[1] > b.max[1] || b.min[1] > a.max[1] || a.min[2] > b.max[2] || b.min[2] > a.max[2]) continue;
      yield [order[i], order[j]];
    }
  }
}

export function pointsInBounds(verts: number[][]) {
  const order = verts.map((_,i)=>i).sort((a,b)=>verts[a][0]-verts[b][0]);
  return function* (bounds: ArcBounds): Generator<number> {
    let lo=0, hi=order.length;
    while(lo<hi) { const mid=(lo+hi)>>>1; if(verts[order[mid]][0]<bounds.min[0]) lo=mid+1; else hi=mid; }
    for(let i=lo;i<order.length;i++) {
      const k=order[i], p=verts[k];
      if(p[0]>bounds.max[0]) break;
      if(p[1]>=bounds.min[1] && p[1]<=bounds.max[1] && p[2]>=bounds.min[2] && p[2]<=bounds.max[2]) yield k;
    }
  };
}
