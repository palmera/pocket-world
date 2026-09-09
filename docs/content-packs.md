# Declarative inhabitant packs

Geography is saved independently from inhabitants. The scene renderer consumes
`defaultContentPacks.catalog(terrain)`, and model references use stable namespaced
IDs such as `core:meadow.walkers`. Removing a pack never deletes terrain. Missing
references resolve to the relevant built-in ecosystem's first inhabitant.

`ContentPackRegistry.register(data)` validates and snapshots JSON-compatible data.
It accepts at most 16 packs with 256 entries each. Duplicate pack/inhabitant IDs,
unknown model/behaviour keys, nonfinite colors, and extra executable or URL fields
are rejected. Built-in art cannot be unregistered. Pack registration is a code
integration seam for future distribution, not a remote download or payment system.

```json
{
  "schemaVersion": 1,
  "id": "woodland-crafts",
  "label": "Woodland crafts",
  "inhabitants": [{
    "id": "reed-gatherer",
    "label": "Recolector de juncos",
    "terrain": "wetland",
    "model": "worker",
    "motion": "gather",
    "motif": "people",
    "colors": [6575422, 12167810],
    "stage": 1
  }]
}
```

The permitted model families are exported as `MODEL_KEYS`; trusted motions are
exported as `BASIC_BEHAVIOURS`. `stage` is 0–3. Packs choose existing trusted
capabilities, not JavaScript, shaders, remote resources, or billing actions.
Current populations obey the same geographic density/spacing budget for all packs.
Future custom meshes should pass an asset validation/footprint budget before their
model key is registered by the application, never execute code supplied in a pack.

The living clock advances only during active play. Settlement ages begin at
0/60/180/480 simulation seconds. Forest, wetland and snow require respectively
120/300/600 seconds **and** 3/8/15 world edits. Saved discoveries are monotonic;
starting a new world may restart its clock without removing discovered colors.
