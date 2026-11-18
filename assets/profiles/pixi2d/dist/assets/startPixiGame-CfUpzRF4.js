const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./browserAll-ClIQLABI.js","./Geometry-DuktKPGT.js","./init-D5TSuBEl.js","./canvasUtils-B-n9KQGi.js","./webworkerAll-DybuJ2_o.js","./CanvasPool-C5nSytcC.js","./WebGPURenderer-upjCDfak.js","./colorToUniform-BRamFM33.js","./DefaultBatcher-kUrrL9t-.js","./localUniformBit-BOGrcT1E.js","./getTextureBatchBindGroup-BGIKwd15.js","./getTexelRangeRects-BkOf51hU.js","./RenderTargetSystem-BFfDoSPW.js","./WebGLRenderer-BvoRHXlc.js","./CanvasRenderer-DuGN_riS.js","./Graphics-yWNOqeyh.js"])))=>i.map(i=>d[i]);
import{E as z,D as ge,r as wt,q as Oe,k as O,t as B,d as G,x as W,o as Ge,c as $,e as U,M as I,aa as j,P as Z,h as xe,m as Ye,p as qe,U as ye,T as M,y as ve,R as Xe,V as We,b as we,H as ae,A as le,C as He,ab as bt,ac as ke,J as _t,W as Tt,j as Ct,F as Pe,Z as X,O as Pt}from"./Geometry-DuktKPGT.js";import{C as St}from"./init-D5TSuBEl.js";import{A as je,h as zt,a as At,b as Rt,c as Et,r as Ut,G as $e,d as Ke,g as Qe,V as ee}from"./colorToUniform-BRamFM33.js";import{c as Je}from"./canvasUtils-B-n9KQGi.js";import{a as Mt,b as Ot}from"./localUniformBit-BOGrcT1E.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))r(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const n of s.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&r(n)}).observe(document,{childList:!0,subtree:!0});function t(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function r(i){if(i.ep)return;i.ep=!0;const s=t(i);fetch(i.href,s)}})();const kt="modulepreload",Ft=function(l,e){return new URL(l,e).href},Fe={},K=function(e,t,r){let i=Promise.resolve();if(t&&t.length>0){let n=function(u){return Promise.all(u.map(h=>Promise.resolve(h).then(f=>({status:"fulfilled",value:f}),f=>({status:"rejected",reason:f}))))};const o=document.getElementsByTagName("link"),a=document.querySelector("meta[property=csp-nonce]"),c=a?.nonce||a?.getAttribute("nonce");i=n(t.map(u=>{if(u=Ft(u,r),u in Fe)return;Fe[u]=!0;const h=u.endsWith(".css"),f=h?'[rel="stylesheet"]':"";if(!!r)for(let g=o.length-1;g>=0;g--){const m=o[g];if(m.href===u&&(!h||m.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${u}"]${f}`))return;const p=document.createElement("link");if(p.rel=h?"stylesheet":kt,h||(p.as="script"),p.crossOrigin="",p.href=u,c&&p.setAttribute("nonce",c),document.head.appendChild(p),h)return new Promise((g,m)=>{p.addEventListener("load",g),p.addEventListener("error",()=>m(new Error(`Unable to preload CSS for ${u}`)))})}))}function s(n){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=n,window.dispatchEvent(o),!o.defaultPrevented)throw n}return i.then(n=>{for(const o of n||[])o.status==="rejected"&&s(o.reason);return e().catch(s)})},Bt={extension:{type:z.Environment,name:"browser",priority:-1},test:()=>!0,load:async()=>{await K(()=>import("./browserAll-ClIQLABI.js"),__vite__mapDeps([0,1,2,3,4,5]),import.meta.url)}},It={extension:{type:z.Environment,name:"webworker",priority:0},test:()=>typeof self<"u"&&self.WorkerGlobalScope!==void 0,load:async()=>{await K(()=>import("./webworkerAll-DybuJ2_o.js"),__vite__mapDeps([4,2,1,3,5]),import.meta.url)}};let te;function Vt(l){return te!==void 0||(te=(()=>{const e={stencil:!0,failIfMajorPerformanceCaveat:l??je.defaultOptions.failIfMajorPerformanceCaveat};try{if(!ge.get().getWebGLRenderingContext())return!1;let r=ge.get().createCanvas().getContext("webgl",e);const i=!!r?.getContextAttributes()?.stencil;if(r){const s=r.getExtension("WEBGL_lose_context");s&&s.loseContext()}return r=null,i}catch{return!1}})()),te}let re;async function Dt(l={}){return re!==void 0||(re=await(async()=>{const e=ge.get().getNavigator().gpu;if(!e)return!1;try{return await(await e.requestAdapter(l)).requestDevice(),!0}catch{return!1}})()),re}const Be=["webgl","webgpu","canvas"];async function Lt(l){let e=[];l.preference?Array.isArray(l.preference)?e=l.preference.slice():(e.push(l.preference),Be.forEach(s=>{s!==l.preference&&e.push(s)})):e=Be.slice();let t,r={};for(let s=0;s<e.length;s++){const n=e[s];if(n==="webgpu"&&await Dt()){const{WebGPURenderer:o}=await K(async()=>{const{WebGPURenderer:a}=await import("./WebGPURenderer-upjCDfak.js");return{WebGPURenderer:a}},__vite__mapDeps([6,1,7,8,9,10,11,12,5]),import.meta.url);t=o,r={...l,...l.webgpu};break}else if(n==="webgl"&&Vt(l.failIfMajorPerformanceCaveat??je.defaultOptions.failIfMajorPerformanceCaveat)){const{WebGLRenderer:o}=await K(async()=>{const{WebGLRenderer:a}=await import("./WebGLRenderer-BvoRHXlc.js");return{WebGLRenderer:a}},__vite__mapDeps([13,1,7,8,9,11,12,5]),import.meta.url);t=o,r={...l,...l.webgl};break}else if(n==="canvas"){const{CanvasRenderer:o}=await K(async()=>{const{CanvasRenderer:a}=await import("./CanvasRenderer-DuGN_riS.js");return{CanvasRenderer:a}},__vite__mapDeps([14,1,12,7,8,5,3,15,10]),import.meta.url);t=o,r={...l,...l.canvasOptions};break}}if(delete r.webgpu,delete r.webgl,delete r.canvasOptions,!t)throw new Error("No available renderer for the current environment");const i=new t;return await i.init(r),i}class Ze{static init(e){Object.defineProperty(this,"resizeTo",{configurable:!0,set(t){globalThis.removeEventListener("resize",this.queueResize),this._resizeTo=t,t&&(globalThis.addEventListener("resize",this.queueResize),this.resize())},get(){return this._resizeTo}}),this.queueResize=()=>{this._resizeTo&&(this._cancelResize(),this._resizeId=requestAnimationFrame(()=>this.resize()))},this._cancelResize=()=>{this._resizeId&&(cancelAnimationFrame(this._resizeId),this._resizeId=null)},this.resize=()=>{if(!this._resizeTo)return;this._cancelResize();let t,r;if(this._resizeTo===globalThis.window)t=globalThis.innerWidth,r=globalThis.innerHeight;else{const{clientWidth:i,clientHeight:s}=this._resizeTo;t=i,r=s}this.renderer.resize(t,r),this.render()},this._resizeId=null,this._resizeTo=null,this.resizeTo=e.resizeTo||null}static destroy(){globalThis.removeEventListener("resize",this.queueResize),this._cancelResize(),this._cancelResize=null,this.queueResize=null,this.resizeTo=null,this.resize=null}}Ze.extension=z.Application;class et{static init(e){e=Object.assign({autoStart:!0,sharedTicker:!1},e),Object.defineProperty(this,"ticker",{configurable:!0,set(t){this._ticker&&this._ticker.remove(this.render,this),this._ticker=t,t&&t.add(this.render,this,wt.LOW)},get(){return this._ticker}}),this.stop=()=>{this._ticker.stop()},this.start=()=>{this._ticker.start()},this._ticker=null,this.ticker=e.sharedTicker?Oe.shared:new Oe,e.autoStart&&this.start()}static destroy(){if(this._ticker){const e=this._ticker;this.ticker=null,e.destroy()}}}et.extension=z.Application;O.add(Ze);O.add(et);const tt=class be{constructor(...e){this.stage=new B,e[0]!==void 0&&G(W,"Application constructor options are deprecated, please use Application.init() instead.")}async init(e){e={...e},this.stage||(this.stage=new B),this.renderer=await Lt(e),be._plugins.forEach(t=>{t.init.call(this,e)})}render(){this.renderer.render({container:this.stage})}get canvas(){return this.renderer.canvas}get view(){return G(W,"Application.view is deprecated, please use Application.canvas instead."),this.renderer.canvas}get screen(){return this.renderer.screen}get domContainerRoot(){return this.renderer.renderPipes.dom?._domElement}destroy(e=!1,t=!1){const r=be._plugins.slice(0);r.reverse(),r.forEach(i=>{i.destroy.call(this)}),this.stage.destroy(t),this.stage=null,this.renderer.destroy(e),this.renderer=null}};tt._plugins=[];let _e=tt;O.handleByList(z.Application,_e._plugins);O.add(zt);const rt=class it extends Ge{constructor(...e){let t=e[0]??{};t instanceof Float32Array&&(G(W,"use new MeshGeometry({ positions, uvs, indices }) instead"),t={positions:t,uvs:e[1],indices:e[2]}),t={...it.defaultOptions,...t};const r=t.positions||new Float32Array([0,0,1,0,1,1,0,1]);let i=t.uvs;i||(t.positions?i=new Float32Array(r.length):i=new Float32Array([0,0,1,0,1,1,0,1]));const s=t.indices||new Uint32Array([0,1,2,0,2,3]),n=t.shrinkBuffersToFit,o=new $({data:r,label:"attribute-mesh-positions",shrinkToFit:n,usage:U.VERTEX|U.COPY_DST}),a=new $({data:i,label:"attribute-mesh-uvs",shrinkToFit:n,usage:U.VERTEX|U.COPY_DST}),c=new $({data:s,label:"index-mesh-buffer",shrinkToFit:n,usage:U.INDEX|U.COPY_DST});super({attributes:{aPosition:{buffer:o,format:"float32x2",stride:8,offset:0},aUV:{buffer:a,format:"float32x2",stride:8,offset:0}},indexBuffer:c,topology:t.topology}),this.batchMode="auto"}get positions(){return this.attributes.aPosition.buffer.data}set positions(e){this.attributes.aPosition.buffer.data=e}get uvs(){return this.attributes.aUV.buffer.data}set uvs(e){this.attributes.aUV.buffer.data=e}get indices(){return this.indexBuffer.data}set indices(e){this.indexBuffer.data=e}};rt.defaultOptions={topology:"triangle-list",shrinkBuffersToFit:!1};let st=rt;class Nt{constructor(){this.batcherName="default",this.packAsQuad=!1,this.indexOffset=0,this.attributeOffset=0,this.roundPixels=0,this._batcher=null,this._batch=null,this._textureMatrixUpdateId=-1,this._uvUpdateId=-1}get blendMode(){return this.renderable.groupBlendMode}get topology(){return this._topology||this.geometry.topology}set topology(e){this._topology=e}reset(){this.renderable=null,this.texture=null,this._batcher=null,this._batch=null,this.geometry=null,this._uvUpdateId=-1,this._textureMatrixUpdateId=-1}setTexture(e){this.texture!==e&&(this.texture=e,this._textureMatrixUpdateId=-1)}get uvs(){const t=this.geometry.getBuffer("aUV"),r=t.data;let i=r;const s=this.texture.textureMatrix;return s.isSimple||(i=this._transformedUvs,(this._textureMatrixUpdateId!==s._updateID||this._uvUpdateId!==t._updateID)&&((!i||i.length<r.length)&&(i=this._transformedUvs=new Float32Array(r.length)),this._textureMatrixUpdateId=s._updateID,this._uvUpdateId=t._updateID,s.multiplyUvs(r,i))),i}get positions(){return this.geometry.positions}get indices(){return this.geometry.indices}get color(){return this.renderable.groupColorAlpha}get groupTransform(){return this.renderable.groupTransform}get attributeSize(){return this.geometry.positions.length/2}get indexSize(){return this.geometry.indices.length}}class Gt{constructor({matrix:e,observer:t}={}){this.dirty=!0,this._matrix=e??new I,this.observer=t,this.position=new j(this,0,0),this.scale=new j(this,1,1),this.pivot=new j(this,0,0),this.skew=new j(this,0,0),this._rotation=0,this._cx=1,this._sx=0,this._cy=0,this._sy=1}get matrix(){const e=this._matrix;return this.dirty&&(e.a=this._cx*this.scale.x,e.b=this._sx*this.scale.x,e.c=this._cy*this.scale.y,e.d=this._sy*this.scale.y,e.tx=this.position.x-(this.pivot.x*e.a+this.pivot.y*e.c),e.ty=this.position.y-(this.pivot.x*e.b+this.pivot.y*e.d),this.dirty=!1),e}_onUpdate(e){this.dirty=!0,e===this.skew&&this.updateSkew(),this.observer?._onUpdate(this)}updateSkew(){this._cx=Math.cos(this._rotation+this.skew.y),this._sx=Math.sin(this._rotation+this.skew.y),this._cy=-Math.sin(this._rotation-this.skew.x),this._sy=Math.cos(this._rotation-this.skew.x),this.dirty=!0}toString(){return`[pixi.js/math:Transform position=(${this.position.x}, ${this.position.y}) rotation=${this.rotation} scale=(${this.scale.x}, ${this.scale.y}) skew=(${this.skew.x}, ${this.skew.y}) ]`}setFromMatrix(e){e.decompose(this),this.dirty=!0}get rotation(){return this._rotation}set rotation(e){this._rotation!==e&&(this._rotation=e,this._onUpdate(this.skew))}}const ie=new I,F=new I,E=[new Z,new Z,new Z,new Z];class nt{constructor(e){this._renderer=e}validateRenderable(e){return!1}addRenderable(e,t){this._renderer.renderPipes.batch.break(t),t.add(e)}updateRenderable(e){}execute(e){const t=this._renderer,r=t.canvasContext,i=r.activeContext;i.save(),r.setBlendMode(e.groupBlendMode);const s=t.globalUniforms.globalUniformData?.worldColor??4294967295,n=e.groupColorAlpha,o=(s>>>24&255)/255,a=(n>>>24&255)/255,c=t.filter?.alphaMultiplier??1,u=o*a*c;if(u<=0){i.restore();return}i.globalAlpha=u;const h=s&16777215,f=n&16777215,d=xe(Ye(f,h)),p=e.texture,g=Je.getTintedPattern(p,d),m=e.width,w=e.height,y=e.groupTransform,v=p.source._resolution??p.source.resolution??1;F.copyFrom(e._tileTransform.matrix),e.applyAnchorToTexture||F.translate(-e.anchor.x*m,-e.anchor.y*w);const x=F.tx,C=F.ty;F.scale(1/v,1/v),F.tx=x,F.ty=C,ie.identity(),ie.prepend(F),ie.prepend(y);const T=t._roundPixels|e._roundPixels;r.setContextTransform(ie,T===1),i.fillStyle=g;const _=e.anchor.x*-m,S=e.anchor.y*-w;E[0].set(_,S),E[1].set(_+m,S),E[2].set(_+m,S+w),E[3].set(_,S+w);for(let b=0;b<4;b++)F.applyInverse(E[b],E[b]);i.beginPath(),i.moveTo(E[0].x,E[0].y);for(let b=1;b<4;b++)i.lineTo(E[b].x,E[b].y);i.closePath(),i.fill(),i.restore()}destroy(){this._renderer=null}}nt.extension={type:[z.CanvasPipes],name:"tilingSprite"};const Yt={name:"tiling-bit",vertex:{header:`
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
        `}},qt={name:"tiling-bit",vertex:{header:`
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

        `}};let de,pe;class Xt extends qe{constructor(){de??(de=At({name:"tiling-sprite-shader",bits:[Mt,Yt,Rt]})),pe??(pe=Et({name:"tiling-sprite-shader",bits:[Ot,qt,Ut]}));const e=new ye({uMapCoord:{value:new I,type:"mat3x3<f32>"},uClampFrame:{value:new Float32Array([0,0,1,1]),type:"vec4<f32>"},uClampOffset:{value:new Float32Array([0,0]),type:"vec2<f32>"},uTextureTransform:{value:new I,type:"mat3x3<f32>"},uSizeAnchor:{value:new Float32Array([100,100,.5,.5]),type:"vec4<f32>"}});super({glProgram:pe,gpuProgram:de,resources:{localUniforms:new ye({uTransformMatrix:{value:new I,type:"mat3x3<f32>"},uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uRound:{value:0,type:"f32"}}),tilingUniforms:e,uTexture:M.EMPTY.source,uSampler:M.EMPTY.source.style}})}updateUniforms(e,t,r,i,s,n){const o=this.resources.tilingUniforms,a=n.width,c=n.height,u=n.textureMatrix,h=o.uniforms.uTextureTransform;h.set(r.a*a/e,r.b*a/t,r.c*c/e,r.d*c/t,r.tx/e,r.ty/t),h.invert(),o.uniforms.uMapCoord=u.mapCoord,o.uniforms.uClampFrame=u.uClampFrame,o.uniforms.uClampOffset=u.uClampOffset,o.uniforms.uTextureTransform=h,o.uniforms.uSizeAnchor[0]=e,o.uniforms.uSizeAnchor[1]=t,o.uniforms.uSizeAnchor[2]=i,o.uniforms.uSizeAnchor[3]=s,n&&(this.resources.uTexture=n.source,this.resources.uSampler=n.source.style)}}class Wt extends st{constructor(){super({positions:new Float32Array([0,0,1,0,1,1,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])})}}function Ht(l,e){const t=l.anchor.x,r=l.anchor.y;e[0]=-t*l.width,e[1]=-r*l.height,e[2]=(1-t)*l.width,e[3]=-r*l.height,e[4]=(1-t)*l.width,e[5]=(1-r)*l.height,e[6]=-t*l.width,e[7]=(1-r)*l.height}function jt(l,e,t,r){let i=0;const s=l.length/e,n=r.a,o=r.b,a=r.c,c=r.d,u=r.tx,h=r.ty;for(t*=e;i<s;){const f=l[t],d=l[t+1];l[t]=n*f+a*d+u,l[t+1]=o*f+c*d+h,t+=e,i++}}function $t(l,e){const t=l.texture,r=t.frame.width,i=t.frame.height;let s=0,n=0;l.applyAnchorToTexture&&(s=l.anchor.x,n=l.anchor.y),e[0]=e[6]=-s,e[2]=e[4]=1-s,e[1]=e[3]=-n,e[5]=e[7]=1-n;const o=l._tileTransform.matrix,a=I.shared;a.set(o.a*r/l.width,o.b*r/l.height,o.c*i/l.width,o.d*i/l.height,o.tx/l.width,o.ty/l.height),a.invert(),jt(e,2,0,a)}const se=new Wt;class Kt{constructor(){this.canBatch=!0,this.geometry=new st({indices:se.indices.slice(),positions:se.positions.slice(),uvs:se.uvs.slice()})}destroy(){this.geometry.destroy(),this.shader?.destroy()}}class ot{constructor(e){this._state=ve.default2d,this._renderer=e,this._managedTilingSprites=new $e({renderer:e,type:"renderable",name:"tilingSprite"})}validateRenderable(e){const t=this._getTilingSpriteData(e),r=t.canBatch;this._updateCanBatch(e);const i=t.canBatch;if(i&&i===r){const{batchableMesh:s}=t;return!s._batcher.checkAndUpdateTexture(s,e.texture)}return r!==i}addRenderable(e,t){const r=this._renderer.renderPipes.batch;this._updateCanBatch(e);const i=this._getTilingSpriteData(e),{geometry:s,canBatch:n}=i;if(n){i.batchableMesh||(i.batchableMesh=new Nt);const o=i.batchableMesh;e.didViewUpdate&&(this._updateBatchableMesh(e),o.geometry=s,o.renderable=e,o.transform=e.groupTransform,o.setTexture(e._texture)),o.roundPixels=this._renderer._roundPixels|e._roundPixels,r.addToBatch(o,t)}else r.break(t),i.shader||(i.shader=new Xt),this.updateRenderable(e),t.add(e)}execute(e){const t=this._renderer,{shader:r}=this._getTilingSpriteData(e);r.groups[0]=t.globalUniforms.bindGroup;const i=r.resources.localUniforms.uniforms;i.uTransformMatrix=e.groupTransform,i.uRound=t._roundPixels|e._roundPixels,Ke(e.groupColorAlpha,i.uColor,0),this._state.blendMode=Qe(e.groupBlendMode,e.texture._source),t.encoder.draw({geometry:se,shader:r,state:this._state})}updateRenderable(e){const t=this._getTilingSpriteData(e),{canBatch:r}=t;if(r){const{batchableMesh:i}=t;e.didViewUpdate&&this._updateBatchableMesh(e),i._batcher.updateElement(i)}else if(e.didViewUpdate){const{shader:i}=t;i.updateUniforms(e.width,e.height,e._tileTransform.matrix,e.anchor.x,e.anchor.y,e.texture)}}_getTilingSpriteData(e){return e._gpuData[this._renderer.uid]||this._initTilingSpriteData(e)}_initTilingSpriteData(e){const t=new Kt;return t.renderable=e,e._gpuData[this._renderer.uid]=t,this._managedTilingSprites.add(e),t}_updateBatchableMesh(e){const t=this._getTilingSpriteData(e),{geometry:r}=t,i=e.texture.source.style;i.addressMode!=="repeat"&&(i.addressMode="repeat",i.update()),$t(e,r.uvs),Ht(e,r.positions)}destroy(){this._managedTilingSprites.destroy(),this._renderer=null}_updateCanBatch(e){const t=this._getTilingSpriteData(e),r=e.texture;let i=!0;return this._renderer.type===Xe.WEBGL&&(i=this._renderer.context.supports.nonPowOf2wrapping),t.canBatch=r.textureMatrix.isSimple&&(i||r.source.isPowerOfTwo),t.canBatch}}ot.extension={type:[z.WebGLPipes,z.WebGPUPipes],name:"tilingSprite"};O.add(nt);O.add(ot);const at=class ne extends We{constructor(...e){let t=e[0]||{};t instanceof M&&(t={texture:t}),e.length>1&&(G(W,"use new TilingSprite({ texture, width:100, height:100 }) instead"),t.width=e[1],t.height=e[2]),t={...ne.defaultOptions,...t};const{texture:r,anchor:i,tilePosition:s,tileScale:n,tileRotation:o,width:a,height:c,applyAnchorToTexture:u,roundPixels:h,...f}=t??{};super({label:"TilingSprite",...f}),this.renderPipeId="tilingSprite",this.batched=!0,this.allowChildren=!1,this._anchor=new j({_onUpdate:()=>{this.onViewUpdate()}}),this.applyAnchorToTexture=u,this.texture=r,this._width=a??r.width,this._height=c??r.height,this._tileTransform=new Gt({observer:{_onUpdate:()=>this.onViewUpdate()}}),i&&(this.anchor=i),this.tilePosition=s,this.tileScale=n,this.tileRotation=o,this.roundPixels=h??!1}static from(e,t={}){return typeof e=="string"?new ne({texture:St.get(e),...t}):new ne({texture:e,...t})}get uvRespectAnchor(){return G(W,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture}set uvRespectAnchor(e){G(W,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture=e}get clampMargin(){return this._texture.textureMatrix.clampMargin}set clampMargin(e){this._texture.textureMatrix.clampMargin=e}get anchor(){return this._anchor}set anchor(e){typeof e=="number"?this._anchor.set(e):this._anchor.copyFrom(e)}get tilePosition(){return this._tileTransform.position}set tilePosition(e){this._tileTransform.position.copyFrom(e)}get tileScale(){return this._tileTransform.scale}set tileScale(e){typeof e=="number"?this._tileTransform.scale.set(e):this._tileTransform.scale.copyFrom(e)}set tileRotation(e){this._tileTransform.rotation=e}get tileRotation(){return this._tileTransform.rotation}get tileTransform(){return this._tileTransform}set texture(e){e||(e=M.EMPTY);const t=this._texture;t!==e&&(t&&t.dynamic&&t.off("update",this.onViewUpdate,this),e.dynamic&&e.on("update",this.onViewUpdate,this),this._texture=e,this.onViewUpdate())}get texture(){return this._texture}set width(e){this._width=e,this.onViewUpdate()}get width(){return this._width}set height(e){this._height=e,this.onViewUpdate()}get height(){return this._height}setSize(e,t){typeof e=="object"&&(t=e.height??e.width,e=e.width),this._width=e,this._height=t??e,this.onViewUpdate()}getSize(e){return e||(e={}),e.width=this._width,e.height=this._height,e}updateBounds(){const e=this._bounds,t=this._anchor,r=this._width,i=this._height;e.minX=-t._x*r,e.maxX=e.minX+r,e.minY=-t._y*i,e.maxY=e.minY+i}containsPoint(e){const t=this._width,r=this._height,i=-t*this._anchor._x;let s=0;return e.x>=i&&e.x<=i+t&&(s=-r*this._anchor._y,e.y>=s&&e.y<=s+r)}destroy(e=!1){if(super.destroy(e),this._anchor=null,this._tileTransform=null,this._bounds=null,typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource;this._texture.destroy(r)}this._texture=null}};at.defaultOptions={texture:M.EMPTY,anchor:{x:0,y:0},tilePosition:{x:0,y:0},tileScale:{x:1,y:1},tileRotation:0,applyAnchorToTexture:!1};let Qt=at;class Jt{execute(e,t){const r=e.renderer,i=r.canvasContext.activeContext,s=t.particleChildren,n=t.texture;i.save(),r.canvasContext.setContextTransform(t.worldTransform,t.roundPixels),r.canvasContext.setBlendMode(t.groupBlendMode);const o=t.groupColorAlpha,a=r.filter?.alphaMultiplier??1,c=(o>>>24&255)/255*a;for(let u=0;u<s.length;u++){const h=s[u],f=h.texture||n;if(!f?.source?.resource)continue;const d=h.color,p=(d>>>24&255)/255*c;if(p<=0)continue;const g=d&16777215,m=((g&255)<<16)+(g&65280)+(g>>16&255);let w=f.source.resource;m!==16777215&&(w=Je.getTintedCanvas({texture:f},m));const y=f.frame,v=f.source.resolution,x=y.x*v,C=y.y*v,T=y.width*v,_=y.height*v;i.globalAlpha=p;const S=-h.anchorX*y.width,b=-h.anchorY*y.height;h.rotation!==0||h.scaleX!==1||h.scaleY!==1?(i.save(),i.translate(h.x,h.y),i.rotate(h.rotation),i.scale(h.scaleX,h.scaleY),i.drawImage(w,x,C,T,_,S,b,y.width,y.height),i.restore()):i.drawImage(w,x,C,T,_,h.x+S,h.y+b,y.width,y.height)}i.restore()}}function Ie(l,e=null){const t=l*6;if(t>65535?e||(e=new Uint32Array(t)):e||(e=new Uint16Array(t)),e.length!==t)throw new Error(`Out buffer length is incorrect, got ${e.length} and expected ${t}`);for(let r=0,i=0;r<t;r+=6,i+=4)e[r+0]=i+0,e[r+1]=i+1,e[r+2]=i+2,e[r+3]=i+0,e[r+4]=i+2,e[r+5]=i+3;return e}function Zt(l){return{dynamicUpdate:Ve(l,!0),staticUpdate:Ve(l,!1)}}function Ve(l,e){const t=[];t.push(`

        var index = 0;

        for (let i = 0; i < ps.length; ++i)
        {
            const p = ps[i];

            `);let r=0;for(const s in l){const n=l[s];if(e!==n.dynamic)continue;t.push(`offset = index + ${r}`),t.push(n.code);const o=we(n.format);r+=o.stride/4}t.push(`
            index += stride * 4;
        }
    `),t.unshift(`
        var stride = ${r};
        var offset = 0, w0 = 0, w1 = 0, h0 = 0, h1 = 0;
    `);const i=t.join(`
`);return new Function("ps","f32v","u32v",i)}class er{constructor(e){this._size=0,this._generateParticleUpdateCache={};const t=this._size=e.size??1e3,r=e.properties;let i=0,s=0;for(const u in r){const h=r[u],f=we(h.format);h.dynamic?s+=f.stride:i+=f.stride}this._dynamicStride=s/4,this._staticStride=i/4,this.staticAttributeBuffer=new ee(t*4*i),this.dynamicAttributeBuffer=new ee(t*4*s),this.indexBuffer=Ie(t);const n=new Ge;let o=0,a=0;this._staticBuffer=new $({data:new Float32Array(1),label:"static-particle-buffer",shrinkToFit:!1,usage:U.VERTEX|U.COPY_DST}),this._dynamicBuffer=new $({data:new Float32Array(1),label:"dynamic-particle-buffer",shrinkToFit:!1,usage:U.VERTEX|U.COPY_DST});for(const u in r){const h=r[u],f=we(h.format);h.dynamic?(n.addAttribute(h.attributeName,{buffer:this._dynamicBuffer,stride:this._dynamicStride*4,offset:o*4,format:h.format}),o+=f.size):(n.addAttribute(h.attributeName,{buffer:this._staticBuffer,stride:this._staticStride*4,offset:a*4,format:h.format}),a+=f.size)}n.addIndex(this.indexBuffer);const c=this.getParticleUpdate(r);this._dynamicUpload=c.dynamicUpdate,this._staticUpload=c.staticUpdate,this.geometry=n}getParticleUpdate(e){const t=tr(e);return this._generateParticleUpdateCache[t]?this._generateParticleUpdateCache[t]:(this._generateParticleUpdateCache[t]=this.generateParticleUpdate(e),this._generateParticleUpdateCache[t])}generateParticleUpdate(e){return Zt(e)}update(e,t){e.length>this._size&&(t=!0,this._size=Math.max(e.length,this._size*1.5|0),this.staticAttributeBuffer=new ee(this._size*this._staticStride*4*4),this.dynamicAttributeBuffer=new ee(this._size*this._dynamicStride*4*4),this.indexBuffer=Ie(this._size),this.geometry.indexBuffer.setDataWithSize(this.indexBuffer,this.indexBuffer.byteLength,!0));const r=this.dynamicAttributeBuffer;if(this._dynamicUpload(e,r.float32View,r.uint32View),this._dynamicBuffer.setDataWithSize(this.dynamicAttributeBuffer.float32View,e.length*this._dynamicStride*4,!0),t){const i=this.staticAttributeBuffer;this._staticUpload(e,i.float32View,i.uint32View),this._staticBuffer.setDataWithSize(i.float32View,e.length*this._staticStride*4,!0)}}destroy(){this._staticBuffer.destroy(),this._dynamicBuffer.destroy(),this.geometry.destroy()}}function tr(l){const e=[];for(const t in l){const r=l[t];e.push(t,r.code,r.dynamic?"d":"s")}return e.join("_")}var rr=`varying vec2 vUV;
varying vec4 vColor;

uniform sampler2D uTexture;

void main(void){
    vec4 color = texture2D(uTexture, vUV) * vColor;
    gl_FragColor = color;
}`,ir=`attribute vec2 aVertex;
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
`,De=`
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
}`;class sr extends qe{constructor(){const e=ae.from({vertex:ir,fragment:rr}),t=le.from({fragment:{source:De,entryPoint:"mainFragment"},vertex:{source:De,entryPoint:"mainVertex"}});super({glProgram:e,gpuProgram:t,resources:{uTexture:M.WHITE.source,uSampler:new bt({}),uniforms:{uTranslationMatrix:{value:new I,type:"mat3x3<f32>"},uColor:{value:new He(16777215),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}}})}}class ue{constructor(e,t){this.state=ve.for2d(),this.localUniforms=new ye({uTranslationMatrix:{value:new I,type:"mat3x3<f32>"},uColor:{value:new Float32Array(4),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}),this.renderer=e,this.adaptor=t,this.defaultShader=new sr,this.state=ve.for2d(),this._managedContainers=new $e({renderer:e,type:"renderable",name:"particleContainer"})}validateRenderable(e){return!1}addRenderable(e,t){this.renderer.renderPipes.batch.break(t),t.add(e)}getBuffers(e){return e._gpuData[this.renderer.uid]||this._initBuffer(e)}_initBuffer(e){return e._gpuData[this.renderer.uid]=new er({size:e.particleChildren.length,properties:e._properties}),this._managedContainers.add(e),e._gpuData[this.renderer.uid]}updateRenderable(e){}execute(e){const t=e.particleChildren;if(t.length===0)return;const r=this.renderer,i=this.getBuffers(e);e.texture||(e.texture=t[0].texture);const s=this.state;i.update(t,e._childrenDirty),e._childrenDirty=!1,s.blendMode=Qe(e.groupBlendMode,e.texture._source);const n=this.localUniforms.uniforms,o=n.uTranslationMatrix;e.worldTransform.copyTo(o);const a=r.globalUniforms.globalUniformData;o.tx-=a.offset.x,o.ty-=a.offset.y,o.prepend(a.projectionMatrix),n.uResolution=a.resolution,n.uRound=r._roundPixels|e._roundPixels;const c=e.groupColorAlpha,u=a.worldColor,h=(c>>>24)*(u>>>24)/255|0,f=Ye(c&16777215,u&16777215);Ke((h<<24|f)>>>0,n.uColor,0),this.adaptor.execute(this,e)}destroy(){this._managedContainers.destroy(),this.renderer=null,this.defaultShader&&(this.defaultShader.destroy(),this.defaultShader=null)}}ue.extension={type:[z.CanvasPipes],name:"particle"};class lt extends ue{constructor(e){super(e,new Jt)}}lt.extension={type:[z.CanvasPipes],name:"particle"};class nr{execute(e,t){const r=e.state,i=e.renderer,s=t.shader||e.defaultShader;s.resources.uTexture=t.texture._source,s.resources.uniforms=e.localUniforms;const n=i.gl,o=e.getBuffers(t);i.shader.bind(s),i.state.set(r),i.geometry.bind(o.geometry,s.glProgram);const c=o.geometry.indexBuffer.data.BYTES_PER_ELEMENT===2?n.UNSIGNED_SHORT:n.UNSIGNED_INT;n.drawElements(n.TRIANGLES,t.particleChildren.length*6,c,0)}}class ut extends ue{constructor(e){super(e,new nr)}}ut.extension={type:[z.WebGLPipes],name:"particle"};class or{execute(e,t){const r=e.renderer,i=t.shader||e.defaultShader;i.groups[0]=r.renderPipes.uniformBatch.getUniformBindGroup(e.localUniforms,!0),i.groups[1]=r.texture.getTextureBindGroup(t.texture);const s=e.state,n=e.getBuffers(t);r.encoder.draw({geometry:n.geometry,shader:t.shader||e.defaultShader,state:s,size:t.particleChildren.length*6})}}class ht extends ue{constructor(e){super(e,new or)}}ht.extension={type:[z.WebGPUPipes],name:"particle"};const ct=class Te{constructor(e){if(e instanceof M)this.texture=e,ke(this,Te.defaultOptions,{});else{const t={...Te.defaultOptions,...e};ke(this,t,{})}}get alpha(){return this._alpha}set alpha(e){this._alpha=Math.min(Math.max(e,0),1),this._updateColor()}get tint(){return xe(this._tint)}set tint(e){this._tint=typeof e=="number"?xe(e):He.shared.setValue(e??16777215).toBgrNumber(),this._updateColor()}_updateColor(){this.color=this._tint+((this._alpha*255|0)<<24)}};ct.defaultOptions={anchorX:0,anchorY:0,x:0,y:0,scaleX:1,scaleY:1,rotation:0,tint:16777215,alpha:1};let Se=ct;const Le={vertex:{attributeName:"aVertex",format:"float32x2",code:`
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
        `,dynamic:!1}};O.add(ut);O.add(ht);O.add(lt);const ar=new _t(0,0,0,0),lr=48,ft=class Ce extends We{constructor(e={}){e={...Ce.defaultOptions,...e,dynamicProperties:{...Ce.defaultOptions.dynamicProperties,...e?.dynamicProperties}};const{dynamicProperties:t,shader:r,roundPixels:i,texture:s,particles:n,...o}=e;super({label:"ParticleContainer",...o}),this.renderPipeId="particle",this.batched=!1,this._childrenDirty=!1,this.texture=s||null,this.shader=r,this._properties={};for(const a in Le){const c=Le[a],u=t[a];this._properties[a]={...c,dynamic:u}}this.allowChildren=!0,this.roundPixels=i??!1,this.particleChildren=n??[]}addParticle(...e){for(let t=0;t<e.length;t++)this.particleChildren.push(e[t]);return this.onViewUpdate(),e[0]}removeParticle(...e){if(e.length>lr)return this._removeParticlesInOnePass(e)&&this.onViewUpdate(),e[0];let t=!1;for(let r=0;r<e.length;r++){const i=this.particleChildren.indexOf(e[r]);i>-1&&(this.particleChildren.splice(i,1),t=!0)}return t&&this.onViewUpdate(),e[0]}_removeParticlesInOnePass(e){const t=new Map;for(let n=0;n<e.length;n++){const o=e[n];t.set(o,(t.get(o)??0)+1)}const r=this.particleChildren,i=r.length;let s=0;for(let n=0;n<i;n++){const o=r[n],a=t.get(o);a?t.set(o,a-1):r[s++]=o}return r.length=s,s!==i}update(){this._childrenDirty=!0}onViewUpdate(){this._childrenDirty=!0,super.onViewUpdate()}get bounds(){return ar}updateBounds(){}destroy(e=!1){if(super.destroy(e),typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource,i=this.texture??this.particleChildren[0]?.texture;i&&i.destroy(r)}this.texture=null,this.shader?.destroy()}removeParticles(e,t){e??(e=0),t??(t=this.particleChildren.length);const r=this.particleChildren.splice(e,t-e);return this.onViewUpdate(),r}removeParticleAt(e){const t=this.particleChildren.splice(e,1);return this.onViewUpdate(),t[0]}addParticleAt(e,t){return this.particleChildren.splice(t,0,e),this.onViewUpdate(),e}addChild(...e){throw new Error("ParticleContainer.addChild() is not available. Please use ParticleContainer.addParticle()")}removeChild(...e){throw new Error("ParticleContainer.removeChild() is not available. Please use ParticleContainer.removeParticle()")}removeChildren(e,t){throw new Error("ParticleContainer.removeChildren() is not available. Please use ParticleContainer.removeParticles()")}removeChildAt(e){throw new Error("ParticleContainer.removeChildAt() is not available. Please use ParticleContainer.removeParticleAt()")}getChildAt(e){throw new Error("ParticleContainer.getChildAt() is not available. Please use ParticleContainer.getParticleAt()")}setChildIndex(e,t){throw new Error("ParticleContainer.setChildIndex() is not available. Please use ParticleContainer.setParticleIndex()")}getChildIndex(e){throw new Error("ParticleContainer.getChildIndex() is not available. Please use ParticleContainer.getParticleIndex()")}addChildAt(e,t){throw new Error("ParticleContainer.addChildAt() is not available. Please use ParticleContainer.addParticleAt()")}swapChildren(e,t){throw new Error("ParticleContainer.swapChildren() is not available. Please use ParticleContainer.swapParticles()")}reparentChild(...e){throw new Error("ParticleContainer.reparentChild() is not available with the particle container")}reparentChildAt(e,t){throw new Error("ParticleContainer.reparentChildAt() is not available with the particle container")}};ft.defaultOptions={dynamicProperties:{vertex:!1,position:!0,rotation:!1,uvs:!1,color:!1},roundPixels:!1};let oe=ft;O.add(Bt,It);class ur{constructor(e=1024){if(!Number.isInteger(e)||e<8)throw new RangeError("Atlas size must be an integer of at least 8 pixels");this.size=e,this.canvas=document.createElement("canvas"),this.canvas.width=this.canvas.height=e,this.ctx=this.canvas.getContext("2d"),this.x=this.y=2,this.rowHeight=0,this.frames=new Map,this.textures=new Map,this.source=null}register(e,t,r,i,{makeWhite:s=!0}={}){if(typeof e!="string"||!e||!Number.isInteger(t)||!Number.isInteger(r)||t<=0||r<=0||typeof i!="function")throw new TypeError("Atlas frames require a name, positive integer dimensions and a draw function");if(this.frames.has(e+"_white"))throw new Error("Invalid or duplicate atlas frame: "+e);this.checkCapacity([{name:e,width:t,height:r},...s?[{name:e+"_white",width:t,height:r}]:[]]);const n=document.createElement("canvas");n.width=t,n.height=r;const o=n.getContext("2d");i(o,t,r),this.pack(e,n),s&&(o.globalCompositeOperation="source-in",o.fillStyle="#ffffff",o.fillRect(0,0,t,r),this.pack(e+"_white",n))}checkCapacity(e){if(this.source)throw new Error("Cannot add frames to a built atlas");let t=this.x,r=this.y,i=this.rowHeight;const s=new Set;for(const{name:n,width:o,height:a}of e){if(typeof n!="string"||!n||s.has(n)||this.frames.has(n))throw new Error("Invalid or duplicate atlas frame: "+n);if(!Number.isInteger(o)||!Number.isInteger(a)||o<=0||a<=0)throw new RangeError("Atlas dimensions must be positive integers");if(s.add(n),o+4>this.size||a+4>this.size)throw new RangeError("Atlas frame too large: "+n);if(t+o+2>this.size&&(t=2,r+=i+4,i=0),r+a+2>this.size)throw new RangeError("Procedural atlas is full");t+=o+4,i=Math.max(i,a)}}registerImage(e,t,{width:r=t?.width,height:i=t?.height,makeWhite:s=!0}={}){if(!(t?.width>0&&t?.height>0))throw new TypeError("Atlas image must be decoded and have positive dimensions: "+e);this.register(e,r,i,(n,o,a)=>{const c=Math.min(o/t.width,a/t.height),u=t.width*c,h=t.height*c;n.drawImage(t,(o-u)/2,(a-h)/2,u,h)},{makeWhite:s})}registerSheet(e,t,{width:r,height:i,makeWhite:s=!0}={}){const n=t?.image;if(typeof e!="string"||!e||!n||!(n.width>0&&n.height>0)||!Number.isSafeInteger(t.length)||t.length<1||typeof t.frame!="function")throw new TypeError("registerSheet requires a name and a decoded HGame SpriteSheet");const o=[],a=[];for(let c=0;c<t.length;c++){const u=t.frame(c),h=`${e}/${c}`;if(![u?.x,u?.y,u?.width,u?.height].every(Number.isFinite)||u.x<0||u.y<0||u.width<=0||u.height<=0||u.x+u.width>n.width||u.y+u.height>n.height)throw new RangeError("SpriteSheet frame is outside the image: "+h);const f=r??u.width,d=i??u.height;if(this.frames.has(h+"_white"))throw new Error("Invalid or duplicate atlas frame: "+h);o.push({name:h,rect:u,width:f,height:d}),a.push({name:h,width:f,height:d}),s&&a.push({name:h+"_white",width:f,height:d})}this.checkCapacity(a);for(const c of o){const u=c.rect;this.register(c.name,c.width,c.height,(h,f,d)=>{h.drawImage(n,u.x,u.y,u.width,u.height,0,0,f,d)},{makeWhite:s})}return o.map(c=>c.name)}pack(e,t){const{width:r,height:i}=t;if(r+4>this.size||i+4>this.size)throw new RangeError("Atlas frame too large: "+e);if(this.x+r+2>this.size&&(this.x=2,this.y+=this.rowHeight+4,this.rowHeight=0),this.y+i+2>this.size)throw new RangeError("Procedural atlas is full");const s=this.x,n=this.y,o=this.ctx;o.drawImage(t,s,n),o.drawImage(t,0,0,r,1,s,n-1,r,1),o.drawImage(t,0,i-1,r,1,s,n+i,r,1),o.drawImage(t,0,0,1,i,s-1,n,1,i),o.drawImage(t,r-1,0,1,i,s+r,n,1,i),o.drawImage(t,0,0,1,1,s-1,n-1,1,1),o.drawImage(t,r-1,0,1,1,s+r,n-1,1,1),o.drawImage(t,0,i-1,1,1,s-1,n+i,1,1),o.drawImage(t,r-1,i-1,1,1,s+r,n+i,1,1),this.frames.set(e,new Tt(s,n,r,i)),this.x+=r+4,this.rowHeight=Math.max(this.rowHeight,i)}build(){if(this.source)return this;this.source=new Ct({resource:this.canvas,scaleMode:"linear"});for(const[e,t]of this.frames)this.textures.set(e,new M({source:this.source,frame:t}));return this}get(e){return this.textures.get(e)??M.WHITE}dispose(){for(const e of this.textures.values())e.destroy();this.textures.clear(),this.source?.destroy(),this.source=null}}function hr({playerImage:l=null,enemyImage:e=null,eliteImage:t=e,extraFrames:r=[],size:i=1024}={}){const s=new ur(i),n=(a,c=.4)=>(u,h,f)=>{u.fillStyle=a,u.beginPath(),u.arc(h/2,f/2,Math.min(h,f)*c,0,Math.PI*2),u.fill()},o=a=>(c,u,h)=>{if(!(a?.width>0&&a?.height>0))throw new TypeError("Character image must be decoded and have positive dimensions");const f=Math.min(u/a.width,h/a.height),d=a.width*f,p=a.height*f;c.drawImage(a,(u-d)/2,(h-p)/2,d,p)};s.register("player_hero",64,64,l?o(l):n("#53eccc")),s.register("enemy_chaser",40,40,e?o(e):n("#fa536e")),s.register("enemy_elite",56,56,t?o(t):n("#ffad53")),s.register("bullet_orb",20,20,n("#92faff")),s.register("particle_soft",20,20,(a,c,u)=>{const h=a.createRadialGradient(c/2,u/2,0,c/2,u/2,c/2);h.addColorStop(0,"#fff"),h.addColorStop(1,"#ffffff00"),a.fillStyle=h,a.fillRect(0,0,c,u)});for(const[a,c]of["#ff6622","#ffbb33","#ffed99"].entries())s.register("particle_fire_"+a,20,20,(u,h,f)=>{const d=u.createRadialGradient(h/2,f/2,0,h/2,f/2,h/2);d.addColorStop(0,c),d.addColorStop(1,c+"00"),u.fillStyle=d,u.fillRect(0,0,h,f)},{makeWhite:!1});s.register("particle_spark",12,12,(a,c,u)=>{a.fillStyle="#fff",a.beginPath(),a.moveTo(c/2,0),a.lineTo(c,u/2),a.lineTo(c/2,u),a.lineTo(0,u/2),a.closePath(),a.fill()}),s.register("slash_trail",128,16,(a,c,u)=>{const h=a.createLinearGradient(0,0,c,0);h.addColorStop(0,"#ffffff00"),h.addColorStop(1,"#ffffffff"),a.fillStyle=h,a.fillRect(0,0,c,u)}),s.register("shadow_oval",48,20,(a,c,u)=>{a.fillStyle="#0008",a.beginPath(),a.ellipse(c/2,u/2,c/2,u/2,0,0,Math.PI*2),a.fill()},{makeWhite:!1}),s.register("ground_grid",128,128,(a,c,u)=>{a.fillStyle="#101b2a",a.fillRect(0,0,c,u),a.strokeStyle="#244256",a.lineWidth=1,a.strokeRect(.5,.5,c-1,u-1)},{makeWhite:!1});for(const a of r)typeof a.sheet=="function"?s.registerSheet(a.name,a.sheet(a.image),a):s.registerImage(a.name,a.image,a);return s.build()}var ze=`in vec2 aPosition;
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
`,Ae=`struct GlobalFilterUniforms {
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
}`,cr=`
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
}`,fr=`struct KawaseBlurUniforms {
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
}`,dr=`
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
`,pr=`struct KawaseBlurUniforms {
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
}`,mr=Object.defineProperty,gr=(l,e,t)=>e in l?mr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,N=(l,e,t)=>(gr(l,typeof e!="symbol"?e+"":e,t),t);const dt=class pt extends Pe{constructor(...e){let t=e[0]??{};(typeof t=="number"||Array.isArray(t))&&(G("6.0.0","KawaseBlurFilter constructor params are now options object. See params: { strength, quality, clamp, pixelSize }"),t={strength:t},e[1]!==void 0&&(t.quality=e[1]),e[2]!==void 0&&(t.clamp=e[2])),t={...pt.DEFAULT_OPTIONS,...t};const r=le.from({vertex:{source:Ae,entryPoint:"mainVertex"},fragment:{source:t?.clamp?pr:fr,entryPoint:"mainFragment"}}),i=ae.from({vertex:ze,fragment:t?.clamp?dr:cr,name:"kawase-blur-filter"});super({gpuProgram:r,glProgram:i,resources:{kawaseBlurUniforms:{uOffset:{value:new Float32Array(2),type:"vec2<f32>"}}}}),N(this,"uniforms"),N(this,"_pixelSize",{x:0,y:0}),N(this,"_clamp"),N(this,"_kernels",[]),N(this,"_blur"),N(this,"_quality"),this.uniforms=this.resources.kawaseBlurUniforms.uniforms,this.pixelSize=t.pixelSize??{x:1,y:1},Array.isArray(t.strength)?this.kernels=t.strength:typeof t.strength=="number"&&(this._blur=t.strength,this.quality=t.quality??3),this._clamp=!!t.clamp}apply(e,t,r,i){const s=this.pixelSizeX/t.source.width,n=this.pixelSizeY/t.source.height;let o;if(this._quality===1||this._blur===0)o=this._kernels[0]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*n,e.applyFilter(this,t,r,i);else{const a=X.getSameSizeTexture(t);let c=t,u=a,h;const f=this._quality-1;for(let d=0;d<f;d++)o=this._kernels[d]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*n,e.applyFilter(this,c,u,!0),h=c,c=u,u=h;o=this._kernels[f]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*n,e.applyFilter(this,c,r,i),X.returnTexture(a)}}get strength(){return this._blur}set strength(e){this._blur=e,this._generateKernels()}get quality(){return this._quality}set quality(e){this._quality=Math.max(1,Math.round(e)),this._generateKernels()}get kernels(){return this._kernels}set kernels(e){Array.isArray(e)&&e.length>0?(this._kernels=e,this._quality=e.length,this._blur=Math.max(...e)):(this._kernels=[0],this._quality=1)}get pixelSize(){return this._pixelSize}set pixelSize(e){if(typeof e=="number"){this.pixelSizeX=this.pixelSizeY=e;return}if(Array.isArray(e)){this.pixelSizeX=e[0],this.pixelSizeY=e[1];return}this._pixelSize=e}get pixelSizeX(){return this.pixelSize.x}set pixelSizeX(e){this.pixelSize.x=e}get pixelSizeY(){return this.pixelSize.y}set pixelSizeY(e){this.pixelSize.y=e}get clamp(){return this._clamp}_updatePadding(){this.padding=Math.ceil(this._kernels.reduce((e,t)=>e+t+.5,0))}_generateKernels(){const e=this._blur,t=this._quality,r=[e];if(e>0){let i=e;const s=e/t;for(let n=1;n<t;n++)i-=s,r.push(i)}this._kernels=r,this._updatePadding()}};N(dt,"DEFAULT_OPTIONS",{strength:4,quality:3,clamp:!1,pixelSize:{x:1,y:1}});let xr=dt;var yr=`in vec2 vTextureCoord;
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
`,vr=`struct AdvancedBloomUniforms {
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
`,wr=`
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
`,br=`struct ExtractBrightnessUniforms {
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
`,_r=Object.defineProperty,Tr=(l,e,t)=>e in l?_r(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,mt=(l,e,t)=>(Tr(l,typeof e!="symbol"?e+"":e,t),t);const gt=class xt extends Pe{constructor(e){e={...xt.DEFAULT_OPTIONS,...e};const t=le.from({vertex:{source:Ae,entryPoint:"mainVertex"},fragment:{source:br,entryPoint:"mainFragment"}}),r=ae.from({vertex:ze,fragment:wr,name:"extract-brightness-filter"});super({gpuProgram:t,glProgram:r,resources:{extractBrightnessUniforms:{uThreshold:{value:e.threshold,type:"f32"}}}}),mt(this,"uniforms"),this.uniforms=this.resources.extractBrightnessUniforms.uniforms}get threshold(){return this.uniforms.uThreshold}set threshold(e){this.uniforms.uThreshold=e}};mt(gt,"DEFAULT_OPTIONS",{threshold:.5});let Cr=gt;var Pr=Object.defineProperty,Sr=(l,e,t)=>e in l?Pr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,q=(l,e,t)=>(Sr(l,typeof e!="symbol"?e+"":e,t),t);const yt=class vt extends Pe{constructor(e){e={...vt.DEFAULT_OPTIONS,...e};const t=le.from({vertex:{source:Ae,entryPoint:"mainVertex"},fragment:{source:vr,entryPoint:"mainFragment"}}),r=ae.from({vertex:ze,fragment:yr,name:"advanced-bloom-filter"});super({gpuProgram:t,glProgram:r,resources:{advancedBloomUniforms:{uBloomScale:{value:e.bloomScale,type:"f32"},uBrightness:{value:e.brightness,type:"f32"}},uMapTexture:M.WHITE}}),q(this,"uniforms"),q(this,"bloomScale",1),q(this,"brightness",1),q(this,"_extractFilter"),q(this,"_blurFilter"),this.uniforms=this.resources.advancedBloomUniforms.uniforms,this._extractFilter=new Cr({threshold:e.threshold}),this._blurFilter=new xr({strength:e.kernels??e.blur,quality:e.kernels?void 0:e.quality}),Object.assign(this,e)}apply(e,t,r,i){const s=X.getSameSizeTexture(t);this._extractFilter.apply(e,t,s,!0);const n=X.getSameSizeTexture(t);this._blurFilter.apply(e,s,n,!0),this.uniforms.uBloomScale=this.bloomScale,this.uniforms.uBrightness=this.brightness,this.resources.uMapTexture=n.source,e.applyFilter(this,t,r,i),X.returnTexture(n),X.returnTexture(s)}get threshold(){return this._extractFilter.threshold}set threshold(e){this._extractFilter.threshold=e}get kernels(){return this._blurFilter.kernels}set kernels(e){this._blurFilter.kernels=e}get blur(){return this._blurFilter.strength}set blur(e){this._blurFilter.strength=e}get quality(){return this._blurFilter.quality}set quality(e){this._blurFilter.quality=e}get pixelSize(){return this._blurFilter.pixelSize}set pixelSize(e){typeof e=="number"&&(e={x:e,y:e}),Array.isArray(e)&&(e={x:e[0],y:e[1]}),this._blurFilter.pixelSize=e}get pixelSizeX(){return this._blurFilter.pixelSizeX}set pixelSizeX(e){this._blurFilter.pixelSizeX=e}get pixelSizeY(){return this._blurFilter.pixelSizeY}set pixelSizeY(e){this._blurFilter.pixelSizeY=e}};q(yt,"DEFAULT_OPTIONS",{threshold:.5,bloomScale:1,brightness:1,blur:8,quality:4,pixelSize:{x:1,y:1}});let zr=yt;class Ar{constructor(e,{textures:t=["enemy_chaser"],clips:r=null,scale:i=1,worldScale:s=1,offsetX:n=0,offsetY:o=0,syncRotation:a=!1,flipByDirection:c=!1,cull:u=!0}={}){if(!e?.worldRoot||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a swarm layer");const h=r??(Array.isArray(t)?t.map(f=>({frames:[f]})):null);if(!Array.isArray(h)||h.length===0)throw new TypeError("Swarm clips or textures must be a non-empty array");if(![i,s,n,o].every(Number.isFinite)||i<=0||s<=0)throw new RangeError("Swarm scale and worldScale must be positive and offsets must be finite");this.renderer=e,this.scale=i,this.worldScale=s,this.offsetX=n,this.offsetY=o,this.syncRotation=!!a,this.flipByDirection=!!c,this.cull=!!u,this.clips=h.map(f=>{if(!f||!Array.isArray(f.frames)||f.frames.length===0||f.frames.some(g=>typeof g!="string"||!e.atlas.textures.has(g)))throw new TypeError("Swarm clip frames must be existing atlas frame names");const d=f.fps??8;if(!Number.isFinite(d)||d<=0)throw new RangeError("Swarm clip fps must be positive");const p=f.frames.map(g=>{const m=e.atlas.textures.get(g);return{texture:m,white:e.atlas.textures.get(g+"_white")??m,radius:Math.hypot(m.orig.width,m.orig.height)*.5}});return{frames:p,fps:d,loop:f.loop!==!1,radius:Math.max(...p.map(g=>g.radius))}}),this.layer=new oe({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),e.worldRoot.addChildAt(this.layer,e.worldRoot.getChildIndex(e.entityLayer)),this.particles=[],this.pool=[],this.pendingParticles=[],this.visibleCount=0,this.disposed=!1}sync(e){if(this.disposed)throw new Error("Swarm layer is disposed");if(!e?.activeIds||!e.posX||!e.posY||!Number.isInteger(e.count))throw new TypeError("sync requires an HGame CPU SwarmSimulation");const t=e.count;if(t<0||t>e.activeIds.length)throw new RangeError("Swarm count exceeds active ID capacity");const r=this.renderer.camera,i=this.renderer.app.screen,s=i.width/2,n=i.height/2,o=r.zoom;if(!(o>0)||!Number.isFinite(o))throw new RangeError("Camera zoom must be finite and positive");const a=r.x+(-s-r.shakeX)/o,c=r.x+(s-r.shakeX)/o,u=r.y+(-n-r.shakeY)/o,h=r.y+(n-r.shakeY)/o,f=this.clips,d=f.length===1?f[0]:null,p=e.posX,g=e.posY,m=e.activeIds,w=e.animClip,y=e.scale,v=e.rot,x=e.animTime,C=e.flash,T=this.worldScale,_=this.offsetX,S=this.offsetY,b=this.scale,P=this.cull,V=this.syncRotation,Q=this.flipByDirection;let R=0;for(let H=0;H<t;H++){const k=m[H],he=p[k]*T+_,ce=g[k]*T+S,D=d??f[(w?.[k]??0)%f.length],J=(y?.[k]??1)*b;if(P){const L=D.radius*Math.abs(J);if(he+L<a||he-L>c||ce+L<u||ce-L>h)continue}let Re=0;if(D.frames.length>1){const L=x?.[k]??0,Me=Number.isFinite(L)?Math.max(0,Math.floor(L*D.fps)):0;Re=D.loop?Me%D.frames.length:Math.min(Me,D.frames.length-1)}const Ee=D.frames[Re];let A=this.particles[R];const fe=C?.[k]>0?Ee.white:Ee.texture;A||(A=this.pool.pop()??new Se({texture:fe,anchorX:.5,anchorY:.5}),this.particles.push(A),this.pendingParticles.push(A),this.pendingParticles.length===4096&&this.flushPending()),A.texture!==fe&&(A.texture=fe),A.x=he,A.y=ce;const Ue=V||Q?v?.[k]??0:0;A.rotation=V?Ue:0,A.scaleX=Q&&Math.sin(Ue)<0?-J:J,A.scaleY=J,R++}if(this.flushPending(),R<this.particles.length){const H=this.layer.removeParticles(R);this.particles.length=R;for(const k of H)this.pool.push(k)}return this.visibleCount=R,R}flushPending(){this.pendingParticles.length&&this.layer.addParticle(...this.pendingParticles),this.pendingParticles.length=0}dispose(){this.disposed||(this.disposed=!0,this.layer.removeFromParent(),this.layer.destroy(),this.particles.length=0,this.pool.length=0,this.pendingParticles.length=0,this.visibleCount=0,this.renderer.swarmLayers.delete(this))}}class Rr{constructor(e,t,{frames:r,layer:i="background",chunkSize:s=32,maxCachedChunks:n=128,originX:o=0,originY:a=0}={}){if(!e?.bgLayer||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a tilemap layer");if(!t||typeof t.get!="function"||!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<1||t.height<1||!Number.isFinite(t.tileWidth)||!Number.isFinite(t.tileHeight)||!(t.tileWidth>0)||!(t.tileHeight>0))throw new TypeError("A rectangular HGame TileMap with positive tile dimensions is required");if(!r||typeof r!="object"||Array.isArray(r))throw new TypeError("frames must map tile values to atlas frame names");if(i!=="background"&&i!=="foreground")throw new RangeError("Tilemap layer must be background or foreground");if(!Number.isInteger(s)||s<1||s>128)throw new RangeError("chunkSize must be an integer from 1 to 128");if(!Number.isInteger(n)||n<1||n>4096)throw new RangeError("maxCachedChunks must be an integer from 1 to 4096");if(!Number.isFinite(o)||!Number.isFinite(a))throw new RangeError("Tilemap origin must be finite");this.renderer=e,this.map=t,this.frames=new Map;for(const[c,u]of Object.entries(r)){if(u==null)continue;const h=e.atlas.textures.get(u);if(!h)throw new Error("Unknown tilemap atlas frame: "+u);this.frames.set(c,h)}this.chunkSize=s,this.maxCachedChunks=n,this.originX=o,this.originY=a,this.cols=Math.ceil(t.width/s),this.rows=Math.ceil(t.height/s),this.root=new B,this.root.eventMode="none",this.root.interactiveChildren=!1,this.chunks=new Map,this.visibleRange=null,this.disposed=!1;try{(i==="foreground"?e.foregroundLayer:e.bgLayer).addChild(this.root),this.update()}catch(c){throw this.root.destroy({children:!0}),c}}buildChunk(e,t){const r=t*this.cols+e,i=e*this.chunkSize,s=t*this.chunkSize,n=Math.min(this.map.width,i+this.chunkSize),o=Math.min(this.map.height,s+this.chunkSize),a=new oe({dynamicProperties:{position:!1,vertex:!1,uvs:!1,rotation:!1,color:!1}}),c={view:a,x0:i,y0:s,x1:n,y1:o,cells:new Array((n-i)*(o-s)).fill(null)};return this.chunks.set(r,c),this.root.addChild(a),this.refreshChunk(c),c}updateCell(e,t,r){const i=(r-e.y0)*(e.x1-e.x0)+t-e.x0,s=e.cells[i],n=this.frames.get(String(this.map.get(t,r)));if(!n)return s?(e.cells[i]=null,2):0;const o=this.originX+t*this.map.tileWidth,a=this.originY+r*this.map.tileHeight,c=this.map.tileWidth/n.orig.width,u=this.map.tileHeight/n.orig.height;if(s&&s.texture===n&&s.x===o&&s.y===a&&s.scaleX===c&&s.scaleY===u)return 0;const h=s??new Se({texture:n});return h.texture=n,h.x=o,h.y=a,h.scaleX=c,h.scaleY=u,e.cells[i]=h,s?1:2}commitChunkChanges(e,t){if(t===2){const r=e.view.particleChildren;r.length=0;for(const i of e.cells)i&&r.push(i)}t>0&&e.view.update()}refreshChunk(e){let t=0;for(let r=e.y0;r<e.y1;r++)for(let i=e.x0;i<e.x1;i++)t=Math.max(t,this.updateCell(e,i,r));this.commitChunkChanges(e,t)}cachedChunkAt(e,t){return this.chunks.get(Math.floor(t/this.chunkSize)*this.cols+Math.floor(e/this.chunkSize))}refreshTile(e,t){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw new RangeError("Tile is outside the map");const r=this.cachedChunkAt(e,t);r&&this.refreshChunk(r)}setTile(e,t,r){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw new RangeError("Tile is outside the map");if(typeof this.map.set!="function")throw new TypeError("Tilemap must support set");if(Object.is(this.map.get(e,t),r))return;this.map.set(e,t,r);const i=this.cachedChunkAt(e,t);i&&this.commitChunkChanges(i,this.updateCell(i,e,t))}setTiles(e){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Array.isArray(e))throw new TypeError("Tile edits must be an array");if(typeof this.map.set!="function")throw new TypeError("Tilemap must support set");for(const r of e)if(!r||!Object.hasOwn(r,"value")||!Number.isInteger(r.x)||!Number.isInteger(r.y)||r.x<0||r.y<0||r.x>=this.map.width||r.y>=this.map.height)throw new RangeError("Each tile edit needs an in-bounds x, y, and value");const t=new Map;try{for(const{x:r,y:i,value:s}of e){if(Object.is(this.map.get(r,i),s))continue;this.map.set(r,i,s);const n=this.cachedChunkAt(r,i);if(!n)continue;const o=this.updateCell(n,r,i);o>0&&t.set(n,Math.max(o,t.get(n)??0))}}finally{for(const[r,i]of t)this.commitChunkChanges(r,i)}}update(){if(this.disposed)return;const e=this.renderer.camera,t=this.renderer.app.screen,r=e.zoom;if(!(r>0)||!Number.isFinite(r))throw new RangeError("Camera zoom must be finite and positive");const i=e.x+(-t.width/2-e.shakeX)/r,s=e.x+(t.width/2-e.shakeX)/r,n=e.y+(-t.height/2-e.shakeY)/r,o=e.y+(t.height/2-e.shakeY)/r,a=this.chunkSize*this.map.tileWidth,c=this.chunkSize*this.map.tileHeight,u=Math.max(0,Math.ceil((i-this.originX)/a)-1),h=Math.min(this.cols-1,Math.floor((s-this.originX)/a)),f=Math.max(0,Math.ceil((n-this.originY)/c)-1),d=Math.min(this.rows-1,Math.floor((o-this.originY)/c)),p=this.visibleRange;if(!(p&&p.x0===u&&p.x1===h&&p.y0===f&&p.y1===d)){if(p)for(let g=p.y0;g<=p.y1;g++)for(let m=p.x0;m<=p.x1;m++)(m<u||m>h||g<f||g>d)&&(this.chunks.get(g*this.cols+m).view.visible=!1);for(let g=f;g<=d;g++)for(let m=u;m<=h;m++){const w=g*this.cols+m,y=this.chunks.get(w)??this.buildChunk(m,g);y.view.visible=!0,this.chunks.delete(w),this.chunks.set(w,y)}for(const[g,m]of this.chunks){if(this.chunks.size<=this.maxCachedChunks||m.view.visible)break;m.view.removeFromParent(),m.view.destroy(),this.chunks.delete(g)}this.visibleRange={x0:u,x1:h,y0:f,y1:d}}}dispose(){this.disposed||(this.disposed=!0,this.root.removeFromParent(),this.root.destroy({children:!0}),this.chunks.clear(),this.visibleRange=null,this.renderer.tilemapLayers.delete(this))}}const Ne=["webgpu","webgl","canvas"];class Er{constructor(e,{backend:t="auto",maxPixels:r=23e5,maxPixelRatio:i=2,qualityController:s=null,qualityPresets:n=null}={}){if(t!=="auto"&&!Ne.includes(t))throw new RangeError("Invalid Pixi renderer backend: "+t);if(!Number.isFinite(r)||r<1||!Number.isFinite(i)||i<=0)throw new RangeError("Renderer pixel budget and maximum pixel ratio must be positive");if(this.atlas=e,this.maxPixels=r,this.maxPixelRatio=i,this.backendPreference=t,s&&(typeof s.sampleFrame!="function"||typeof s.resetMeasurements!="function"))throw new TypeError("qualityController must support sampleFrame and resetMeasurements");this.qualityController=s,this.qualityPresets=n,this.lastFrameTime=null,this.app=new _e,this.entityMap=new Map,this.spritePool=[],this.swarmLayers=new Set,this.tilemapLayers=new Set,this.effectChannels=new Map,this.beforeRenderCallbacks=new Set,this.camera={x:0,y:0,targetX:0,targetY:0,zoom:1,shakeX:0,shakeY:0}}async init(e){this.mount=e;const{width:t,height:r,resolution:i}=this.planViewport(),s={width:t,height:r,resolution:i,autoDensity:!0,backgroundColor:725019,autoStart:!1},n=[];let o=!1;const a=this.backendPreference==="auto"?Ne:[this.backendPreference];for(const[u,h]of a.entries())try{await this.app.init({...s,preference:[h]}),o=!0,this.backend=h;break}catch(f){n.push(f);try{this.app.renderer?this.app.destroy({removeView:!0},{children:!0}):this.app.stage?.destroy({children:!0})}catch(d){n.push(d),console.warn("Failed to clean up a Pixi renderer:",d)}u+1<a.length&&(this.app=new _e)}if(!o)throw new AggregateError(n,"Unable to initialize a Pixi renderer");this.isCanvas=this.app.renderer.type===Xe.CANVAS,this.app.ticker.stop(),this.app.canvas.id="game",this.app.canvas.setAttribute("aria-label","游戏画面"),this.app.canvas.dataset.rendererBackend=this.backend,this.updateQualityMarker(),e.appendChild(this.app.canvas),this.worldRoot=new B,this.worldRoot.eventMode="none",this.worldRoot.interactiveChildren=!1,this.bgLayer=new B;const c=new Qt({texture:this.atlas.get("ground_grid"),width:4096,height:4096});this.grid=c,c.position.set(-2048,-2048),this.bgLayer.addChild(c),this.shadowLayer=new B,this.entityLayer=new B({sortableChildren:!0}),this.foregroundLayer=new B,this.enemyLayer=new oe({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),this.enemyParticles=[],this.enemyPool=[],this.pendingEnemies=[],this.trailLayer=new B,this.particleLayer=new oe({dynamicProperties:{position:!0,vertex:!0,rotation:!0,color:!0,uvs:!0}}),this.worldRoot.addChild(this.bgLayer,this.shadowLayer,this.enemyLayer,this.entityLayer,this.foregroundLayer,this.trailLayer,this.particleLayer),this.app.stage.addChild(this.worldRoot),this.bloom=new zr({threshold:.62,bloomScale:.4,brightness:1,blur:3}),this.bloom.resolution="inherit",this.bloomEnabled=!1,this.app.stage.filterArea=this.app.screen,this.applyFilters(),this.viewport={width:t,height:r,resolution:i},this.syncCameraView(),typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(e))}planViewport(){const e=Math.max(1,Math.floor(this.mount?.clientWidth||1)),t=Math.max(1,Math.floor(this.mount?.clientHeight||1)),r=Number(globalThis.devicePixelRatio)||1,i=this.qualityController?.state,s=i?.dynamicScale??1,n=this.qualityPresets?.[i?.tier]?.maxPixelRatio??this.maxPixelRatio,o=Math.max(1/Math.min(e,t),Math.min(r,this.maxPixelRatio,n,Math.sqrt(this.maxPixels/(e*t)))*s);return{width:e,height:t,resolution:o}}resize(){if(this.disposed||!this.app.renderer)return!1;this.updateQualityMarker();const e=this.planViewport(),t=this.viewport;return t&&t.width===e.width&&t.height===e.height&&t.resolution===e.resolution?!1:(this.app.renderer.resize(e.width,e.height,e.resolution),this.viewport=e,this.app.stage.filterArea=this.app.screen,this.syncCameraView(),this.onResize?.(),!0)}updateQualityMarker(){const e=this.qualityController?.state?.tier;e&&(this.app.canvas.dataset.qualityTier=e)}renderDiagnostics(){const e=this.app.renderer.gpu?.adapter,t=e?.info;return{backend:this.backend,adapter:e?{vendor:t?.vendor||null,architecture:t?.architecture||null,device:t?.device||null,description:t?.description||null,fallback:t?.isFallbackAdapter??e.isFallbackAdapter??null}:null}}resetQualityMeasurements(){this.lastFrameTime=null,this.qualityController?.resetMeasurements()}setQuality(e){if(typeof this.qualityController?.setMode!="function")throw new Error("Renderer2D has no configurable quality controller");return this.qualityController.setMode(e)?(this.lastFrameTime=null,this.resize(),!0):!1}setBloom({enabled:e=!0,threshold:t,bloomScale:r,brightness:i,blur:s}={}){if(!this.bloom||this.disposed)throw new Error("Initialize Renderer2D before configuring bloom");for(const[n,o]of Object.entries({threshold:t,bloomScale:r,brightness:i,blur:s}))if(o!==void 0&&(!Number.isFinite(o)||o<0))throw new RangeError(`Bloom ${n} must be a finite non-negative number`);t!==void 0&&(this.bloom.threshold=t),r!==void 0&&(this.bloom.bloomScale=r),i!==void 0&&(this.bloom.brightness=i),s!==void 0&&(this.bloom.blur=s),this.bloomEnabled=!!e,this.applyFilters()}setEffectFilters(e,{owner:t=this,beforeRender:r=null,bloom:i=!0}={}){e.length?this.effectChannels.set(t,{filters:e,beforeRender:r,bloom:i}):this.effectChannels.delete(t),this.applyFilters()}onBeforeRender(e){if(typeof e!="function")throw new TypeError("Expected a render preparation callback");return this.beforeRenderCallbacks.add(e),()=>this.beforeRenderCallbacks.delete(e)}applyFilters(){const e=[];if(!this.isCanvas){let t=this.bloomEnabled;for(const r of this.effectChannels.values())e.push(...r.filters),t||=r.bloom;t&&e.unshift(this.bloom)}this.app.stage.filters=e}createSwarmLayer(e){const t=new Ar(this,e);return this.swarmLayers.add(t),t}createTilemapLayer(e,t){const r=new Rr(this,e,t);return this.tilemapLayers.add(r),r}syncEnemies(e,t){const r=this.enemyTextures??=["enemy_chaser","enemy_chaser_white","enemy_elite","enemy_elite_white"].map(w=>this.atlas.get(w)),i=this.enemyCullRadius??=Math.max(...r.map(w=>Math.hypot(w.orig.width,w.orig.height)*.525)),{x:s,y:n,zoom:o,shakeX:a,shakeY:c}=this.camera,{width:u,height:h}=this.app.screen,f=s+(-u/2-a)/o-i,d=s+(u/2-a)/o+i,p=n+(-h/2-c)/o-i,g=n+(h/2-c)/o+i;let m=0;for(let w=0;w<e.length;w++){const y=e[w];if(y.x<f||y.x>d||y.y<p||y.y>g)continue;const v=r[(y.elite?2:0)+(y.flash>0?1:0)];let x=this.enemyParticles[m++];x||(x=this.enemyPool.pop()??new Se({texture:v,anchorX:.5,anchorY:.5}),this.enemyParticles.push(x),this.pendingEnemies.push(x),this.pendingEnemies.length===4096&&this.flushEnemies()),x.texture!==v&&(x.texture=v),x.x=y.x,x.y=y.y;const C=t*7+y.id*.37;x.rotation=Math.sin(C)*.09;const T=Math.sin(C*2);x.scaleX=1+T*.035,x.scaleY=1-T*.05}if(this.flushEnemies(),m<this.enemyParticles.length){const w=this.enemyLayer.removeParticles(m);this.enemyParticles.length=m;for(const y of w)this.enemyPool.push(y)}}flushEnemies(){this.pendingEnemies.length&&this.enemyLayer.addParticle(...this.pendingEnemies),this.pendingEnemies.length=0}alloc(e){const t=this.spritePool.pop()??new Pt;return t.texture=this.atlas.get(e),t.anchor.set(.5),t.alpha=1,t.tint=16777215,t.scale.set(1),t.rotation=0,t.visible=!0,t}syncEntity(e,t){let r=this.entityMap.get(e);r||(r={sprite:this.alloc(t.tex),shadow:null,flashTimer:0,animScaleX:1,animScaleY:1},this.entityMap.set(e,r),this.entityLayer.addChild(r.sprite)),r.baseTex=t.tex;const i=r.sprite,s=this.atlas.get(t.tex);return i.texture=r.flashTimer>0?this.atlas.textures.get(t.tex+"_white")??s:s,i.position.set(t.x,t.y),i.rotation=t.rot??0,i.scale.set((t.scaleX??1)*r.animScaleX,(t.scaleY??1)*r.animScaleY),i.tint=r.flashTimer>0?16777215:t.tint??16777215,i.alpha=t.alpha??1,i.zIndex=t.zIndex??t.y,t.hasShadow!==!1?(r.shadow||(r.shadow=this.alloc("shadow_oval"),this.shadowLayer.addChild(r.shadow)),r.shadow.visible=!0,r.shadow.position.set(t.x,t.y+18),r.shadow.alpha=.35):r.shadow&&(r.shadow.visible=!1),r}releaseEntity(e){const t=this.entityMap.get(e);t&&(t.sprite.removeFromParent(),this.spritePool.push(t.sprite),t.shadow&&(t.shadow.removeFromParent(),this.spritePool.push(t.shadow)),this.entityMap.delete(e))}update(e){const t=this.camera,r=1-Math.exp(-10*e);t.x+=(t.targetX-t.x)*r,t.y+=(t.targetY-t.y)*r,this.syncCameraView();for(const i of this.entityMap.values())i.flashTimer=Math.max(0,i.flashTimer-e)}syncCameraView(){const e=this.camera;this.worldRoot.scale.set(e.zoom),this.worldRoot.position.set(this.app.screen.width/2-e.x*e.zoom+e.shakeX,this.app.screen.height/2-e.y*e.zoom+e.shakeY);for(const t of this.tilemapLayers)t.update()}screenToWorld(e,t){return{x:(e-this.app.screen.width/2-this.camera.shakeX)/this.camera.zoom+this.camera.x,y:(t-this.app.screen.height/2-this.camera.shakeY)/this.camera.zoom+this.camera.y}}worldToScreen(e,t,r={x:0,y:0}){return r.x=(e-this.camera.x)*this.camera.zoom+this.app.screen.width/2+this.camera.shakeX,r.y=(t-this.camera.y)*this.camera.zoom+this.app.screen.height/2+this.camera.shakeY,r}render(e){if(this.qualityController&&e!==null){if(e===void 0){const t=performance.now();e=this.lastFrameTime===null?0:t-this.lastFrameTime,this.lastFrameTime=t}else e===0&&this.resetQualityMeasurements();e>0&&this.qualityController.sampleFrame(e)&&this.resize()}for(const t of this.beforeRenderCallbacks)t();if(!this.isCanvas)for(const t of this.effectChannels.values())t.beforeRender?.();this.app.renderer.render(this.app.stage)}dispose(){if(this.disposed)return;this.disposed=!0,this.resizeObserver?.disconnect(),this.resizeObserver=null,this.onResize=null;for(const t of this.swarmLayers)t.dispose();for(const t of this.tilemapLayers)t.dispose();for(const t of this.spritePool)t.destroy();this.spritePool.length=0,this.enemyParticles.length=0,this.enemyPool.length=0,this.pendingEnemies.length=0,this.entityMap.clear();const e=this.app.stage;try{e&&(e.filters=[]),this.effectChannels.clear(),this.beforeRenderCallbacks.clear(),this.bloom?.destroy(),this.app.renderer?this.app.destroy({removeView:!0},{children:!0}):e&&!e.destroyed&&e.destroy({children:!0})}finally{this.atlas.dispose()}}}function Ur(l,{resetInput:e=()=>{},onVisibility:t=()=>{}}={}){let r=!1;function i(a){a?r&&(r=!1,l.running&&l.paused&&l.resume()):(e(),l.running&&!l.paused&&(r=l.pause())),t(a)}const s=l.platform.lifecycle,n=s.on("visibility",i),o=s.on("focus",a=>{a||e()});return{sync(){i(s.visible)},dispose(){n(),o(),r=!1}}}async function me(l){const e=await fetch(new URL(l,document.baseURI));if(!e.ok)throw new Error(`Could not load ${l}: HTTP ${e.status}`);return e.json()}function Y(l){const e=location.port==="4175"&&location.pathname.startsWith("/local-games/"),t=new URL(e?"/runtime/hgame/":"./vendor/hgame/",document.baseURI);return import(new URL(l,t).href)}async function Ir(l,{mount:e=document.querySelector("#game-canvas"),createAtlas:t=hr,rendererOptions:r}={}){if(!e)throw new Error("Missing Pixi game canvas mount");if(typeof l!="function")throw new TypeError("Pixi game setup callback is required");const[i,s,n,{createGameApplication:o},{defineProject:a},{Scene:c},{Entity:u},{Component:h},{createAdaptiveQualityController:f,QUALITY2D_PRESETS:d}]=await Promise.all([me("./game.config.json"),me("./engine.config.json"),me("./src/presentation.json"),Y("core/application.js"),Y("core/config.js"),Y("core/scene.js"),Y("core/entity.js"),Y("core/component.js"),Y("integrations/quality3d.js")]),p=a(s),g=n.quality??"auto",m=g==="auto"&&p.tickHz===0?"high":g,w=f({mode:m,device:{mobile:globalThis.matchMedia?.("(pointer: coarse)")?.matches??!1,memoryGB:navigator.deviceMemory??null}}),y=await t();let v,x,C,T,_;const S=()=>x.renderDiagnostics();function b(P){P.persisted||v.dispose()}try{x=new Er(y,{backend:n.backend??"auto",qualityController:w,qualityPresets:d,maxPixelRatio:3,...r}),await x.init(e),C=x.app.canvas,v=o({project:p,gameId:i.id,gameVersion:i.version,renderer:{render(V,Q){const R=Q?.unscaledDeltaSeconds;x.render(p.tickHz===0?null:R===void 0?void 0:R*1e3)},resize(){x.resize()},dispose(){window.removeEventListener("pagehide",b),_&&window.__hgameState===_&&delete window.__hgameState,window.__hgameRenderDiagnostics===S&&delete window.__hgameRenderDiagnostics,delete e.dataset.engineReady,delete C.dataset.engineReady;try{T?.dispose()}finally{x.dispose()}}}}),window.addEventListener("pagehide",b),await v.installFeatures();const P=await l({app:v,renderer:x,Scene:c,Entity:u,Component:h});if(v.disposed)throw new Error("Pixi game was disposed during setup");if(typeof P?.scene!="string"||!v.scenes.get(P.scene))throw new Error("Pixi game setup must return the name of a registered scene in { scene }");return T=Ur(v,{...P.visibility,onVisibility(V){x.resetQualityMeasurements(),P.visibility?.onVisibility?.(V)}}),x.onResize=()=>{p.tickHz===0&&v.running&&!v.paused&&x.render(null)},v.scenes.start(P.scene),v.start(),T.sync(),_=P.state,_&&(window.__hgameState=_),window.__hgameRenderDiagnostics=S,e.dataset.engineReady="true",C.dataset.engineReady="true",{app:v,renderer:x}}catch(P){try{v?v.dispose():x?x.dispose():y.dispose()}catch(V){throw new AggregateError([P,V],"Pixi game startup and cleanup failed")}throw P}}export{Nt as B,st as M,oe as P,Se as a,hr as c,Y as l,me as r,Ir as s,ze as v,Ae as w};
