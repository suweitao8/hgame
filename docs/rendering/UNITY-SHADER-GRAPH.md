# Unity Shader Graph references for fullscreen effects

Use `createFullscreenShaderPass` to translate a Unity URP fullscreen shader into text-authored GLSL3. It produces an ordinary HGame HDR pass descriptor. Add it to `post3d.passes` when creating the Three adapter or call `adapter.postPipeline.setPasses()` on an existing adapter.

| Unity reference | HGame fullscreen shader |
| --- | --- |
| Screen Position, Default | The `uv` argument to `shadeFullscreen` or `hgameScreenUV()`. Coordinates run from `(0, 0)` at the bottom-left to `(1, 1)` at the top-right of the current view. |
| Screen Position, Center | `uv * 2.0 - 1.0` |
| Screen Position, Pixel | `hgameScreenPixels()` gives bottom-left pixel coordinates in the current HDR buffer. `hgameScreenSize()` gives its dimensions after render scaling. |
| URP Sample Buffer, BlitSource | `hgameSceneColor(uv)` reads the incoming linear HDR color. Each effect receives the previous pass's output. |
| Scene Depth, Raw | `hgameSceneDepthRaw(uv)` returns device depth. Reverse depth devices reverse the raw ordering. |
| Scene Depth, Eye | `hgameSceneEyeDepth(uv)` returns the distance along the camera's forward axis in scene units. `hgameSceneViewPosition(uv)` returns the full view-space position. |
| Scene Depth, Linear01 | `hgameSceneLinearDepth(uv)` divides eye depth by the current camera's far distance and clamps to `[0, 1]`. This is also the HGame rule for orthographic views. |
| Tiling And Offset | `uv * tiling + offset`. Configure texture wrapping on the Three texture. |
| Sample Texture 2D | Declare a `sampler2D` and use `texture(sampler, uv)`. Set `texture.colorSpace = THREE.SRGBColorSpace` for sRGB color assets and `THREE.NoColorSpace` for masks, normal maps and other numerical data. |

The pass runs after the first-person layer, before exposure, bloom and tone mapping. It reads original world depth, while its HDR color includes any preceding fullscreen effects and first-person drawing. Unity's Scene Color node in URP reads the opaque texture at a different stage, so use the BlitSource reference for this HGame color input. [Unity Screen Position](https://docs.unity3d.com/Packages/com.unity.shadergraph@17.0/manual/Screen-Position-Node.html) · [Unity Full Screen Pass](https://docs.unity.com/en-us/engine/6000.6/manual/post-processing-and-full-screen-effects/urp/custom-post-processing/renderer-feature-full-screen-pass) · [Unity Scene Depth](https://docs.unity3d.com/Packages/com.unity.shadergraph@17.0/manual/Scene-Depth-Node.html)

```js
import { createFullscreenShaderPass } from './vendor/hgame/integrations/post3d.js';

const fog = createFullscreenShaderPass(THREE, {
  id: 'depth-fog',
  sceneDepth: true,
  uniforms: {
    fogColor: { value: new THREE.Color(0x9eb8cf) },
    fogRange: { value: new THREE.Vector2(8, 45) },
  },
  fragment: `
    uniform vec3 fogColor;
    uniform vec2 fogRange;

    vec4 shadeFullscreen(vec2 uv) {
      vec4 scene = hgameSceneColor(uv);
      float fog = smoothstep(fogRange.x, fogRange.y, hgameSceneEyeDepth(uv));
      return vec4(mix(scene.rgb, fogColor, fog), scene.a);
    }
  `,
});

adapter.postPipeline.setPasses([fog]);
```

Supply your uniforms and the `shadeFullscreen` function. The factory supplies the vertex shader, the GLSL version and the fragment entry point. Write linear RGBA for each pixel. Leave names beginning with `hgame` available for pipeline inputs. The game owns `fog.material` and disposes it after removing the pass. Change parameters through `fog.material.uniforms`.

Set `sceneDepth: true` when the shader uses depth helpers. HGame then binds the actual world projection and depth per view, including under temporal jitter, and skips the pass when sampleable world depth is unavailable. Color-only effects can still run on the HDR path. Use `node tests/browser-fullscreen-shader-pass.mjs --chrome <chromium-path>` to probe shader inputs on WebGL2.
