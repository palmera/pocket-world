import { arcBounds } from "../engine/freestyle/arcBounds";
import { normalize, type Vec3 } from "../engine/geometry/vec";
const v=(p:readonly number[]):Vec3=>[p[0],p[1],p[2]];

// A physical radial depression with analytic slope normals, not a raised tube.
// A small spatial grid keeps dense authored outlines out of an all-pairs loop.
export function createJellyMeniscus(borders:[Vec3,Vec3][]) {
  const width=.04, depth=1.7, radius=120, cell=.12, reach=width*3;
  type Segment={a:Vec3;d:Vec3;inverse:number};
  const grid=new Map<string,Segment[]>();
  const coord=(p:number)=>Math.floor(p/cell);
  for(const pair of borders) {
    const bounds=arcBounds(pair[0],pair[1]);
    const d=v(pair[1].map((n,i)=>n-pair[0][i]));
    const segment={a:pair[0],d,inverse:1/(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]||1)};
    for(let x=coord(bounds.min[0]-reach);x<=coord(bounds.max[0]+reach);x++)
      for(let y=coord(bounds.min[1]-reach);y<=coord(bounds.max[1]+reach);y++)
        for(let z=coord(bounds.min[2]-reach);z<=coord(bounds.max[2]+reach);z++) {
          const key=`${x},${y},${z}`, list=grid.get(key)??[];list.push(segment);grid.set(key,list);
        }
  }
  const cache=new Map<string,{p:Vec3;n:Vec3}>();
  return (positions:number[])=>{
  const normals:number[]=[], out:number[]=[];
  for(let i=0;i<positions.length;i+=3) {
    const p=normalize(v(positions.slice(i,i+3))), key=p.join(",");
    let sample=cache.get(key);
    if(!sample) {
      let squared=Infinity, nearest=p;
      for(const {a,d,inverse} of grid.get(`${coord(p[0])},${coord(p[1])},${coord(p[2])}`)??[]) {
        const t=Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1]+(p[2]-a[2])*d[2])*inverse));
        const x=a[0]+d[0]*t,y=a[1]+d[1]*t,z=a[2]+d[2]*t;
        const ds=(p[0]-x)**2+(p[1]-y)**2+(p[2]-z)**2;
        if(ds<squared) {squared=ds;nearest=[x,y,z];}
      }
      nearest=normalize(nearest);
      const distance=squared<Infinity?Math.acos(Math.max(-1,Math.min(1,p[0]*nearest[0]+p[1]*nearest[1]+p[2]*nearest[2]))):Infinity;
      const falloff=distance<reach?Math.exp(-((distance/width)**2)):0;
      const height=radius+.45-depth*falloff;
      const cosine=p.reduce((s,n,k)=>s+n*nearest[k],0);
      const tangent=normalize(v(p.map((n,k)=>n*cosine-nearest[k])));
      const slope=falloff ? 2*depth*distance/(width*width)*falloff/height : 0;
      sample={p:v(p.map(n=>n*height)),n:normalize(v(p.map((n,k)=>n-tangent[k]*slope)))};
      cache.set(key,sample);
    }
    out.push(...sample.p); normals.push(...sample.n);
  }
  return {positions:out,normals};
  };
}

export function jellyMeniscus(positions:number[], borders:[Vec3,Vec3][]) { return createJellyMeniscus(borders)(positions); }
