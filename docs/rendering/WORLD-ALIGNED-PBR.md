# World-Aligned PBR Materials

HGame's optional `integrations/world-aligned-material.js` module samples textures from world position rather than restarting UVs at each mesh origin. Adjacent static meshes can therefore share a continuous material scale and offset.

## Projection modes

- `planar`: one projection plane; suitable for horizontal floors and large flat surfaces.
- `triplanar`: blends projections from three world axes using the surface normal; suitable for walls, slopes, and mixed geometry, at a higher texture-sampling cost.

The world tile size is expressed in world units. New 3D starter levels use a default tile size of `1`.

## Curated Color / Normal / ORM loader

`integrations/pbr-material-library.js` accepts a caller-supplied catalog and local texture loader. It does not ship a material catalog or any third-party textures.

Expected map conventions:

| Map | Color space | Meaning |
|---|---|---|
| Color | sRGB | Base color / albedo |
| Normal | Linear | Tangent-space normal, OpenGL +Y convention |
| ORM | Linear | R = AO, G = roughness, B = metallic |

Catalog image paths are content-addressed files under `textures/` and are validated before loading. Identical paths share one texture request and one cached texture. Call `dispose()` when the material library is no longer needed.

Example:

```js
import { loadCuratedPbrLibrary } from './vendor/hgame/integrations/pbr-material-library.js';

const library = await loadCuratedPbrLibrary({
  THREE,
  catalogUrl: './assets/pbr-materials/catalog.json',
});
const material = await library.get('stone-wall', {
  tileSize: 1,
  projection: 'triplanar',
});
mesh.material = material;
```

## Limits and performance

- World projection is intended for static scenery. Moving objects can exhibit texture swimming unless their projection origin is designed accordingly.
- Triplanar projection samples three axes and costs more than planar projection; use it only where the geometry needs it.
- The built-in procedural detail texture is not a replacement for a high-quality authored normal/ORM library.
- Material appearance does not define collision, AI, navigation, or authoritative network state.
- Only distribute textures whose source license explicitly permits the intended use. This repository does not include any private curated texture library.
