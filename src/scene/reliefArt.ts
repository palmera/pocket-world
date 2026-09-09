import * as THREE from "three";
import { sanitizeRelief, type ReliefStamp } from "../world/relief";

type Point3=[number,number,number];
const normalizePoint=(p:readonly number[]):Point3=>{const length=Math.hypot(p[0],p[1],p[2]);return [p[0]/length,p[1]/length,p[2]/length];};
const dotPoint=(a:Point3,b:Point3)=>Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2]));
const crossPoint=(a:Point3,b:Point3):Point3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

/** Local, conforming refinement of an existing non-indexed sphere mesh.
 * Shared-edge splits depend ONLY on the edge endpoints and global stamps, so
 * separately cached faces still agree. Unlike fixed-depth subdivision, a tap
 * wholly inside a large triangle is discovered and inserted as an interior
 * vertex. No graph/topology edits and no deformation occur in this helper.
 */
export function refineReliefMesh(positions:readonly number[],input:readonly ReliefStamp[],radius=120):number[] {
  const stamps=sanitizeRelief(input);
  if (!stamps.length) return Array.from(positions);
  // Taller/narrower landforms need more local samples to keep geometry close
  // to the analytic height used by picking, props and brush previews. Lower
  // intensity features stay cheaper; the untouched base mesh is unchanged.
  const targetEdge=(stamp:ReliefStamp)=>stamp.radius*Math.max(.18,Math.min(.48,.65/Math.sqrt(Math.max(.2,Math.abs(stamp.amount)))));
  const out:number[]=[],edges=new Map<string,Point3|false>();
  const pointKey=(p:Point3)=>p.map(n=>Math.round(n*1e11)).join(",");
  const midpoint=(a:Point3,b:Point3):Point3|false=>{
    const aKey=pointKey(a),bKey=pointKey(b),key=aKey<bKey?`${aKey};${bKey}`:`${bKey};${aKey}`;
    const cached=edges.get(key);
    if(cached!==undefined)return cached;
    const cosine=dotPoint(a,b),angle=Math.acos(cosine);
    if(angle<.0032 || angle>Math.PI-.001) {edges.set(key,false);return false;}
    const mid=normalizePoint([a[0]+b[0],a[1]+b[1],a[2]+b[2]]);
    let split=false;
    for(const stamp of stamps) {
      if(angle<=targetEdge(stamp) || dotPoint(mid,stamp.center)<Math.cos(Math.min(Math.PI,angle*.5+stamp.radius)))continue;
      let nearest=Math.min(Math.acos(dotPoint(a,stamp.center)),Math.acos(dotPoint(b,stamp.center)));
      const normal=normalizePoint(crossPoint(a,b)),offset=dotPoint(normal,stamp.center);
      const projection=normalizePoint([stamp.center[0]-normal[0]*offset,stamp.center[1]-normal[1]*offset,stamp.center[2]-normal[2]*offset]);
      if(Math.acos(dotPoint(a,projection))+Math.acos(dotPoint(b,projection))<=angle+1e-8)nearest=Math.min(nearest,Math.asin(Math.abs(offset)));
      if(nearest<=stamp.radius) {split=true;break;}
    }
    edges.set(key,split?mid:false);
    return split?mid:false;
  };
  const emit=(a:Point3,b:Point3,c:Point3)=>{
    if(out.length>=4_500_000)throw new Error("Relief mesh exceeds its safe triangle budget");
    for(const p of [a,b,c])out.push(p[0]*radius,p[1]*radius,p[2]*radius);
  };
  const visit=(a:Point3,b:Point3,c:Point3,depth:number):void=>{
    if(depth>24)throw new Error("Relief mesh exceeds its safe refinement depth");
    const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);
    if(ab && bc && ca) {visit(a,ab,ca,depth+1);visit(ab,b,bc,depth+1);visit(ca,bc,c,depth+1);visit(ab,bc,ca,depth+1);return;}
    if(ab && bc) {visit(b,bc,ab,depth+1);visit(a,ab,bc,depth+1);visit(a,bc,c,depth+1);return;}
    if(bc && ca) {visit(c,ca,bc,depth+1);visit(b,bc,ca,depth+1);visit(b,ca,a,depth+1);return;}
    if(ca && ab) {visit(a,ab,ca,depth+1);visit(c,ca,ab,depth+1);visit(c,ab,b,depth+1);return;}
    if(ab) {visit(a,ab,c,depth+1);visit(ab,b,c,depth+1);return;}
    if(bc) {visit(b,bc,a,depth+1);visit(bc,c,a,depth+1);return;}
    if(ca) {visit(c,ca,b,depth+1);visit(ca,a,b,depth+1);return;}
    const sideAB=crossPoint(a,b),sideBC=crossPoint(b,c),sideCA=crossPoint(c,a);
    for(const stamp of stamps) {
      const p=stamp.center,first=dotPoint(sideAB,p),second=dotPoint(sideBC,p),third=dotPoint(sideCA,p);
      if((first>1e-9 && second>1e-9 && third>1e-9) || (first< -1e-9 && second< -1e-9 && third< -1e-9)) {
        // Reject the antipodal triangle and points numerically on a vertex.
        if(dotPoint(normalizePoint([a[0]+b[0]+c[0],a[1]+b[1]+c[1],a[2]+b[2]+c[2]]),p)<=0 || Math.max(dotPoint(p,a),dotPoint(p,b),dotPoint(p,c))>1-1e-12)continue;
        visit(a,b,p,depth+1);visit(b,c,p,depth+1);visit(c,a,p,depth+1);return;
      }
    }
    emit(a,b,c);
  };
  for(let i=0;i+8<positions.length;i+=9) visit(normalizePoint(positions.slice(i,i+3)),normalizePoint(positions.slice(i+3,i+6)),normalizePoint(positions.slice(i+6,i+9)),0);
  return out;
}

/** Nearby water stamps describe a single weather system, not a new actor each. */
export function selectReliefFeatures(stamps:readonly ReliefStamp[],max=12):ReliefStamp[] {
  const chosen:ReliefStamp[]=[];
  const limit=Number.isFinite(max)?Math.max(0,Math.min(12,Math.floor(max))):12;
  if (!limit) return chosen;
  const candidates=stamps.filter(stamp=>(stamp.kind==="hurricane" || stamp.kind==="whirlpool") && Math.abs(stamp.amount)>=.35)
    .map((stamp,index)=>({stamp,index})).sort((a,b)=>Math.abs(b.stamp.amount)-Math.abs(a.stamp.amount) || a.index-b.index);
  for(const {stamp} of candidates) {
    if(chosen.some(other=>{
      const cosine=stamp.center[0]*other.center[0]+stamp.center[1]*other.center[1]+stamp.center[2]*other.center[2];
      return cosine>Math.cos((stamp.radius+other.radius)*.85);
    })) continue;
    chosen.push(stamp);
    if(chosen.length===limit) break;
  }
  return chosen;
}

/** Water landforms use cheap authored silhouettes, not one particle per crest.
 * Returned groups use local +Y as up, world units, and an origin at radius 120.
 * Position the group at stamp.center * 120, then align +Y with stamp.center.
 * Their own vertices already follow the sphere and its shallow water relief.
 */
export function createReliefFeature(stamp: ReliefStamp): THREE.Group | undefined {
  if (stamp.kind !== "hurricane" && stamp.kind !== "whirlpool") return;
  const feature=new THREE.Group(),rotor=new THREE.Group();
  feature.name=`relief-${stamp.kind}`;
  rotor.name="relief-rotor";
  feature.add(rotor);
  const size=120*Math.sin(stamp.radius),hurricane=stamp.kind==="hurricane";
  const surface=(r:number)=>{
    const u=Math.min(1,Math.asin(Math.min(1,r/120))/stamp.radius);
    return stamp.amount*(hurricane?.1:.3)*(1-u*u)**3-r*r/240;
  };
  const material=new THREE.MeshStandardMaterial({
    color:hurricane?0x859093:0xd1e2db,roughness:hurricane?.96:.35,
    metalness:0,transparent:true,opacity:hurricane?.87:.7,
    depthWrite:false,side:THREE.DoubleSide,
  });
  const spiral=spiralGeometry(hurricane?3:2,48,size*.12,size*.85,size*(hurricane?.15:.034),
    r=>surface(r)+(hurricane?2.1+size*.085:.12),hurricane?5.1:9.5);
  const arms=new THREE.Mesh(spiral,material);
  arms.castShadow=false; arms.receiveShadow=true;
  rotor.add(arms);
  if (hurricane) {
    // A ragged, low cloud deck with a visible eye. No cotton-candy cloud balls.
    const shadowMaterial=new THREE.MeshStandardMaterial({color:0x495962,roughness:1,transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide});
    const shadow=new THREE.Mesh(spiralGeometry(3,36,size*.16,size*.78,size*.22,r=>surface(r)+1.4+size*.04,5.1),shadowMaterial);
    shadow.rotation.y=.26;
    rotor.add(shadow);
    const eye=new THREE.Mesh(new THREE.TorusGeometry(size*.135,size*.022,4,24),material);
    eye.rotation.x=Math.PI/2;
    eye.position.y=surface(size*.135)+2.1+size*.085;
    rotor.add(eye);
  }
  feature.userData.reliefSpeed=hurricane?.19:-.36;
  feature.userData.reliefKind=stamp.kind;
  return feature;
}

/** No allocations or geometry rebuilds per frame; paused/reduced-motion friendly. */
export function animateReliefFeature(feature:THREE.Group,timeSeconds:number,reducedMotion=false):void {
  const rotor=feature.children[0];
  if (rotor) rotor.rotation.y=reducedMotion?0:timeSeconds*(feature.userData.reliefSpeed as number || 0);
}

function spiralGeometry(arms:number,steps:number,inner:number,outer:number,width:number,height:(radius:number)=>number,turn:number):THREE.BufferGeometry {
  const positions:number[]=[],indices:number[]=[];
  for(let arm=0;arm<arms;arm++) {
    const base=positions.length/3;
    for(let i=0;i<=steps;i++) {
      const t=i/steps,r=inner+(outer-inner)*t,angle=arm*Math.PI*2/arms+t*turn;
      // Taper both ends and corrugate the cloud ribbons, keeping two vertices
      // per cross-section and a small, bounded triangle budget.
      const half=width*Math.sin(Math.PI*t)**.65*(.65+.35*t)*.5;
      for(const side of [-1,1]) {
        const radial=r+side*half;
        positions.push(Math.cos(angle)*radial,height(radial)+Math.sin(t*19+arm)*width*.12,Math.sin(angle)*radial);
      }
      if(i<steps) {const a=base+i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
