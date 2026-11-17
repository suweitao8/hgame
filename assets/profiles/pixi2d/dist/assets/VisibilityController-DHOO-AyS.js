const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./browserAll-Dknvu5GT.js","./Geometry-b4_yFV4e.js","./init-CWUIAUpk.js","./canvasUtils-DiiUq8Hs.js","./webworkerAll-vTjiTUhh.js","./CanvasPool-D2lhgJD8.js","./WebGPURenderer-uoQZUmwt.js","./colorToUniform-MIizxb8Q.js","./RenderTargetSystem-BDuLvLx3.js","./localUniformBit-BOGrcT1E.js","./getTextureBatchBindGroup-D2l3TxEN.js","./getTexelRangeRects-BjZFLgKe.js","./WebGLRenderer-Q9cycPvx.js","./CanvasRenderer-B56f80B8.js"])))=>i.map(i=>d[i]);
import{E as v,D as ee,U as Ze,h as fe,j as C,k as M,d as B,o as I,m as we,c as k,e as T,M as U,a6 as V,P as Y,a7 as te,a8 as be,Q as _e,l as re,T as P,p as ie,W as et,V as Te,b as se,t as j,s as K,C as Pe,a9 as tt,aa as de,y as rt,R as it,J as st,F as ue,_ as E,I as nt}from"./Geometry-b4_yFV4e.js";import{C as ot}from"./init-CWUIAUpk.js";import{A as Ce,h as at,a as lt,b as ut,r as ht,d as ct,G as Se,c as ze,g as Ue,V as N}from"./colorToUniform-MIizxb8Q.js";import{c as Ae}from"./canvasUtils-DiiUq8Hs.js";import{a as ft,b as dt}from"./localUniformBit-BOGrcT1E.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))r(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const n of s.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&r(n)}).observe(document,{childList:!0,subtree:!0});function t(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function r(i){if(i.ep)return;i.ep=!0;const s=t(i);fetch(i.href,s)}})();const pt="modulepreload",mt=function(l,e){return new URL(l,e).href},pe={},D=function(e,t,r){let i=Promise.resolve();if(t&&t.length>0){let n=function(u){return Promise.all(u.map(h=>Promise.resolve(h).then(f=>({status:"fulfilled",value:f}),f=>({status:"rejected",reason:f}))))};const a=document.getElementsByTagName("link"),o=document.querySelector("meta[property=csp-nonce]"),c=o?.nonce||o?.getAttribute("nonce");i=n(t.map(u=>{if(u=mt(u,r),u in pe)return;pe[u]=!0;const h=u.endsWith(".css"),f=h?'[rel="stylesheet"]':"";if(!!r)for(let m=a.length-1;m>=0;m--){const g=a[m];if(g.href===u&&(!h||g.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${u}"]${f}`))return;const p=document.createElement("link");if(p.rel=h?"stylesheet":pt,h||(p.as="script"),p.crossOrigin="",p.href=u,c&&p.setAttribute("nonce",c),document.head.appendChild(p),h)return new Promise((m,g)=>{p.addEventListener("load",m),p.addEventListener("error",()=>g(new Error(`Unable to preload CSS for ${u}`)))})}))}function s(n){const a=new Event("vite:preloadError",{cancelable:!0});if(a.payload=n,window.dispatchEvent(a),!a.defaultPrevented)throw n}return i.then(n=>{for(const a of n||[])a.status==="rejected"&&s(a.reason);return e().catch(s)})},gt={extension:{type:v.Environment,name:"browser",priority:-1},test:()=>!0,load:async()=>{await D(()=>import("./browserAll-Dknvu5GT.js"),__vite__mapDeps([0,1,2,3,4,5]),import.meta.url)}},xt={extension:{type:v.Environment,name:"webworker",priority:0},test:()=>typeof self<"u"&&self.WorkerGlobalScope!==void 0,load:async()=>{await D(()=>import("./webworkerAll-vTjiTUhh.js"),__vite__mapDeps([4,2,1,3,5]),import.meta.url)}};let X;function yt(l){return X!==void 0||(X=(()=>{const e={stencil:!0,failIfMajorPerformanceCaveat:l??Ce.defaultOptions.failIfMajorPerformanceCaveat};try{if(!ee.get().getWebGLRenderingContext())return!1;let r=ee.get().createCanvas().getContext("webgl",e);const i=!!r?.getContextAttributes()?.stencil;if(r){const s=r.getExtension("WEBGL_lose_context");s&&s.loseContext()}return r=null,i}catch{return!1}})()),X}let q;async function vt(l={}){return q!==void 0||(q=await(async()=>{const e=ee.get().getNavigator().gpu;if(!e)return!1;try{return await(await e.requestAdapter(l)).requestDevice(),!0}catch{return!1}})()),q}const me=["webgl","webgpu","canvas"];async function wt(l){let e=[];l.preference?Array.isArray(l.preference)?e=l.preference.slice():(e.push(l.preference),me.forEach(s=>{s!==l.preference&&e.push(s)})):e=me.slice();let t,r={};for(let s=0;s<e.length;s++){const n=e[s];if(n==="webgpu"&&await vt()){const{WebGPURenderer:a}=await D(async()=>{const{WebGPURenderer:o}=await import("./WebGPURenderer-uoQZUmwt.js");return{WebGPURenderer:o}},__vite__mapDeps([6,1,7,8,5,9,10,11]),import.meta.url);t=a,r={...l,...l.webgpu};break}else if(n==="webgl"&&yt(l.failIfMajorPerformanceCaveat??Ce.defaultOptions.failIfMajorPerformanceCaveat)){const{WebGLRenderer:a}=await D(async()=>{const{WebGLRenderer:o}=await import("./WebGLRenderer-Q9cycPvx.js");return{WebGLRenderer:o}},__vite__mapDeps([12,1,7,8,5,9,11]),import.meta.url);t=a,r={...l,...l.webgl};break}else if(n==="canvas"){const{CanvasRenderer:a}=await D(async()=>{const{CanvasRenderer:o}=await import("./CanvasRenderer-B56f80B8.js");return{CanvasRenderer:o}},__vite__mapDeps([13,1,8,7,5,3,10]),import.meta.url);t=a,r={...l,...l.canvasOptions};break}}if(delete r.webgpu,delete r.webgl,delete r.canvasOptions,!t)throw new Error("No available renderer for the current environment");const i=new t;return await i.init(r),i}class Oe{static init(e){Object.defineProperty(this,"resizeTo",{configurable:!0,set(t){globalThis.removeEventListener("resize",this.queueResize),this._resizeTo=t,t&&(globalThis.addEventListener("resize",this.queueResize),this.resize())},get(){return this._resizeTo}}),this.queueResize=()=>{this._resizeTo&&(this._cancelResize(),this._resizeId=requestAnimationFrame(()=>this.resize()))},this._cancelResize=()=>{this._resizeId&&(cancelAnimationFrame(this._resizeId),this._resizeId=null)},this.resize=()=>{if(!this._resizeTo)return;this._cancelResize();let t,r;if(this._resizeTo===globalThis.window)t=globalThis.innerWidth,r=globalThis.innerHeight;else{const{clientWidth:i,clientHeight:s}=this._resizeTo;t=i,r=s}this.renderer.resize(t,r),this.render()},this._resizeId=null,this._resizeTo=null,this.resizeTo=e.resizeTo||null}static destroy(){globalThis.removeEventListener("resize",this.queueResize),this._cancelResize(),this._cancelResize=null,this.queueResize=null,this.resizeTo=null,this.resize=null}}Oe.extension=v.Application;class Re{static init(e){e=Object.assign({autoStart:!0,sharedTicker:!1},e),Object.defineProperty(this,"ticker",{configurable:!0,set(t){this._ticker&&this._ticker.remove(this.render,this),this._ticker=t,t&&t.add(this.render,this,Ze.LOW)},get(){return this._ticker}}),this.stop=()=>{this._ticker.stop()},this.start=()=>{this._ticker.start()},this._ticker=null,this.ticker=e.sharedTicker?fe.shared:new fe,e.autoStart&&this.start()}static destroy(){if(this._ticker){const e=this._ticker;this.ticker=null,e.destroy()}}}Re.extension=v.Application;C.add(Oe);C.add(Re);const Me=class ne{constructor(...e){this.stage=new M,e[0]!==void 0&&B(I,"Application constructor options are deprecated, please use Application.init() instead.")}async init(e){e={...e},this.stage||(this.stage=new M),this.renderer=await wt(e),ne._plugins.forEach(t=>{t.init.call(this,e)})}render(){this.renderer.render({container:this.stage})}get canvas(){return this.renderer.canvas}get view(){return B(I,"Application.view is deprecated, please use Application.canvas instead."),this.renderer.canvas}get screen(){return this.renderer.screen}get domContainerRoot(){return this.renderer.renderPipes.dom?._domElement}destroy(e=!1,t=!1){const r=ne._plugins.slice(0);r.reverse(),r.forEach(i=>{i.destroy.call(this)}),this.stage.destroy(t),this.stage=null,this.renderer.destroy(e),this.renderer=null}};Me._plugins=[];let Be=Me;C.handleByList(v.Application,Be._plugins);C.add(at);const Fe=class Ee extends we{constructor(...e){let t=e[0]??{};t instanceof Float32Array&&(B(I,"use new MeshGeometry({ positions, uvs, indices }) instead"),t={positions:t,uvs:e[1],indices:e[2]}),t={...Ee.defaultOptions,...t};const r=t.positions||new Float32Array([0,0,1,0,1,1,0,1]);let i=t.uvs;i||(t.positions?i=new Float32Array(r.length):i=new Float32Array([0,0,1,0,1,1,0,1]));const s=t.indices||new Uint32Array([0,1,2,0,2,3]),n=t.shrinkBuffersToFit,a=new k({data:r,label:"attribute-mesh-positions",shrinkToFit:n,usage:T.VERTEX|T.COPY_DST}),o=new k({data:i,label:"attribute-mesh-uvs",shrinkToFit:n,usage:T.VERTEX|T.COPY_DST}),c=new k({data:s,label:"index-mesh-buffer",shrinkToFit:n,usage:T.INDEX|T.COPY_DST});super({attributes:{aPosition:{buffer:a,format:"float32x2",stride:8,offset:0},aUV:{buffer:o,format:"float32x2",stride:8,offset:0}},indexBuffer:c,topology:t.topology}),this.batchMode="auto"}get positions(){return this.attributes.aPosition.buffer.data}set positions(e){this.attributes.aPosition.buffer.data=e}get uvs(){return this.attributes.aUV.buffer.data}set uvs(e){this.attributes.aUV.buffer.data=e}get indices(){return this.indexBuffer.data}set indices(e){this.indexBuffer.data=e}};Fe.defaultOptions={topology:"triangle-list",shrinkBuffersToFit:!1};let Ie=Fe;class bt{constructor(){this.batcherName="default",this.packAsQuad=!1,this.indexOffset=0,this.attributeOffset=0,this.roundPixels=0,this._batcher=null,this._batch=null,this._textureMatrixUpdateId=-1,this._uvUpdateId=-1}get blendMode(){return this.renderable.groupBlendMode}get topology(){return this._topology||this.geometry.topology}set topology(e){this._topology=e}reset(){this.renderable=null,this.texture=null,this._batcher=null,this._batch=null,this.geometry=null,this._uvUpdateId=-1,this._textureMatrixUpdateId=-1}setTexture(e){this.texture!==e&&(this.texture=e,this._textureMatrixUpdateId=-1)}get uvs(){const t=this.geometry.getBuffer("aUV"),r=t.data;let i=r;const s=this.texture.textureMatrix;return s.isSimple||(i=this._transformedUvs,(this._textureMatrixUpdateId!==s._updateID||this._uvUpdateId!==t._updateID)&&((!i||i.length<r.length)&&(i=this._transformedUvs=new Float32Array(r.length)),this._textureMatrixUpdateId=s._updateID,this._uvUpdateId=t._updateID,s.multiplyUvs(r,i))),i}get positions(){return this.geometry.positions}get indices(){return this.geometry.indices}get color(){return this.renderable.groupColorAlpha}get groupTransform(){return this.renderable.groupTransform}get attributeSize(){return this.geometry.positions.length/2}get indexSize(){return this.geometry.indices.length}}class _t{constructor({matrix:e,observer:t}={}){this.dirty=!0,this._matrix=e??new U,this.observer=t,this.position=new V(this,0,0),this.scale=new V(this,1,1),this.pivot=new V(this,0,0),this.skew=new V(this,0,0),this._rotation=0,this._cx=1,this._sx=0,this._cy=0,this._sy=1}get matrix(){const e=this._matrix;return this.dirty&&(e.a=this._cx*this.scale.x,e.b=this._sx*this.scale.x,e.c=this._cy*this.scale.y,e.d=this._sy*this.scale.y,e.tx=this.position.x-(this.pivot.x*e.a+this.pivot.y*e.c),e.ty=this.position.y-(this.pivot.x*e.b+this.pivot.y*e.d),this.dirty=!1),e}_onUpdate(e){this.dirty=!0,e===this.skew&&this.updateSkew(),this.observer?._onUpdate(this)}updateSkew(){this._cx=Math.cos(this._rotation+this.skew.y),this._sx=Math.sin(this._rotation+this.skew.y),this._cy=-Math.sin(this._rotation-this.skew.x),this._sy=Math.cos(this._rotation-this.skew.x),this.dirty=!0}toString(){return`[pixi.js/math:Transform position=(${this.position.x}, ${this.position.y}) rotation=${this.rotation} scale=(${this.scale.x}, ${this.scale.y}) skew=(${this.skew.x}, ${this.skew.y}) ]`}setFromMatrix(e){e.decompose(this),this.dirty=!0}get rotation(){return this._rotation}set rotation(e){this._rotation!==e&&(this._rotation=e,this._onUpdate(this.skew))}}const W=new U,z=new U,_=[new Y,new Y,new Y,new Y];class Ve{constructor(e){this._renderer=e}validateRenderable(e){return!1}addRenderable(e,t){this._renderer.renderPipes.batch.break(t),t.add(e)}updateRenderable(e){}execute(e){const t=this._renderer,r=t.canvasContext,i=r.activeContext;i.save(),r.setBlendMode(e.groupBlendMode);const s=t.globalUniforms.globalUniformData?.worldColor??4294967295,n=e.groupColorAlpha,a=(s>>>24&255)/255,o=(n>>>24&255)/255,c=t.filter?.alphaMultiplier??1,u=a*o*c;if(u<=0){i.restore();return}i.globalAlpha=u;const h=s&16777215,f=n&16777215,d=te(be(f,h)),p=e.texture,m=Ae.getTintedPattern(p,d),g=e.width,w=e.height,x=e.groupTransform,b=p.source._resolution??p.source.resolution??1;z.copyFrom(e._tileTransform.matrix),e.applyAnchorToTexture||z.translate(-e.anchor.x*g,-e.anchor.y*w);const S=z.tx,L=z.ty;z.scale(1/b,1/b),z.tx=S,z.ty=L,W.identity(),W.prepend(z),W.prepend(x);const G=t._roundPixels|e._roundPixels;r.setContextTransform(W,G===1),i.fillStyle=m;const A=e.anchor.x*-g,O=e.anchor.y*-w;_[0].set(A,O),_[1].set(A+g,O),_[2].set(A+g,O+w),_[3].set(A,O+w);for(let y=0;y<4;y++)z.applyInverse(_[y],_[y]);i.beginPath(),i.moveTo(_[0].x,_[0].y);for(let y=1;y<4;y++)i.lineTo(_[y].x,_[y].y);i.closePath(),i.fill(),i.restore()}destroy(){this._renderer=null}}Ve.extension={type:[v.CanvasPipes],name:"tilingSprite"};const Tt={name:"tiling-bit",vertex:{header:`
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
        `}},Pt={name:"tiling-bit",vertex:{header:`
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

        `}};let J,Z;class Ct extends _e{constructor(){J??(J=lt({name:"tiling-sprite-shader",bits:[ft,Tt,ht]})),Z??(Z=ut({name:"tiling-sprite-shader",bits:[dt,Pt,ct]}));const e=new re({uMapCoord:{value:new U,type:"mat3x3<f32>"},uClampFrame:{value:new Float32Array([0,0,1,1]),type:"vec4<f32>"},uClampOffset:{value:new Float32Array([0,0]),type:"vec2<f32>"},uTextureTransform:{value:new U,type:"mat3x3<f32>"},uSizeAnchor:{value:new Float32Array([100,100,.5,.5]),type:"vec4<f32>"}});super({glProgram:Z,gpuProgram:J,resources:{localUniforms:new re({uTransformMatrix:{value:new U,type:"mat3x3<f32>"},uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uRound:{value:0,type:"f32"}}),tilingUniforms:e,uTexture:P.EMPTY.source,uSampler:P.EMPTY.source.style}})}updateUniforms(e,t,r,i,s,n){const a=this.resources.tilingUniforms,o=n.width,c=n.height,u=n.textureMatrix,h=a.uniforms.uTextureTransform;h.set(r.a*o/e,r.b*o/t,r.c*c/e,r.d*c/t,r.tx/e,r.ty/t),h.invert(),a.uniforms.uMapCoord=u.mapCoord,a.uniforms.uClampFrame=u.uClampFrame,a.uniforms.uClampOffset=u.uClampOffset,a.uniforms.uTextureTransform=h,a.uniforms.uSizeAnchor[0]=e,a.uniforms.uSizeAnchor[1]=t,a.uniforms.uSizeAnchor[2]=i,a.uniforms.uSizeAnchor[3]=s,n&&(this.resources.uTexture=n.source,this.resources.uSampler=n.source.style)}}class St extends Ie{constructor(){super({positions:new Float32Array([0,0,1,0,1,1,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])})}}function zt(l,e){const t=l.anchor.x,r=l.anchor.y;e[0]=-t*l.width,e[1]=-r*l.height,e[2]=(1-t)*l.width,e[3]=-r*l.height,e[4]=(1-t)*l.width,e[5]=(1-r)*l.height,e[6]=-t*l.width,e[7]=(1-r)*l.height}function Ut(l,e,t,r){let i=0;const s=l.length/e,n=r.a,a=r.b,o=r.c,c=r.d,u=r.tx,h=r.ty;for(t*=e;i<s;){const f=l[t],d=l[t+1];l[t]=n*f+o*d+u,l[t+1]=a*f+c*d+h,t+=e,i++}}function At(l,e){const t=l.texture,r=t.frame.width,i=t.frame.height;let s=0,n=0;l.applyAnchorToTexture&&(s=l.anchor.x,n=l.anchor.y),e[0]=e[6]=-s,e[2]=e[4]=1-s,e[1]=e[3]=-n,e[5]=e[7]=1-n;const a=l._tileTransform.matrix,o=U.shared;o.set(a.a*r/l.width,a.b*r/l.height,a.c*i/l.width,a.d*i/l.height,a.tx/l.width,a.ty/l.height),o.invert(),Ut(e,2,0,o)}const $=new St;class Ot{constructor(){this.canBatch=!0,this.geometry=new Ie({indices:$.indices.slice(),positions:$.positions.slice(),uvs:$.uvs.slice()})}destroy(){this.geometry.destroy(),this.shader?.destroy()}}class ke{constructor(e){this._state=ie.default2d,this._renderer=e,this._managedTilingSprites=new Se({renderer:e,type:"renderable",name:"tilingSprite"})}validateRenderable(e){const t=this._getTilingSpriteData(e),r=t.canBatch;this._updateCanBatch(e);const i=t.canBatch;if(i&&i===r){const{batchableMesh:s}=t;return!s._batcher.checkAndUpdateTexture(s,e.texture)}return r!==i}addRenderable(e,t){const r=this._renderer.renderPipes.batch;this._updateCanBatch(e);const i=this._getTilingSpriteData(e),{geometry:s,canBatch:n}=i;if(n){i.batchableMesh||(i.batchableMesh=new bt);const a=i.batchableMesh;e.didViewUpdate&&(this._updateBatchableMesh(e),a.geometry=s,a.renderable=e,a.transform=e.groupTransform,a.setTexture(e._texture)),a.roundPixels=this._renderer._roundPixels|e._roundPixels,r.addToBatch(a,t)}else r.break(t),i.shader||(i.shader=new Ct),this.updateRenderable(e),t.add(e)}execute(e){const t=this._renderer,{shader:r}=this._getTilingSpriteData(e);r.groups[0]=t.globalUniforms.bindGroup;const i=r.resources.localUniforms.uniforms;i.uTransformMatrix=e.groupTransform,i.uRound=t._roundPixels|e._roundPixels,ze(e.groupColorAlpha,i.uColor,0),this._state.blendMode=Ue(e.groupBlendMode,e.texture._source),t.encoder.draw({geometry:$,shader:r,state:this._state})}updateRenderable(e){const t=this._getTilingSpriteData(e),{canBatch:r}=t;if(r){const{batchableMesh:i}=t;e.didViewUpdate&&this._updateBatchableMesh(e),i._batcher.updateElement(i)}else if(e.didViewUpdate){const{shader:i}=t;i.updateUniforms(e.width,e.height,e._tileTransform.matrix,e.anchor.x,e.anchor.y,e.texture)}}_getTilingSpriteData(e){return e._gpuData[this._renderer.uid]||this._initTilingSpriteData(e)}_initTilingSpriteData(e){const t=new Ot;return t.renderable=e,e._gpuData[this._renderer.uid]=t,this._managedTilingSprites.add(e),t}_updateBatchableMesh(e){const t=this._getTilingSpriteData(e),{geometry:r}=t,i=e.texture.source.style;i.addressMode!=="repeat"&&(i.addressMode="repeat",i.update()),At(e,r.uvs),zt(e,r.positions)}destroy(){this._managedTilingSprites.destroy(),this._renderer=null}_updateCanBatch(e){const t=this._getTilingSpriteData(e),r=e.texture;let i=!0;return this._renderer.type===et.WEBGL&&(i=this._renderer.context.supports.nonPowOf2wrapping),t.canBatch=r.textureMatrix.isSimple&&(i||r.source.isPowerOfTwo),t.canBatch}}ke.extension={type:[v.WebGLPipes,v.WebGPUPipes],name:"tilingSprite"};C.add(Ve);C.add(ke);const De=class H extends Te{constructor(...e){let t=e[0]||{};t instanceof P&&(t={texture:t}),e.length>1&&(B(I,"use new TilingSprite({ texture, width:100, height:100 }) instead"),t.width=e[1],t.height=e[2]),t={...H.defaultOptions,...t};const{texture:r,anchor:i,tilePosition:s,tileScale:n,tileRotation:a,width:o,height:c,applyAnchorToTexture:u,roundPixels:h,...f}=t??{};super({label:"TilingSprite",...f}),this.renderPipeId="tilingSprite",this.batched=!0,this.allowChildren=!1,this._anchor=new V({_onUpdate:()=>{this.onViewUpdate()}}),this.applyAnchorToTexture=u,this.texture=r,this._width=o??r.width,this._height=c??r.height,this._tileTransform=new _t({observer:{_onUpdate:()=>this.onViewUpdate()}}),i&&(this.anchor=i),this.tilePosition=s,this.tileScale=n,this.tileRotation=a,this.roundPixels=h??!1}static from(e,t={}){return typeof e=="string"?new H({texture:ot.get(e),...t}):new H({texture:e,...t})}get uvRespectAnchor(){return B(I,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture}set uvRespectAnchor(e){B(I,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture=e}get clampMargin(){return this._texture.textureMatrix.clampMargin}set clampMargin(e){this._texture.textureMatrix.clampMargin=e}get anchor(){return this._anchor}set anchor(e){typeof e=="number"?this._anchor.set(e):this._anchor.copyFrom(e)}get tilePosition(){return this._tileTransform.position}set tilePosition(e){this._tileTransform.position.copyFrom(e)}get tileScale(){return this._tileTransform.scale}set tileScale(e){typeof e=="number"?this._tileTransform.scale.set(e):this._tileTransform.scale.copyFrom(e)}set tileRotation(e){this._tileTransform.rotation=e}get tileRotation(){return this._tileTransform.rotation}get tileTransform(){return this._tileTransform}set texture(e){e||(e=P.EMPTY);const t=this._texture;t!==e&&(t&&t.dynamic&&t.off("update",this.onViewUpdate,this),e.dynamic&&e.on("update",this.onViewUpdate,this),this._texture=e,this.onViewUpdate())}get texture(){return this._texture}set width(e){this._width=e,this.onViewUpdate()}get width(){return this._width}set height(e){this._height=e,this.onViewUpdate()}get height(){return this._height}setSize(e,t){typeof e=="object"&&(t=e.height??e.width,e=e.width),this._width=e,this._height=t??e,this.onViewUpdate()}getSize(e){return e||(e={}),e.width=this._width,e.height=this._height,e}updateBounds(){const e=this._bounds,t=this._anchor,r=this._width,i=this._height;e.minX=-t._x*r,e.maxX=e.minX+r,e.minY=-t._y*i,e.maxY=e.minY+i}containsPoint(e){const t=this._width,r=this._height,i=-t*this._anchor._x;let s=0;return e.x>=i&&e.x<=i+t&&(s=-r*this._anchor._y,e.y>=s&&e.y<=s+r)}destroy(e=!1){if(super.destroy(e),this._anchor=null,this._tileTransform=null,this._bounds=null,typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource;this._texture.destroy(r)}this._texture=null}};De.defaultOptions={texture:P.EMPTY,anchor:{x:0,y:0},tilePosition:{x:0,y:0},tileScale:{x:1,y:1},tileRotation:0,applyAnchorToTexture:!1};let Rt=De;class Mt{execute(e,t){const r=e.renderer,i=r.canvasContext.activeContext,s=t.particleChildren,n=t.texture;i.save(),r.canvasContext.setContextTransform(t.worldTransform,t.roundPixels),r.canvasContext.setBlendMode(t.groupBlendMode);const a=t.groupColorAlpha,o=r.filter?.alphaMultiplier??1,c=(a>>>24&255)/255*o;for(let u=0;u<s.length;u++){const h=s[u],f=h.texture||n;if(!f?.source?.resource)continue;const d=h.color,p=(d>>>24&255)/255*c;if(p<=0)continue;const m=d&16777215,g=((m&255)<<16)+(m&65280)+(m>>16&255);let w=f.source.resource;g!==16777215&&(w=Ae.getTintedCanvas({texture:f},g));const x=f.frame,b=f.source.resolution,S=x.x*b,L=x.y*b,G=x.width*b,A=x.height*b;i.globalAlpha=p;const O=-h.anchorX*x.width,y=-h.anchorY*x.height;h.rotation!==0||h.scaleX!==1||h.scaleY!==1?(i.save(),i.translate(h.x,h.y),i.rotate(h.rotation),i.scale(h.scaleX,h.scaleY),i.drawImage(w,S,L,G,A,O,y,x.width,x.height),i.restore()):i.drawImage(w,S,L,G,A,h.x+O,h.y+y,x.width,x.height)}i.restore()}}function ge(l,e=null){const t=l*6;if(t>65535?e||(e=new Uint32Array(t)):e||(e=new Uint16Array(t)),e.length!==t)throw new Error(`Out buffer length is incorrect, got ${e.length} and expected ${t}`);for(let r=0,i=0;r<t;r+=6,i+=4)e[r+0]=i+0,e[r+1]=i+1,e[r+2]=i+2,e[r+3]=i+0,e[r+4]=i+2,e[r+5]=i+3;return e}function Bt(l){return{dynamicUpdate:xe(l,!0),staticUpdate:xe(l,!1)}}function xe(l,e){const t=[];t.push(`

        var index = 0;

        for (let i = 0; i < ps.length; ++i)
        {
            const p = ps[i];

            `);let r=0;for(const s in l){const n=l[s];if(e!==n.dynamic)continue;t.push(`offset = index + ${r}`),t.push(n.code);const a=se(n.format);r+=a.stride/4}t.push(`
            index += stride * 4;
        }
    `),t.unshift(`
        var stride = ${r};
        var offset = 0, w0 = 0, w1 = 0, h0 = 0, h1 = 0;
    `);const i=t.join(`
`);return new Function("ps","f32v","u32v",i)}class Ft{constructor(e){this._size=0,this._generateParticleUpdateCache={};const t=this._size=e.size??1e3,r=e.properties;let i=0,s=0;for(const u in r){const h=r[u],f=se(h.format);h.dynamic?s+=f.stride:i+=f.stride}this._dynamicStride=s/4,this._staticStride=i/4,this.staticAttributeBuffer=new N(t*4*i),this.dynamicAttributeBuffer=new N(t*4*s),this.indexBuffer=ge(t);const n=new we;let a=0,o=0;this._staticBuffer=new k({data:new Float32Array(1),label:"static-particle-buffer",shrinkToFit:!1,usage:T.VERTEX|T.COPY_DST}),this._dynamicBuffer=new k({data:new Float32Array(1),label:"dynamic-particle-buffer",shrinkToFit:!1,usage:T.VERTEX|T.COPY_DST});for(const u in r){const h=r[u],f=se(h.format);h.dynamic?(n.addAttribute(h.attributeName,{buffer:this._dynamicBuffer,stride:this._dynamicStride*4,offset:a*4,format:h.format}),a+=f.size):(n.addAttribute(h.attributeName,{buffer:this._staticBuffer,stride:this._staticStride*4,offset:o*4,format:h.format}),o+=f.size)}n.addIndex(this.indexBuffer);const c=this.getParticleUpdate(r);this._dynamicUpload=c.dynamicUpdate,this._staticUpload=c.staticUpdate,this.geometry=n}getParticleUpdate(e){const t=Et(e);return this._generateParticleUpdateCache[t]?this._generateParticleUpdateCache[t]:(this._generateParticleUpdateCache[t]=this.generateParticleUpdate(e),this._generateParticleUpdateCache[t])}generateParticleUpdate(e){return Bt(e)}update(e,t){e.length>this._size&&(t=!0,this._size=Math.max(e.length,this._size*1.5|0),this.staticAttributeBuffer=new N(this._size*this._staticStride*4*4),this.dynamicAttributeBuffer=new N(this._size*this._dynamicStride*4*4),this.indexBuffer=ge(this._size),this.geometry.indexBuffer.setDataWithSize(this.indexBuffer,this.indexBuffer.byteLength,!0));const r=this.dynamicAttributeBuffer;if(this._dynamicUpload(e,r.float32View,r.uint32View),this._dynamicBuffer.setDataWithSize(this.dynamicAttributeBuffer.float32View,e.length*this._dynamicStride*4,!0),t){const i=this.staticAttributeBuffer;this._staticUpload(e,i.float32View,i.uint32View),this._staticBuffer.setDataWithSize(i.float32View,e.length*this._staticStride*4,!0)}}destroy(){this._staticBuffer.destroy(),this._dynamicBuffer.destroy(),this.geometry.destroy()}}function Et(l){const e=[];for(const t in l){const r=l[t];e.push(t,r.code,r.dynamic?"d":"s")}return e.join("_")}var It=`varying vec2 vUV;
varying vec4 vColor;

uniform sampler2D uTexture;

void main(void){
    vec4 color = texture2D(uTexture, vUV) * vColor;
    gl_FragColor = color;
}`,Vt=`attribute vec2 aVertex;
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
`,ye=`
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
}`;class kt extends _e{constructor(){const e=j.from({vertex:Vt,fragment:It}),t=K.from({fragment:{source:ye,entryPoint:"mainFragment"},vertex:{source:ye,entryPoint:"mainVertex"}});super({glProgram:e,gpuProgram:t,resources:{uTexture:P.WHITE.source,uSampler:new tt({}),uniforms:{uTranslationMatrix:{value:new U,type:"mat3x3<f32>"},uColor:{value:new Pe(16777215),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}}})}}class Q{constructor(e,t){this.state=ie.for2d(),this.localUniforms=new re({uTranslationMatrix:{value:new U,type:"mat3x3<f32>"},uColor:{value:new Float32Array(4),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}),this.renderer=e,this.adaptor=t,this.defaultShader=new kt,this.state=ie.for2d(),this._managedContainers=new Se({renderer:e,type:"renderable",name:"particleContainer"})}validateRenderable(e){return!1}addRenderable(e,t){this.renderer.renderPipes.batch.break(t),t.add(e)}getBuffers(e){return e._gpuData[this.renderer.uid]||this._initBuffer(e)}_initBuffer(e){return e._gpuData[this.renderer.uid]=new Ft({size:e.particleChildren.length,properties:e._properties}),this._managedContainers.add(e),e._gpuData[this.renderer.uid]}updateRenderable(e){}execute(e){const t=e.particleChildren;if(t.length===0)return;const r=this.renderer,i=this.getBuffers(e);e.texture||(e.texture=t[0].texture);const s=this.state;i.update(t,e._childrenDirty),e._childrenDirty=!1,s.blendMode=Ue(e.groupBlendMode,e.texture._source);const n=this.localUniforms.uniforms,a=n.uTranslationMatrix;e.worldTransform.copyTo(a);const o=r.globalUniforms.globalUniformData;a.tx-=o.offset.x,a.ty-=o.offset.y,a.prepend(o.projectionMatrix),n.uResolution=o.resolution,n.uRound=r._roundPixels|e._roundPixels;const c=e.groupColorAlpha,u=o.worldColor,h=(c>>>24)*(u>>>24)/255|0,f=be(c&16777215,u&16777215);ze((h<<24|f)>>>0,n.uColor,0),this.adaptor.execute(this,e)}destroy(){this._managedContainers.destroy(),this.renderer=null,this.defaultShader&&(this.defaultShader.destroy(),this.defaultShader=null)}}Q.extension={type:[v.CanvasPipes],name:"particle"};class Le extends Q{constructor(e){super(e,new Mt)}}Le.extension={type:[v.CanvasPipes],name:"particle"};class Dt{execute(e,t){const r=e.state,i=e.renderer,s=t.shader||e.defaultShader;s.resources.uTexture=t.texture._source,s.resources.uniforms=e.localUniforms;const n=i.gl,a=e.getBuffers(t);i.shader.bind(s),i.state.set(r),i.geometry.bind(a.geometry,s.glProgram);const c=a.geometry.indexBuffer.data.BYTES_PER_ELEMENT===2?n.UNSIGNED_SHORT:n.UNSIGNED_INT;n.drawElements(n.TRIANGLES,t.particleChildren.length*6,c,0)}}class Ge extends Q{constructor(e){super(e,new Dt)}}Ge.extension={type:[v.WebGLPipes],name:"particle"};class Lt{execute(e,t){const r=e.renderer,i=t.shader||e.defaultShader;i.groups[0]=r.renderPipes.uniformBatch.getUniformBindGroup(e.localUniforms,!0),i.groups[1]=r.texture.getTextureBindGroup(t.texture);const s=e.state,n=e.getBuffers(t);r.encoder.draw({geometry:n.geometry,shader:t.shader||e.defaultShader,state:s,size:t.particleChildren.length*6})}}class Ye extends Q{constructor(e){super(e,new Lt)}}Ye.extension={type:[v.WebGPUPipes],name:"particle"};const Ne=class oe{constructor(e){if(e instanceof P)this.texture=e,de(this,oe.defaultOptions,{});else{const t={...oe.defaultOptions,...e};de(this,t,{})}}get alpha(){return this._alpha}set alpha(e){this._alpha=Math.min(Math.max(e,0),1),this._updateColor()}get tint(){return te(this._tint)}set tint(e){this._tint=typeof e=="number"?te(e):Pe.shared.setValue(e??16777215).toBgrNumber(),this._updateColor()}_updateColor(){this.color=this._tint+((this._alpha*255|0)<<24)}};Ne.defaultOptions={anchorX:0,anchorY:0,x:0,y:0,scaleX:1,scaleY:1,rotation:0,tint:16777215,alpha:1};let Xe=Ne;const ve={vertex:{attributeName:"aVertex",format:"float32x2",code:`
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
        `,dynamic:!1}};C.add(Ge);C.add(Ye);C.add(Le);const Gt=new rt(0,0,0,0),Yt=48,qe=class ae extends Te{constructor(e={}){e={...ae.defaultOptions,...e,dynamicProperties:{...ae.defaultOptions.dynamicProperties,...e?.dynamicProperties}};const{dynamicProperties:t,shader:r,roundPixels:i,texture:s,particles:n,...a}=e;super({label:"ParticleContainer",...a}),this.renderPipeId="particle",this.batched=!1,this._childrenDirty=!1,this.texture=s||null,this.shader=r,this._properties={};for(const o in ve){const c=ve[o],u=t[o];this._properties[o]={...c,dynamic:u}}this.allowChildren=!0,this.roundPixels=i??!1,this.particleChildren=n??[]}addParticle(...e){for(let t=0;t<e.length;t++)this.particleChildren.push(e[t]);return this.onViewUpdate(),e[0]}removeParticle(...e){if(e.length>Yt)return this._removeParticlesInOnePass(e)&&this.onViewUpdate(),e[0];let t=!1;for(let r=0;r<e.length;r++){const i=this.particleChildren.indexOf(e[r]);i>-1&&(this.particleChildren.splice(i,1),t=!0)}return t&&this.onViewUpdate(),e[0]}_removeParticlesInOnePass(e){const t=new Map;for(let n=0;n<e.length;n++){const a=e[n];t.set(a,(t.get(a)??0)+1)}const r=this.particleChildren,i=r.length;let s=0;for(let n=0;n<i;n++){const a=r[n],o=t.get(a);o?t.set(a,o-1):r[s++]=a}return r.length=s,s!==i}update(){this._childrenDirty=!0}onViewUpdate(){this._childrenDirty=!0,super.onViewUpdate()}get bounds(){return Gt}updateBounds(){}destroy(e=!1){if(super.destroy(e),typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource,i=this.texture??this.particleChildren[0]?.texture;i&&i.destroy(r)}this.texture=null,this.shader?.destroy()}removeParticles(e,t){e??(e=0),t??(t=this.particleChildren.length);const r=this.particleChildren.splice(e,t-e);return this.onViewUpdate(),r}removeParticleAt(e){const t=this.particleChildren.splice(e,1);return this.onViewUpdate(),t[0]}addParticleAt(e,t){return this.particleChildren.splice(t,0,e),this.onViewUpdate(),e}addChild(...e){throw new Error("ParticleContainer.addChild() is not available. Please use ParticleContainer.addParticle()")}removeChild(...e){throw new Error("ParticleContainer.removeChild() is not available. Please use ParticleContainer.removeParticle()")}removeChildren(e,t){throw new Error("ParticleContainer.removeChildren() is not available. Please use ParticleContainer.removeParticles()")}removeChildAt(e){throw new Error("ParticleContainer.removeChildAt() is not available. Please use ParticleContainer.removeParticleAt()")}getChildAt(e){throw new Error("ParticleContainer.getChildAt() is not available. Please use ParticleContainer.getParticleAt()")}setChildIndex(e,t){throw new Error("ParticleContainer.setChildIndex() is not available. Please use ParticleContainer.setParticleIndex()")}getChildIndex(e){throw new Error("ParticleContainer.getChildIndex() is not available. Please use ParticleContainer.getParticleIndex()")}addChildAt(e,t){throw new Error("ParticleContainer.addChildAt() is not available. Please use ParticleContainer.addParticleAt()")}swapChildren(e,t){throw new Error("ParticleContainer.swapChildren() is not available. Please use ParticleContainer.swapParticles()")}reparentChild(...e){throw new Error("ParticleContainer.reparentChild() is not available with the particle container")}reparentChildAt(e,t){throw new Error("ParticleContainer.reparentChildAt() is not available with the particle container")}};qe.defaultOptions={dynamicProperties:{vertex:!1,position:!0,rotation:!1,uvs:!1,color:!1},roundPixels:!1};let le=qe;C.add(gt,xt);class Nt{constructor(e=1024){if(!Number.isInteger(e)||e<8)throw new RangeError("Atlas size must be an integer of at least 8 pixels");this.size=e,this.canvas=document.createElement("canvas"),this.canvas.width=this.canvas.height=e,this.ctx=this.canvas.getContext("2d"),this.x=this.y=2,this.rowHeight=0,this.frames=new Map,this.textures=new Map,this.source=null}register(e,t,r,i,{makeWhite:s=!0}={}){if(typeof e!="string"||!e||!Number.isInteger(t)||!Number.isInteger(r)||t<=0||r<=0||typeof i!="function")throw new TypeError("Atlas frames require a name, positive integer dimensions and a draw function");if(this.frames.has(e+"_white"))throw new Error("Invalid or duplicate atlas frame: "+e);this.checkCapacity([{name:e,width:t,height:r},...s?[{name:e+"_white",width:t,height:r}]:[]]);const n=document.createElement("canvas");n.width=t,n.height=r;const a=n.getContext("2d");i(a,t,r),this.pack(e,n),s&&(a.globalCompositeOperation="source-in",a.fillStyle="#ffffff",a.fillRect(0,0,t,r),this.pack(e+"_white",n))}checkCapacity(e){if(this.source)throw new Error("Cannot add frames to a built atlas");let t=this.x,r=this.y,i=this.rowHeight;const s=new Set;for(const{name:n,width:a,height:o}of e){if(typeof n!="string"||!n||s.has(n)||this.frames.has(n))throw new Error("Invalid or duplicate atlas frame: "+n);if(!Number.isInteger(a)||!Number.isInteger(o)||a<=0||o<=0)throw new RangeError("Atlas dimensions must be positive integers");if(s.add(n),a+4>this.size||o+4>this.size)throw new RangeError("Atlas frame too large: "+n);if(t+a+2>this.size&&(t=2,r+=i+4,i=0),r+o+2>this.size)throw new RangeError("Procedural atlas is full");t+=a+4,i=Math.max(i,o)}}registerImage(e,t,{width:r=t?.width,height:i=t?.height,makeWhite:s=!0}={}){if(!(t?.width>0&&t?.height>0))throw new TypeError("Atlas image must be decoded and have positive dimensions: "+e);this.register(e,r,i,(n,a,o)=>{const c=Math.min(a/t.width,o/t.height),u=t.width*c,h=t.height*c;n.drawImage(t,(a-u)/2,(o-h)/2,u,h)},{makeWhite:s})}registerSheet(e,t,{width:r,height:i,makeWhite:s=!0}={}){const n=t?.image;if(typeof e!="string"||!e||!n||!(n.width>0&&n.height>0)||!Number.isSafeInteger(t.length)||t.length<1||typeof t.frame!="function")throw new TypeError("registerSheet requires a name and a decoded HGame SpriteSheet");const a=[],o=[];for(let c=0;c<t.length;c++){const u=t.frame(c),h=`${e}/${c}`;if(![u?.x,u?.y,u?.width,u?.height].every(Number.isFinite)||u.x<0||u.y<0||u.width<=0||u.height<=0||u.x+u.width>n.width||u.y+u.height>n.height)throw new RangeError("SpriteSheet frame is outside the image: "+h);const f=r??u.width,d=i??u.height;if(this.frames.has(h+"_white"))throw new Error("Invalid or duplicate atlas frame: "+h);a.push({name:h,rect:u,width:f,height:d}),o.push({name:h,width:f,height:d}),s&&o.push({name:h+"_white",width:f,height:d})}this.checkCapacity(o);for(const c of a){const u=c.rect;this.register(c.name,c.width,c.height,(h,f,d)=>{h.drawImage(n,u.x,u.y,u.width,u.height,0,0,f,d)},{makeWhite:s})}return a.map(c=>c.name)}pack(e,t){const{width:r,height:i}=t;if(r+4>this.size||i+4>this.size)throw new RangeError("Atlas frame too large: "+e);if(this.x+r+2>this.size&&(this.x=2,this.y+=this.rowHeight+4,this.rowHeight=0),this.y+i+2>this.size)throw new RangeError("Procedural atlas is full");this.ctx.drawImage(t,this.x,this.y),this.frames.set(e,new it(this.x,this.y,r,i)),this.x+=r+4,this.rowHeight=Math.max(this.rowHeight,i)}build(){if(this.source)return this;this.source=new st({resource:this.canvas,scaleMode:"linear"});for(const[e,t]of this.frames)this.textures.set(e,new P({source:this.source,frame:t}));return this}get(e){return this.textures.get(e)??P.WHITE}dispose(){for(const e of this.textures.values())e.destroy();this.textures.clear(),this.source?.destroy(),this.source=null}}function dr({playerImage:l=null,enemyImage:e=null,eliteImage:t=e,extraFrames:r=[],size:i=1024}={}){const s=new Nt(i),n=(o,c=.4)=>(u,h,f)=>{u.fillStyle=o,u.beginPath(),u.arc(h/2,f/2,Math.min(h,f)*c,0,Math.PI*2),u.fill()},a=o=>(c,u,h)=>{if(!(o?.width>0&&o?.height>0))throw new TypeError("Character image must be decoded and have positive dimensions");const f=Math.min(u/o.width,h/o.height),d=o.width*f,p=o.height*f;c.drawImage(o,(u-d)/2,(h-p)/2,d,p)};s.register("player_hero",64,64,l?a(l):n("#53eccc")),s.register("enemy_chaser",40,40,e?a(e):n("#fa536e")),s.register("enemy_elite",56,56,t?a(t):n("#ffad53")),s.register("bullet_orb",20,20,n("#92faff")),s.register("particle_soft",20,20,(o,c,u)=>{const h=o.createRadialGradient(c/2,u/2,0,c/2,u/2,c/2);h.addColorStop(0,"#fff"),h.addColorStop(1,"#ffffff00"),o.fillStyle=h,o.fillRect(0,0,c,u)}),s.register("particle_spark",12,12,(o,c,u)=>{o.fillStyle="#fff",o.beginPath(),o.moveTo(c/2,0),o.lineTo(c,u/2),o.lineTo(c/2,u),o.lineTo(0,u/2),o.closePath(),o.fill()}),s.register("slash_trail",128,16,(o,c,u)=>{const h=o.createLinearGradient(0,0,c,0);h.addColorStop(0,"#ffffff00"),h.addColorStop(1,"#ffffffff"),o.fillStyle=h,o.fillRect(0,0,c,u)}),s.register("shadow_oval",48,20,(o,c,u)=>{o.fillStyle="#0008",o.beginPath(),o.ellipse(c/2,u/2,c/2,u/2,0,0,Math.PI*2),o.fill()},{makeWhite:!1}),s.register("ground_grid",128,128,(o,c,u)=>{o.fillStyle="#101b2a",o.fillRect(0,0,c,u),o.strokeStyle="#244256",o.lineWidth=1,o.strokeRect(.5,.5,c-1,u-1)},{makeWhite:!1});for(const o of r)typeof o.sheet=="function"?s.registerSheet(o.name,o.sheet(o.image),o):s.registerImage(o.name,o.image,o);return s.build()}var he=`in vec2 aPosition;
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
`,ce=`struct GlobalFilterUniforms {
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
}`,Xt=`
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
}`,qt=`struct KawaseBlurUniforms {
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
}`,Wt=`
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
`,$t=`struct KawaseBlurUniforms {
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
}`,Ht=Object.defineProperty,jt=(l,e,t)=>e in l?Ht(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,R=(l,e,t)=>(jt(l,typeof e!="symbol"?e+"":e,t),t);const We=class $e extends ue{constructor(...e){let t=e[0]??{};(typeof t=="number"||Array.isArray(t))&&(B("6.0.0","KawaseBlurFilter constructor params are now options object. See params: { strength, quality, clamp, pixelSize }"),t={strength:t},e[1]!==void 0&&(t.quality=e[1]),e[2]!==void 0&&(t.clamp=e[2])),t={...$e.DEFAULT_OPTIONS,...t};const r=K.from({vertex:{source:ce,entryPoint:"mainVertex"},fragment:{source:t?.clamp?$t:qt,entryPoint:"mainFragment"}}),i=j.from({vertex:he,fragment:t?.clamp?Wt:Xt,name:"kawase-blur-filter"});super({gpuProgram:r,glProgram:i,resources:{kawaseBlurUniforms:{uOffset:{value:new Float32Array(2),type:"vec2<f32>"}}}}),R(this,"uniforms"),R(this,"_pixelSize",{x:0,y:0}),R(this,"_clamp"),R(this,"_kernels",[]),R(this,"_blur"),R(this,"_quality"),this.uniforms=this.resources.kawaseBlurUniforms.uniforms,this.pixelSize=t.pixelSize??{x:1,y:1},Array.isArray(t.strength)?this.kernels=t.strength:typeof t.strength=="number"&&(this._blur=t.strength,this.quality=t.quality??3),this._clamp=!!t.clamp}apply(e,t,r,i){const s=this.pixelSizeX/t.source.width,n=this.pixelSizeY/t.source.height;let a;if(this._quality===1||this._blur===0)a=this._kernels[0]+.5,this.uniforms.uOffset[0]=a*s,this.uniforms.uOffset[1]=a*n,e.applyFilter(this,t,r,i);else{const o=E.getSameSizeTexture(t);let c=t,u=o,h;const f=this._quality-1;for(let d=0;d<f;d++)a=this._kernels[d]+.5,this.uniforms.uOffset[0]=a*s,this.uniforms.uOffset[1]=a*n,e.applyFilter(this,c,u,!0),h=c,c=u,u=h;a=this._kernels[f]+.5,this.uniforms.uOffset[0]=a*s,this.uniforms.uOffset[1]=a*n,e.applyFilter(this,c,r,i),E.returnTexture(o)}}get strength(){return this._blur}set strength(e){this._blur=e,this._generateKernels()}get quality(){return this._quality}set quality(e){this._quality=Math.max(1,Math.round(e)),this._generateKernels()}get kernels(){return this._kernels}set kernels(e){Array.isArray(e)&&e.length>0?(this._kernels=e,this._quality=e.length,this._blur=Math.max(...e)):(this._kernels=[0],this._quality=1)}get pixelSize(){return this._pixelSize}set pixelSize(e){if(typeof e=="number"){this.pixelSizeX=this.pixelSizeY=e;return}if(Array.isArray(e)){this.pixelSizeX=e[0],this.pixelSizeY=e[1];return}this._pixelSize=e}get pixelSizeX(){return this.pixelSize.x}set pixelSizeX(e){this.pixelSize.x=e}get pixelSizeY(){return this.pixelSize.y}set pixelSizeY(e){this.pixelSize.y=e}get clamp(){return this._clamp}_updatePadding(){this.padding=Math.ceil(this._kernels.reduce((e,t)=>e+t+.5,0))}_generateKernels(){const e=this._blur,t=this._quality,r=[e];if(e>0){let i=e;const s=e/t;for(let n=1;n<t;n++)i-=s,r.push(i)}this._kernels=r,this._updatePadding()}};R(We,"DEFAULT_OPTIONS",{strength:4,quality:3,clamp:!1,pixelSize:{x:1,y:1}});let Kt=We;var Qt=`in vec2 vTextureCoord;
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
`,Jt=`struct AdvancedBloomUniforms {
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
`,Zt=`
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
`,er=`struct ExtractBrightnessUniforms {
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
`,tr=Object.defineProperty,rr=(l,e,t)=>e in l?tr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,He=(l,e,t)=>(rr(l,typeof e!="symbol"?e+"":e,t),t);const je=class Ke extends ue{constructor(e){e={...Ke.DEFAULT_OPTIONS,...e};const t=K.from({vertex:{source:ce,entryPoint:"mainVertex"},fragment:{source:er,entryPoint:"mainFragment"}}),r=j.from({vertex:he,fragment:Zt,name:"extract-brightness-filter"});super({gpuProgram:t,glProgram:r,resources:{extractBrightnessUniforms:{uThreshold:{value:e.threshold,type:"f32"}}}}),He(this,"uniforms"),this.uniforms=this.resources.extractBrightnessUniforms.uniforms}get threshold(){return this.uniforms.uThreshold}set threshold(e){this.uniforms.uThreshold=e}};He(je,"DEFAULT_OPTIONS",{threshold:.5});let ir=je;var sr=Object.defineProperty,nr=(l,e,t)=>e in l?sr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,F=(l,e,t)=>(nr(l,typeof e!="symbol"?e+"":e,t),t);const Qe=class Je extends ue{constructor(e){e={...Je.DEFAULT_OPTIONS,...e};const t=K.from({vertex:{source:ce,entryPoint:"mainVertex"},fragment:{source:Jt,entryPoint:"mainFragment"}}),r=j.from({vertex:he,fragment:Qt,name:"advanced-bloom-filter"});super({gpuProgram:t,glProgram:r,resources:{advancedBloomUniforms:{uBloomScale:{value:e.bloomScale,type:"f32"},uBrightness:{value:e.brightness,type:"f32"}},uMapTexture:P.WHITE}}),F(this,"uniforms"),F(this,"bloomScale",1),F(this,"brightness",1),F(this,"_extractFilter"),F(this,"_blurFilter"),this.uniforms=this.resources.advancedBloomUniforms.uniforms,this._extractFilter=new ir({threshold:e.threshold}),this._blurFilter=new Kt({strength:e.kernels??e.blur,quality:e.kernels?void 0:e.quality}),Object.assign(this,e)}apply(e,t,r,i){const s=E.getSameSizeTexture(t);this._extractFilter.apply(e,t,s,!0);const n=E.getSameSizeTexture(t);this._blurFilter.apply(e,s,n,!0),this.uniforms.uBloomScale=this.bloomScale,this.uniforms.uBrightness=this.brightness,this.resources.uMapTexture=n.source,e.applyFilter(this,t,r,i),E.returnTexture(n),E.returnTexture(s)}get threshold(){return this._extractFilter.threshold}set threshold(e){this._extractFilter.threshold=e}get kernels(){return this._blurFilter.kernels}set kernels(e){this._blurFilter.kernels=e}get blur(){return this._blurFilter.strength}set blur(e){this._blurFilter.strength=e}get quality(){return this._blurFilter.quality}set quality(e){this._blurFilter.quality=e}get pixelSize(){return this._blurFilter.pixelSize}set pixelSize(e){typeof e=="number"&&(e={x:e,y:e}),Array.isArray(e)&&(e={x:e[0],y:e[1]}),this._blurFilter.pixelSize=e}get pixelSizeX(){return this._blurFilter.pixelSizeX}set pixelSizeX(e){this._blurFilter.pixelSizeX=e}get pixelSizeY(){return this._blurFilter.pixelSizeY}set pixelSizeY(e){this._blurFilter.pixelSizeY=e}};F(Qe,"DEFAULT_OPTIONS",{threshold:.5,bloomScale:1,brightness:1,blur:8,quality:4,pixelSize:{x:1,y:1}});let or=Qe;class ar{constructor(e,{textures:t=["enemy_chaser"],scale:r=1,worldScale:i=1,offsetX:s=0,offsetY:n=0,syncRotation:a=!1,flipByDirection:o=!1,cull:c=!0}={}){if(!e?.worldRoot||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a swarm layer");if(!Array.isArray(t)||t.length===0||t.some(u=>typeof u!="string"||!e.atlas.textures.has(u)))throw new TypeError("Swarm textures must be existing atlas frame names");if(![r,i,s,n].every(Number.isFinite)||r<=0||i<=0)throw new RangeError("Swarm scale and worldScale must be positive and offsets must be finite");this.renderer=e,this.scale=r,this.worldScale=i,this.offsetX=s,this.offsetY=n,this.syncRotation=!!a,this.flipByDirection=!!o,this.cull=!!c,this.frames=t.map(u=>{const h=e.atlas.textures.get(u);return{texture:h,white:e.atlas.textures.get(u+"_white")??h,radius:Math.hypot(h.orig.width,h.orig.height)*.5}}),this.layer=new le({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),e.worldRoot.addChildAt(this.layer,e.worldRoot.getChildIndex(e.entityLayer)),this.particles=[],this.pool=[],this.pendingParticles=[],this.visibleCount=0,this.disposed=!1}sync(e){if(this.disposed)throw new Error("Swarm layer is disposed");if(!e?.activeIds||!e.posX||!e.posY||!Number.isInteger(e.count))throw new TypeError("sync requires an HGame CPU SwarmSimulation");const t=e.count;if(t<0||t>e.activeIds.length)throw new RangeError("Swarm count exceeds active ID capacity");const r=this.renderer.camera,i=this.renderer.app.screen,s=i.width/2,n=i.height/2,a=r.zoom;if(!(a>0)||!Number.isFinite(a))throw new RangeError("Camera zoom must be finite and positive");let o=0;for(let c=0;c<t;c++){const u=e.activeIds[c],h=e.posX[u]*this.worldScale+this.offsetX,f=e.posY[u]*this.worldScale+this.offsetY,d=this.frames[(e.animClip?.[u]??0)%this.frames.length],p=(e.scale?.[u]??1)*this.scale;if(this.cull){const x=(h-r.x)*a+s+r.shakeX,b=(f-r.y)*a+n+r.shakeY,S=d.radius*Math.abs(p)*a;if(x+S<0||x-S>i.width||b+S<0||b-S>i.height)continue}let m=this.particles[o];const g=e.flash?.[u]>0?d.white:d.texture;m||(m=this.pool.pop()??new Xe({texture:g,anchorX:.5,anchorY:.5}),this.particles.push(m),this.pendingParticles.push(m),this.pendingParticles.length===4096&&this.flushPending()),m.texture!==g&&(m.texture=g),m.x=h,m.y=f;const w=e.rot?.[u]??0;m.rotation=this.syncRotation?w:0,m.scaleX=this.flipByDirection&&Math.sin(w)<0?-p:p,m.scaleY=p,o++}if(this.flushPending(),o<this.particles.length){const c=this.layer.removeParticles(o);this.particles.length=o;for(const u of c)this.pool.push(u)}return this.visibleCount=o,o}flushPending(){this.pendingParticles.length&&this.layer.addParticle(...this.pendingParticles),this.pendingParticles.length=0}dispose(){this.disposed||(this.disposed=!0,this.layer.removeFromParent(),this.layer.destroy(),this.particles.length=0,this.pool.length=0,this.pendingParticles.length=0,this.visibleCount=0,this.renderer.swarmLayers.delete(this))}}class pr{constructor(e,{maxPixels:t=23e5,maxPixelRatio:r=2}={}){if(!Number.isFinite(t)||t<1||!Number.isFinite(r)||r<=0)throw new RangeError("Renderer pixel budget and maximum pixel ratio must be positive");this.atlas=e,this.maxPixels=t,this.maxPixelRatio=r,this.app=new Be,this.entityMap=new Map,this.spritePool=[],this.swarmLayers=new Set,this.camera={x:0,y:0,targetX:0,targetY:0,zoom:1,shakeX:0,shakeY:0}}async init(e){this.mount=e;const{width:t,height:r,resolution:i}=this.planViewport();await this.app.init({preference:"webgpu",width:t,height:r,resolution:i,autoDensity:!0,backgroundColor:725019,autoStart:!1}),this.app.ticker.stop(),this.app.canvas.id="game",this.app.canvas.setAttribute("aria-label","游戏画面"),e.appendChild(this.app.canvas),this.worldRoot=new M,this.worldRoot.eventMode="none",this.worldRoot.interactiveChildren=!1,this.bgLayer=new M;const s=new Rt({texture:this.atlas.get("ground_grid"),width:4096,height:4096});s.position.set(-2048,-2048),this.bgLayer.addChild(s),this.shadowLayer=new M,this.entityLayer=new M({sortableChildren:!0}),this.enemyLayer=new le({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),this.enemyParticles=[],this.enemyPool=[],this.pendingEnemies=[],this.trailLayer=new M,this.particleLayer=new le({dynamicProperties:{position:!0,vertex:!0,rotation:!0,color:!0,uvs:!0}}),this.worldRoot.addChild(this.bgLayer,this.shadowLayer,this.enemyLayer,this.entityLayer,this.trailLayer,this.particleLayer),this.app.stage.addChild(this.worldRoot),this.bloom=new or({threshold:.62,bloomScale:.4,brightness:1,blur:3}),this.app.stage.filters=[],this.viewport={width:t,height:r,resolution:i},typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(e))}planViewport(){const e=Math.max(1,Math.floor(this.mount?.clientWidth||1)),t=Math.max(1,Math.floor(this.mount?.clientHeight||1)),r=Number(globalThis.devicePixelRatio)||1,i=Math.max(1/Math.min(e,t),Math.min(r,this.maxPixelRatio,Math.sqrt(this.maxPixels/(e*t))));return{width:e,height:t,resolution:i}}resize(){if(this.disposed||!this.app.renderer)return!1;const e=this.planViewport(),t=this.viewport;return t&&t.width===e.width&&t.height===e.height&&t.resolution===e.resolution?!1:(this.app.renderer.resize(e.width,e.height,e.resolution),this.viewport=e,this.onResize?.(),!0)}createSwarmLayer(e){const t=new ar(this,e);return this.swarmLayers.add(t),t}syncEnemies(e,t){if(this.enemyParticles.length>e.length){const r=this.enemyLayer.removeParticles(e.length);this.enemyParticles.length=e.length;for(const i of r)this.enemyPool.push(i)}for(let r=0;r<e.length;r++){const i=e[r];let s=this.enemyParticles[r];const n=(i.elite?"enemy_elite":"enemy_chaser")+(i.flash>0?"_white":"");s||(s=this.enemyPool.pop()??new Xe({texture:this.atlas.get(n),anchorX:.5,anchorY:.5}),this.enemyParticles.push(s),this.pendingEnemies.push(s),this.pendingEnemies.length===4096&&this.flushEnemies()),s.texture=this.atlas.get(n),s.x=i.x,s.y=i.y;const a=t*7+i.id*.37;s.rotation=Math.sin(a)*.09,s.scaleX=1+Math.sin(a*2)*.035,s.scaleY=1-Math.sin(a*2)*.05}this.flushEnemies()}flushEnemies(){this.pendingEnemies.length&&this.enemyLayer.addParticle(...this.pendingEnemies),this.pendingEnemies.length=0}alloc(e){const t=this.spritePool.pop()??new nt;return t.texture=this.atlas.get(e),t.anchor.set(.5),t.alpha=1,t.tint=16777215,t.scale.set(1),t.rotation=0,t.visible=!0,t}syncEntity(e,t){let r=this.entityMap.get(e);r||(r={sprite:this.alloc(t.tex),shadow:this.alloc("shadow_oval"),flashTimer:0,animScaleX:1,animScaleY:1},this.entityMap.set(e,r),this.entityLayer.addChild(r.sprite),this.shadowLayer.addChild(r.shadow)),r.baseTex=t.tex;const i=r.sprite;return i.texture=this.atlas.get(r.flashTimer>0?t.tex+"_white":t.tex),i.position.set(t.x,t.y),i.rotation=t.rot??0,i.scale.set((t.scaleX??1)*r.animScaleX,(t.scaleY??1)*r.animScaleY),i.tint=r.flashTimer>0?16777215:t.tint??16777215,i.alpha=t.alpha??1,i.zIndex=t.zIndex??t.y,r.shadow.visible=t.hasShadow!==!1,r.shadow.position.set(t.x,t.y+18),r.shadow.alpha=.35,r}releaseEntity(e){const t=this.entityMap.get(e);t&&(t.sprite.removeFromParent(),t.shadow.removeFromParent(),this.spritePool.push(t.sprite,t.shadow),this.entityMap.delete(e))}update(e){const t=this.camera,r=1-Math.exp(-10*e);t.x+=(t.targetX-t.x)*r,t.y+=(t.targetY-t.y)*r,this.worldRoot.scale.set(t.zoom),this.worldRoot.position.set(this.app.screen.width/2-t.x*t.zoom+t.shakeX,this.app.screen.height/2-t.y*t.zoom+t.shakeY);for(const i of this.entityMap.values())i.flashTimer=Math.max(0,i.flashTimer-e)}screenToWorld(e,t){return{x:(e-this.app.screen.width/2-this.camera.shakeX)/this.camera.zoom+this.camera.x,y:(t-this.app.screen.height/2-this.camera.shakeY)/this.camera.zoom+this.camera.y}}worldToScreen(e,t){return{x:(e-this.camera.x)*this.camera.zoom+this.app.screen.width/2+this.camera.shakeX,y:(t-this.camera.y)*this.camera.zoom+this.app.screen.height/2+this.camera.shakeY}}render(){this.app.renderer.render(this.app.stage)}dispose(){if(!this.disposed){this.disposed=!0,this.resizeObserver?.disconnect(),this.resizeObserver=null,this.onResize=null;for(const e of this.swarmLayers)e.dispose();for(const e of this.spritePool)e.destroy();this.spritePool.length=0,this.enemyParticles.length=0,this.enemyPool.length=0,this.pendingEnemies.length=0,this.entityMap.clear(),this.app.stage.filters=[],this.bloom.destroy(),this.app.destroy({removeView:!0},{children:!0}),this.atlas.dispose()}}}function mr(l,{resetInput:e=()=>{},onVisibility:t=()=>{}}={}){let r=!1;function i(o){o?r&&(r=!1,l.running&&l.paused&&l.resume()):(e(),l.running&&!l.paused&&(r=l.pause())),t(o)}const s=l.platform.lifecycle,n=s.on("visibility",i),a=s.on("focus",o=>{o||e()});return{sync(){i(s.visible)},dispose(){n(),a(),r=!1}}}export{bt as B,Ie as M,Xe as P,pr as R,mr as b,dr as c,he as v,ce as w};
