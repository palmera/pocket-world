import * as THREE from "three";

// Never spread geometry arrays into function arguments: Safari/V8 have a
// finite argument stack, reached by a single region containing several holes.
export function joinFloat32(chunks: readonly Float32Array[]): Float32Array {
  const result = new Float32Array(chunks.reduce((n, chunk)=>n+chunk.length, 0));
  let offset=0;
  for (const chunk of chunks) { result.set(chunk,offset); offset+=chunk.length; }
  return result;
}

// Cache only resources used in the latest successful frame, not every edit in
// the session. Build transactions let a failed update retain the old scene.
export class FrameCache<T> {
  private current = new Map<string,T>();
  private pending = new Map<string,T>();
  begin() { this.pending = new Map(); }
  get(key: string, create: ()=>T): T {
    const value = this.pending.get(key) ?? this.current.get(key) ?? create();
    this.pending.set(key,value);
    return value;
  }
  commit() { this.current=this.pending; this.pending=new Map(); }
  rollback() { this.pending=new Map(); }
}

export function disposeExcept(root: THREE.Object3D, retained?: THREE.Object3D) {
  const collect = (object: THREE.Object3D) => {
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    object.traverse(child=>{
      const drawable=child as THREE.Mesh;
      if(drawable.geometry) resources.add(drawable.geometry);
      if(drawable.material) {
        for(const material of Array.isArray(drawable.material)?drawable.material:[drawable.material]) resources.add(material);
      }
    });
    return resources;
  };
  const keep=retained ? collect(retained) : new Set();
  for(const resource of collect(root)) if(!keep.has(resource)) resource.dispose();
  root.clear();
}
