export type InputMode = "hand" | "pen";
export function spaceCanControlCamera(target: EventTarget | null): boolean {
  return !(target && "closest" in target && (target as Element).closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="button"],[role="slider"]'));
}
type Owner = "camera" | "edit" | "ignore";

// One owner per physical gesture. OrbitControls must never see editing pointers.
export class PointerRouting {
  private owners = new Map<number,Owner>();
  owner(id:number): Owner { return this.owners.get(id) ?? "ignore"; }
  cancelEdit(): number | undefined {
    for(const [id,owner] of this.owners) if(owner === "edit") {
      this.owners.set(id,"ignore");
      return id;
    }
  }
  down(id:number, pointerType:string, tool:"move"|"draw"|"paint"|"brush"|"relief", mode:InputMode): {owner:Owner;cancelled?:number} {
    if(this.owners.has(id)) return {owner:this.owner(id)};
    const camera = tool === "move" || (mode === "pen" && pointerType === "touch");
    if(camera) {
      const cancelled=this.cancelEdit();
      this.owners.set(id,"camera");
      return {owner:"camera",cancelled};
    }
    const busy=[...this.owners.values()].some(owner=>owner !== "ignore");
    const owner = busy ? "ignore" : "edit";
    this.owners.set(id,owner);
    return {owner};
  }
  up(id:number): Owner {
    const owner=this.owner(id);
    this.owners.delete(id);
    return owner;
  }
}
