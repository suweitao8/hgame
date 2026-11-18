const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./browserAll-ClIQLABI.js","./Geometry-DuktKPGT.js","./init-D5TSuBEl.js","./canvasUtils-B-n9KQGi.js","./webworkerAll-DybuJ2_o.js","./CanvasPool-C5nSytcC.js","./WebGPURenderer-upjCDfak.js","./colorToUniform-BRamFM33.js","./DefaultBatcher-kUrrL9t-.js","./localUniformBit-BOGrcT1E.js","./getTextureBatchBindGroup-BGIKwd15.js","./getTexelRangeRects-BkOf51hU.js","./RenderTargetSystem-BFfDoSPW.js","./WebGLRenderer-BvoRHXlc.js","./CanvasRenderer-DuGN_riS.js","./Graphics-yWNOqeyh.js"])))=>i.map(i=>d[i]);
import{E as w,D as fe,r as vt,q as Oe,k as S,t as O,d as V,x as Y,o as De,c as H,e as C,M as R,aa as W,P as K,h as de,m as Ne,p as Ge,U as pe,T as P,y as me,R as Ye,V as Xe,b as ge,H as se,A as ne,C as qe,ab as wt,ac as Re,J as bt,W as _t,j as Tt,F as be,Z as G,O as Ct}from"./Geometry-DuktKPGT.js";import{C as Pt}from"./init-D5TSuBEl.js";import{A as We,h as St,a as zt,b as At,c as Ut,r as Et,G as He,d as je,g as $e,V as Q}from"./colorToUniform-BRamFM33.js";import{c as Ke}from"./canvasUtils-B-n9KQGi.js";import{a as Ot,b as Rt}from"./localUniformBit-BOGrcT1E.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))r(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const n of s.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&r(n)}).observe(document,{childList:!0,subtree:!0});function t(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function r(i){if(i.ep)return;i.ep=!0;const s=t(i);fetch(i.href,s)}})();const Mt="modulepreload",Ft=function(l,e){return new URL(l,e).href},Me={},j=function(e,t,r){let i=Promise.resolve();if(t&&t.length>0){let n=function(u){return Promise.all(u.map(h=>Promise.resolve(h).then(f=>({status:"fulfilled",value:f}),f=>({status:"rejected",reason:f}))))};const o=document.getElementsByTagName("link"),a=document.querySelector("meta[property=csp-nonce]"),c=a?.nonce||a?.getAttribute("nonce");i=n(t.map(u=>{if(u=Ft(u,r),u in Me)return;Me[u]=!0;const h=u.endsWith(".css"),f=h?'[rel="stylesheet"]':"";if(!!r)for(let g=o.length-1;g>=0;g--){const m=o[g];if(m.href===u&&(!h||m.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${u}"]${f}`))return;const p=document.createElement("link");if(p.rel=h?"stylesheet":Mt,h||(p.as="script"),p.crossOrigin="",p.href=u,c&&p.setAttribute("nonce",c),document.head.appendChild(p),h)return new Promise((g,m)=>{p.addEventListener("load",g),p.addEventListener("error",()=>m(new Error(`Unable to preload CSS for ${u}`)))})}))}function s(n){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=n,window.dispatchEvent(o),!o.defaultPrevented)throw n}return i.then(n=>{for(const o of n||[])o.status==="rejected"&&s(o.reason);return e().catch(s)})},Bt={extension:{type:w.Environment,name:"browser",priority:-1},test:()=>!0,load:async()=>{await j(()=>import("./browserAll-ClIQLABI.js"),__vite__mapDeps([0,1,2,3,4,5]),import.meta.url)}},It={extension:{type:w.Environment,name:"webworker",priority:0},test:()=>typeof self<"u"&&self.WorkerGlobalScope!==void 0,load:async()=>{await j(()=>import("./webworkerAll-DybuJ2_o.js"),__vite__mapDeps([4,2,1,3,5]),import.meta.url)}};let J;function kt(l){return J!==void 0||(J=(()=>{const e={stencil:!0,failIfMajorPerformanceCaveat:l??We.defaultOptions.failIfMajorPerformanceCaveat};try{if(!fe.get().getWebGLRenderingContext())return!1;let r=fe.get().createCanvas().getContext("webgl",e);const i=!!r?.getContextAttributes()?.stencil;if(r){const s=r.getExtension("WEBGL_lose_context");s&&s.loseContext()}return r=null,i}catch{return!1}})()),J}let Z;async function Vt(l={}){return Z!==void 0||(Z=await(async()=>{const e=fe.get().getNavigator().gpu;if(!e)return!1;try{return await(await e.requestAdapter(l)).requestDevice(),!0}catch{return!1}})()),Z}const Fe=["webgl","webgpu","canvas"];async function Lt(l){let e=[];l.preference?Array.isArray(l.preference)?e=l.preference.slice():(e.push(l.preference),Fe.forEach(s=>{s!==l.preference&&e.push(s)})):e=Fe.slice();let t,r={};for(let s=0;s<e.length;s++){const n=e[s];if(n==="webgpu"&&await Vt()){const{WebGPURenderer:o}=await j(async()=>{const{WebGPURenderer:a}=await import("./WebGPURenderer-upjCDfak.js");return{WebGPURenderer:a}},__vite__mapDeps([6,1,7,8,9,10,11,12,5]),import.meta.url);t=o,r={...l,...l.webgpu};break}else if(n==="webgl"&&kt(l.failIfMajorPerformanceCaveat??We.defaultOptions.failIfMajorPerformanceCaveat)){const{WebGLRenderer:o}=await j(async()=>{const{WebGLRenderer:a}=await import("./WebGLRenderer-BvoRHXlc.js");return{WebGLRenderer:a}},__vite__mapDeps([13,1,7,8,9,11,12,5]),import.meta.url);t=o,r={...l,...l.webgl};break}else if(n==="canvas"){const{CanvasRenderer:o}=await j(async()=>{const{CanvasRenderer:a}=await import("./CanvasRenderer-DuGN_riS.js");return{CanvasRenderer:a}},__vite__mapDeps([14,1,12,7,8,5,3,15,10]),import.meta.url);t=o,r={...l,...l.canvasOptions};break}}if(delete r.webgpu,delete r.webgl,delete r.canvasOptions,!t)throw new Error("No available renderer for the current environment");const i=new t;return await i.init(r),i}class Qe{static init(e){Object.defineProperty(this,"resizeTo",{configurable:!0,set(t){globalThis.removeEventListener("resize",this.queueResize),this._resizeTo=t,t&&(globalThis.addEventListener("resize",this.queueResize),this.resize())},get(){return this._resizeTo}}),this.queueResize=()=>{this._resizeTo&&(this._cancelResize(),this._resizeId=requestAnimationFrame(()=>this.resize()))},this._cancelResize=()=>{this._resizeId&&(cancelAnimationFrame(this._resizeId),this._resizeId=null)},this.resize=()=>{if(!this._resizeTo)return;this._cancelResize();let t,r;if(this._resizeTo===globalThis.window)t=globalThis.innerWidth,r=globalThis.innerHeight;else{const{clientWidth:i,clientHeight:s}=this._resizeTo;t=i,r=s}this.renderer.resize(t,r),this.render()},this._resizeId=null,this._resizeTo=null,this.resizeTo=e.resizeTo||null}static destroy(){globalThis.removeEventListener("resize",this.queueResize),this._cancelResize(),this._cancelResize=null,this.queueResize=null,this.resizeTo=null,this.resize=null}}Qe.extension=w.Application;class Je{static init(e){e=Object.assign({autoStart:!0,sharedTicker:!1},e),Object.defineProperty(this,"ticker",{configurable:!0,set(t){this._ticker&&this._ticker.remove(this.render,this),this._ticker=t,t&&t.add(this.render,this,vt.LOW)},get(){return this._ticker}}),this.stop=()=>{this._ticker.stop()},this.start=()=>{this._ticker.start()},this._ticker=null,this.ticker=e.sharedTicker?Oe.shared:new Oe,e.autoStart&&this.start()}static destroy(){if(this._ticker){const e=this._ticker;this.ticker=null,e.destroy()}}}Je.extension=w.Application;S.add(Qe);S.add(Je);const Ze=class xe{constructor(...e){this.stage=new O,e[0]!==void 0&&V(Y,"Application constructor options are deprecated, please use Application.init() instead.")}async init(e){e={...e},this.stage||(this.stage=new O),this.renderer=await Lt(e),xe._plugins.forEach(t=>{t.init.call(this,e)})}render(){this.renderer.render({container:this.stage})}get canvas(){return this.renderer.canvas}get view(){return V(Y,"Application.view is deprecated, please use Application.canvas instead."),this.renderer.canvas}get screen(){return this.renderer.screen}get domContainerRoot(){return this.renderer.renderPipes.dom?._domElement}destroy(e=!1,t=!1){const r=xe._plugins.slice(0);r.reverse(),r.forEach(i=>{i.destroy.call(this)}),this.stage.destroy(t),this.stage=null,this.renderer.destroy(e),this.renderer=null}};Ze._plugins=[];let ye=Ze;S.handleByList(w.Application,ye._plugins);S.add(St);const et=class tt extends De{constructor(...e){let t=e[0]??{};t instanceof Float32Array&&(V(Y,"use new MeshGeometry({ positions, uvs, indices }) instead"),t={positions:t,uvs:e[1],indices:e[2]}),t={...tt.defaultOptions,...t};const r=t.positions||new Float32Array([0,0,1,0,1,1,0,1]);let i=t.uvs;i||(t.positions?i=new Float32Array(r.length):i=new Float32Array([0,0,1,0,1,1,0,1]));const s=t.indices||new Uint32Array([0,1,2,0,2,3]),n=t.shrinkBuffersToFit,o=new H({data:r,label:"attribute-mesh-positions",shrinkToFit:n,usage:C.VERTEX|C.COPY_DST}),a=new H({data:i,label:"attribute-mesh-uvs",shrinkToFit:n,usage:C.VERTEX|C.COPY_DST}),c=new H({data:s,label:"index-mesh-buffer",shrinkToFit:n,usage:C.INDEX|C.COPY_DST});super({attributes:{aPosition:{buffer:o,format:"float32x2",stride:8,offset:0},aUV:{buffer:a,format:"float32x2",stride:8,offset:0}},indexBuffer:c,topology:t.topology}),this.batchMode="auto"}get positions(){return this.attributes.aPosition.buffer.data}set positions(e){this.attributes.aPosition.buffer.data=e}get uvs(){return this.attributes.aUV.buffer.data}set uvs(e){this.attributes.aUV.buffer.data=e}get indices(){return this.indexBuffer.data}set indices(e){this.indexBuffer.data=e}};et.defaultOptions={topology:"triangle-list",shrinkBuffersToFit:!1};let rt=et;class Dt{constructor(){this.batcherName="default",this.packAsQuad=!1,this.indexOffset=0,this.attributeOffset=0,this.roundPixels=0,this._batcher=null,this._batch=null,this._textureMatrixUpdateId=-1,this._uvUpdateId=-1}get blendMode(){return this.renderable.groupBlendMode}get topology(){return this._topology||this.geometry.topology}set topology(e){this._topology=e}reset(){this.renderable=null,this.texture=null,this._batcher=null,this._batch=null,this.geometry=null,this._uvUpdateId=-1,this._textureMatrixUpdateId=-1}setTexture(e){this.texture!==e&&(this.texture=e,this._textureMatrixUpdateId=-1)}get uvs(){const t=this.geometry.getBuffer("aUV"),r=t.data;let i=r;const s=this.texture.textureMatrix;return s.isSimple||(i=this._transformedUvs,(this._textureMatrixUpdateId!==s._updateID||this._uvUpdateId!==t._updateID)&&((!i||i.length<r.length)&&(i=this._transformedUvs=new Float32Array(r.length)),this._textureMatrixUpdateId=s._updateID,this._uvUpdateId=t._updateID,s.multiplyUvs(r,i))),i}get positions(){return this.geometry.positions}get indices(){return this.geometry.indices}get color(){return this.renderable.groupColorAlpha}get groupTransform(){return this.renderable.groupTransform}get attributeSize(){return this.geometry.positions.length/2}get indexSize(){return this.geometry.indices.length}}class Nt{constructor({matrix:e,observer:t}={}){this.dirty=!0,this._matrix=e??new R,this.observer=t,this.position=new W(this,0,0),this.scale=new W(this,1,1),this.pivot=new W(this,0,0),this.skew=new W(this,0,0),this._rotation=0,this._cx=1,this._sx=0,this._cy=0,this._sy=1}get matrix(){const e=this._matrix;return this.dirty&&(e.a=this._cx*this.scale.x,e.b=this._sx*this.scale.x,e.c=this._cy*this.scale.y,e.d=this._sy*this.scale.y,e.tx=this.position.x-(this.pivot.x*e.a+this.pivot.y*e.c),e.ty=this.position.y-(this.pivot.x*e.b+this.pivot.y*e.d),this.dirty=!1),e}_onUpdate(e){this.dirty=!0,e===this.skew&&this.updateSkew(),this.observer?._onUpdate(this)}updateSkew(){this._cx=Math.cos(this._rotation+this.skew.y),this._sx=Math.sin(this._rotation+this.skew.y),this._cy=-Math.sin(this._rotation-this.skew.x),this._sy=Math.cos(this._rotation-this.skew.x),this.dirty=!0}toString(){return`[pixi.js/math:Transform position=(${this.position.x}, ${this.position.y}) rotation=${this.rotation} scale=(${this.scale.x}, ${this.scale.y}) skew=(${this.skew.x}, ${this.skew.y}) ]`}setFromMatrix(e){e.decompose(this),this.dirty=!0}get rotation(){return this._rotation}set rotation(e){this._rotation!==e&&(this._rotation=e,this._onUpdate(this.skew))}}const ee=new R,E=new R,T=[new K,new K,new K,new K];class it{constructor(e){this._renderer=e}validateRenderable(e){return!1}addRenderable(e,t){this._renderer.renderPipes.batch.break(t),t.add(e)}updateRenderable(e){}execute(e){const t=this._renderer,r=t.canvasContext,i=r.activeContext;i.save(),r.setBlendMode(e.groupBlendMode);const s=t.globalUniforms.globalUniformData?.worldColor??4294967295,n=e.groupColorAlpha,o=(s>>>24&255)/255,a=(n>>>24&255)/255,c=t.filter?.alphaMultiplier??1,u=o*a*c;if(u<=0){i.restore();return}i.globalAlpha=u;const h=s&16777215,f=n&16777215,d=de(Ne(f,h)),p=e.texture,g=Ke.getTintedPattern(p,d),m=e.width,y=e.height,x=e.groupTransform,b=p.source._resolution??p.source.resolution??1;E.copyFrom(e._tileTransform.matrix),e.applyAnchorToTexture||E.translate(-e.anchor.x*m,-e.anchor.y*y);const L=E.tx,D=E.ty;E.scale(1/b,1/b),E.tx=L,E.ty=D,ee.identity(),ee.prepend(E),ee.prepend(x);const M=t._roundPixels|e._roundPixels;r.setContextTransform(ee,M===1),i.fillStyle=g;const z=e.anchor.x*-m,A=e.anchor.y*-y;T[0].set(z,A),T[1].set(z+m,A),T[2].set(z+m,A+y),T[3].set(z,A+y);for(let v=0;v<4;v++)E.applyInverse(T[v],T[v]);i.beginPath(),i.moveTo(T[0].x,T[0].y);for(let v=1;v<4;v++)i.lineTo(T[v].x,T[v].y);i.closePath(),i.fill(),i.restore()}destroy(){this._renderer=null}}it.extension={type:[w.CanvasPipes],name:"tilingSprite"};const Gt={name:"tiling-bit",vertex:{header:`
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
        `}},Yt={name:"tiling-bit",vertex:{header:`
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

        `}};let he,ce;class Xt extends Ge{constructor(){he??(he=zt({name:"tiling-sprite-shader",bits:[Ot,Gt,At]})),ce??(ce=Ut({name:"tiling-sprite-shader",bits:[Rt,Yt,Et]}));const e=new pe({uMapCoord:{value:new R,type:"mat3x3<f32>"},uClampFrame:{value:new Float32Array([0,0,1,1]),type:"vec4<f32>"},uClampOffset:{value:new Float32Array([0,0]),type:"vec2<f32>"},uTextureTransform:{value:new R,type:"mat3x3<f32>"},uSizeAnchor:{value:new Float32Array([100,100,.5,.5]),type:"vec4<f32>"}});super({glProgram:ce,gpuProgram:he,resources:{localUniforms:new pe({uTransformMatrix:{value:new R,type:"mat3x3<f32>"},uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uRound:{value:0,type:"f32"}}),tilingUniforms:e,uTexture:P.EMPTY.source,uSampler:P.EMPTY.source.style}})}updateUniforms(e,t,r,i,s,n){const o=this.resources.tilingUniforms,a=n.width,c=n.height,u=n.textureMatrix,h=o.uniforms.uTextureTransform;h.set(r.a*a/e,r.b*a/t,r.c*c/e,r.d*c/t,r.tx/e,r.ty/t),h.invert(),o.uniforms.uMapCoord=u.mapCoord,o.uniforms.uClampFrame=u.uClampFrame,o.uniforms.uClampOffset=u.uClampOffset,o.uniforms.uTextureTransform=h,o.uniforms.uSizeAnchor[0]=e,o.uniforms.uSizeAnchor[1]=t,o.uniforms.uSizeAnchor[2]=i,o.uniforms.uSizeAnchor[3]=s,n&&(this.resources.uTexture=n.source,this.resources.uSampler=n.source.style)}}class qt extends rt{constructor(){super({positions:new Float32Array([0,0,1,0,1,1,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])})}}function Wt(l,e){const t=l.anchor.x,r=l.anchor.y;e[0]=-t*l.width,e[1]=-r*l.height,e[2]=(1-t)*l.width,e[3]=-r*l.height,e[4]=(1-t)*l.width,e[5]=(1-r)*l.height,e[6]=-t*l.width,e[7]=(1-r)*l.height}function Ht(l,e,t,r){let i=0;const s=l.length/e,n=r.a,o=r.b,a=r.c,c=r.d,u=r.tx,h=r.ty;for(t*=e;i<s;){const f=l[t],d=l[t+1];l[t]=n*f+a*d+u,l[t+1]=o*f+c*d+h,t+=e,i++}}function jt(l,e){const t=l.texture,r=t.frame.width,i=t.frame.height;let s=0,n=0;l.applyAnchorToTexture&&(s=l.anchor.x,n=l.anchor.y),e[0]=e[6]=-s,e[2]=e[4]=1-s,e[1]=e[3]=-n,e[5]=e[7]=1-n;const o=l._tileTransform.matrix,a=R.shared;a.set(o.a*r/l.width,o.b*r/l.height,o.c*i/l.width,o.d*i/l.height,o.tx/l.width,o.ty/l.height),a.invert(),Ht(e,2,0,a)}const te=new qt;class $t{constructor(){this.canBatch=!0,this.geometry=new rt({indices:te.indices.slice(),positions:te.positions.slice(),uvs:te.uvs.slice()})}destroy(){this.geometry.destroy(),this.shader?.destroy()}}class st{constructor(e){this._state=me.default2d,this._renderer=e,this._managedTilingSprites=new He({renderer:e,type:"renderable",name:"tilingSprite"})}validateRenderable(e){const t=this._getTilingSpriteData(e),r=t.canBatch;this._updateCanBatch(e);const i=t.canBatch;if(i&&i===r){const{batchableMesh:s}=t;return!s._batcher.checkAndUpdateTexture(s,e.texture)}return r!==i}addRenderable(e,t){const r=this._renderer.renderPipes.batch;this._updateCanBatch(e);const i=this._getTilingSpriteData(e),{geometry:s,canBatch:n}=i;if(n){i.batchableMesh||(i.batchableMesh=new Dt);const o=i.batchableMesh;e.didViewUpdate&&(this._updateBatchableMesh(e),o.geometry=s,o.renderable=e,o.transform=e.groupTransform,o.setTexture(e._texture)),o.roundPixels=this._renderer._roundPixels|e._roundPixels,r.addToBatch(o,t)}else r.break(t),i.shader||(i.shader=new Xt),this.updateRenderable(e),t.add(e)}execute(e){const t=this._renderer,{shader:r}=this._getTilingSpriteData(e);r.groups[0]=t.globalUniforms.bindGroup;const i=r.resources.localUniforms.uniforms;i.uTransformMatrix=e.groupTransform,i.uRound=t._roundPixels|e._roundPixels,je(e.groupColorAlpha,i.uColor,0),this._state.blendMode=$e(e.groupBlendMode,e.texture._source),t.encoder.draw({geometry:te,shader:r,state:this._state})}updateRenderable(e){const t=this._getTilingSpriteData(e),{canBatch:r}=t;if(r){const{batchableMesh:i}=t;e.didViewUpdate&&this._updateBatchableMesh(e),i._batcher.updateElement(i)}else if(e.didViewUpdate){const{shader:i}=t;i.updateUniforms(e.width,e.height,e._tileTransform.matrix,e.anchor.x,e.anchor.y,e.texture)}}_getTilingSpriteData(e){return e._gpuData[this._renderer.uid]||this._initTilingSpriteData(e)}_initTilingSpriteData(e){const t=new $t;return t.renderable=e,e._gpuData[this._renderer.uid]=t,this._managedTilingSprites.add(e),t}_updateBatchableMesh(e){const t=this._getTilingSpriteData(e),{geometry:r}=t,i=e.texture.source.style;i.addressMode!=="repeat"&&(i.addressMode="repeat",i.update()),jt(e,r.uvs),Wt(e,r.positions)}destroy(){this._managedTilingSprites.destroy(),this._renderer=null}_updateCanBatch(e){const t=this._getTilingSpriteData(e),r=e.texture;let i=!0;return this._renderer.type===Ye.WEBGL&&(i=this._renderer.context.supports.nonPowOf2wrapping),t.canBatch=r.textureMatrix.isSimple&&(i||r.source.isPowerOfTwo),t.canBatch}}st.extension={type:[w.WebGLPipes,w.WebGPUPipes],name:"tilingSprite"};S.add(it);S.add(st);const nt=class re extends Xe{constructor(...e){let t=e[0]||{};t instanceof P&&(t={texture:t}),e.length>1&&(V(Y,"use new TilingSprite({ texture, width:100, height:100 }) instead"),t.width=e[1],t.height=e[2]),t={...re.defaultOptions,...t};const{texture:r,anchor:i,tilePosition:s,tileScale:n,tileRotation:o,width:a,height:c,applyAnchorToTexture:u,roundPixels:h,...f}=t??{};super({label:"TilingSprite",...f}),this.renderPipeId="tilingSprite",this.batched=!0,this.allowChildren=!1,this._anchor=new W({_onUpdate:()=>{this.onViewUpdate()}}),this.applyAnchorToTexture=u,this.texture=r,this._width=a??r.width,this._height=c??r.height,this._tileTransform=new Nt({observer:{_onUpdate:()=>this.onViewUpdate()}}),i&&(this.anchor=i),this.tilePosition=s,this.tileScale=n,this.tileRotation=o,this.roundPixels=h??!1}static from(e,t={}){return typeof e=="string"?new re({texture:Pt.get(e),...t}):new re({texture:e,...t})}get uvRespectAnchor(){return V(Y,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture}set uvRespectAnchor(e){V(Y,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture=e}get clampMargin(){return this._texture.textureMatrix.clampMargin}set clampMargin(e){this._texture.textureMatrix.clampMargin=e}get anchor(){return this._anchor}set anchor(e){typeof e=="number"?this._anchor.set(e):this._anchor.copyFrom(e)}get tilePosition(){return this._tileTransform.position}set tilePosition(e){this._tileTransform.position.copyFrom(e)}get tileScale(){return this._tileTransform.scale}set tileScale(e){typeof e=="number"?this._tileTransform.scale.set(e):this._tileTransform.scale.copyFrom(e)}set tileRotation(e){this._tileTransform.rotation=e}get tileRotation(){return this._tileTransform.rotation}get tileTransform(){return this._tileTransform}set texture(e){e||(e=P.EMPTY);const t=this._texture;t!==e&&(t&&t.dynamic&&t.off("update",this.onViewUpdate,this),e.dynamic&&e.on("update",this.onViewUpdate,this),this._texture=e,this.onViewUpdate())}get texture(){return this._texture}set width(e){this._width=e,this.onViewUpdate()}get width(){return this._width}set height(e){this._height=e,this.onViewUpdate()}get height(){return this._height}setSize(e,t){typeof e=="object"&&(t=e.height??e.width,e=e.width),this._width=e,this._height=t??e,this.onViewUpdate()}getSize(e){return e||(e={}),e.width=this._width,e.height=this._height,e}updateBounds(){const e=this._bounds,t=this._anchor,r=this._width,i=this._height;e.minX=-t._x*r,e.maxX=e.minX+r,e.minY=-t._y*i,e.maxY=e.minY+i}containsPoint(e){const t=this._width,r=this._height,i=-t*this._anchor._x;let s=0;return e.x>=i&&e.x<=i+t&&(s=-r*this._anchor._y,e.y>=s&&e.y<=s+r)}destroy(e=!1){if(super.destroy(e),this._anchor=null,this._tileTransform=null,this._bounds=null,typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource;this._texture.destroy(r)}this._texture=null}};nt.defaultOptions={texture:P.EMPTY,anchor:{x:0,y:0},tilePosition:{x:0,y:0},tileScale:{x:1,y:1},tileRotation:0,applyAnchorToTexture:!1};let Kt=nt;class Qt{execute(e,t){const r=e.renderer,i=r.canvasContext.activeContext,s=t.particleChildren,n=t.texture;i.save(),r.canvasContext.setContextTransform(t.worldTransform,t.roundPixels),r.canvasContext.setBlendMode(t.groupBlendMode);const o=t.groupColorAlpha,a=r.filter?.alphaMultiplier??1,c=(o>>>24&255)/255*a;for(let u=0;u<s.length;u++){const h=s[u],f=h.texture||n;if(!f?.source?.resource)continue;const d=h.color,p=(d>>>24&255)/255*c;if(p<=0)continue;const g=d&16777215,m=((g&255)<<16)+(g&65280)+(g>>16&255);let y=f.source.resource;m!==16777215&&(y=Ke.getTintedCanvas({texture:f},m));const x=f.frame,b=f.source.resolution,L=x.x*b,D=x.y*b,M=x.width*b,z=x.height*b;i.globalAlpha=p;const A=-h.anchorX*x.width,v=-h.anchorY*x.height;h.rotation!==0||h.scaleX!==1||h.scaleY!==1?(i.save(),i.translate(h.x,h.y),i.rotate(h.rotation),i.scale(h.scaleX,h.scaleY),i.drawImage(y,L,D,M,z,A,v,x.width,x.height),i.restore()):i.drawImage(y,L,D,M,z,h.x+A,h.y+v,x.width,x.height)}i.restore()}}function Be(l,e=null){const t=l*6;if(t>65535?e||(e=new Uint32Array(t)):e||(e=new Uint16Array(t)),e.length!==t)throw new Error(`Out buffer length is incorrect, got ${e.length} and expected ${t}`);for(let r=0,i=0;r<t;r+=6,i+=4)e[r+0]=i+0,e[r+1]=i+1,e[r+2]=i+2,e[r+3]=i+0,e[r+4]=i+2,e[r+5]=i+3;return e}function Jt(l){return{dynamicUpdate:Ie(l,!0),staticUpdate:Ie(l,!1)}}function Ie(l,e){const t=[];t.push(`

        var index = 0;

        for (let i = 0; i < ps.length; ++i)
        {
            const p = ps[i];

            `);let r=0;for(const s in l){const n=l[s];if(e!==n.dynamic)continue;t.push(`offset = index + ${r}`),t.push(n.code);const o=ge(n.format);r+=o.stride/4}t.push(`
            index += stride * 4;
        }
    `),t.unshift(`
        var stride = ${r};
        var offset = 0, w0 = 0, w1 = 0, h0 = 0, h1 = 0;
    `);const i=t.join(`
`);return new Function("ps","f32v","u32v",i)}class Zt{constructor(e){this._size=0,this._generateParticleUpdateCache={};const t=this._size=e.size??1e3,r=e.properties;let i=0,s=0;for(const u in r){const h=r[u],f=ge(h.format);h.dynamic?s+=f.stride:i+=f.stride}this._dynamicStride=s/4,this._staticStride=i/4,this.staticAttributeBuffer=new Q(t*4*i),this.dynamicAttributeBuffer=new Q(t*4*s),this.indexBuffer=Be(t);const n=new De;let o=0,a=0;this._staticBuffer=new H({data:new Float32Array(1),label:"static-particle-buffer",shrinkToFit:!1,usage:C.VERTEX|C.COPY_DST}),this._dynamicBuffer=new H({data:new Float32Array(1),label:"dynamic-particle-buffer",shrinkToFit:!1,usage:C.VERTEX|C.COPY_DST});for(const u in r){const h=r[u],f=ge(h.format);h.dynamic?(n.addAttribute(h.attributeName,{buffer:this._dynamicBuffer,stride:this._dynamicStride*4,offset:o*4,format:h.format}),o+=f.size):(n.addAttribute(h.attributeName,{buffer:this._staticBuffer,stride:this._staticStride*4,offset:a*4,format:h.format}),a+=f.size)}n.addIndex(this.indexBuffer);const c=this.getParticleUpdate(r);this._dynamicUpload=c.dynamicUpdate,this._staticUpload=c.staticUpdate,this.geometry=n}getParticleUpdate(e){const t=er(e);return this._generateParticleUpdateCache[t]?this._generateParticleUpdateCache[t]:(this._generateParticleUpdateCache[t]=this.generateParticleUpdate(e),this._generateParticleUpdateCache[t])}generateParticleUpdate(e){return Jt(e)}update(e,t){e.length>this._size&&(t=!0,this._size=Math.max(e.length,this._size*1.5|0),this.staticAttributeBuffer=new Q(this._size*this._staticStride*4*4),this.dynamicAttributeBuffer=new Q(this._size*this._dynamicStride*4*4),this.indexBuffer=Be(this._size),this.geometry.indexBuffer.setDataWithSize(this.indexBuffer,this.indexBuffer.byteLength,!0));const r=this.dynamicAttributeBuffer;if(this._dynamicUpload(e,r.float32View,r.uint32View),this._dynamicBuffer.setDataWithSize(this.dynamicAttributeBuffer.float32View,e.length*this._dynamicStride*4,!0),t){const i=this.staticAttributeBuffer;this._staticUpload(e,i.float32View,i.uint32View),this._staticBuffer.setDataWithSize(i.float32View,e.length*this._staticStride*4,!0)}}destroy(){this._staticBuffer.destroy(),this._dynamicBuffer.destroy(),this.geometry.destroy()}}function er(l){const e=[];for(const t in l){const r=l[t];e.push(t,r.code,r.dynamic?"d":"s")}return e.join("_")}var tr=`varying vec2 vUV;
varying vec4 vColor;

uniform sampler2D uTexture;

void main(void){
    vec4 color = texture2D(uTexture, vUV) * vColor;
    gl_FragColor = color;
}`,rr=`attribute vec2 aVertex;
attribute vec2 aUV;
attribute vec4 aColor;

attribute vec2 aPosition;
attribute float aRotation;

uniform mat3 uTranslationMatrix;
uniform float uRound;
uniform vec2 uResolution;
uniform vec4 uColor;

varying vec2 vUV;
varying vec4 vColor;

vec2 roundPixels(vec2 position, vec2 targetSize)
{       
    return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}

void main(void){
    float cosRotation = cos(aRotation);
    float sinRotation = sin(aRotation);
    float x = aVertex.x * cosRotation - aVertex.y * sinRotation;
    float y = aVertex.x * sinRotation + aVertex.y * cosRotation;

    vec2 v = vec2(x, y);
    v = v + aPosition;

    gl_Position = vec4((uTranslationMatrix * vec3(v, 1.0)).xy, 0.0, 1.0);

    if(uRound == 1.0)
    {
        gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
    }

    vUV = aUV;
    vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor;
}
`,ke=`
struct ParticleUniforms {
  uTranslationMatrix:mat3x3<f32>,
  uColor:vec4<f32>,
  uRound:f32,
  uResolution:vec2<f32>,
};

fn roundPixels(position: vec2<f32>, targetSize: vec2<f32>) -> vec2<f32>
{
  return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}

@group(0) @binding(0) var<uniform> uniforms: ParticleUniforms;

@group(1) @binding(0) var uTexture: texture_2d<f32>;
@group(1) @binding(1) var uSampler : sampler;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) color : vec4<f32>,
  };
@vertex
fn mainVertex(
  @location(0) aVertex: vec2<f32>,
  @location(1) aPosition: vec2<f32>,
  @location(2) aUV: vec2<f32>,
  @location(3) aColor: vec4<f32>,
  @location(4) aRotation: f32,
) -> VSOutput {
  
   let v = vec2(
       aVertex.x * cos(aRotation) - aVertex.y * sin(aRotation),
       aVertex.x * sin(aRotation) + aVertex.y * cos(aRotation)
   ) + aPosition;

   var position = vec4((uniforms.uTranslationMatrix * vec3(v, 1.0)).xy, 0.0, 1.0);

   if(uniforms.uRound == 1.0) {
       position = vec4(roundPixels(position.xy, uniforms.uResolution), position.zw);
   }

    let vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uniforms.uColor;

  return VSOutput(
   position,
   aUV,
   vColor,
  );
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @builtin(position) position: vec4<f32>,
) -> @location(0) vec4<f32> {

    var sample = textureSample(uTexture, uSampler, uv) * color;
   
    return sample;
}`;class ir extends Ge{constructor(){const e=se.from({vertex:rr,fragment:tr}),t=ne.from({fragment:{source:ke,entryPoint:"mainFragment"},vertex:{source:ke,entryPoint:"mainVertex"}});super({glProgram:e,gpuProgram:t,resources:{uTexture:P.WHITE.source,uSampler:new wt({}),uniforms:{uTranslationMatrix:{value:new R,type:"mat3x3<f32>"},uColor:{value:new qe(16777215),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}}})}}class oe{constructor(e,t){this.state=me.for2d(),this.localUniforms=new pe({uTranslationMatrix:{value:new R,type:"mat3x3<f32>"},uColor:{value:new Float32Array(4),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}),this.renderer=e,this.adaptor=t,this.defaultShader=new ir,this.state=me.for2d(),this._managedContainers=new He({renderer:e,type:"renderable",name:"particleContainer"})}validateRenderable(e){return!1}addRenderable(e,t){this.renderer.renderPipes.batch.break(t),t.add(e)}getBuffers(e){return e._gpuData[this.renderer.uid]||this._initBuffer(e)}_initBuffer(e){return e._gpuData[this.renderer.uid]=new Zt({size:e.particleChildren.length,properties:e._properties}),this._managedContainers.add(e),e._gpuData[this.renderer.uid]}updateRenderable(e){}execute(e){const t=e.particleChildren;if(t.length===0)return;const r=this.renderer,i=this.getBuffers(e);e.texture||(e.texture=t[0].texture);const s=this.state;i.update(t,e._childrenDirty),e._childrenDirty=!1,s.blendMode=$e(e.groupBlendMode,e.texture._source);const n=this.localUniforms.uniforms,o=n.uTranslationMatrix;e.worldTransform.copyTo(o);const a=r.globalUniforms.globalUniformData;o.tx-=a.offset.x,o.ty-=a.offset.y,o.prepend(a.projectionMatrix),n.uResolution=a.resolution,n.uRound=r._roundPixels|e._roundPixels;const c=e.groupColorAlpha,u=a.worldColor,h=(c>>>24)*(u>>>24)/255|0,f=Ne(c&16777215,u&16777215);je((h<<24|f)>>>0,n.uColor,0),this.adaptor.execute(this,e)}destroy(){this._managedContainers.destroy(),this.renderer=null,this.defaultShader&&(this.defaultShader.destroy(),this.defaultShader=null)}}oe.extension={type:[w.CanvasPipes],name:"particle"};class ot extends oe{constructor(e){super(e,new Qt)}}ot.extension={type:[w.CanvasPipes],name:"particle"};class sr{execute(e,t){const r=e.state,i=e.renderer,s=t.shader||e.defaultShader;s.resources.uTexture=t.texture._source,s.resources.uniforms=e.localUniforms;const n=i.gl,o=e.getBuffers(t);i.shader.bind(s),i.state.set(r),i.geometry.bind(o.geometry,s.glProgram);const c=o.geometry.indexBuffer.data.BYTES_PER_ELEMENT===2?n.UNSIGNED_SHORT:n.UNSIGNED_INT;n.drawElements(n.TRIANGLES,t.particleChildren.length*6,c,0)}}class at extends oe{constructor(e){super(e,new sr)}}at.extension={type:[w.WebGLPipes],name:"particle"};class nr{execute(e,t){const r=e.renderer,i=t.shader||e.defaultShader;i.groups[0]=r.renderPipes.uniformBatch.getUniformBindGroup(e.localUniforms,!0),i.groups[1]=r.texture.getTextureBindGroup(t.texture);const s=e.state,n=e.getBuffers(t);r.encoder.draw({geometry:n.geometry,shader:t.shader||e.defaultShader,state:s,size:t.particleChildren.length*6})}}class lt extends oe{constructor(e){super(e,new nr)}}lt.extension={type:[w.WebGPUPipes],name:"particle"};const ut=class ve{constructor(e){if(e instanceof P)this.texture=e,Re(this,ve.defaultOptions,{});else{const t={...ve.defaultOptions,...e};Re(this,t,{})}}get alpha(){return this._alpha}set alpha(e){this._alpha=Math.min(Math.max(e,0),1),this._updateColor()}get tint(){return de(this._tint)}set tint(e){this._tint=typeof e=="number"?de(e):qe.shared.setValue(e??16777215).toBgrNumber(),this._updateColor()}_updateColor(){this.color=this._tint+((this._alpha*255|0)<<24)}};ut.defaultOptions={anchorX:0,anchorY:0,x:0,y:0,scaleX:1,scaleY:1,rotation:0,tint:16777215,alpha:1};let _e=ut;const Ve={vertex:{attributeName:"aVertex",format:"float32x2",code:`
            const texture = p.texture;
            const sx = p.scaleX;
            const sy = p.scaleY;
            const ax = p.anchorX;
            const ay = p.anchorY;
            const trim = texture.trim;
            const orig = texture.orig;

            if (trim)
            {
                w1 = trim.x - (ax * orig.width);
                w0 = w1 + trim.width;

                h1 = trim.y - (ay * orig.height);
                h0 = h1 + trim.height;
            }
            else
            {
                w1 = -ax * (orig.width);
                w0 = w1 + orig.width;

                h1 = -ay * (orig.height);
                h0 = h1 + orig.height;
            }

            f32v[offset] = w1 * sx;
            f32v[offset + 1] = h1 * sy;

            f32v[offset + stride] = w0 * sx;
            f32v[offset + stride + 1] = h1 * sy;

            f32v[offset + (stride * 2)] = w0 * sx;
            f32v[offset + (stride * 2) + 1] = h0 * sy;

            f32v[offset + (stride * 3)] = w1 * sx;
            f32v[offset + (stride * 3) + 1] = h0 * sy;
        `,dynamic:!1},position:{attributeName:"aPosition",format:"float32x2",code:`
            var x = p.x;
            var y = p.y;

            f32v[offset] = x;
            f32v[offset + 1] = y;

            f32v[offset + stride] = x;
            f32v[offset + stride + 1] = y;

            f32v[offset + (stride * 2)] = x;
            f32v[offset + (stride * 2) + 1] = y;

            f32v[offset + (stride * 3)] = x;
            f32v[offset + (stride * 3) + 1] = y;
        `,dynamic:!0},rotation:{attributeName:"aRotation",format:"float32",code:`
            var rotation = p.rotation;

            f32v[offset] = rotation;
            f32v[offset + stride] = rotation;
            f32v[offset + (stride * 2)] = rotation;
            f32v[offset + (stride * 3)] = rotation;
        `,dynamic:!1},uvs:{attributeName:"aUV",format:"float32x2",code:`
            var uvs = p.texture.uvs;

            f32v[offset] = uvs.x0;
            f32v[offset + 1] = uvs.y0;

            f32v[offset + stride] = uvs.x1;
            f32v[offset + stride + 1] = uvs.y1;

            f32v[offset + (stride * 2)] = uvs.x2;
            f32v[offset + (stride * 2) + 1] = uvs.y2;

            f32v[offset + (stride * 3)] = uvs.x3;
            f32v[offset + (stride * 3) + 1] = uvs.y3;
        `,dynamic:!1},color:{attributeName:"aColor",format:"unorm8x4",code:`
            const c = p.color;

            u32v[offset] = c;
            u32v[offset + stride] = c;
            u32v[offset + (stride * 2)] = c;
            u32v[offset + (stride * 3)] = c;
        `,dynamic:!1}};S.add(at);S.add(lt);S.add(ot);const or=new bt(0,0,0,0),ar=48,ht=class we extends Xe{constructor(e={}){e={...we.defaultOptions,...e,dynamicProperties:{...we.defaultOptions.dynamicProperties,...e?.dynamicProperties}};const{dynamicProperties:t,shader:r,roundPixels:i,texture:s,particles:n,...o}=e;super({label:"ParticleContainer",...o}),this.renderPipeId="particle",this.batched=!1,this._childrenDirty=!1,this.texture=s||null,this.shader=r,this._properties={};for(const a in Ve){const c=Ve[a],u=t[a];this._properties[a]={...c,dynamic:u}}this.allowChildren=!0,this.roundPixels=i??!1,this.particleChildren=n??[]}addParticle(...e){for(let t=0;t<e.length;t++)this.particleChildren.push(e[t]);return this.onViewUpdate(),e[0]}removeParticle(...e){if(e.length>ar)return this._removeParticlesInOnePass(e)&&this.onViewUpdate(),e[0];let t=!1;for(let r=0;r<e.length;r++){const i=this.particleChildren.indexOf(e[r]);i>-1&&(this.particleChildren.splice(i,1),t=!0)}return t&&this.onViewUpdate(),e[0]}_removeParticlesInOnePass(e){const t=new Map;for(let n=0;n<e.length;n++){const o=e[n];t.set(o,(t.get(o)??0)+1)}const r=this.particleChildren,i=r.length;let s=0;for(let n=0;n<i;n++){const o=r[n],a=t.get(o);a?t.set(o,a-1):r[s++]=o}return r.length=s,s!==i}update(){this._childrenDirty=!0}onViewUpdate(){this._childrenDirty=!0,super.onViewUpdate()}get bounds(){return or}updateBounds(){}destroy(e=!1){if(super.destroy(e),typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource,i=this.texture??this.particleChildren[0]?.texture;i&&i.destroy(r)}this.texture=null,this.shader?.destroy()}removeParticles(e,t){e??(e=0),t??(t=this.particleChildren.length);const r=this.particleChildren.splice(e,t-e);return this.onViewUpdate(),r}removeParticleAt(e){const t=this.particleChildren.splice(e,1);return this.onViewUpdate(),t[0]}addParticleAt(e,t){return this.particleChildren.splice(t,0,e),this.onViewUpdate(),e}addChild(...e){throw new Error("ParticleContainer.addChild() is not available. Please use ParticleContainer.addParticle()")}removeChild(...e){throw new Error("ParticleContainer.removeChild() is not available. Please use ParticleContainer.removeParticle()")}removeChildren(e,t){throw new Error("ParticleContainer.removeChildren() is not available. Please use ParticleContainer.removeParticles()")}removeChildAt(e){throw new Error("ParticleContainer.removeChildAt() is not available. Please use ParticleContainer.removeParticleAt()")}getChildAt(e){throw new Error("ParticleContainer.getChildAt() is not available. Please use ParticleContainer.getParticleAt()")}setChildIndex(e,t){throw new Error("ParticleContainer.setChildIndex() is not available. Please use ParticleContainer.setParticleIndex()")}getChildIndex(e){throw new Error("ParticleContainer.getChildIndex() is not available. Please use ParticleContainer.getParticleIndex()")}addChildAt(e,t){throw new Error("ParticleContainer.addChildAt() is not available. Please use ParticleContainer.addParticleAt()")}swapChildren(e,t){throw new Error("ParticleContainer.swapChildren() is not available. Please use ParticleContainer.swapParticles()")}reparentChild(...e){throw new Error("ParticleContainer.reparentChild() is not available with the particle container")}reparentChildAt(e,t){throw new Error("ParticleContainer.reparentChildAt() is not available with the particle container")}};ht.defaultOptions={dynamicProperties:{vertex:!1,position:!0,rotation:!1,uvs:!1,color:!1},roundPixels:!1};let ie=ht;S.add(Bt,It);class lr{constructor(e=1024){if(!Number.isInteger(e)||e<8)throw new RangeError("Atlas size must be an integer of at least 8 pixels");this.size=e,this.canvas=document.createElement("canvas"),this.canvas.width=this.canvas.height=e,this.ctx=this.canvas.getContext("2d"),this.x=this.y=2,this.rowHeight=0,this.frames=new Map,this.textures=new Map,this.source=null}register(e,t,r,i,{makeWhite:s=!0}={}){if(typeof e!="string"||!e||!Number.isInteger(t)||!Number.isInteger(r)||t<=0||r<=0||typeof i!="function")throw new TypeError("Atlas frames require a name, positive integer dimensions and a draw function");if(this.frames.has(e+"_white"))throw new Error("Invalid or duplicate atlas frame: "+e);this.checkCapacity([{name:e,width:t,height:r},...s?[{name:e+"_white",width:t,height:r}]:[]]);const n=document.createElement("canvas");n.width=t,n.height=r;const o=n.getContext("2d");i(o,t,r),this.pack(e,n),s&&(o.globalCompositeOperation="source-in",o.fillStyle="#ffffff",o.fillRect(0,0,t,r),this.pack(e+"_white",n))}checkCapacity(e){if(this.source)throw new Error("Cannot add frames to a built atlas");let t=this.x,r=this.y,i=this.rowHeight;const s=new Set;for(const{name:n,width:o,height:a}of e){if(typeof n!="string"||!n||s.has(n)||this.frames.has(n))throw new Error("Invalid or duplicate atlas frame: "+n);if(!Number.isInteger(o)||!Number.isInteger(a)||o<=0||a<=0)throw new RangeError("Atlas dimensions must be positive integers");if(s.add(n),o+4>this.size||a+4>this.size)throw new RangeError("Atlas frame too large: "+n);if(t+o+2>this.size&&(t=2,r+=i+4,i=0),r+a+2>this.size)throw new RangeError("Procedural atlas is full");t+=o+4,i=Math.max(i,a)}}registerImage(e,t,{width:r=t?.width,height:i=t?.height,makeWhite:s=!0}={}){if(!(t?.width>0&&t?.height>0))throw new TypeError("Atlas image must be decoded and have positive dimensions: "+e);this.register(e,r,i,(n,o,a)=>{const c=Math.min(o/t.width,a/t.height),u=t.width*c,h=t.height*c;n.drawImage(t,(o-u)/2,(a-h)/2,u,h)},{makeWhite:s})}registerSheet(e,t,{width:r,height:i,makeWhite:s=!0}={}){const n=t?.image;if(typeof e!="string"||!e||!n||!(n.width>0&&n.height>0)||!Number.isSafeInteger(t.length)||t.length<1||typeof t.frame!="function")throw new TypeError("registerSheet requires a name and a decoded HGame SpriteSheet");const o=[],a=[];for(let c=0;c<t.length;c++){const u=t.frame(c),h=`${e}/${c}`;if(![u?.x,u?.y,u?.width,u?.height].every(Number.isFinite)||u.x<0||u.y<0||u.width<=0||u.height<=0||u.x+u.width>n.width||u.y+u.height>n.height)throw new RangeError("SpriteSheet frame is outside the image: "+h);const f=r??u.width,d=i??u.height;if(this.frames.has(h+"_white"))throw new Error("Invalid or duplicate atlas frame: "+h);o.push({name:h,rect:u,width:f,height:d}),a.push({name:h,width:f,height:d}),s&&a.push({name:h+"_white",width:f,height:d})}this.checkCapacity(a);for(const c of o){const u=c.rect;this.register(c.name,c.width,c.height,(h,f,d)=>{h.drawImage(n,u.x,u.y,u.width,u.height,0,0,f,d)},{makeWhite:s})}return o.map(c=>c.name)}pack(e,t){const{width:r,height:i}=t;if(r+4>this.size||i+4>this.size)throw new RangeError("Atlas frame too large: "+e);if(this.x+r+2>this.size&&(this.x=2,this.y+=this.rowHeight+4,this.rowHeight=0),this.y+i+2>this.size)throw new RangeError("Procedural atlas is full");const s=this.x,n=this.y,o=this.ctx;o.drawImage(t,s,n),o.drawImage(t,0,0,r,1,s,n-1,r,1),o.drawImage(t,0,i-1,r,1,s,n+i,r,1),o.drawImage(t,0,0,1,i,s-1,n,1,i),o.drawImage(t,r-1,0,1,i,s+r,n,1,i),o.drawImage(t,0,0,1,1,s-1,n-1,1,1),o.drawImage(t,r-1,0,1,1,s+r,n-1,1,1),o.drawImage(t,0,i-1,1,1,s-1,n+i,1,1),o.drawImage(t,r-1,i-1,1,1,s+r,n+i,1,1),this.frames.set(e,new _t(s,n,r,i)),this.x+=r+4,this.rowHeight=Math.max(this.rowHeight,i)}build(){if(this.source)return this;this.source=new Tt({resource:this.canvas,scaleMode:"linear"});for(const[e,t]of this.frames)this.textures.set(e,new P({source:this.source,frame:t}));return this}get(e){return this.textures.get(e)??P.WHITE}dispose(){for(const e of this.textures.values())e.destroy();this.textures.clear(),this.source?.destroy(),this.source=null}}function ur({playerImage:l=null,enemyImage:e=null,eliteImage:t=e,extraFrames:r=[],size:i=1024}={}){const s=new lr(i),n=(a,c=.4)=>(u,h,f)=>{u.fillStyle=a,u.beginPath(),u.arc(h/2,f/2,Math.min(h,f)*c,0,Math.PI*2),u.fill()},o=a=>(c,u,h)=>{if(!(a?.width>0&&a?.height>0))throw new TypeError("Character image must be decoded and have positive dimensions");const f=Math.min(u/a.width,h/a.height),d=a.width*f,p=a.height*f;c.drawImage(a,(u-d)/2,(h-p)/2,d,p)};s.register("player_hero",64,64,l?o(l):n("#53eccc")),s.register("enemy_chaser",40,40,e?o(e):n("#fa536e")),s.register("enemy_elite",56,56,t?o(t):n("#ffad53")),s.register("bullet_orb",20,20,n("#92faff")),s.register("particle_soft",20,20,(a,c,u)=>{const h=a.createRadialGradient(c/2,u/2,0,c/2,u/2,c/2);h.addColorStop(0,"#fff"),h.addColorStop(1,"#ffffff00"),a.fillStyle=h,a.fillRect(0,0,c,u)});for(const[a,c]of["#ff6622","#ffbb33","#ffed99"].entries())s.register("particle_fire_"+a,20,20,(u,h,f)=>{const d=u.createRadialGradient(h/2,f/2,0,h/2,f/2,h/2);d.addColorStop(0,c),d.addColorStop(1,c+"00"),u.fillStyle=d,u.fillRect(0,0,h,f)},{makeWhite:!1});s.register("particle_spark",12,12,(a,c,u)=>{a.fillStyle="#fff",a.beginPath(),a.moveTo(c/2,0),a.lineTo(c,u/2),a.lineTo(c/2,u),a.lineTo(0,u/2),a.closePath(),a.fill()}),s.register("slash_trail",128,16,(a,c,u)=>{const h=a.createLinearGradient(0,0,c,0);h.addColorStop(0,"#ffffff00"),h.addColorStop(1,"#ffffffff"),a.fillStyle=h,a.fillRect(0,0,c,u)}),s.register("shadow_oval",48,20,(a,c,u)=>{a.fillStyle="#0008",a.beginPath(),a.ellipse(c/2,u/2,c/2,u/2,0,0,Math.PI*2),a.fill()},{makeWhite:!1}),s.register("ground_grid",128,128,(a,c,u)=>{a.fillStyle="#101b2a",a.fillRect(0,0,c,u),a.strokeStyle="#244256",a.lineWidth=1,a.strokeRect(.5,.5,c-1,u-1)},{makeWhite:!1});for(const a of r)typeof a.sheet=="function"?s.registerSheet(a.name,a.sheet(a.image),a):s.registerImage(a.name,a.image,a);return s.build()}var Te=`in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`,Ce=`struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>
  };

fn filterVertexPosition(aPosition:vec2<f32>) -> vec4<f32>
{
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>
{
    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

fn globalTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>
{
  return  (aPosition.xy / gfu.uGlobalFrame.zw) + (gfu.uGlobalFrame.xy / gfu.uGlobalFrame.zw);  
}

fn getSize() -> vec2<f32>
{
  return gfu.uGlobalFrame.zw;
}
  
@vertex
fn mainVertex(
  @location(0) aPosition : vec2<f32>, 
) -> VSOutput {
  return VSOutput(
   filterVertexPosition(aPosition),
   filterTextureCoord(aPosition)
  );
}`,hr=`
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
}`,cr=`struct KawaseBlurUniforms {
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
}`,fr=`
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
`,dr=`struct KawaseBlurUniforms {
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
}`,pr=Object.defineProperty,mr=(l,e,t)=>e in l?pr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,k=(l,e,t)=>(mr(l,typeof e!="symbol"?e+"":e,t),t);const ct=class ft extends be{constructor(...e){let t=e[0]??{};(typeof t=="number"||Array.isArray(t))&&(V("6.0.0","KawaseBlurFilter constructor params are now options object. See params: { strength, quality, clamp, pixelSize }"),t={strength:t},e[1]!==void 0&&(t.quality=e[1]),e[2]!==void 0&&(t.clamp=e[2])),t={...ft.DEFAULT_OPTIONS,...t};const r=ne.from({vertex:{source:Ce,entryPoint:"mainVertex"},fragment:{source:t?.clamp?dr:cr,entryPoint:"mainFragment"}}),i=se.from({vertex:Te,fragment:t?.clamp?fr:hr,name:"kawase-blur-filter"});super({gpuProgram:r,glProgram:i,resources:{kawaseBlurUniforms:{uOffset:{value:new Float32Array(2),type:"vec2<f32>"}}}}),k(this,"uniforms"),k(this,"_pixelSize",{x:0,y:0}),k(this,"_clamp"),k(this,"_kernels",[]),k(this,"_blur"),k(this,"_quality"),this.uniforms=this.resources.kawaseBlurUniforms.uniforms,this.pixelSize=t.pixelSize??{x:1,y:1},Array.isArray(t.strength)?this.kernels=t.strength:typeof t.strength=="number"&&(this._blur=t.strength,this.quality=t.quality??3),this._clamp=!!t.clamp}apply(e,t,r,i){const s=this.pixelSizeX/t.source.width,n=this.pixelSizeY/t.source.height;let o;if(this._quality===1||this._blur===0)o=this._kernels[0]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*n,e.applyFilter(this,t,r,i);else{const a=G.getSameSizeTexture(t);let c=t,u=a,h;const f=this._quality-1;for(let d=0;d<f;d++)o=this._kernels[d]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*n,e.applyFilter(this,c,u,!0),h=c,c=u,u=h;o=this._kernels[f]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*n,e.applyFilter(this,c,r,i),G.returnTexture(a)}}get strength(){return this._blur}set strength(e){this._blur=e,this._generateKernels()}get quality(){return this._quality}set quality(e){this._quality=Math.max(1,Math.round(e)),this._generateKernels()}get kernels(){return this._kernels}set kernels(e){Array.isArray(e)&&e.length>0?(this._kernels=e,this._quality=e.length,this._blur=Math.max(...e)):(this._kernels=[0],this._quality=1)}get pixelSize(){return this._pixelSize}set pixelSize(e){if(typeof e=="number"){this.pixelSizeX=this.pixelSizeY=e;return}if(Array.isArray(e)){this.pixelSizeX=e[0],this.pixelSizeY=e[1];return}this._pixelSize=e}get pixelSizeX(){return this.pixelSize.x}set pixelSizeX(e){this.pixelSize.x=e}get pixelSizeY(){return this.pixelSize.y}set pixelSizeY(e){this.pixelSize.y=e}get clamp(){return this._clamp}_updatePadding(){this.padding=Math.ceil(this._kernels.reduce((e,t)=>e+t+.5,0))}_generateKernels(){const e=this._blur,t=this._quality,r=[e];if(e>0){let i=e;const s=e/t;for(let n=1;n<t;n++)i-=s,r.push(i)}this._kernels=r,this._updatePadding()}};k(ct,"DEFAULT_OPTIONS",{strength:4,quality:3,clamp:!1,pixelSize:{x:1,y:1}});let gr=ct;var xr=`in vec2 vTextureCoord;
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
`,yr=`struct AdvancedBloomUniforms {
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
`,vr=`
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
`,wr=`struct ExtractBrightnessUniforms {
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
`,br=Object.defineProperty,_r=(l,e,t)=>e in l?br(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,dt=(l,e,t)=>(_r(l,typeof e!="symbol"?e+"":e,t),t);const pt=class mt extends be{constructor(e){e={...mt.DEFAULT_OPTIONS,...e};const t=ne.from({vertex:{source:Ce,entryPoint:"mainVertex"},fragment:{source:wr,entryPoint:"mainFragment"}}),r=se.from({vertex:Te,fragment:vr,name:"extract-brightness-filter"});super({gpuProgram:t,glProgram:r,resources:{extractBrightnessUniforms:{uThreshold:{value:e.threshold,type:"f32"}}}}),dt(this,"uniforms"),this.uniforms=this.resources.extractBrightnessUniforms.uniforms}get threshold(){return this.uniforms.uThreshold}set threshold(e){this.uniforms.uThreshold=e}};dt(pt,"DEFAULT_OPTIONS",{threshold:.5});let Tr=pt;var Cr=Object.defineProperty,Pr=(l,e,t)=>e in l?Cr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,N=(l,e,t)=>(Pr(l,typeof e!="symbol"?e+"":e,t),t);const gt=class xt extends be{constructor(e){e={...xt.DEFAULT_OPTIONS,...e};const t=ne.from({vertex:{source:Ce,entryPoint:"mainVertex"},fragment:{source:yr,entryPoint:"mainFragment"}}),r=se.from({vertex:Te,fragment:xr,name:"advanced-bloom-filter"});super({gpuProgram:t,glProgram:r,resources:{advancedBloomUniforms:{uBloomScale:{value:e.bloomScale,type:"f32"},uBrightness:{value:e.brightness,type:"f32"}},uMapTexture:P.WHITE}}),N(this,"uniforms"),N(this,"bloomScale",1),N(this,"brightness",1),N(this,"_extractFilter"),N(this,"_blurFilter"),this.uniforms=this.resources.advancedBloomUniforms.uniforms,this._extractFilter=new Tr({threshold:e.threshold}),this._blurFilter=new gr({strength:e.kernels??e.blur,quality:e.kernels?void 0:e.quality}),Object.assign(this,e)}apply(e,t,r,i){const s=G.getSameSizeTexture(t);this._extractFilter.apply(e,t,s,!0);const n=G.getSameSizeTexture(t);this._blurFilter.apply(e,s,n,!0),this.uniforms.uBloomScale=this.bloomScale,this.uniforms.uBrightness=this.brightness,this.resources.uMapTexture=n.source,e.applyFilter(this,t,r,i),G.returnTexture(n),G.returnTexture(s)}get threshold(){return this._extractFilter.threshold}set threshold(e){this._extractFilter.threshold=e}get kernels(){return this._blurFilter.kernels}set kernels(e){this._blurFilter.kernels=e}get blur(){return this._blurFilter.strength}set blur(e){this._blurFilter.strength=e}get quality(){return this._blurFilter.quality}set quality(e){this._blurFilter.quality=e}get pixelSize(){return this._blurFilter.pixelSize}set pixelSize(e){typeof e=="number"&&(e={x:e,y:e}),Array.isArray(e)&&(e={x:e[0],y:e[1]}),this._blurFilter.pixelSize=e}get pixelSizeX(){return this._blurFilter.pixelSizeX}set pixelSizeX(e){this._blurFilter.pixelSizeX=e}get pixelSizeY(){return this._blurFilter.pixelSizeY}set pixelSizeY(e){this._blurFilter.pixelSizeY=e}};N(gt,"DEFAULT_OPTIONS",{threshold:.5,bloomScale:1,brightness:1,blur:8,quality:4,pixelSize:{x:1,y:1}});let Sr=gt;class zr{constructor(e,{textures:t=["enemy_chaser"],clips:r=null,scale:i=1,worldScale:s=1,offsetX:n=0,offsetY:o=0,syncRotation:a=!1,flipByDirection:c=!1,cull:u=!0}={}){if(!e?.worldRoot||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a swarm layer");const h=r??(Array.isArray(t)?t.map(f=>({frames:[f]})):null);if(!Array.isArray(h)||h.length===0)throw new TypeError("Swarm clips or textures must be a non-empty array");if(![i,s,n,o].every(Number.isFinite)||i<=0||s<=0)throw new RangeError("Swarm scale and worldScale must be positive and offsets must be finite");this.renderer=e,this.scale=i,this.worldScale=s,this.offsetX=n,this.offsetY=o,this.syncRotation=!!a,this.flipByDirection=!!c,this.cull=!!u,this.clips=h.map(f=>{if(!f||!Array.isArray(f.frames)||f.frames.length===0||f.frames.some(g=>typeof g!="string"||!e.atlas.textures.has(g)))throw new TypeError("Swarm clip frames must be existing atlas frame names");const d=f.fps??8;if(!Number.isFinite(d)||d<=0)throw new RangeError("Swarm clip fps must be positive");const p=f.frames.map(g=>{const m=e.atlas.textures.get(g);return{texture:m,white:e.atlas.textures.get(g+"_white")??m,radius:Math.hypot(m.orig.width,m.orig.height)*.5}});return{frames:p,fps:d,loop:f.loop!==!1,radius:Math.max(...p.map(g=>g.radius))}}),this.layer=new ie({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),e.worldRoot.addChildAt(this.layer,e.worldRoot.getChildIndex(e.entityLayer)),this.particles=[],this.pool=[],this.pendingParticles=[],this.visibleCount=0,this.disposed=!1}sync(e){if(this.disposed)throw new Error("Swarm layer is disposed");if(!e?.activeIds||!e.posX||!e.posY||!Number.isInteger(e.count))throw new TypeError("sync requires an HGame CPU SwarmSimulation");const t=e.count;if(t<0||t>e.activeIds.length)throw new RangeError("Swarm count exceeds active ID capacity");const r=this.renderer.camera,i=this.renderer.app.screen,s=i.width/2,n=i.height/2,o=r.zoom;if(!(o>0)||!Number.isFinite(o))throw new RangeError("Camera zoom must be finite and positive");const a=r.x+(-s-r.shakeX)/o,c=r.x+(s-r.shakeX)/o,u=r.y+(-n-r.shakeY)/o,h=r.y+(n-r.shakeY)/o,f=this.clips,d=f.length===1?f[0]:null,p=e.posX,g=e.posY,m=e.activeIds,y=e.animClip,x=e.scale,b=e.rot,L=e.animTime,D=e.flash,M=this.worldScale,z=this.offsetX,A=this.offsetY,v=this.scale,yt=this.cull,Pe=this.syncRotation,Se=this.flipByDirection;let F=0;for(let X=0;X<t;X++){const U=m[X],ae=p[U]*M+z,le=g[U]*M+A,B=d??f[(y?.[U]??0)%f.length],$=(x?.[U]??1)*v;if(yt){const I=B.radius*Math.abs($);if(ae+I<a||ae-I>c||le+I<u||le-I>h)continue}let ze=0;if(B.frames.length>1){const I=L?.[U]??0,Ee=Number.isFinite(I)?Math.max(0,Math.floor(I*B.fps)):0;ze=B.loop?Ee%B.frames.length:Math.min(Ee,B.frames.length-1)}const Ae=B.frames[ze];let _=this.particles[F];const ue=D?.[U]>0?Ae.white:Ae.texture;_||(_=this.pool.pop()??new _e({texture:ue,anchorX:.5,anchorY:.5}),this.particles.push(_),this.pendingParticles.push(_),this.pendingParticles.length===4096&&this.flushPending()),_.texture!==ue&&(_.texture=ue),_.x=ae,_.y=le;const Ue=Pe||Se?b?.[U]??0:0;_.rotation=Pe?Ue:0,_.scaleX=Se&&Math.sin(Ue)<0?-$:$,_.scaleY=$,F++}if(this.flushPending(),F<this.particles.length){const X=this.layer.removeParticles(F);this.particles.length=F;for(const U of X)this.pool.push(U)}return this.visibleCount=F,F}flushPending(){this.pendingParticles.length&&this.layer.addParticle(...this.pendingParticles),this.pendingParticles.length=0}dispose(){this.disposed||(this.disposed=!0,this.layer.removeFromParent(),this.layer.destroy(),this.particles.length=0,this.pool.length=0,this.pendingParticles.length=0,this.visibleCount=0,this.renderer.swarmLayers.delete(this))}}class Ar{constructor(e,t,{frames:r,layer:i="background",chunkSize:s=32,maxCachedChunks:n=128,originX:o=0,originY:a=0}={}){if(!e?.bgLayer||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a tilemap layer");if(!t||typeof t.get!="function"||!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<1||t.height<1||!Number.isFinite(t.tileWidth)||!Number.isFinite(t.tileHeight)||!(t.tileWidth>0)||!(t.tileHeight>0))throw new TypeError("A rectangular HGame TileMap with positive tile dimensions is required");if(!r||typeof r!="object"||Array.isArray(r))throw new TypeError("frames must map tile values to atlas frame names");if(i!=="background"&&i!=="foreground")throw new RangeError("Tilemap layer must be background or foreground");if(!Number.isInteger(s)||s<1||s>128)throw new RangeError("chunkSize must be an integer from 1 to 128");if(!Number.isInteger(n)||n<1||n>4096)throw new RangeError("maxCachedChunks must be an integer from 1 to 4096");if(!Number.isFinite(o)||!Number.isFinite(a))throw new RangeError("Tilemap origin must be finite");this.renderer=e,this.map=t,this.frames=new Map;for(const[c,u]of Object.entries(r)){if(u==null)continue;const h=e.atlas.textures.get(u);if(!h)throw new Error("Unknown tilemap atlas frame: "+u);this.frames.set(c,h)}this.chunkSize=s,this.maxCachedChunks=n,this.originX=o,this.originY=a,this.cols=Math.ceil(t.width/s),this.rows=Math.ceil(t.height/s),this.root=new O,this.root.eventMode="none",this.root.interactiveChildren=!1,this.chunks=new Map,this.visibleRange=null,this.disposed=!1;try{(i==="foreground"?e.foregroundLayer:e.bgLayer).addChild(this.root),this.update()}catch(c){throw this.root.destroy({children:!0}),c}}buildChunk(e,t){const r=t*this.cols+e,i=e*this.chunkSize,s=t*this.chunkSize,n=Math.min(this.map.width,i+this.chunkSize),o=Math.min(this.map.height,s+this.chunkSize),a=new ie({dynamicProperties:{position:!1,vertex:!1,uvs:!1,rotation:!1,color:!1}}),c={view:a,x0:i,y0:s,x1:n,y1:o,cells:new Array((n-i)*(o-s)).fill(null)};return this.chunks.set(r,c),this.root.addChild(a),this.refreshChunk(c),c}updateCell(e,t,r){const i=(r-e.y0)*(e.x1-e.x0)+t-e.x0,s=e.cells[i],n=this.frames.get(String(this.map.get(t,r)));if(!n)return s?(e.cells[i]=null,2):0;const o=this.originX+t*this.map.tileWidth,a=this.originY+r*this.map.tileHeight,c=this.map.tileWidth/n.orig.width,u=this.map.tileHeight/n.orig.height;if(s&&s.texture===n&&s.x===o&&s.y===a&&s.scaleX===c&&s.scaleY===u)return 0;const h=s??new _e({texture:n});return h.texture=n,h.x=o,h.y=a,h.scaleX=c,h.scaleY=u,e.cells[i]=h,s?1:2}commitChunkChanges(e,t){if(t===2){const r=e.view.particleChildren;r.length=0;for(const i of e.cells)i&&r.push(i)}t>0&&e.view.update()}refreshChunk(e){let t=0;for(let r=e.y0;r<e.y1;r++)for(let i=e.x0;i<e.x1;i++)t=Math.max(t,this.updateCell(e,i,r));this.commitChunkChanges(e,t)}cachedChunkAt(e,t){return this.chunks.get(Math.floor(t/this.chunkSize)*this.cols+Math.floor(e/this.chunkSize))}refreshTile(e,t){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw new RangeError("Tile is outside the map");const r=this.cachedChunkAt(e,t);r&&this.refreshChunk(r)}setTile(e,t,r){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw new RangeError("Tile is outside the map");if(typeof this.map.set!="function")throw new TypeError("Tilemap must support set");if(Object.is(this.map.get(e,t),r))return;this.map.set(e,t,r);const i=this.cachedChunkAt(e,t);i&&this.commitChunkChanges(i,this.updateCell(i,e,t))}setTiles(e){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Array.isArray(e))throw new TypeError("Tile edits must be an array");if(typeof this.map.set!="function")throw new TypeError("Tilemap must support set");for(const r of e)if(!r||!Object.hasOwn(r,"value")||!Number.isInteger(r.x)||!Number.isInteger(r.y)||r.x<0||r.y<0||r.x>=this.map.width||r.y>=this.map.height)throw new RangeError("Each tile edit needs an in-bounds x, y, and value");const t=new Map;try{for(const{x:r,y:i,value:s}of e){if(Object.is(this.map.get(r,i),s))continue;this.map.set(r,i,s);const n=this.cachedChunkAt(r,i);if(!n)continue;const o=this.updateCell(n,r,i);o>0&&t.set(n,Math.max(o,t.get(n)??0))}}finally{for(const[r,i]of t)this.commitChunkChanges(r,i)}}update(){if(this.disposed)return;const e=this.renderer.camera,t=this.renderer.app.screen,r=e.zoom;if(!(r>0)||!Number.isFinite(r))throw new RangeError("Camera zoom must be finite and positive");const i=e.x+(-t.width/2-e.shakeX)/r,s=e.x+(t.width/2-e.shakeX)/r,n=e.y+(-t.height/2-e.shakeY)/r,o=e.y+(t.height/2-e.shakeY)/r,a=this.chunkSize*this.map.tileWidth,c=this.chunkSize*this.map.tileHeight,u=Math.max(0,Math.ceil((i-this.originX)/a)-1),h=Math.min(this.cols-1,Math.floor((s-this.originX)/a)),f=Math.max(0,Math.ceil((n-this.originY)/c)-1),d=Math.min(this.rows-1,Math.floor((o-this.originY)/c)),p=this.visibleRange;if(!(p&&p.x0===u&&p.x1===h&&p.y0===f&&p.y1===d)){if(p)for(let g=p.y0;g<=p.y1;g++)for(let m=p.x0;m<=p.x1;m++)(m<u||m>h||g<f||g>d)&&(this.chunks.get(g*this.cols+m).view.visible=!1);for(let g=f;g<=d;g++)for(let m=u;m<=h;m++){const y=g*this.cols+m,x=this.chunks.get(y)??this.buildChunk(m,g);x.view.visible=!0,this.chunks.delete(y),this.chunks.set(y,x)}for(const[g,m]of this.chunks){if(this.chunks.size<=this.maxCachedChunks||m.view.visible)break;m.view.removeFromParent(),m.view.destroy(),this.chunks.delete(g)}this.visibleRange={x0:u,x1:h,y0:f,y1:d}}}dispose(){this.disposed||(this.disposed=!0,this.root.removeFromParent(),this.root.destroy({children:!0}),this.chunks.clear(),this.visibleRange=null,this.renderer.tilemapLayers.delete(this))}}class Ur{constructor(e,{maxPixels:t=23e5,maxPixelRatio:r=2,qualityController:i=null}={}){if(!Number.isFinite(t)||t<1||!Number.isFinite(r)||r<=0)throw new RangeError("Renderer pixel budget and maximum pixel ratio must be positive");if(this.atlas=e,this.maxPixels=t,this.maxPixelRatio=r,i&&(typeof i.sampleFrame!="function"||typeof i.resetMeasurements!="function"))throw new TypeError("qualityController must support sampleFrame and resetMeasurements");this.qualityController=i,this.lastFrameTime=null,this.app=new ye,this.entityMap=new Map,this.spritePool=[],this.swarmLayers=new Set,this.tilemapLayers=new Set,this.camera={x:0,y:0,targetX:0,targetY:0,zoom:1,shakeX:0,shakeY:0}}async init(e){this.mount=e;const{width:t,height:r,resolution:i}=this.planViewport(),s={width:t,height:r,resolution:i,autoDensity:!0,backgroundColor:725019,autoStart:!1},n=[];let o=!1;for(const c of["webgpu","webgl","canvas"])try{await this.app.init({...s,preference:[c]}),o=!0;break}catch(u){n.push(u);try{this.app.renderer?this.app.destroy({removeView:!0},{children:!0}):this.app.stage?.destroy({children:!0})}catch(h){n.push(h),console.warn("Failed to clean up a Pixi renderer:",h)}c!=="canvas"&&(this.app=new ye)}if(!o)throw new AggregateError(n,"Unable to initialize a Pixi renderer");this.isCanvas=this.app.renderer.type===Ye.CANVAS,this.app.ticker.stop(),this.app.canvas.id="game",this.app.canvas.setAttribute("aria-label","游戏画面"),e.appendChild(this.app.canvas),this.worldRoot=new O,this.worldRoot.eventMode="none",this.worldRoot.interactiveChildren=!1,this.bgLayer=new O;const a=new Kt({texture:this.atlas.get("ground_grid"),width:4096,height:4096});this.grid=a,a.position.set(-2048,-2048),this.bgLayer.addChild(a),this.shadowLayer=new O,this.entityLayer=new O({sortableChildren:!0}),this.foregroundLayer=new O,this.enemyLayer=new ie({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),this.enemyParticles=[],this.enemyPool=[],this.pendingEnemies=[],this.trailLayer=new O,this.particleLayer=new ie({dynamicProperties:{position:!0,vertex:!0,rotation:!0,color:!0,uvs:!0}}),this.worldRoot.addChild(this.bgLayer,this.shadowLayer,this.enemyLayer,this.entityLayer,this.foregroundLayer,this.trailLayer,this.particleLayer),this.app.stage.addChild(this.worldRoot),this.bloom=new Sr({threshold:.62,bloomScale:.4,brightness:1,blur:3}),this.bloomEnabled=!1,this.effectFilters=[],this.applyFilters(),this.viewport={width:t,height:r,resolution:i},typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(e))}planViewport(){const e=Math.max(1,Math.floor(this.mount?.clientWidth||1)),t=Math.max(1,Math.floor(this.mount?.clientHeight||1)),r=Number(globalThis.devicePixelRatio)||1,i=this.qualityController?.state?.dynamicScale??1,s=Math.max(1/Math.min(e,t),Math.min(r,this.maxPixelRatio,Math.sqrt(this.maxPixels/(e*t)))*i);return{width:e,height:t,resolution:s}}resize(){if(this.disposed||!this.app.renderer)return!1;const e=this.planViewport(),t=this.viewport;return t&&t.width===e.width&&t.height===e.height&&t.resolution===e.resolution?!1:(this.app.renderer.resize(e.width,e.height,e.resolution),this.viewport=e,this.onResize?.(),!0)}resetQualityMeasurements(){this.lastFrameTime=null,this.qualityController?.resetMeasurements()}setBloom({enabled:e=!0,threshold:t,bloomScale:r,brightness:i,blur:s}={}){if(!this.bloom||this.disposed)throw new Error("Initialize Renderer2D before configuring bloom");for(const[n,o]of Object.entries({threshold:t,bloomScale:r,brightness:i,blur:s}))if(o!==void 0&&(!Number.isFinite(o)||o<0))throw new RangeError(`Bloom ${n} must be a finite non-negative number`);t!==void 0&&(this.bloom.threshold=t),r!==void 0&&(this.bloom.bloomScale=r),i!==void 0&&(this.bloom.brightness=i),s!==void 0&&(this.bloom.blur=s),this.bloomEnabled=!!e,this.applyFilters()}setEffectFilters(e){this.effectFilters=e,this.applyFilters()}applyFilters(){const e=this.effectFilters;this.app.stage.filters=!this.isCanvas&&(this.bloomEnabled||e.length)?[this.bloom,...e]:[]}createSwarmLayer(e){const t=new zr(this,e);return this.swarmLayers.add(t),t}createTilemapLayer(e,t){const r=new Ar(this,e,t);return this.tilemapLayers.add(r),r}syncEnemies(e,t){if(this.enemyParticles.length>e.length){const r=this.enemyLayer.removeParticles(e.length);this.enemyParticles.length=e.length;for(const i of r)this.enemyPool.push(i)}for(let r=0;r<e.length;r++){const i=e[r];let s=this.enemyParticles[r];const n=(i.elite?"enemy_elite":"enemy_chaser")+(i.flash>0?"_white":"");s||(s=this.enemyPool.pop()??new _e({texture:this.atlas.get(n),anchorX:.5,anchorY:.5}),this.enemyParticles.push(s),this.pendingEnemies.push(s),this.pendingEnemies.length===4096&&this.flushEnemies());const o=this.atlas.get(n);s.texture!==o&&(s.texture=o),s.x=i.x,s.y=i.y;const a=t*7+i.id*.37;s.rotation=Math.sin(a)*.09;const c=Math.sin(a*2);s.scaleX=1+c*.035,s.scaleY=1-c*.05}this.flushEnemies()}flushEnemies(){this.pendingEnemies.length&&this.enemyLayer.addParticle(...this.pendingEnemies),this.pendingEnemies.length=0}alloc(e){const t=this.spritePool.pop()??new Ct;return t.texture=this.atlas.get(e),t.anchor.set(.5),t.alpha=1,t.tint=16777215,t.scale.set(1),t.rotation=0,t.visible=!0,t}syncEntity(e,t){let r=this.entityMap.get(e);r||(r={sprite:this.alloc(t.tex),shadow:null,flashTimer:0,animScaleX:1,animScaleY:1},this.entityMap.set(e,r),this.entityLayer.addChild(r.sprite)),r.baseTex=t.tex;const i=r.sprite,s=this.atlas.get(t.tex);return i.texture=r.flashTimer>0?this.atlas.textures.get(t.tex+"_white")??s:s,i.position.set(t.x,t.y),i.rotation=t.rot??0,i.scale.set((t.scaleX??1)*r.animScaleX,(t.scaleY??1)*r.animScaleY),i.tint=r.flashTimer>0?16777215:t.tint??16777215,i.alpha=t.alpha??1,i.zIndex=t.zIndex??t.y,t.hasShadow!==!1?(r.shadow||(r.shadow=this.alloc("shadow_oval"),this.shadowLayer.addChild(r.shadow)),r.shadow.visible=!0,r.shadow.position.set(t.x,t.y+18),r.shadow.alpha=.35):r.shadow&&(r.shadow.visible=!1),r}releaseEntity(e){const t=this.entityMap.get(e);t&&(t.sprite.removeFromParent(),this.spritePool.push(t.sprite),t.shadow&&(t.shadow.removeFromParent(),this.spritePool.push(t.shadow)),this.entityMap.delete(e))}update(e){const t=this.camera,r=1-Math.exp(-10*e);t.x+=(t.targetX-t.x)*r,t.y+=(t.targetY-t.y)*r,this.worldRoot.scale.set(t.zoom),this.worldRoot.position.set(this.app.screen.width/2-t.x*t.zoom+t.shakeX,this.app.screen.height/2-t.y*t.zoom+t.shakeY);for(const i of this.tilemapLayers)i.update();for(const i of this.entityMap.values())i.flashTimer=Math.max(0,i.flashTimer-e)}screenToWorld(e,t){return{x:(e-this.app.screen.width/2-this.camera.shakeX)/this.camera.zoom+this.camera.x,y:(t-this.app.screen.height/2-this.camera.shakeY)/this.camera.zoom+this.camera.y}}worldToScreen(e,t){return{x:(e-this.camera.x)*this.camera.zoom+this.app.screen.width/2+this.camera.shakeX,y:(t-this.camera.y)*this.camera.zoom+this.app.screen.height/2+this.camera.shakeY}}render(){if(this.qualityController){const e=performance.now();this.lastFrameTime!==null&&this.qualityController.sampleFrame(e-this.lastFrameTime)&&this.resize(),this.lastFrameTime=e}this.app.renderer.render(this.app.stage)}dispose(){if(this.disposed)return;this.disposed=!0,this.resizeObserver?.disconnect(),this.resizeObserver=null,this.onResize=null;for(const t of this.swarmLayers)t.dispose();for(const t of this.tilemapLayers)t.dispose();for(const t of this.spritePool)t.destroy();this.spritePool.length=0,this.enemyParticles.length=0,this.enemyPool.length=0,this.pendingEnemies.length=0,this.entityMap.clear();const e=this.app.stage;try{e&&(e.filters=[]),this.effectFilters&&(this.effectFilters.length=0),this.bloom?.destroy(),this.app.renderer?this.app.destroy({removeView:!0},{children:!0}):e&&!e.destroyed&&e.destroy({children:!0})}finally{this.atlas.dispose()}}}function Er(l,{resetInput:e=()=>{},onVisibility:t=()=>{}}={}){let r=!1;function i(a){a?r&&(r=!1,l.running&&l.paused&&l.resume()):(e(),l.running&&!l.paused&&(r=l.pause())),t(a)}const s=l.platform.lifecycle,n=s.on("visibility",i),o=s.on("focus",a=>{a||e()});return{sync(){i(s.visible)},dispose(){n(),o(),r=!1}}}async function Le(l){const e=await fetch(new URL(l,document.baseURI));if(!e.ok)throw new Error(`Could not load ${l}: HTTP ${e.status}`);return e.json()}function q(l){const e=location.port==="4175"&&location.pathname.startsWith("/local-games/"),t=new URL(e?"/runtime/hgame/":"./vendor/hgame/",document.baseURI);return import(new URL(l,t).href)}async function Ir(l,{mount:e=document.querySelector("#game-canvas"),createAtlas:t=ur,rendererOptions:r}={}){if(!e)throw new Error("Missing Pixi game canvas mount");if(typeof l!="function")throw new TypeError("Pixi game setup callback is required");const[i,s,{createGameApplication:n},{defineProject:o},{Scene:a},{Entity:c},{Component:u}]=await Promise.all([Le("./game.config.json"),Le("./engine.config.json"),q("core/application.js"),q("core/config.js"),q("core/scene.js"),q("core/entity.js"),q("core/component.js")]),h=o(s),f=await t();let d,p,g,m;function y(x){x.persisted||d.dispose()}try{p=new Ur(f,r),await p.init(e),d=n({project:h,gameId:i.id,gameVersion:i.version,renderer:{render(){p.render()},resize(){p.resize()},dispose(){window.removeEventListener("pagehide",y),m&&window.__hgameState===m&&delete window.__hgameState,delete e.dataset.engineReady;try{g?.dispose()}finally{p.dispose()}}}}),window.addEventListener("pagehide",y),await d.installFeatures();const x=await l({app:d,renderer:p,Scene:a,Entity:c,Component:u});if(d.disposed)throw new Error("Pixi game was disposed during setup");if(typeof x?.scene!="string"||!d.scenes.get(x.scene))throw new Error("Pixi game setup must return the name of a registered scene in { scene }");return g=Er(d,x.visibility),p.onResize=()=>{h.tickHz===0&&d.running&&!d.paused&&p.render()},d.scenes.start(x.scene),d.start(),g.sync(),m=x.state,m&&(window.__hgameState=m),e.dataset.engineReady="true",{app:d,renderer:p}}catch(x){try{d?d.dispose():p?p.dispose():f.dispose()}catch(b){throw new AggregateError([x,b],"Pixi game startup and cleanup failed")}throw x}}export{Dt as B,rt as M,_e as P,ur as c,q as l,Le as r,Ir as s,Te as v,Ce as w};
