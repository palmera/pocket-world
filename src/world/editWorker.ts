import { drawBorder } from "./drawBorder";
import { paintStroke } from "./brushStroke";
import type { FreeGraph } from "../engine/freestyle/freestyleGraph";
export type EditRequest = { graph:FreeGraph; paints:Record<string,string>; points:number[][]; close:boolean; step:number; paint:string; brushRadius?:number };
self.onmessage=(event:MessageEvent<EditRequest>)=>{
  try {
    const r=event.data;
    const edit=r.brushRadius ? paintStroke(r.graph,r.paints,r.points,r.brushRadius,r.paint) : drawBorder(r.graph,r.paints,r.points,r.close,r.step,r.paint);
    self.postMessage({edit});
  } catch(error) { self.postMessage({error:error instanceof Error?error.message:String(error)}); }
};
