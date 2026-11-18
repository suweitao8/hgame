import"./chunk-f949f2d5.js";import{a as e,i as t,n,o as r,r as i,t as a}from"./chunk-4e86d6c7.js";import{A as o,C as s,D as c,M as l,S as u,U as d,X as f,Z as p,a as m,c as h,ct as g,f as _,h as v,it as y,ot as b,p as x,rt as S,s as C,st as w,u as T,v as E,w as D,x as O,y as k}from"./chunk-9d7de434.js";import{C as ee,D as A,O as j,b as M,d as N,h as P,m as F,u as I,x as te}from"./chunk-7c6b963b.js";import{t as ne}from"./chunk-3f4ab349.js";import{f as re,p as ie}from"./chunk-f511cd8a.js";import{t as ae}from"./chunk-c614e1b9.js";let L;function oe(e){return L===void 0&&(L=(()=>{let t={stencil:!0,failIfMajorPerformanceCaveat:e??j.defaultOptions.failIfMajorPerformanceCaveat};try{if(!O.get().getWebGLRenderingContext())return!1;let e=O.get().createCanvas().getContext(`webgl`,t),n=!!e?.getContextAttributes()?.stencil;if(e){let t=e.getExtension(`WEBGL_lose_context`);t&&t.loseContext()}return e=null,n}catch{return!1}})()),L}let R;async function se(e={}){return R===void 0&&(R=await(async()=>{let t=O.get().getNavigator().gpu;if(!t)return!1;try{return await(await t.requestAdapter(e)).requestDevice(),!0}catch{return!1}})()),R}const z=[`webgl`,`webgpu`,`canvas`];async function ce(e){let t=[];e.preference?Array.isArray(e.preference)?t=e.preference.slice():(t.push(e.preference),z.forEach(n=>{n!==e.preference&&t.push(n)})):t=z.slice();let n,r={};for(let i=0;i<t.length;i++){let a=t[i];if(a===`webgpu`&&await se()){let{WebGPURenderer:t}=await import(`./chunk-79ac0bef.js`);n=t,r={...e,...e.webgpu};break}if(a===`webgl`&&oe(e.failIfMajorPerformanceCaveat??j.defaultOptions.failIfMajorPerformanceCaveat)){let{WebGLRenderer:t}=await import(`./chunk-5060ef99.js`);n=t,r={...e,...e.webgl};break}if(a===`canvas`){let{CanvasRenderer:t}=await import(`./chunk-dcd5e0be.js`);n=t,r={...e,...e.canvasOptions};break}}if(delete r.webgpu,delete r.webgl,delete r.canvasOptions,!n)throw Error(`No available renderer for the current environment`);let i=new n;return await i.init(r),i}var B=class{static init(e){Object.defineProperty(this,"resizeTo",{configurable:!0,set(e){globalThis.removeEventListener(`resize`,this.queueResize),this._resizeTo=e,e&&(globalThis.addEventListener(`resize`,this.queueResize),this.resize())},get(){return this._resizeTo}}),this.queueResize=()=>{this._resizeTo&&(this._cancelResize(),this._resizeId=requestAnimationFrame(()=>this.resize()))},this._cancelResize=()=>{this._resizeId&&=(cancelAnimationFrame(this._resizeId),null)},this.resize=()=>{if(!this._resizeTo)return;this._cancelResize();let e,t;if(this._resizeTo===globalThis.window)e=globalThis.innerWidth,t=globalThis.innerHeight;else{let{clientWidth:n,clientHeight:r}=this._resizeTo;e=n,t=r}this.renderer.resize(e,t),this.render()},this._resizeId=null,this._resizeTo=null,this.resizeTo=e.resizeTo||null}static destroy(){globalThis.removeEventListener(`resize`,this.queueResize),this._cancelResize(),this._cancelResize=null,this.queueResize=null,this.resizeTo=null,this.resize=null}};B.extension=w.Application;var V=class{static init(e){e=Object.assign({autoStart:!0,sharedTicker:!1},e),Object.defineProperty(this,"ticker",{configurable:!0,set(e){this._ticker&&this._ticker.remove(this.render,this),this._ticker=e,e&&e.add(this.render,this,k.LOW)},get(){return this._ticker}}),this.stop=()=>{this._ticker.stop()},this.start=()=>{this._ticker.start()},this._ticker=null,this.ticker=e.sharedTicker?E.shared:new E,e.autoStart&&this.start()}static destroy(){if(this._ticker){let e=this._ticker;this.ticker=null,e.destroy()}}};V.extension=w.Application,g.add(B),g.add(V);const H=class e{constructor(...e){this.stage=new D,e[0]!==void 0&&f(p,`Application constructor options are deprecated, please use Application.init() instead.`)}async init(t){t={...t},this.stage||=new D,this.renderer=await ce(t),e._plugins.forEach(e=>{e.init.call(this,t)})}render(){this.renderer.render({container:this.stage})}get canvas(){return this.renderer.canvas}get view(){return f(p,`Application.view is deprecated, please use Application.canvas instead.`),this.renderer.canvas}get screen(){return this.renderer.screen}get domContainerRoot(){return this.renderer.renderPipes.dom?._domElement}destroy(t=!1,n=!1){let r=e._plugins.slice(0);r.reverse(),r.forEach(e=>{e.destroy.call(this)}),this.stage.destroy(n),this.stage=null,this.renderer.destroy(t),this.renderer=null}};H._plugins=[];let U=H;g.handleByList(w.Application,U._plugins),g.add(A);var le=class{constructor({matrix:e,observer:t}={}){this.dirty=!0,this._matrix=e??new S,this.observer=t,this.position=new b(this,0,0),this.scale=new b(this,1,1),this.pivot=new b(this,0,0),this.skew=new b(this,0,0),this._rotation=0,this._cx=1,this._sx=0,this._cy=0,this._sy=1}get matrix(){let e=this._matrix;return this.dirty&&=(e.a=this._cx*this.scale.x,e.b=this._sx*this.scale.x,e.c=this._cy*this.scale.y,e.d=this._sy*this.scale.y,e.tx=this.position.x-(this.pivot.x*e.a+this.pivot.y*e.c),e.ty=this.position.y-(this.pivot.x*e.b+this.pivot.y*e.d),!1),e}_onUpdate(e){this.dirty=!0,e===this.skew&&this.updateSkew(),this.observer?._onUpdate(this)}updateSkew(){this._cx=Math.cos(this._rotation+this.skew.y),this._sx=Math.sin(this._rotation+this.skew.y),this._cy=-Math.sin(this._rotation-this.skew.x),this._sy=Math.cos(this._rotation-this.skew.x),this.dirty=!0}toString(){return`[pixi.js/math:Transform position=(${this.position.x}, ${this.position.y}) rotation=${this.rotation} scale=(${this.scale.x}, ${this.scale.y}) skew=(${this.skew.x}, ${this.skew.y}) ]`}setFromMatrix(e){e.decompose(this),this.dirty=!0}get rotation(){return this._rotation}set rotation(e){this._rotation!==e&&(this._rotation=e,this._onUpdate(this.skew))}};const W=new S,G=new S,K=[new y,new y,new y,new y];var q=class{constructor(e){this._renderer=e}validateRenderable(e){return!1}addRenderable(e,t){this._renderer.renderPipes.batch.break(t),t.add(e)}updateRenderable(e){}execute(e){let t=this._renderer,n=t.canvasContext,r=n.activeContext;r.save(),n.setBlendMode(e.groupBlendMode);let i=t.globalUniforms.globalUniformData?.worldColor??4294967295,a=e.groupColorAlpha,s=(i>>>24&255)/255,c=(a>>>24&255)/255,u=t.filter?.alphaMultiplier??1,d=s*c*u;if(d<=0){r.restore();return}r.globalAlpha=d;let f=i&16777215,p=a&16777215,m=o(l(p,f)),h=e.texture,g=ne.getTintedPattern(h,m),_=e.width,v=e.height,y=e.groupTransform,b=h.source._resolution??h.source.resolution??1;G.copyFrom(e._tileTransform.matrix),e.applyAnchorToTexture||G.translate(-e.anchor.x*_,-e.anchor.y*v);let x=G.tx,S=G.ty;G.scale(1/b,1/b),G.tx=x,G.ty=S,W.identity(),W.prepend(G),W.prepend(y);let C=t._roundPixels|e._roundPixels;n.setContextTransform(W,C===1),r.fillStyle=g;let w=e.anchor.x*-_,T=e.anchor.y*-v;K[0].set(w,T),K[1].set(w+_,T),K[2].set(w+_,T+v),K[3].set(w,T+v);for(let e=0;e<4;e++)G.applyInverse(K[e],K[e]);r.beginPath(),r.moveTo(K[0].x,K[0].y);for(let e=1;e<4;e++)r.lineTo(K[e].x,K[e].y);r.closePath(),r.fill(),r.restore()}destroy(){this._renderer=null}};q.extension={type:[w.CanvasPipes],name:`tilingSprite`};const ue={name:`tiling-bit`,vertex:{header:`
            struct TilingUniforms {
                uMapCoord:mat3x3<f32>,
                uClampFrame:vec4<f32>,
                uClampOffset:vec2<f32>,
                uTextureTransform:mat3x3<f32>,
                uSizeAnchor:vec4<f32>
            };

            @group(2) @binding(0) var<uniform> tilingUniforms: TilingUniforms;
            @group(2) @binding(1) var uTexture: texture_2d<f32>;
            @group(2) @binding(2) var uSampler: sampler;
        `,main:`
            uv = (tilingUniforms.uTextureTransform * vec3(uv, 1.0)).xy;

            position = (position - tilingUniforms.uSizeAnchor.zw) * tilingUniforms.uSizeAnchor.xy;
        `},fragment:{header:`
            struct TilingUniforms {
                uMapCoord:mat3x3<f32>,
                uClampFrame:vec4<f32>,
                uClampOffset:vec2<f32>,
                uTextureTransform:mat3x3<f32>,
                uSizeAnchor:vec4<f32>
            };

            @group(2) @binding(0) var<uniform> tilingUniforms: TilingUniforms;
            @group(2) @binding(1) var uTexture: texture_2d<f32>;
            @group(2) @binding(2) var uSampler: sampler;
        `,main:`

            var coord = vUV + ceil(tilingUniforms.uClampOffset - vUV);
            coord = (tilingUniforms.uMapCoord * vec3(coord, 1.0)).xy;
            var unclamped = coord;
            coord = clamp(coord, tilingUniforms.uClampFrame.xy, tilingUniforms.uClampFrame.zw);

            var bias = 0.;

            if(unclamped.x == coord.x && unclamped.y == coord.y)
            {
                bias = -32.;
            }

            outColor = textureSampleBias(uTexture, uSampler, coord, bias);
        `}},de={name:`tiling-bit`,vertex:{header:`
            uniform mat3 uTextureTransform;
            uniform vec4 uSizeAnchor;

        `,main:`
            uv = (uTextureTransform * vec3(aUV, 1.0)).xy;

            position = (position - uSizeAnchor.zw) * uSizeAnchor.xy;
        `},fragment:{header:`
            uniform sampler2D uTexture;
            uniform mat3 uMapCoord;
            uniform vec4 uClampFrame;
            uniform vec2 uClampOffset;
        `,main:`

        vec2 coord = vUV + ceil(uClampOffset - vUV);
        coord = (uMapCoord * vec3(coord, 1.0)).xy;
        vec2 unclamped = coord;
        coord = clamp(coord, uClampFrame.xy, uClampFrame.zw);

        outColor = texture(uTexture, coord, unclamped == coord ? 0.0 : -32.0);// lod-bias very negative to force lod 0

        `}};let J,Y;var fe=class extends h{constructor(){J??=te({name:`tiling-sprite-shader`,bits:[re,ue,F]}),Y??=M({name:`tiling-sprite-shader`,bits:[ie,de,P]});let e=new _({uMapCoord:{value:new S,type:`mat3x3<f32>`},uClampFrame:{value:new Float32Array([0,0,1,1]),type:`vec4<f32>`},uClampOffset:{value:new Float32Array([0,0]),type:`vec2<f32>`},uTextureTransform:{value:new S,type:`mat3x3<f32>`},uSizeAnchor:{value:new Float32Array([100,100,.5,.5]),type:`vec4<f32>`}});super({glProgram:Y,gpuProgram:J,resources:{localUniforms:new _({uTransformMatrix:{value:new S,type:`mat3x3<f32>`},uColor:{value:new Float32Array([1,1,1,1]),type:`vec4<f32>`},uRound:{value:0,type:`f32`}}),tilingUniforms:e,uTexture:d.EMPTY.source,uSampler:d.EMPTY.source.style}})}updateUniforms(e,t,n,r,i,a){let o=this.resources.tilingUniforms,s=a.width,c=a.height,l=a.textureMatrix,u=o.uniforms.uTextureTransform;u.set(n.a*s/e,n.b*s/t,n.c*c/e,n.d*c/t,n.tx/e,n.ty/t),u.invert(),o.uniforms.uMapCoord=l.mapCoord,o.uniforms.uClampFrame=l.uClampFrame,o.uniforms.uClampOffset=l.uClampOffset,o.uniforms.uTextureTransform=u,o.uniforms.uSizeAnchor[0]=e,o.uniforms.uSizeAnchor[1]=t,o.uniforms.uSizeAnchor[2]=r,o.uniforms.uSizeAnchor[3]=i,a&&(this.resources.uTexture=a.source,this.resources.uSampler=a.source.style)}},pe=class extends r{constructor(){super({positions:new Float32Array([0,0,1,0,1,1,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])})}};function me(e,t){let n=e.anchor.x,r=e.anchor.y;t[0]=-n*e.width,t[1]=-r*e.height,t[2]=(1-n)*e.width,t[3]=-r*e.height,t[4]=(1-n)*e.width,t[5]=(1-r)*e.height,t[6]=-n*e.width,t[7]=(1-r)*e.height}function he(e,t,n,r){let i=0,a=e.length/(t||2),o=r.a,s=r.b,c=r.c,l=r.d,u=r.tx,d=r.ty;for(n*=t;i<a;){let r=e[n],a=e[n+1];e[n]=o*r+c*a+u,e[n+1]=s*r+l*a+d,n+=t,i++}}function ge(e,t){let n=e.texture,r=n.frame.width,i=n.frame.height,a=0,o=0;e.applyAnchorToTexture&&(a=e.anchor.x,o=e.anchor.y),t[0]=t[6]=-a,t[2]=t[4]=1-a,t[1]=t[3]=-o,t[5]=t[7]=1-o;let s=e._tileTransform.matrix,c=S.shared;c.set(s.a*r/e.width,s.b*r/e.height,s.c*i/e.width,s.d*i/e.height,s.tx/e.width,s.ty/e.height),c.invert(),he(t,2,0,c)}const X=new pe;var _e=class{constructor(){this.canBatch=!0,this.geometry=new r({indices:X.indices.slice(),positions:X.positions.slice(),uvs:X.uvs.slice()})}destroy(){this.geometry.destroy(),this.shader?.destroy()}},ve=class{constructor(e){this._state=C.default2d,this._renderer=e,this._managedTilingSprites=new N({renderer:e,type:`renderable`,name:`tilingSprite`})}validateRenderable(e){let t=this._getTilingSpriteData(e),n=t.canBatch;this._updateCanBatch(e);let r=t.canBatch;if(r&&r===n){let{batchableMesh:n}=t;return!n._batcher.checkAndUpdateTexture(n,e.texture)}return n!==r}addRenderable(t,n){let r=this._renderer.renderPipes.batch;this._updateCanBatch(t);let i=this._getTilingSpriteData(t),{geometry:a,canBatch:o}=i;if(o){i.batchableMesh||=new e;let o=i.batchableMesh;t.didViewUpdate&&(this._updateBatchableMesh(t),o.geometry=a,o.renderable=t,o.transform=t.groupTransform,o.setTexture(t._texture)),o.roundPixels=this._renderer._roundPixels|t._roundPixels,r.addToBatch(o,n)}else r.break(n),i.shader||=new fe,this.updateRenderable(t),n.add(t)}execute(e){let t=this._renderer,{shader:n}=this._getTilingSpriteData(e);n.groups[0]=t.globalUniforms.bindGroup;let r=n.resources.localUniforms.uniforms;r.uTransformMatrix=e.groupTransform,r.uRound=t._roundPixels|e._roundPixels,I(e.groupColorAlpha,r.uColor,0),this._state.blendMode=ee(e.groupBlendMode,e.texture._source),t.encoder.draw({geometry:X,shader:n,state:this._state})}updateRenderable(e){let t=this._getTilingSpriteData(e),{canBatch:n}=t;if(n){let{batchableMesh:n}=t;e.didViewUpdate&&this._updateBatchableMesh(e),n._batcher.updateElement(n)}else if(e.didViewUpdate){let{shader:n}=t;n.updateUniforms(e.width,e.height,e._tileTransform.matrix,e.anchor.x,e.anchor.y,e.texture)}}_getTilingSpriteData(e){return e._gpuData[this._renderer.uid]||this._initTilingSpriteData(e)}_initTilingSpriteData(e){let t=new _e;return t.renderable=e,e._gpuData[this._renderer.uid]=t,this._managedTilingSprites.add(e),t}_updateBatchableMesh(e){let{geometry:t}=this._getTilingSpriteData(e),n=e.texture.source.style;n.addressMode!==`repeat`&&(n.addressMode=`repeat`,n.update()),ge(e,t.uvs),me(e,t.positions)}destroy(){this._managedTilingSprites.destroy(),this._renderer=null}_updateCanBatch(e){let t=this._getTilingSpriteData(e),n=e.texture,r=!0;return this._renderer.type===T.WEBGL&&(r=this._renderer.context.supports.nonPowOf2wrapping),t.canBatch=n.textureMatrix.isSimple&&(r||n.source.isPowerOfTwo),t.canBatch}};ve.extension={type:[w.WebGLPipes,w.WebGPUPipes],name:`tilingSprite`},g.add(q),g.add(ve);const ye=class e extends s{constructor(...t){let n=t[0]||{};n instanceof d&&(n={texture:n}),t.length>1&&(f(p,`use new TilingSprite({ texture, width:100, height:100 }) instead`),n.width=t[1],n.height=t[2]),n={...e.defaultOptions,...n};let{texture:r,anchor:i,tilePosition:a,tileScale:o,tileRotation:s,width:c,height:l,applyAnchorToTexture:u,roundPixels:m,...h}=n??{};super({label:`TilingSprite`,...h}),this.renderPipeId=`tilingSprite`,this.batched=!0,this.allowChildren=!1,this._anchor=new b({_onUpdate:()=>{this.onViewUpdate()}}),this.applyAnchorToTexture=u,this.texture=r,this._width=c??r.width,this._height=l??r.height,this._tileTransform=new le({observer:{_onUpdate:()=>this.onViewUpdate()}}),i&&(this.anchor=i),this.tilePosition=a,this.tileScale=o,this.tileRotation=s,this.roundPixels=m??!1}static from(t,n={}){return typeof t==`string`?new e({texture:ae.get(t),...n}):new e({texture:t,...n})}get uvRespectAnchor(){return f(p,`uvRespectAnchor is deprecated, please use applyAnchorToTexture instead`),this.applyAnchorToTexture}set uvRespectAnchor(e){f(p,`uvRespectAnchor is deprecated, please use applyAnchorToTexture instead`),this.applyAnchorToTexture=e}get clampMargin(){return this._texture.textureMatrix.clampMargin}set clampMargin(e){this._texture.textureMatrix.clampMargin=e}get anchor(){return this._anchor}set anchor(e){typeof e==`number`?this._anchor.set(e):this._anchor.copyFrom(e)}get tilePosition(){return this._tileTransform.position}set tilePosition(e){this._tileTransform.position.copyFrom(e)}get tileScale(){return this._tileTransform.scale}set tileScale(e){typeof e==`number`?this._tileTransform.scale.set(e):this._tileTransform.scale.copyFrom(e)}set tileRotation(e){this._tileTransform.rotation=e}get tileRotation(){return this._tileTransform.rotation}get tileTransform(){return this._tileTransform}set texture(e){e||=d.EMPTY;let t=this._texture;t!==e&&(t&&t.dynamic&&t.off(`update`,this.onViewUpdate,this),e.dynamic&&e.on(`update`,this.onViewUpdate,this),this._texture=e,this.onViewUpdate())}get texture(){return this._texture}set width(e){this._width=e,this.onViewUpdate()}get width(){return this._width}set height(e){this._height=e,this.onViewUpdate()}get height(){return this._height}setSize(e,t){typeof e==`object`&&(t=e.height??e.width,e=e.width),this._width=e,this._height=t??e,this.onViewUpdate()}getSize(e){return e||={},e.width=this._width,e.height=this._height,e}updateBounds(){let e=this._bounds,t=this._anchor,n=this._width,r=this._height;e.minX=-t._x*n,e.maxX=e.minX+n,e.minY=-t._y*r,e.maxY=e.minY+r}containsPoint(e){let t=this._width,n=this._height,r=-t*this._anchor._x,i=0;return e.x>=r&&e.x<=r+t&&(i=-n*this._anchor._y,e.y>=i&&e.y<=i+n)}destroy(e=!1){if(super.destroy(e),this._anchor=null,this._tileTransform=null,this._bounds=null,typeof e==`boolean`?e:e?.texture){let t=typeof e==`boolean`?e:e?.textureSource;this._texture.destroy(t)}this._texture=null}};ye.defaultOptions={texture:d.EMPTY,anchor:{x:0,y:0},tilePosition:{x:0,y:0},tileScale:{x:1,y:1},tileRotation:0,applyAnchorToTexture:!1};let be=ye;var xe=`
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uOffset;

void main(void)
{
    vec4 color = vec4(0.0);

    // Sample top left pixel
    color += texture(uTexture, vec2(vTextureCoord.x - uOffset.x, vTextureCoord.y + uOffset.y));

    // Sample top right pixel
    color += texture(uTexture, vec2(vTextureCoord.x + uOffset.x, vTextureCoord.y + uOffset.y));

    // Sample bottom right pixel
    color += texture(uTexture, vec2(vTextureCoord.x + uOffset.x, vTextureCoord.y - uOffset.y));

    // Sample bottom left pixel
    color += texture(uTexture, vec2(vTextureCoord.x - uOffset.x, vTextureCoord.y - uOffset.y));

    // Average
    color *= 0.25;

    finalColor = color;
}`,Se=`struct KawaseBlurUniforms {
  uOffset:vec2<f32>,
};

@group(0) @binding(1) var uTexture: texture_2d<f32>; 
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> kawaseBlurUniforms : KawaseBlurUniforms;

@fragment
fn mainFragment(
  @builtin(position) position: vec4<f32>,
  @location(0) uv : vec2<f32>
) -> @location(0) vec4<f32> {
  let uOffset = kawaseBlurUniforms.uOffset;
  var color: vec4<f32> = vec4<f32>(0.0);

  // Sample top left pixel
  color += textureSample(uTexture, uSampler, vec2<f32>(uv.x - uOffset.x, uv.y + uOffset.y));
  // Sample top right pixel
  color += textureSample(uTexture, uSampler, vec2<f32>(uv.x + uOffset.x, uv.y + uOffset.y));
  // Sample bottom right pixel
  color += textureSample(uTexture, uSampler, vec2<f32>(uv.x + uOffset.x, uv.y - uOffset.y));
  // Sample bottom left pixel
  color += textureSample(uTexture, uSampler, vec2<f32>(uv.x - uOffset.x, uv.y - uOffset.y));
  // Average
  color *= 0.25;

  return color;
}`,Ce=`
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uOffset;

uniform vec4 uInputClamp;

void main(void)
{
    vec4 color = vec4(0.0);

    // Sample top left pixel
    color += texture(uTexture, clamp(vec2(vTextureCoord.x - uOffset.x, vTextureCoord.y + uOffset.y), uInputClamp.xy, uInputClamp.zw));

    // Sample top right pixel
    color += texture(uTexture, clamp(vec2(vTextureCoord.x + uOffset.x, vTextureCoord.y + uOffset.y), uInputClamp.xy, uInputClamp.zw));

    // Sample bottom right pixel
    color += texture(uTexture, clamp(vec2(vTextureCoord.x + uOffset.x, vTextureCoord.y - uOffset.y), uInputClamp.xy, uInputClamp.zw));

    // Sample bottom left pixel
    color += texture(uTexture, clamp(vec2(vTextureCoord.x - uOffset.x, vTextureCoord.y - uOffset.y), uInputClamp.xy, uInputClamp.zw));

    // Average
    color *= 0.25;

    finalColor = color;
}
`,we=`struct KawaseBlurUniforms {
  uOffset:vec2<f32>,
};

struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;

@group(0) @binding(1) var uTexture: texture_2d<f32>; 
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> kawaseBlurUniforms : KawaseBlurUniforms;

@fragment
fn mainFragment(
  @builtin(position) position: vec4<f32>,
  @location(0) uv : vec2<f32>
) -> @location(0) vec4<f32> {
  let uOffset = kawaseBlurUniforms.uOffset;
  var color: vec4<f32> = vec4(0.0);

  // Sample top left pixel
  color += textureSample(uTexture, uSampler, clamp(vec2<f32>(uv.x - uOffset.x, uv.y + uOffset.y), gfu.uInputClamp.xy, gfu.uInputClamp.zw));
  // Sample top right pixel
  color += textureSample(uTexture, uSampler, clamp(vec2<f32>(uv.x + uOffset.x, uv.y + uOffset.y), gfu.uInputClamp.xy, gfu.uInputClamp.zw));
  // Sample bottom right pixel
  color += textureSample(uTexture, uSampler, clamp(vec2<f32>(uv.x + uOffset.x, uv.y - uOffset.y), gfu.uInputClamp.xy, gfu.uInputClamp.zw));
  // Sample bottom left pixel
  color += textureSample(uTexture, uSampler, clamp(vec2<f32>(uv.x - uOffset.x, uv.y - uOffset.y), gfu.uInputClamp.xy, gfu.uInputClamp.zw));
  // Average
  color *= 0.25;
    
  return color;
}`,Te=Object.defineProperty,Ee=(e,t,n)=>t in e?Te(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,Z=(e,t,n)=>(Ee(e,typeof t==`symbol`?t:t+``,n),n);const De=class e extends m{constructor(...t){let r=t[0]??{};(typeof r==`number`||Array.isArray(r))&&(f(`6.0.0`,`KawaseBlurFilter constructor params are now options object. See params: { strength, quality, clamp, pixelSize }`),r={strength:r},t[1]!==void 0&&(r.quality=t[1]),t[2]!==void 0&&(r.clamp=t[2])),r={...e.DEFAULT_OPTIONS,...r};let i=x.from({vertex:{source:a,entryPoint:`mainVertex`},fragment:{source:r?.clamp?we:Se,entryPoint:`mainFragment`}}),o=v.from({vertex:n,fragment:r?.clamp?Ce:xe,name:`kawase-blur-filter`});super({gpuProgram:i,glProgram:o,resources:{kawaseBlurUniforms:{uOffset:{value:new Float32Array(2),type:`vec2<f32>`}}}}),Z(this,`uniforms`),Z(this,`_pixelSize`,{x:0,y:0}),Z(this,`_clamp`),Z(this,`_kernels`,[]),Z(this,`_blur`),Z(this,`_quality`),this.uniforms=this.resources.kawaseBlurUniforms.uniforms,this.pixelSize=r.pixelSize??{x:1,y:1},Array.isArray(r.strength)?this.kernels=r.strength:typeof r.strength==`number`&&(this._blur=r.strength,this.quality=r.quality??3),this._clamp=!!r.clamp}apply(e,t,n,r){let i=this.pixelSizeX/t.source.width,a=this.pixelSizeY/t.source.height,o;if(this._quality===1||this._blur===0)o=this._kernels[0]+.5,this.uniforms.uOffset[0]=o*i,this.uniforms.uOffset[1]=o*a,e.applyFilter(this,t,n,r);else{let s=c.getSameSizeTexture(t),l=t,u=s,d,f=this._quality-1;for(let t=0;t<f;t++)o=this._kernels[t]+.5,this.uniforms.uOffset[0]=o*i,this.uniforms.uOffset[1]=o*a,e.applyFilter(this,l,u,!0),d=l,l=u,u=d;o=this._kernels[f]+.5,this.uniforms.uOffset[0]=o*i,this.uniforms.uOffset[1]=o*a,e.applyFilter(this,l,n,r),c.returnTexture(s)}}get strength(){return this._blur}set strength(e){this._blur=e,this._generateKernels()}get quality(){return this._quality}set quality(e){this._quality=Math.max(1,Math.round(e)),this._generateKernels()}get kernels(){return this._kernels}set kernels(e){Array.isArray(e)&&e.length>0?(this._kernels=e,this._quality=e.length,this._blur=Math.max(...e)):(this._kernels=[0],this._quality=1)}get pixelSize(){return this._pixelSize}set pixelSize(e){typeof e==`number`?this.pixelSizeX=this.pixelSizeY=e:Array.isArray(e)?(this.pixelSizeX=e[0],this.pixelSizeY=e[1]):this._pixelSize=e}get pixelSizeX(){return this.pixelSize.x}set pixelSizeX(e){this.pixelSize.x=e}get pixelSizeY(){return this.pixelSize.y}set pixelSizeY(e){this.pixelSize.y=e}get clamp(){return this._clamp}_updatePadding(){this.padding=Math.ceil(this._kernels.reduce((e,t)=>e+t+.5,0))}_generateKernels(){let e=this._blur,t=this._quality,n=[e];if(e>0){let r=e,i=e/t;for(let e=1;e<t;e++)r-=i,n.push(r)}this._kernels=n,this._updatePadding()}};Z(De,`DEFAULT_OPTIONS`,{strength:4,quality:3,clamp:!1,pixelSize:{x:1,y:1}});let Oe=De;var ke=`in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMapTexture;
uniform float uBloomScale;
uniform float uBrightness;

void main() {
    vec4 color = texture(uTexture, vTextureCoord);
    color.rgb *= uBrightness;
    vec4 bloomColor = vec4(texture(uMapTexture, vTextureCoord).rgb, 0.0);
    bloomColor.rgb *= uBloomScale;
    finalColor = color + bloomColor;
}
`,Ae=`struct AdvancedBloomUniforms {
  uBloomScale: f32,
  uBrightness: f32,
};

@group(0) @binding(1) var uTexture: texture_2d<f32>; 
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> advancedBloomUniforms : AdvancedBloomUniforms;
@group(1) @binding(1) var uMapTexture: texture_2d<f32>;

@fragment
fn mainFragment(
  @builtin(position) position: vec4<f32>,
  @location(0) uv : vec2<f32>
) -> @location(0) vec4<f32> {
  var color = textureSample(uTexture, uSampler, uv);
  color = vec4<f32>(color.rgb * advancedBloomUniforms.uBrightness, color.a);

  var bloomColor = vec4<f32>(textureSample(uMapTexture, uSampler, uv).rgb, 0.0);
  bloomColor = vec4<f32>(bloomColor.rgb * advancedBloomUniforms.uBloomScale, bloomColor.a);
  
  return color + bloomColor;
}
`,je=`
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uThreshold;

void main() {
    vec4 color = texture(uTexture, vTextureCoord);

    // A simple & fast algorithm for getting brightness.
    // It's inaccuracy , but good enought for this feature.
    float _max = max(max(color.r, color.g), color.b);
    float _min = min(min(color.r, color.g), color.b);
    float brightness = (_max + _min) * 0.5;

    if(brightness > uThreshold) {
        finalColor = color;
    } else {
        finalColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
}
`,Me=`struct ExtractBrightnessUniforms {
  uThreshold: f32,
};

@group(0) @binding(1) var uTexture: texture_2d<f32>; 
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> extractBrightnessUniforms : ExtractBrightnessUniforms;

@fragment
fn mainFragment(
  @builtin(position) position: vec4<f32>,
  @location(0) uv : vec2<f32>
) -> @location(0) vec4<f32> {
  let color: vec4<f32> = textureSample(uTexture, uSampler, uv);

  // A simple & fast algorithm for getting brightness.
  // It's inaccurate, but good enough for this feature.
  let max: f32 = max(max(color.r, color.g), color.b);
  let min: f32 = min(min(color.r, color.g), color.b);
  let brightness: f32 = (max + min) * 0.5;

  return select(vec4<f32>(0.), color, brightness > extractBrightnessUniforms.uThreshold);
}
`,Ne=Object.defineProperty,Pe=(e,t,n)=>t in e?Ne(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,Fe=(e,t,n)=>(Pe(e,typeof t==`symbol`?t:t+``,n),n);const Ie=class e extends m{constructor(t){t={...e.DEFAULT_OPTIONS,...t};let r=x.from({vertex:{source:a,entryPoint:`mainVertex`},fragment:{source:Me,entryPoint:`mainFragment`}}),i=v.from({vertex:n,fragment:je,name:`extract-brightness-filter`});super({gpuProgram:r,glProgram:i,resources:{extractBrightnessUniforms:{uThreshold:{value:t.threshold,type:`f32`}}}}),Fe(this,`uniforms`),this.uniforms=this.resources.extractBrightnessUniforms.uniforms}get threshold(){return this.uniforms.uThreshold}set threshold(e){this.uniforms.uThreshold=e}};Fe(Ie,`DEFAULT_OPTIONS`,{threshold:.5});let Le=Ie;var Re=Object.defineProperty,ze=(e,t,n)=>t in e?Re(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,Q=(e,t,n)=>(ze(e,typeof t==`symbol`?t:t+``,n),n);const Be=class e extends m{constructor(t){t={...e.DEFAULT_OPTIONS,...t};let r=x.from({vertex:{source:a,entryPoint:`mainVertex`},fragment:{source:Ae,entryPoint:`mainFragment`}}),i=v.from({vertex:n,fragment:ke,name:`advanced-bloom-filter`});super({gpuProgram:r,glProgram:i,resources:{advancedBloomUniforms:{uBloomScale:{value:t.bloomScale,type:`f32`},uBrightness:{value:t.brightness,type:`f32`}},uMapTexture:d.WHITE}}),Q(this,`uniforms`),Q(this,`bloomScale`,1),Q(this,`brightness`,1),Q(this,`_extractFilter`),Q(this,`_blurFilter`),this.uniforms=this.resources.advancedBloomUniforms.uniforms,this._extractFilter=new Le({threshold:t.threshold}),this._blurFilter=new Oe({strength:t.kernels??t.blur,quality:t.kernels?void 0:t.quality}),Object.assign(this,t)}apply(e,t,n,r){let i=c.getSameSizeTexture(t);this._extractFilter.apply(e,t,i,!0);let a=c.getSameSizeTexture(t);this._blurFilter.apply(e,i,a,!0),this.uniforms.uBloomScale=this.bloomScale,this.uniforms.uBrightness=this.brightness,this.resources.uMapTexture=a.source,e.applyFilter(this,t,n,r),c.returnTexture(a),c.returnTexture(i)}get threshold(){return this._extractFilter.threshold}set threshold(e){this._extractFilter.threshold=e}get kernels(){return this._blurFilter.kernels}set kernels(e){this._blurFilter.kernels=e}get blur(){return this._blurFilter.strength}set blur(e){this._blurFilter.strength=e}get quality(){return this._blurFilter.quality}set quality(e){this._blurFilter.quality=e}get pixelSize(){return this._blurFilter.pixelSize}set pixelSize(e){typeof e==`number`&&(e={x:e,y:e}),Array.isArray(e)&&(e={x:e[0],y:e[1]}),this._blurFilter.pixelSize=e}get pixelSizeX(){return this._blurFilter.pixelSizeX}set pixelSizeX(e){this._blurFilter.pixelSizeX=e}get pixelSizeY(){return this._blurFilter.pixelSizeY}set pixelSizeY(e){this._blurFilter.pixelSizeY=e}};Q(Be,`DEFAULT_OPTIONS`,{threshold:.5,bloomScale:1,brightness:1,blur:8,quality:4,pixelSize:{x:1,y:1}});let Ve=Be;var He=class{constructor(e,{textures:t=[`enemy_chaser`],clips:n=null,scale:r=1,worldScale:a=1,offsetX:o=0,offsetY:s=0,syncRotation:c=!1,flipByDirection:l=!1,cull:u=!0}={}){if(!e?.worldRoot||!e?.atlas?.textures)throw TypeError(`Initialize Renderer2D before creating a swarm layer`);let d=n??(Array.isArray(t)?t.map(e=>({frames:[e]})):null);if(!Array.isArray(d)||d.length===0)throw TypeError(`Swarm clips or textures must be a non-empty array`);if(![r,a,o,s].every(Number.isFinite)||r<=0||a<=0)throw RangeError(`Swarm scale and worldScale must be positive and offsets must be finite`);this.renderer=e,this.scale=r,this.worldScale=a,this.offsetX=o,this.offsetY=s,this.syncRotation=!!c,this.flipByDirection=!!l,this.cull=!!u,this.clips=d.map(t=>{if(!t||!Array.isArray(t.frames)||t.frames.length===0||t.frames.some(t=>typeof t!=`string`||!e.atlas.textures.has(t)))throw TypeError(`Swarm clip frames must be existing atlas frame names`);let n=t.fps??8;if(!Number.isFinite(n)||n<=0)throw RangeError(`Swarm clip fps must be positive`);let r=t.frames.map(t=>{let n=e.atlas.textures.get(t);return{texture:n,white:e.atlas.textures.get(t+`_white`)??n,radius:Math.hypot(n.orig.width,n.orig.height)*.5}});return{frames:r,fps:n,loop:t.loop!==!1,radius:Math.max(...r.map(e=>e.radius))}}),this.dynamicUvs=this.clips.some(e=>e.frames.length>1),this.dynamicRotation=this.syncRotation,this.layer=new i({dynamicProperties:{position:!0,uvs:this.dynamicUvs,rotation:this.dynamicRotation,vertex:!0}}),e.worldRoot.addChildAt(this.layer,e.worldRoot.getChildIndex(e.entityLayer)),this.particles=[],this.pool=[],this.pendingParticles=[],this.visibleCount=0,this.disposed=!1}sync(e){if(this.disposed)throw Error(`Swarm layer is disposed`);if(!e?.activeIds||!e.posX||!e.posY||!Number.isInteger(e.count))throw TypeError(`sync requires an HGame CPU SwarmSimulation`);let n=e.count;if(n<0||n>e.activeIds.length)throw RangeError(`Swarm count exceeds active ID capacity`);let r=this.renderer.camera,i=this.renderer.app.screen,a=i.width/2,o=i.height/2,s=r.zoom;if(!(s>0)||!Number.isFinite(s))throw RangeError(`Camera zoom must be finite and positive`);let c=r.x+(-a-r.shakeX)/s,l=r.x+(a-r.shakeX)/s,u=r.y+(-o-r.shakeY)/s,d=r.y+(o-r.shakeY)/s,f=this.clips,p=f.length===1?f[0]:null,m=e.posX,h=e.posY,g=e.activeIds,_=e.animClip,v=e.scale,y=e.rot,b=e.animTime,x=e.flash,S=this.worldScale,C=this.offsetX,w=this.offsetY,T=this.scale,E=this.cull,D=this.syncRotation,O=this.flipByDirection,k=this.dynamicUvs,ee=this.dynamicRotation,A=!1,j=0;for(let e=0;e<n;e++){let n=g[e],r=m[n]*S+C,i=h[n]*S+w,a=p??f[(_?.[n]??0)%f.length],o=(v?.[n]??1)*T;if(E){let e=a.radius*Math.abs(o);if(r+e<c||r-e>l||i+e<u||i-e>d)continue}let s=0;if(a.frames.length>1){let e=b?.[n]??0,t=Number.isFinite(e)?Math.max(0,Math.floor(e*a.fps)):0;s=a.loop?t%a.frames.length:Math.min(t,a.frames.length-1)}let M=a.frames[s],N=this.particles[j],P=x?.[n]>0?M.white:M.texture;N||(N=this.pool.pop()??new t({texture:P,anchorX:.5,anchorY:.5}),this.particles.push(N),this.pendingParticles.push(N),this.pendingParticles.length===4096&&this.flushPending()),N.texture!==P&&(N.texture=P,k||(A=!0)),N.x=r,N.y=i;let F=D||O?y?.[n]??0:0,I=D?F:0;N.rotation!==I&&(N.rotation=I,ee||(A=!0)),N.scaleX=O&&Math.sin(F)<0?-o:o,N.scaleY=o,j++}if(this.flushPending(),j<this.particles.length){for(let e=j;e<this.particles.length;e++)this.pool.push(this.particles[e]);this.particles.length=j,this.layer.particleChildren.length=j,A=!0}return A&&this.layer.update(),this.visibleCount=j,j}flushPending(){this.pendingParticles.length&&this.layer.addParticle(...this.pendingParticles),this.pendingParticles.length=0}dispose(){this.disposed||(this.disposed=!0,this.layer.removeFromParent(),this.layer.destroy(),this.particles.length=0,this.pool.length=0,this.pendingParticles.length=0,this.visibleCount=0,this.renderer.swarmLayers.delete(this))}},Ue=class{constructor(e,t,{frames:n,layer:r=`background`,chunkSize:i=32,maxCachedChunks:a=128,originX:o=0,originY:s=0}={}){if(!e?.bgLayer||!e?.atlas?.textures)throw TypeError(`Initialize Renderer2D before creating a tilemap layer`);if(!t||typeof t.get!=`function`||!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<1||t.height<1||!Number.isFinite(t.tileWidth)||!Number.isFinite(t.tileHeight)||!(t.tileWidth>0)||!(t.tileHeight>0))throw TypeError(`A rectangular HGame TileMap with positive tile dimensions is required`);if(!n||typeof n!=`object`||Array.isArray(n))throw TypeError(`frames must map tile values to atlas frame names`);if(r!==`background`&&r!==`foreground`)throw RangeError(`Tilemap layer must be background or foreground`);if(!Number.isInteger(i)||i<1||i>128)throw RangeError(`chunkSize must be an integer from 1 to 128`);if(!Number.isInteger(a)||a<1||a>4096)throw RangeError(`maxCachedChunks must be an integer from 1 to 4096`);if(!Number.isFinite(o)||!Number.isFinite(s))throw RangeError(`Tilemap origin must be finite`);this.renderer=e,this.map=t,this.frames=new Map;for(let[t,r]of Object.entries(n)){if(r==null)continue;let n=e.atlas.textures.get(r);if(!n)throw Error(`Unknown tilemap atlas frame: `+r);this.frames.set(t,n)}this.chunkSize=i,this.maxCachedChunks=a,this.originX=o,this.originY=s,this.cols=Math.ceil(t.width/i),this.rows=Math.ceil(t.height/i),this.root=new D,this.root.eventMode=`none`,this.root.interactiveChildren=!1,this.chunks=new Map,this.visibleRange=null,this.disposed=!1;try{(r===`foreground`?e.foregroundLayer:e.bgLayer).addChild(this.root),this.update()}catch(e){throw this.root.destroy({children:!0}),e}}buildChunk(e,t){let n=t*this.cols+e,r=e*this.chunkSize,a=t*this.chunkSize,o=Math.min(this.map.width,r+this.chunkSize),s=Math.min(this.map.height,a+this.chunkSize),c=new i({dynamicProperties:{position:!1,vertex:!1,uvs:!1,rotation:!1,color:!1}}),l={view:c,x0:r,y0:a,x1:o,y1:s,cells:Array((o-r)*(s-a)).fill(null)};return this.chunks.set(n,l),this.root.addChild(c),this.refreshChunk(l),l}updateCell(e,n,r){let i=(r-e.y0)*(e.x1-e.x0)+n-e.x0,a=e.cells[i],o=this.frames.get(String(this.map.get(n,r)));if(!o)return a?(e.cells[i]=null,2):0;let s=this.originX+n*this.map.tileWidth,c=this.originY+r*this.map.tileHeight,l=this.map.tileWidth/o.orig.width,u=this.map.tileHeight/o.orig.height;if(a&&a.texture===o&&a.x===s&&a.y===c&&a.scaleX===l&&a.scaleY===u)return 0;let d=a??new t({texture:o});return d.texture=o,d.x=s,d.y=c,d.scaleX=l,d.scaleY=u,e.cells[i]=d,a?1:2}commitChunkChanges(e,t){if(t===2){let t=e.view.particleChildren;t.length=0;for(let n of e.cells)n&&t.push(n)}t>0&&e.view.update()}refreshChunk(e){let t=0;for(let n=e.y0;n<e.y1;n++)for(let r=e.x0;r<e.x1;r++)t=Math.max(t,this.updateCell(e,r,n));this.commitChunkChanges(e,t)}cachedChunkAt(e,t){return this.chunks.get(Math.floor(t/this.chunkSize)*this.cols+Math.floor(e/this.chunkSize))}refreshTile(e,t){if(this.disposed)throw Error(`Tilemap layer is disposed`);if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw RangeError(`Tile is outside the map`);let n=this.cachedChunkAt(e,t);n&&this.refreshChunk(n)}setTile(e,t,n){if(this.disposed)throw Error(`Tilemap layer is disposed`);if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw RangeError(`Tile is outside the map`);if(typeof this.map.set!=`function`)throw TypeError(`Tilemap must support set`);if(Object.is(this.map.get(e,t),n))return;this.map.set(e,t,n);let r=this.cachedChunkAt(e,t);r&&this.commitChunkChanges(r,this.updateCell(r,e,t))}setTiles(e){if(this.disposed)throw Error(`Tilemap layer is disposed`);if(!Array.isArray(e))throw TypeError(`Tile edits must be an array`);if(typeof this.map.set!=`function`)throw TypeError(`Tilemap must support set`);for(let t of e)if(!t||!Object.hasOwn(t,`value`)||!Number.isInteger(t.x)||!Number.isInteger(t.y)||t.x<0||t.y<0||t.x>=this.map.width||t.y>=this.map.height)throw RangeError(`Each tile edit needs an in-bounds x, y, and value`);let t=new Map;try{for(let{x:n,y:r,value:i}of e){if(Object.is(this.map.get(n,r),i))continue;this.map.set(n,r,i);let e=this.cachedChunkAt(n,r);if(!e)continue;let a=this.updateCell(e,n,r);a>0&&t.set(e,Math.max(a,t.get(e)??0))}}finally{for(let[e,n]of t)this.commitChunkChanges(e,n)}}update(){if(this.disposed)return;let e=this.renderer.camera,t=this.renderer.app.screen,n=e.zoom;if(!(n>0)||!Number.isFinite(n))throw RangeError(`Camera zoom must be finite and positive`);let r=e.x+(-t.width/2-e.shakeX)/n,i=e.x+(t.width/2-e.shakeX)/n,a=e.y+(-t.height/2-e.shakeY)/n,o=e.y+(t.height/2-e.shakeY)/n,s=this.chunkSize*this.map.tileWidth,c=this.chunkSize*this.map.tileHeight,l=Math.max(0,Math.ceil((r-this.originX)/s)-1),u=Math.min(this.cols-1,Math.floor((i-this.originX)/s)),d=Math.max(0,Math.ceil((a-this.originY)/c)-1),f=Math.min(this.rows-1,Math.floor((o-this.originY)/c)),p=this.visibleRange;if(!(p&&p.x0===l&&p.x1===u&&p.y0===d&&p.y1===f)){if(p)for(let e=p.y0;e<=p.y1;e++)for(let t=p.x0;t<=p.x1;t++)(t<l||t>u||e<d||e>f)&&(this.chunks.get(e*this.cols+t).view.visible=!1);for(let e=d;e<=f;e++)for(let t=l;t<=u;t++){let n=e*this.cols+t,r=this.chunks.get(n)??this.buildChunk(t,e);r.view.visible=!0,this.chunks.delete(n),this.chunks.set(n,r)}for(let[e,t]of this.chunks){if(this.chunks.size<=this.maxCachedChunks||t.view.visible)break;t.view.removeFromParent(),t.view.destroy(),this.chunks.delete(e)}this.visibleRange={x0:l,x1:u,y0:d,y1:f}}}dispose(){this.disposed||(this.disposed=!0,this.root.removeFromParent(),this.root.destroy({children:!0}),this.chunks.clear(),this.visibleRange=null,this.renderer.tilemapLayers.delete(this))}};const $=[`webgpu`,`webgl`,`canvas`];var We=class{constructor(e,{backend:t=`auto`,maxPixels:n=23e5,maxPixelRatio:r=2,qualityController:i=null,qualityPresets:a=null}={}){if(t!==`auto`&&!$.includes(t))throw RangeError(`Invalid Pixi renderer backend: `+t);if(!Number.isFinite(n)||n<1||!Number.isFinite(r)||r<=0)throw RangeError(`Renderer pixel budget and maximum pixel ratio must be positive`);if(this.atlas=e,this.maxPixels=n,this.maxPixelRatio=r,this.backendPreference=t,i&&(typeof i.sampleFrame!=`function`||typeof i.resetMeasurements!=`function`))throw TypeError(`qualityController must support sampleFrame and resetMeasurements`);this.qualityController=i,this.qualityPresets=a,this.lastFrameTime=null,this.app=new U,this.entityMap=new Map,this.spritePool=[],this.enemyParticles=[],this.enemyPool=[],this.pendingEnemies=[],this.swarmLayers=new Set,this.tilemapLayers=new Set,this.effectChannels=new Map,this.beforeRenderCallbacks=new Set,this.camera={x:0,y:0,targetX:0,targetY:0,zoom:1,shakeX:0,shakeY:0}}async init(e){this.mount=e;let{width:t,height:n,resolution:r}=this.planViewport(),a={width:t,height:n,resolution:r,autoDensity:!0,backgroundColor:725019,autoStart:!1},o=[],s=!1,c=this.backendPreference===`auto`?$:[this.backendPreference];for(let e of c){let t=this.app??=new U;try{await t.init({...a,preference:[e]}),s=!0,this.backend=e;break}catch(e){o.push(e),this.app=null;try{t.renderer?t.destroy({removeView:!0},{children:!0}):t.stage?.destroy({children:!0})}catch(e){o.push(e),console.warn(`Failed to clean up a Pixi renderer:`,e)}}}if(!s)throw AggregateError(o,`Unable to initialize a Pixi renderer`);this.backend===`webgpu`&&this.atlas.useWebGpuUpload?.(),this.isCanvas=this.app.renderer.type===T.CANVAS,this.app.ticker.stop(),this.app.canvas.id=`game`,this.app.canvas.setAttribute(`aria-label`,`游戏画面`),this.app.canvas.dataset.rendererBackend=this.backend,this.updateQualityMarker(),e.appendChild(this.app.canvas),this.worldRoot=new D,this.worldRoot.eventMode=`none`,this.worldRoot.interactiveChildren=!1,this.bgLayer=new D;let l=new be({texture:this.atlas.get(`ground_grid`),width:4096,height:4096});this.grid=l,l.position.set(-2048,-2048),this.bgLayer.addChild(l),this.shadowLayer=new D,this.entityLayer=new D({sortableChildren:!0}),this.foregroundLayer=new D,this.enemyLayer=new i({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),this.trailLayer=new D,this.particleLayer=new i({dynamicProperties:{position:!0,vertex:!0,rotation:!0,color:!0,uvs:!0}}),this.worldRoot.addChild(this.bgLayer,this.shadowLayer,this.enemyLayer,this.entityLayer,this.foregroundLayer,this.trailLayer,this.particleLayer),this.app.stage.addChild(this.worldRoot),this.bloom=new Ve({threshold:.62,bloomScale:.4,brightness:1,blur:3}),this.bloom.resolution=`inherit`,this.bloomEnabled=!1,this.app.stage.filterArea=this.app.screen,this.applyFilters(),this.viewport={width:t,height:n,resolution:r},this.syncCameraView(),typeof ResizeObserver==`function`&&(this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(e))}planViewport(){let e=Math.max(1,Math.floor(this.mount?.clientWidth||1)),t=Math.max(1,Math.floor(this.mount?.clientHeight||1)),n=Number(globalThis.devicePixelRatio)||1,r=this.qualityController?.state,i=r?.dynamicScale??1,a=this.qualityPresets?.[r?.tier]?.maxPixelRatio??this.maxPixelRatio;return{width:e,height:t,resolution:Math.max(1/Math.min(e,t),Math.min(n,this.maxPixelRatio,a,Math.sqrt(this.maxPixels/(e*t)))*i)}}resize(){if(this.disposed||!this.app?.renderer)return!1;this.updateQualityMarker();let e=this.planViewport(),t=this.viewport;return t&&t.width===e.width&&t.height===e.height&&t.resolution===e.resolution?!1:(this.app.renderer.resize(e.width,e.height,e.resolution),this.viewport=e,this.app.stage.filterArea=this.app.screen,this.syncCameraView(),this.onResize?.(),!0)}updateQualityMarker(){let e=this.qualityController?.state?.tier;e&&(this.app.canvas.dataset.qualityTier=e)}renderDiagnostics(){let e=this.app.renderer.gpu?.adapter,t=e?.info;return{backend:this.backend,adapter:e?{vendor:t?.vendor||null,architecture:t?.architecture||null,device:t?.device||null,description:t?.description||null,fallback:t?.isFallbackAdapter??e.isFallbackAdapter??null}:null}}resetQualityMeasurements(){this.lastFrameTime=null,this.qualityController?.resetMeasurements()}setQuality(e){if(typeof this.qualityController?.setMode!=`function`)throw Error(`Renderer2D has no configurable quality controller`);return this.qualityController.setMode(e)?(this.lastFrameTime=null,this.resize(),!0):!1}setBloom({enabled:e=!0,threshold:t,bloomScale:n,brightness:r,blur:i}={}){if(!this.bloom||this.disposed)throw Error(`Initialize Renderer2D before configuring bloom`);for(let[e,a]of Object.entries({threshold:t,bloomScale:n,brightness:r,blur:i}))if(a!==void 0&&(!Number.isFinite(a)||a<0))throw RangeError(`Bloom ${e} must be a finite non-negative number`);t!==void 0&&(this.bloom.threshold=t),n!==void 0&&(this.bloom.bloomScale=n),r!==void 0&&(this.bloom.brightness=r),i!==void 0&&(this.bloom.blur=i),this.bloomEnabled=!!e,this.applyFilters()}setEffectFilters(e,{owner:t=this,beforeRender:n=null,bloom:r=!0}={}){e.length?this.effectChannels.set(t,{filters:e,beforeRender:n,bloom:r}):this.effectChannels.delete(t),this.applyFilters()}onBeforeRender(e){if(typeof e!=`function`)throw TypeError(`Expected a render preparation callback`);return this.beforeRenderCallbacks.add(e),()=>this.beforeRenderCallbacks.delete(e)}applyFilters(){let e=[];if(!this.isCanvas){let t=this.bloomEnabled;for(let n of this.effectChannels.values())e.push(...n.filters),t||=n.bloom;t&&e.unshift(this.bloom)}this.app.stage.filters=e}createSwarmLayer(e){let t=new He(this,e);return this.swarmLayers.add(t),t}createTilemapLayer(e,t){let n=new Ue(this,e,t);return this.tilemapLayers.add(n),n}syncEnemies(e,n){let r=this.enemyTextures??=[`enemy_chaser`,`enemy_chaser_white`,`enemy_elite`,`enemy_elite_white`].map(e=>this.atlas.get(e)),i=this.enemyCullRadius??=Math.max(...r.map(e=>Math.hypot(e.orig.width,e.orig.height)*.525)),{x:a,y:o,zoom:s,shakeX:c,shakeY:l}=this.camera,{width:u,height:d}=this.app.screen,f=a+(-u/2-c)/s-i,p=a+(u/2-c)/s+i,m=o+(-d/2-l)/s-i,h=o+(d/2-l)/s+i,g=0;for(let i=0;i<e.length;i++){let a=e[i];if(a.x<f||a.x>p||a.y<m||a.y>h)continue;let o=r[(a.elite?2:0)+ +(a.flash>0)],s=this.enemyParticles[g++];s||(s=this.enemyPool.pop()??new t({texture:o,anchorX:.5,anchorY:.5}),this.enemyParticles.push(s),this.pendingEnemies.push(s),this.pendingEnemies.length===4096&&this.flushEnemies()),s.texture!==o&&(s.texture=o),s.x=a.x,s.y=a.y;let c=n*7+a.id*.37;s.rotation=Math.sin(c)*.09;let l=Math.sin(c*2);s.scaleX=1+l*.035,s.scaleY=1-l*.05}if(this.flushEnemies(),g<this.enemyParticles.length){for(let e=g;e<this.enemyParticles.length;e++)this.enemyPool.push(this.enemyParticles[e]);this.enemyParticles.length=g,this.enemyLayer.particleChildren.length=g,this.enemyLayer.update()}}flushEnemies(){this.pendingEnemies.length&&this.enemyLayer.addParticle(...this.pendingEnemies),this.pendingEnemies.length=0}alloc(e){let t=this.spritePool.pop()??new u;return t.texture=this.atlas.get(e),t.anchor.set(.5),t.alpha=1,t.tint=16777215,t.scale.set(1),t.rotation=0,t.visible=!0,t}syncEntity(e,t){let n=this.entityMap.get(e);n||(n={sprite:this.alloc(t.tex),shadow:null,flashTimer:0,animScaleX:1,animScaleY:1},this.entityMap.set(e,n),this.entityLayer.addChild(n.sprite)),n.baseTex=t.tex;let r=n.sprite,i=this.atlas.get(t.tex);return r.texture=n.flashTimer>0?this.atlas.textures.get(t.tex+`_white`)??i:i,r.position.set(t.x,t.y),r.rotation=t.rot??0,r.scale.set((t.scaleX??1)*n.animScaleX,(t.scaleY??1)*n.animScaleY),r.tint=n.flashTimer>0?16777215:t.tint??16777215,r.alpha=t.alpha??1,r.zIndex=t.zIndex??t.y,t.hasShadow===!1?n.shadow&&(n.shadow.visible=!1):(n.shadow||(n.shadow=this.alloc(`shadow_oval`),this.shadowLayer.addChild(n.shadow)),n.shadow.visible=!0,n.shadow.position.set(t.x,t.y+18),n.shadow.alpha=.35),n}releaseEntity(e){let t=this.entityMap.get(e);t&&(t.sprite.removeFromParent(),this.spritePool.push(t.sprite),t.shadow&&(t.shadow.removeFromParent(),this.spritePool.push(t.shadow)),this.entityMap.delete(e))}update(e){let t=this.camera,n=1-Math.exp(-10*e);t.x+=(t.targetX-t.x)*n,t.y+=(t.targetY-t.y)*n,this.syncCameraView();for(let t of this.entityMap.values())t.flashTimer=Math.max(0,t.flashTimer-e)}syncCameraView(){let e=this.camera;this.worldRoot.scale.set(e.zoom),this.worldRoot.position.set(this.app.screen.width/2-e.x*e.zoom+e.shakeX,this.app.screen.height/2-e.y*e.zoom+e.shakeY);for(let e of this.tilemapLayers)e.update()}screenToWorld(e,t){return{x:(e-this.app.screen.width/2-this.camera.shakeX)/this.camera.zoom+this.camera.x,y:(t-this.app.screen.height/2-this.camera.shakeY)/this.camera.zoom+this.camera.y}}worldToScreen(e,t,n={x:0,y:0}){return n.x=(e-this.camera.x)*this.camera.zoom+this.app.screen.width/2+this.camera.shakeX,n.y=(t-this.camera.y)*this.camera.zoom+this.app.screen.height/2+this.camera.shakeY,n}render(e){if(this.qualityController&&e!==null){if(e===void 0){let t=performance.now();e=this.lastFrameTime===null?0:t-this.lastFrameTime,this.lastFrameTime=t}else e===0&&this.resetQualityMeasurements();e>0&&this.qualityController.sampleFrame(e)&&this.resize()}for(let e of this.beforeRenderCallbacks)e();if(!this.isCanvas)for(let e of this.effectChannels.values())e.beforeRender?.();this.app.renderer.render(this.app.stage)}dispose(){if(!this.disposed){this.disposed=!0;try{this.resizeObserver?.disconnect(),this.resizeObserver=null,this.onResize=null;for(let e of this.swarmLayers)e.dispose();for(let e of this.tilemapLayers)e.dispose();for(let e of this.spritePool)e.destroy();this.spritePool.length=0,this.enemyParticles.length=0,this.enemyPool.length=0,this.pendingEnemies.length=0,this.entityMap.clear();let e=this.app?.stage;e&&(e.filters=[]),this.effectChannels.clear(),this.beforeRenderCallbacks.clear(),this.bloom?.destroy(),this.app?.renderer?this.app.destroy({removeView:!0},{children:!0}):e&&!e.destroyed&&e.destroy({children:!0})}finally{this.atlas.dispose()}}}};export{We as Renderer2D};