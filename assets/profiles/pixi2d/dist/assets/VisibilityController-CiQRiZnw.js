const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./browserAll-Dknvu5GT.js","./Geometry-b4_yFV4e.js","./init-CWUIAUpk.js","./canvasUtils-DiiUq8Hs.js","./webworkerAll-vTjiTUhh.js","./CanvasPool-D2lhgJD8.js","./WebGPURenderer-uoQZUmwt.js","./colorToUniform-MIizxb8Q.js","./RenderTargetSystem-BDuLvLx3.js","./localUniformBit-BOGrcT1E.js","./getTextureBatchBindGroup-D2l3TxEN.js","./getTexelRangeRects-BjZFLgKe.js","./WebGLRenderer-Q9cycPvx.js","./CanvasRenderer-B56f80B8.js"])))=>i.map(i=>d[i]);
import{E as _,D as te,U as Ze,h as de,j as A,k as M,d as B,o as V,m as be,c as L,e as S,M as O,a6 as D,P as N,a7 as re,a8 as _e,Q as Te,l as ie,T as z,p as se,W as et,V as Pe,b as ne,t as K,s as Q,C as Ce,a9 as tt,aa as pe,y as rt,R as it,J as st,F as ue,_ as k,I as nt}from"./Geometry-b4_yFV4e.js";import{C as ot}from"./init-CWUIAUpk.js";import{A as Se,h as at,a as lt,b as ut,r as ht,d as ct,G as ze,c as Ae,g as Ue,V as Y}from"./colorToUniform-MIizxb8Q.js";import{c as Oe}from"./canvasUtils-DiiUq8Hs.js";import{a as ft,b as dt}from"./localUniformBit-BOGrcT1E.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))r(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const o of s.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&r(o)}).observe(document,{childList:!0,subtree:!0});function t(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function r(i){if(i.ep)return;i.ep=!0;const s=t(i);fetch(i.href,s)}})();const pt="modulepreload",mt=function(l,e){return new URL(l,e).href},me={},G=function(e,t,r){let i=Promise.resolve();if(t&&t.length>0){let o=function(u){return Promise.all(u.map(h=>Promise.resolve(h).then(f=>({status:"fulfilled",value:f}),f=>({status:"rejected",reason:f}))))};const n=document.getElementsByTagName("link"),a=document.querySelector("meta[property=csp-nonce]"),c=a?.nonce||a?.getAttribute("nonce");i=o(t.map(u=>{if(u=mt(u,r),u in me)return;me[u]=!0;const h=u.endsWith(".css"),f=h?'[rel="stylesheet"]':"";if(!!r)for(let m=n.length-1;m>=0;m--){const g=n[m];if(g.href===u&&(!h||g.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${u}"]${f}`))return;const p=document.createElement("link");if(p.rel=h?"stylesheet":pt,h||(p.as="script"),p.crossOrigin="",p.href=u,c&&p.setAttribute("nonce",c),document.head.appendChild(p),h)return new Promise((m,g)=>{p.addEventListener("load",m),p.addEventListener("error",()=>g(new Error(`Unable to preload CSS for ${u}`)))})}))}function s(o){const n=new Event("vite:preloadError",{cancelable:!0});if(n.payload=o,window.dispatchEvent(n),!n.defaultPrevented)throw o}return i.then(o=>{for(const n of o||[])n.status==="rejected"&&s(n.reason);return e().catch(s)})},gt={extension:{type:_.Environment,name:"browser",priority:-1},test:()=>!0,load:async()=>{await G(()=>import("./browserAll-Dknvu5GT.js"),__vite__mapDeps([0,1,2,3,4,5]),import.meta.url)}},xt={extension:{type:_.Environment,name:"webworker",priority:0},test:()=>typeof self<"u"&&self.WorkerGlobalScope!==void 0,load:async()=>{await G(()=>import("./webworkerAll-vTjiTUhh.js"),__vite__mapDeps([4,2,1,3,5]),import.meta.url)}};let X;function yt(l){return X!==void 0||(X=(()=>{const e={stencil:!0,failIfMajorPerformanceCaveat:l??Se.defaultOptions.failIfMajorPerformanceCaveat};try{if(!te.get().getWebGLRenderingContext())return!1;let r=te.get().createCanvas().getContext("webgl",e);const i=!!r?.getContextAttributes()?.stencil;if(r){const s=r.getExtension("WEBGL_lose_context");s&&s.loseContext()}return r=null,i}catch{return!1}})()),X}let q;async function vt(l={}){return q!==void 0||(q=await(async()=>{const e=te.get().getNavigator().gpu;if(!e)return!1;try{return await(await e.requestAdapter(l)).requestDevice(),!0}catch{return!1}})()),q}const ge=["webgl","webgpu","canvas"];async function wt(l){let e=[];l.preference?Array.isArray(l.preference)?e=l.preference.slice():(e.push(l.preference),ge.forEach(s=>{s!==l.preference&&e.push(s)})):e=ge.slice();let t,r={};for(let s=0;s<e.length;s++){const o=e[s];if(o==="webgpu"&&await vt()){const{WebGPURenderer:n}=await G(async()=>{const{WebGPURenderer:a}=await import("./WebGPURenderer-uoQZUmwt.js");return{WebGPURenderer:a}},__vite__mapDeps([6,1,7,8,5,9,10,11]),import.meta.url);t=n,r={...l,...l.webgpu};break}else if(o==="webgl"&&yt(l.failIfMajorPerformanceCaveat??Se.defaultOptions.failIfMajorPerformanceCaveat)){const{WebGLRenderer:n}=await G(async()=>{const{WebGLRenderer:a}=await import("./WebGLRenderer-Q9cycPvx.js");return{WebGLRenderer:a}},__vite__mapDeps([12,1,7,8,5,9,11]),import.meta.url);t=n,r={...l,...l.webgl};break}else if(o==="canvas"){const{CanvasRenderer:n}=await G(async()=>{const{CanvasRenderer:a}=await import("./CanvasRenderer-B56f80B8.js");return{CanvasRenderer:a}},__vite__mapDeps([13,1,8,7,5,3,10]),import.meta.url);t=n,r={...l,...l.canvasOptions};break}}if(delete r.webgpu,delete r.webgl,delete r.canvasOptions,!t)throw new Error("No available renderer for the current environment");const i=new t;return await i.init(r),i}class Fe{static init(e){Object.defineProperty(this,"resizeTo",{configurable:!0,set(t){globalThis.removeEventListener("resize",this.queueResize),this._resizeTo=t,t&&(globalThis.addEventListener("resize",this.queueResize),this.resize())},get(){return this._resizeTo}}),this.queueResize=()=>{this._resizeTo&&(this._cancelResize(),this._resizeId=requestAnimationFrame(()=>this.resize()))},this._cancelResize=()=>{this._resizeId&&(cancelAnimationFrame(this._resizeId),this._resizeId=null)},this.resize=()=>{if(!this._resizeTo)return;this._cancelResize();let t,r;if(this._resizeTo===globalThis.window)t=globalThis.innerWidth,r=globalThis.innerHeight;else{const{clientWidth:i,clientHeight:s}=this._resizeTo;t=i,r=s}this.renderer.resize(t,r),this.render()},this._resizeId=null,this._resizeTo=null,this.resizeTo=e.resizeTo||null}static destroy(){globalThis.removeEventListener("resize",this.queueResize),this._cancelResize(),this._cancelResize=null,this.queueResize=null,this.resizeTo=null,this.resize=null}}Fe.extension=_.Application;class Me{static init(e){e=Object.assign({autoStart:!0,sharedTicker:!1},e),Object.defineProperty(this,"ticker",{configurable:!0,set(t){this._ticker&&this._ticker.remove(this.render,this),this._ticker=t,t&&t.add(this.render,this,Ze.LOW)},get(){return this._ticker}}),this.stop=()=>{this._ticker.stop()},this.start=()=>{this._ticker.start()},this._ticker=null,this.ticker=e.sharedTicker?de.shared:new de,e.autoStart&&this.start()}static destroy(){if(this._ticker){const e=this._ticker;this.ticker=null,e.destroy()}}}Me.extension=_.Application;A.add(Fe);A.add(Me);const Ee=class oe{constructor(...e){this.stage=new M,e[0]!==void 0&&B(V,"Application constructor options are deprecated, please use Application.init() instead.")}async init(e){e={...e},this.stage||(this.stage=new M),this.renderer=await wt(e),oe._plugins.forEach(t=>{t.init.call(this,e)})}render(){this.renderer.render({container:this.stage})}get canvas(){return this.renderer.canvas}get view(){return B(V,"Application.view is deprecated, please use Application.canvas instead."),this.renderer.canvas}get screen(){return this.renderer.screen}get domContainerRoot(){return this.renderer.renderPipes.dom?._domElement}destroy(e=!1,t=!1){const r=oe._plugins.slice(0);r.reverse(),r.forEach(i=>{i.destroy.call(this)}),this.stage.destroy(t),this.stage=null,this.renderer.destroy(e),this.renderer=null}};Ee._plugins=[];let Re=Ee;A.handleByList(_.Application,Re._plugins);A.add(at);const Be=class Ie extends be{constructor(...e){let t=e[0]??{};t instanceof Float32Array&&(B(V,"use new MeshGeometry({ positions, uvs, indices }) instead"),t={positions:t,uvs:e[1],indices:e[2]}),t={...Ie.defaultOptions,...t};const r=t.positions||new Float32Array([0,0,1,0,1,1,0,1]);let i=t.uvs;i||(t.positions?i=new Float32Array(r.length):i=new Float32Array([0,0,1,0,1,1,0,1]));const s=t.indices||new Uint32Array([0,1,2,0,2,3]),o=t.shrinkBuffersToFit,n=new L({data:r,label:"attribute-mesh-positions",shrinkToFit:o,usage:S.VERTEX|S.COPY_DST}),a=new L({data:i,label:"attribute-mesh-uvs",shrinkToFit:o,usage:S.VERTEX|S.COPY_DST}),c=new L({data:s,label:"index-mesh-buffer",shrinkToFit:o,usage:S.INDEX|S.COPY_DST});super({attributes:{aPosition:{buffer:n,format:"float32x2",stride:8,offset:0},aUV:{buffer:a,format:"float32x2",stride:8,offset:0}},indexBuffer:c,topology:t.topology}),this.batchMode="auto"}get positions(){return this.attributes.aPosition.buffer.data}set positions(e){this.attributes.aPosition.buffer.data=e}get uvs(){return this.attributes.aUV.buffer.data}set uvs(e){this.attributes.aUV.buffer.data=e}get indices(){return this.indexBuffer.data}set indices(e){this.indexBuffer.data=e}};Be.defaultOptions={topology:"triangle-list",shrinkBuffersToFit:!1};let ke=Be;class bt{constructor(){this.batcherName="default",this.packAsQuad=!1,this.indexOffset=0,this.attributeOffset=0,this.roundPixels=0,this._batcher=null,this._batch=null,this._textureMatrixUpdateId=-1,this._uvUpdateId=-1}get blendMode(){return this.renderable.groupBlendMode}get topology(){return this._topology||this.geometry.topology}set topology(e){this._topology=e}reset(){this.renderable=null,this.texture=null,this._batcher=null,this._batch=null,this.geometry=null,this._uvUpdateId=-1,this._textureMatrixUpdateId=-1}setTexture(e){this.texture!==e&&(this.texture=e,this._textureMatrixUpdateId=-1)}get uvs(){const t=this.geometry.getBuffer("aUV"),r=t.data;let i=r;const s=this.texture.textureMatrix;return s.isSimple||(i=this._transformedUvs,(this._textureMatrixUpdateId!==s._updateID||this._uvUpdateId!==t._updateID)&&((!i||i.length<r.length)&&(i=this._transformedUvs=new Float32Array(r.length)),this._textureMatrixUpdateId=s._updateID,this._uvUpdateId=t._updateID,s.multiplyUvs(r,i))),i}get positions(){return this.geometry.positions}get indices(){return this.geometry.indices}get color(){return this.renderable.groupColorAlpha}get groupTransform(){return this.renderable.groupTransform}get attributeSize(){return this.geometry.positions.length/2}get indexSize(){return this.geometry.indices.length}}class _t{constructor({matrix:e,observer:t}={}){this.dirty=!0,this._matrix=e??new O,this.observer=t,this.position=new D(this,0,0),this.scale=new D(this,1,1),this.pivot=new D(this,0,0),this.skew=new D(this,0,0),this._rotation=0,this._cx=1,this._sx=0,this._cy=0,this._sy=1}get matrix(){const e=this._matrix;return this.dirty&&(e.a=this._cx*this.scale.x,e.b=this._sx*this.scale.x,e.c=this._cy*this.scale.y,e.d=this._sy*this.scale.y,e.tx=this.position.x-(this.pivot.x*e.a+this.pivot.y*e.c),e.ty=this.position.y-(this.pivot.x*e.b+this.pivot.y*e.d),this.dirty=!1),e}_onUpdate(e){this.dirty=!0,e===this.skew&&this.updateSkew(),this.observer?._onUpdate(this)}updateSkew(){this._cx=Math.cos(this._rotation+this.skew.y),this._sx=Math.sin(this._rotation+this.skew.y),this._cy=-Math.sin(this._rotation-this.skew.x),this._sy=Math.cos(this._rotation-this.skew.x),this.dirty=!0}toString(){return`[pixi.js/math:Transform position=(${this.position.x}, ${this.position.y}) rotation=${this.rotation} scale=(${this.scale.x}, ${this.scale.y}) skew=(${this.skew.x}, ${this.skew.y}) ]`}setFromMatrix(e){e.decompose(this),this.dirty=!0}get rotation(){return this._rotation}set rotation(e){this._rotation!==e&&(this._rotation=e,this._onUpdate(this.skew))}}const W=new O,U=new O,C=[new N,new N,new N,new N];class Ve{constructor(e){this._renderer=e}validateRenderable(e){return!1}addRenderable(e,t){this._renderer.renderPipes.batch.break(t),t.add(e)}updateRenderable(e){}execute(e){const t=this._renderer,r=t.canvasContext,i=r.activeContext;i.save(),r.setBlendMode(e.groupBlendMode);const s=t.globalUniforms.globalUniformData?.worldColor??4294967295,o=e.groupColorAlpha,n=(s>>>24&255)/255,a=(o>>>24&255)/255,c=t.filter?.alphaMultiplier??1,u=n*a*c;if(u<=0){i.restore();return}i.globalAlpha=u;const h=s&16777215,f=o&16777215,d=re(_e(f,h)),p=e.texture,m=Oe.getTintedPattern(p,d),g=e.width,y=e.height,x=e.groupTransform,T=p.source._resolution??p.source.resolution??1;U.copyFrom(e._tileTransform.matrix),e.applyAnchorToTexture||U.translate(-e.anchor.x*g,-e.anchor.y*y);const E=U.tx,v=U.ty;U.scale(1/T,1/T),U.tx=E,U.ty=v,W.identity(),W.prepend(U),W.prepend(x);const F=t._roundPixels|e._roundPixels;r.setContextTransform(W,F===1),i.fillStyle=m;const P=e.anchor.x*-g,w=e.anchor.y*-y;C[0].set(P,w),C[1].set(P+g,w),C[2].set(P+g,w+y),C[3].set(P,w+y);for(let b=0;b<4;b++)U.applyInverse(C[b],C[b]);i.beginPath(),i.moveTo(C[0].x,C[0].y);for(let b=1;b<4;b++)i.lineTo(C[b].x,C[b].y);i.closePath(),i.fill(),i.restore()}destroy(){this._renderer=null}}Ve.extension={type:[_.CanvasPipes],name:"tilingSprite"};const Tt={name:"tiling-bit",vertex:{header:`
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

        `}};let Z,ee;class Ct extends Te{constructor(){Z??(Z=lt({name:"tiling-sprite-shader",bits:[ft,Tt,ht]})),ee??(ee=ut({name:"tiling-sprite-shader",bits:[dt,Pt,ct]}));const e=new ie({uMapCoord:{value:new O,type:"mat3x3<f32>"},uClampFrame:{value:new Float32Array([0,0,1,1]),type:"vec4<f32>"},uClampOffset:{value:new Float32Array([0,0]),type:"vec2<f32>"},uTextureTransform:{value:new O,type:"mat3x3<f32>"},uSizeAnchor:{value:new Float32Array([100,100,.5,.5]),type:"vec4<f32>"}});super({glProgram:ee,gpuProgram:Z,resources:{localUniforms:new ie({uTransformMatrix:{value:new O,type:"mat3x3<f32>"},uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uRound:{value:0,type:"f32"}}),tilingUniforms:e,uTexture:z.EMPTY.source,uSampler:z.EMPTY.source.style}})}updateUniforms(e,t,r,i,s,o){const n=this.resources.tilingUniforms,a=o.width,c=o.height,u=o.textureMatrix,h=n.uniforms.uTextureTransform;h.set(r.a*a/e,r.b*a/t,r.c*c/e,r.d*c/t,r.tx/e,r.ty/t),h.invert(),n.uniforms.uMapCoord=u.mapCoord,n.uniforms.uClampFrame=u.uClampFrame,n.uniforms.uClampOffset=u.uClampOffset,n.uniforms.uTextureTransform=h,n.uniforms.uSizeAnchor[0]=e,n.uniforms.uSizeAnchor[1]=t,n.uniforms.uSizeAnchor[2]=i,n.uniforms.uSizeAnchor[3]=s,o&&(this.resources.uTexture=o.source,this.resources.uSampler=o.source.style)}}class St extends ke{constructor(){super({positions:new Float32Array([0,0,1,0,1,1,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])})}}function zt(l,e){const t=l.anchor.x,r=l.anchor.y;e[0]=-t*l.width,e[1]=-r*l.height,e[2]=(1-t)*l.width,e[3]=-r*l.height,e[4]=(1-t)*l.width,e[5]=(1-r)*l.height,e[6]=-t*l.width,e[7]=(1-r)*l.height}function At(l,e,t,r){let i=0;const s=l.length/e,o=r.a,n=r.b,a=r.c,c=r.d,u=r.tx,h=r.ty;for(t*=e;i<s;){const f=l[t],d=l[t+1];l[t]=o*f+a*d+u,l[t+1]=n*f+c*d+h,t+=e,i++}}function Ut(l,e){const t=l.texture,r=t.frame.width,i=t.frame.height;let s=0,o=0;l.applyAnchorToTexture&&(s=l.anchor.x,o=l.anchor.y),e[0]=e[6]=-s,e[2]=e[4]=1-s,e[1]=e[3]=-o,e[5]=e[7]=1-o;const n=l._tileTransform.matrix,a=O.shared;a.set(n.a*r/l.width,n.b*r/l.height,n.c*i/l.width,n.d*i/l.height,n.tx/l.width,n.ty/l.height),a.invert(),At(e,2,0,a)}const H=new St;class Ot{constructor(){this.canBatch=!0,this.geometry=new ke({indices:H.indices.slice(),positions:H.positions.slice(),uvs:H.uvs.slice()})}destroy(){this.geometry.destroy(),this.shader?.destroy()}}class De{constructor(e){this._state=se.default2d,this._renderer=e,this._managedTilingSprites=new ze({renderer:e,type:"renderable",name:"tilingSprite"})}validateRenderable(e){const t=this._getTilingSpriteData(e),r=t.canBatch;this._updateCanBatch(e);const i=t.canBatch;if(i&&i===r){const{batchableMesh:s}=t;return!s._batcher.checkAndUpdateTexture(s,e.texture)}return r!==i}addRenderable(e,t){const r=this._renderer.renderPipes.batch;this._updateCanBatch(e);const i=this._getTilingSpriteData(e),{geometry:s,canBatch:o}=i;if(o){i.batchableMesh||(i.batchableMesh=new bt);const n=i.batchableMesh;e.didViewUpdate&&(this._updateBatchableMesh(e),n.geometry=s,n.renderable=e,n.transform=e.groupTransform,n.setTexture(e._texture)),n.roundPixels=this._renderer._roundPixels|e._roundPixels,r.addToBatch(n,t)}else r.break(t),i.shader||(i.shader=new Ct),this.updateRenderable(e),t.add(e)}execute(e){const t=this._renderer,{shader:r}=this._getTilingSpriteData(e);r.groups[0]=t.globalUniforms.bindGroup;const i=r.resources.localUniforms.uniforms;i.uTransformMatrix=e.groupTransform,i.uRound=t._roundPixels|e._roundPixels,Ae(e.groupColorAlpha,i.uColor,0),this._state.blendMode=Ue(e.groupBlendMode,e.texture._source),t.encoder.draw({geometry:H,shader:r,state:this._state})}updateRenderable(e){const t=this._getTilingSpriteData(e),{canBatch:r}=t;if(r){const{batchableMesh:i}=t;e.didViewUpdate&&this._updateBatchableMesh(e),i._batcher.updateElement(i)}else if(e.didViewUpdate){const{shader:i}=t;i.updateUniforms(e.width,e.height,e._tileTransform.matrix,e.anchor.x,e.anchor.y,e.texture)}}_getTilingSpriteData(e){return e._gpuData[this._renderer.uid]||this._initTilingSpriteData(e)}_initTilingSpriteData(e){const t=new Ot;return t.renderable=e,e._gpuData[this._renderer.uid]=t,this._managedTilingSprites.add(e),t}_updateBatchableMesh(e){const t=this._getTilingSpriteData(e),{geometry:r}=t,i=e.texture.source.style;i.addressMode!=="repeat"&&(i.addressMode="repeat",i.update()),Ut(e,r.uvs),zt(e,r.positions)}destroy(){this._managedTilingSprites.destroy(),this._renderer=null}_updateCanBatch(e){const t=this._getTilingSpriteData(e),r=e.texture;let i=!0;return this._renderer.type===et.WEBGL&&(i=this._renderer.context.supports.nonPowOf2wrapping),t.canBatch=r.textureMatrix.isSimple&&(i||r.source.isPowerOfTwo),t.canBatch}}De.extension={type:[_.WebGLPipes,_.WebGPUPipes],name:"tilingSprite"};A.add(Ve);A.add(De);const Le=class $ extends Pe{constructor(...e){let t=e[0]||{};t instanceof z&&(t={texture:t}),e.length>1&&(B(V,"use new TilingSprite({ texture, width:100, height:100 }) instead"),t.width=e[1],t.height=e[2]),t={...$.defaultOptions,...t};const{texture:r,anchor:i,tilePosition:s,tileScale:o,tileRotation:n,width:a,height:c,applyAnchorToTexture:u,roundPixels:h,...f}=t??{};super({label:"TilingSprite",...f}),this.renderPipeId="tilingSprite",this.batched=!0,this.allowChildren=!1,this._anchor=new D({_onUpdate:()=>{this.onViewUpdate()}}),this.applyAnchorToTexture=u,this.texture=r,this._width=a??r.width,this._height=c??r.height,this._tileTransform=new _t({observer:{_onUpdate:()=>this.onViewUpdate()}}),i&&(this.anchor=i),this.tilePosition=s,this.tileScale=o,this.tileRotation=n,this.roundPixels=h??!1}static from(e,t={}){return typeof e=="string"?new $({texture:ot.get(e),...t}):new $({texture:e,...t})}get uvRespectAnchor(){return B(V,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture}set uvRespectAnchor(e){B(V,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture=e}get clampMargin(){return this._texture.textureMatrix.clampMargin}set clampMargin(e){this._texture.textureMatrix.clampMargin=e}get anchor(){return this._anchor}set anchor(e){typeof e=="number"?this._anchor.set(e):this._anchor.copyFrom(e)}get tilePosition(){return this._tileTransform.position}set tilePosition(e){this._tileTransform.position.copyFrom(e)}get tileScale(){return this._tileTransform.scale}set tileScale(e){typeof e=="number"?this._tileTransform.scale.set(e):this._tileTransform.scale.copyFrom(e)}set tileRotation(e){this._tileTransform.rotation=e}get tileRotation(){return this._tileTransform.rotation}get tileTransform(){return this._tileTransform}set texture(e){e||(e=z.EMPTY);const t=this._texture;t!==e&&(t&&t.dynamic&&t.off("update",this.onViewUpdate,this),e.dynamic&&e.on("update",this.onViewUpdate,this),this._texture=e,this.onViewUpdate())}get texture(){return this._texture}set width(e){this._width=e,this.onViewUpdate()}get width(){return this._width}set height(e){this._height=e,this.onViewUpdate()}get height(){return this._height}setSize(e,t){typeof e=="object"&&(t=e.height??e.width,e=e.width),this._width=e,this._height=t??e,this.onViewUpdate()}getSize(e){return e||(e={}),e.width=this._width,e.height=this._height,e}updateBounds(){const e=this._bounds,t=this._anchor,r=this._width,i=this._height;e.minX=-t._x*r,e.maxX=e.minX+r,e.minY=-t._y*i,e.maxY=e.minY+i}containsPoint(e){const t=this._width,r=this._height,i=-t*this._anchor._x;let s=0;return e.x>=i&&e.x<=i+t&&(s=-r*this._anchor._y,e.y>=s&&e.y<=s+r)}destroy(e=!1){if(super.destroy(e),this._anchor=null,this._tileTransform=null,this._bounds=null,typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource;this._texture.destroy(r)}this._texture=null}};Le.defaultOptions={texture:z.EMPTY,anchor:{x:0,y:0},tilePosition:{x:0,y:0},tileScale:{x:1,y:1},tileRotation:0,applyAnchorToTexture:!1};let Ft=Le;class Mt{execute(e,t){const r=e.renderer,i=r.canvasContext.activeContext,s=t.particleChildren,o=t.texture;i.save(),r.canvasContext.setContextTransform(t.worldTransform,t.roundPixels),r.canvasContext.setBlendMode(t.groupBlendMode);const n=t.groupColorAlpha,a=r.filter?.alphaMultiplier??1,c=(n>>>24&255)/255*a;for(let u=0;u<s.length;u++){const h=s[u],f=h.texture||o;if(!f?.source?.resource)continue;const d=h.color,p=(d>>>24&255)/255*c;if(p<=0)continue;const m=d&16777215,g=((m&255)<<16)+(m&65280)+(m>>16&255);let y=f.source.resource;g!==16777215&&(y=Oe.getTintedCanvas({texture:f},g));const x=f.frame,T=f.source.resolution,E=x.x*T,v=x.y*T,F=x.width*T,P=x.height*T;i.globalAlpha=p;const w=-h.anchorX*x.width,b=-h.anchorY*x.height;h.rotation!==0||h.scaleX!==1||h.scaleY!==1?(i.save(),i.translate(h.x,h.y),i.rotate(h.rotation),i.scale(h.scaleX,h.scaleY),i.drawImage(y,E,v,F,P,w,b,x.width,x.height),i.restore()):i.drawImage(y,E,v,F,P,h.x+w,h.y+b,x.width,x.height)}i.restore()}}function xe(l,e=null){const t=l*6;if(t>65535?e||(e=new Uint32Array(t)):e||(e=new Uint16Array(t)),e.length!==t)throw new Error(`Out buffer length is incorrect, got ${e.length} and expected ${t}`);for(let r=0,i=0;r<t;r+=6,i+=4)e[r+0]=i+0,e[r+1]=i+1,e[r+2]=i+2,e[r+3]=i+0,e[r+4]=i+2,e[r+5]=i+3;return e}function Et(l){return{dynamicUpdate:ye(l,!0),staticUpdate:ye(l,!1)}}function ye(l,e){const t=[];t.push(`

        var index = 0;

        for (let i = 0; i < ps.length; ++i)
        {
            const p = ps[i];

            `);let r=0;for(const s in l){const o=l[s];if(e!==o.dynamic)continue;t.push(`offset = index + ${r}`),t.push(o.code);const n=ne(o.format);r+=n.stride/4}t.push(`
            index += stride * 4;
        }
    `),t.unshift(`
        var stride = ${r};
        var offset = 0, w0 = 0, w1 = 0, h0 = 0, h1 = 0;
    `);const i=t.join(`
`);return new Function("ps","f32v","u32v",i)}class Rt{constructor(e){this._size=0,this._generateParticleUpdateCache={};const t=this._size=e.size??1e3,r=e.properties;let i=0,s=0;for(const u in r){const h=r[u],f=ne(h.format);h.dynamic?s+=f.stride:i+=f.stride}this._dynamicStride=s/4,this._staticStride=i/4,this.staticAttributeBuffer=new Y(t*4*i),this.dynamicAttributeBuffer=new Y(t*4*s),this.indexBuffer=xe(t);const o=new be;let n=0,a=0;this._staticBuffer=new L({data:new Float32Array(1),label:"static-particle-buffer",shrinkToFit:!1,usage:S.VERTEX|S.COPY_DST}),this._dynamicBuffer=new L({data:new Float32Array(1),label:"dynamic-particle-buffer",shrinkToFit:!1,usage:S.VERTEX|S.COPY_DST});for(const u in r){const h=r[u],f=ne(h.format);h.dynamic?(o.addAttribute(h.attributeName,{buffer:this._dynamicBuffer,stride:this._dynamicStride*4,offset:n*4,format:h.format}),n+=f.size):(o.addAttribute(h.attributeName,{buffer:this._staticBuffer,stride:this._staticStride*4,offset:a*4,format:h.format}),a+=f.size)}o.addIndex(this.indexBuffer);const c=this.getParticleUpdate(r);this._dynamicUpload=c.dynamicUpdate,this._staticUpload=c.staticUpdate,this.geometry=o}getParticleUpdate(e){const t=Bt(e);return this._generateParticleUpdateCache[t]?this._generateParticleUpdateCache[t]:(this._generateParticleUpdateCache[t]=this.generateParticleUpdate(e),this._generateParticleUpdateCache[t])}generateParticleUpdate(e){return Et(e)}update(e,t){e.length>this._size&&(t=!0,this._size=Math.max(e.length,this._size*1.5|0),this.staticAttributeBuffer=new Y(this._size*this._staticStride*4*4),this.dynamicAttributeBuffer=new Y(this._size*this._dynamicStride*4*4),this.indexBuffer=xe(this._size),this.geometry.indexBuffer.setDataWithSize(this.indexBuffer,this.indexBuffer.byteLength,!0));const r=this.dynamicAttributeBuffer;if(this._dynamicUpload(e,r.float32View,r.uint32View),this._dynamicBuffer.setDataWithSize(this.dynamicAttributeBuffer.float32View,e.length*this._dynamicStride*4,!0),t){const i=this.staticAttributeBuffer;this._staticUpload(e,i.float32View,i.uint32View),this._staticBuffer.setDataWithSize(i.float32View,e.length*this._staticStride*4,!0)}}destroy(){this._staticBuffer.destroy(),this._dynamicBuffer.destroy(),this.geometry.destroy()}}function Bt(l){const e=[];for(const t in l){const r=l[t];e.push(t,r.code,r.dynamic?"d":"s")}return e.join("_")}var It=`varying vec2 vUV;
varying vec4 vColor;

uniform sampler2D uTexture;

void main(void){
    vec4 color = texture2D(uTexture, vUV) * vColor;
    gl_FragColor = color;
}`,kt=`attribute vec2 aVertex;
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
`,ve=`
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
}`;class Vt extends Te{constructor(){const e=K.from({vertex:kt,fragment:It}),t=Q.from({fragment:{source:ve,entryPoint:"mainFragment"},vertex:{source:ve,entryPoint:"mainVertex"}});super({glProgram:e,gpuProgram:t,resources:{uTexture:z.WHITE.source,uSampler:new tt({}),uniforms:{uTranslationMatrix:{value:new O,type:"mat3x3<f32>"},uColor:{value:new Ce(16777215),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}}})}}class J{constructor(e,t){this.state=se.for2d(),this.localUniforms=new ie({uTranslationMatrix:{value:new O,type:"mat3x3<f32>"},uColor:{value:new Float32Array(4),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}),this.renderer=e,this.adaptor=t,this.defaultShader=new Vt,this.state=se.for2d(),this._managedContainers=new ze({renderer:e,type:"renderable",name:"particleContainer"})}validateRenderable(e){return!1}addRenderable(e,t){this.renderer.renderPipes.batch.break(t),t.add(e)}getBuffers(e){return e._gpuData[this.renderer.uid]||this._initBuffer(e)}_initBuffer(e){return e._gpuData[this.renderer.uid]=new Rt({size:e.particleChildren.length,properties:e._properties}),this._managedContainers.add(e),e._gpuData[this.renderer.uid]}updateRenderable(e){}execute(e){const t=e.particleChildren;if(t.length===0)return;const r=this.renderer,i=this.getBuffers(e);e.texture||(e.texture=t[0].texture);const s=this.state;i.update(t,e._childrenDirty),e._childrenDirty=!1,s.blendMode=Ue(e.groupBlendMode,e.texture._source);const o=this.localUniforms.uniforms,n=o.uTranslationMatrix;e.worldTransform.copyTo(n);const a=r.globalUniforms.globalUniformData;n.tx-=a.offset.x,n.ty-=a.offset.y,n.prepend(a.projectionMatrix),o.uResolution=a.resolution,o.uRound=r._roundPixels|e._roundPixels;const c=e.groupColorAlpha,u=a.worldColor,h=(c>>>24)*(u>>>24)/255|0,f=_e(c&16777215,u&16777215);Ae((h<<24|f)>>>0,o.uColor,0),this.adaptor.execute(this,e)}destroy(){this._managedContainers.destroy(),this.renderer=null,this.defaultShader&&(this.defaultShader.destroy(),this.defaultShader=null)}}J.extension={type:[_.CanvasPipes],name:"particle"};class Ge extends J{constructor(e){super(e,new Mt)}}Ge.extension={type:[_.CanvasPipes],name:"particle"};class Dt{execute(e,t){const r=e.state,i=e.renderer,s=t.shader||e.defaultShader;s.resources.uTexture=t.texture._source,s.resources.uniforms=e.localUniforms;const o=i.gl,n=e.getBuffers(t);i.shader.bind(s),i.state.set(r),i.geometry.bind(n.geometry,s.glProgram);const c=n.geometry.indexBuffer.data.BYTES_PER_ELEMENT===2?o.UNSIGNED_SHORT:o.UNSIGNED_INT;o.drawElements(o.TRIANGLES,t.particleChildren.length*6,c,0)}}class Ne extends J{constructor(e){super(e,new Dt)}}Ne.extension={type:[_.WebGLPipes],name:"particle"};class Lt{execute(e,t){const r=e.renderer,i=t.shader||e.defaultShader;i.groups[0]=r.renderPipes.uniformBatch.getUniformBindGroup(e.localUniforms,!0),i.groups[1]=r.texture.getTextureBindGroup(t.texture);const s=e.state,o=e.getBuffers(t);r.encoder.draw({geometry:o.geometry,shader:t.shader||e.defaultShader,state:s,size:t.particleChildren.length*6})}}class Ye extends J{constructor(e){super(e,new Lt)}}Ye.extension={type:[_.WebGPUPipes],name:"particle"};const Xe=class ae{constructor(e){if(e instanceof z)this.texture=e,pe(this,ae.defaultOptions,{});else{const t={...ae.defaultOptions,...e};pe(this,t,{})}}get alpha(){return this._alpha}set alpha(e){this._alpha=Math.min(Math.max(e,0),1),this._updateColor()}get tint(){return re(this._tint)}set tint(e){this._tint=typeof e=="number"?re(e):Ce.shared.setValue(e??16777215).toBgrNumber(),this._updateColor()}_updateColor(){this.color=this._tint+((this._alpha*255|0)<<24)}};Xe.defaultOptions={anchorX:0,anchorY:0,x:0,y:0,scaleX:1,scaleY:1,rotation:0,tint:16777215,alpha:1};let he=Xe;const we={vertex:{attributeName:"aVertex",format:"float32x2",code:`
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
        `,dynamic:!1}};A.add(Ne);A.add(Ye);A.add(Ge);const Gt=new rt(0,0,0,0),Nt=48,qe=class le extends Pe{constructor(e={}){e={...le.defaultOptions,...e,dynamicProperties:{...le.defaultOptions.dynamicProperties,...e?.dynamicProperties}};const{dynamicProperties:t,shader:r,roundPixels:i,texture:s,particles:o,...n}=e;super({label:"ParticleContainer",...n}),this.renderPipeId="particle",this.batched=!1,this._childrenDirty=!1,this.texture=s||null,this.shader=r,this._properties={};for(const a in we){const c=we[a],u=t[a];this._properties[a]={...c,dynamic:u}}this.allowChildren=!0,this.roundPixels=i??!1,this.particleChildren=o??[]}addParticle(...e){for(let t=0;t<e.length;t++)this.particleChildren.push(e[t]);return this.onViewUpdate(),e[0]}removeParticle(...e){if(e.length>Nt)return this._removeParticlesInOnePass(e)&&this.onViewUpdate(),e[0];let t=!1;for(let r=0;r<e.length;r++){const i=this.particleChildren.indexOf(e[r]);i>-1&&(this.particleChildren.splice(i,1),t=!0)}return t&&this.onViewUpdate(),e[0]}_removeParticlesInOnePass(e){const t=new Map;for(let o=0;o<e.length;o++){const n=e[o];t.set(n,(t.get(n)??0)+1)}const r=this.particleChildren,i=r.length;let s=0;for(let o=0;o<i;o++){const n=r[o],a=t.get(n);a?t.set(n,a-1):r[s++]=n}return r.length=s,s!==i}update(){this._childrenDirty=!0}onViewUpdate(){this._childrenDirty=!0,super.onViewUpdate()}get bounds(){return Gt}updateBounds(){}destroy(e=!1){if(super.destroy(e),typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource,i=this.texture??this.particleChildren[0]?.texture;i&&i.destroy(r)}this.texture=null,this.shader?.destroy()}removeParticles(e,t){e??(e=0),t??(t=this.particleChildren.length);const r=this.particleChildren.splice(e,t-e);return this.onViewUpdate(),r}removeParticleAt(e){const t=this.particleChildren.splice(e,1);return this.onViewUpdate(),t[0]}addParticleAt(e,t){return this.particleChildren.splice(t,0,e),this.onViewUpdate(),e}addChild(...e){throw new Error("ParticleContainer.addChild() is not available. Please use ParticleContainer.addParticle()")}removeChild(...e){throw new Error("ParticleContainer.removeChild() is not available. Please use ParticleContainer.removeParticle()")}removeChildren(e,t){throw new Error("ParticleContainer.removeChildren() is not available. Please use ParticleContainer.removeParticles()")}removeChildAt(e){throw new Error("ParticleContainer.removeChildAt() is not available. Please use ParticleContainer.removeParticleAt()")}getChildAt(e){throw new Error("ParticleContainer.getChildAt() is not available. Please use ParticleContainer.getParticleAt()")}setChildIndex(e,t){throw new Error("ParticleContainer.setChildIndex() is not available. Please use ParticleContainer.setParticleIndex()")}getChildIndex(e){throw new Error("ParticleContainer.getChildIndex() is not available. Please use ParticleContainer.getParticleIndex()")}addChildAt(e,t){throw new Error("ParticleContainer.addChildAt() is not available. Please use ParticleContainer.addParticleAt()")}swapChildren(e,t){throw new Error("ParticleContainer.swapChildren() is not available. Please use ParticleContainer.swapParticles()")}reparentChild(...e){throw new Error("ParticleContainer.reparentChild() is not available with the particle container")}reparentChildAt(e,t){throw new Error("ParticleContainer.reparentChildAt() is not available with the particle container")}};qe.defaultOptions={dynamicProperties:{vertex:!1,position:!0,rotation:!1,uvs:!1,color:!1},roundPixels:!1};let j=qe;A.add(gt,xt);class Yt{constructor(e=1024){if(!Number.isInteger(e)||e<8)throw new RangeError("Atlas size must be an integer of at least 8 pixels");this.size=e,this.canvas=document.createElement("canvas"),this.canvas.width=this.canvas.height=e,this.ctx=this.canvas.getContext("2d"),this.x=this.y=2,this.rowHeight=0,this.frames=new Map,this.textures=new Map,this.source=null}register(e,t,r,i,{makeWhite:s=!0}={}){if(typeof e!="string"||!e||!Number.isInteger(t)||!Number.isInteger(r)||t<=0||r<=0||typeof i!="function")throw new TypeError("Atlas frames require a name, positive integer dimensions and a draw function");if(this.frames.has(e+"_white"))throw new Error("Invalid or duplicate atlas frame: "+e);this.checkCapacity([{name:e,width:t,height:r},...s?[{name:e+"_white",width:t,height:r}]:[]]);const o=document.createElement("canvas");o.width=t,o.height=r;const n=o.getContext("2d");i(n,t,r),this.pack(e,o),s&&(n.globalCompositeOperation="source-in",n.fillStyle="#ffffff",n.fillRect(0,0,t,r),this.pack(e+"_white",o))}checkCapacity(e){if(this.source)throw new Error("Cannot add frames to a built atlas");let t=this.x,r=this.y,i=this.rowHeight;const s=new Set;for(const{name:o,width:n,height:a}of e){if(typeof o!="string"||!o||s.has(o)||this.frames.has(o))throw new Error("Invalid or duplicate atlas frame: "+o);if(!Number.isInteger(n)||!Number.isInteger(a)||n<=0||a<=0)throw new RangeError("Atlas dimensions must be positive integers");if(s.add(o),n+4>this.size||a+4>this.size)throw new RangeError("Atlas frame too large: "+o);if(t+n+2>this.size&&(t=2,r+=i+4,i=0),r+a+2>this.size)throw new RangeError("Procedural atlas is full");t+=n+4,i=Math.max(i,a)}}registerImage(e,t,{width:r=t?.width,height:i=t?.height,makeWhite:s=!0}={}){if(!(t?.width>0&&t?.height>0))throw new TypeError("Atlas image must be decoded and have positive dimensions: "+e);this.register(e,r,i,(o,n,a)=>{const c=Math.min(n/t.width,a/t.height),u=t.width*c,h=t.height*c;o.drawImage(t,(n-u)/2,(a-h)/2,u,h)},{makeWhite:s})}registerSheet(e,t,{width:r,height:i,makeWhite:s=!0}={}){const o=t?.image;if(typeof e!="string"||!e||!o||!(o.width>0&&o.height>0)||!Number.isSafeInteger(t.length)||t.length<1||typeof t.frame!="function")throw new TypeError("registerSheet requires a name and a decoded HGame SpriteSheet");const n=[],a=[];for(let c=0;c<t.length;c++){const u=t.frame(c),h=`${e}/${c}`;if(![u?.x,u?.y,u?.width,u?.height].every(Number.isFinite)||u.x<0||u.y<0||u.width<=0||u.height<=0||u.x+u.width>o.width||u.y+u.height>o.height)throw new RangeError("SpriteSheet frame is outside the image: "+h);const f=r??u.width,d=i??u.height;if(this.frames.has(h+"_white"))throw new Error("Invalid or duplicate atlas frame: "+h);n.push({name:h,rect:u,width:f,height:d}),a.push({name:h,width:f,height:d}),s&&a.push({name:h+"_white",width:f,height:d})}this.checkCapacity(a);for(const c of n){const u=c.rect;this.register(c.name,c.width,c.height,(h,f,d)=>{h.drawImage(o,u.x,u.y,u.width,u.height,0,0,f,d)},{makeWhite:s})}return n.map(c=>c.name)}pack(e,t){const{width:r,height:i}=t;if(r+4>this.size||i+4>this.size)throw new RangeError("Atlas frame too large: "+e);if(this.x+r+2>this.size&&(this.x=2,this.y+=this.rowHeight+4,this.rowHeight=0),this.y+i+2>this.size)throw new RangeError("Procedural atlas is full");const s=this.x,o=this.y,n=this.ctx;n.drawImage(t,s,o),n.drawImage(t,0,0,r,1,s,o-1,r,1),n.drawImage(t,0,i-1,r,1,s,o+i,r,1),n.drawImage(t,0,0,1,i,s-1,o,1,i),n.drawImage(t,r-1,0,1,i,s+r,o,1,i),n.drawImage(t,0,0,1,1,s-1,o-1,1,1),n.drawImage(t,r-1,0,1,1,s+r,o-1,1,1),n.drawImage(t,0,i-1,1,1,s-1,o+i,1,1),n.drawImage(t,r-1,i-1,1,1,s+r,o+i,1,1),this.frames.set(e,new it(s,o,r,i)),this.x+=r+4,this.rowHeight=Math.max(this.rowHeight,i)}build(){if(this.source)return this;this.source=new st({resource:this.canvas,scaleMode:"linear"});for(const[e,t]of this.frames)this.textures.set(e,new z({source:this.source,frame:t}));return this}get(e){return this.textures.get(e)??z.WHITE}dispose(){for(const e of this.textures.values())e.destroy();this.textures.clear(),this.source?.destroy(),this.source=null}}function pr({playerImage:l=null,enemyImage:e=null,eliteImage:t=e,extraFrames:r=[],size:i=1024}={}){const s=new Yt(i),o=(a,c=.4)=>(u,h,f)=>{u.fillStyle=a,u.beginPath(),u.arc(h/2,f/2,Math.min(h,f)*c,0,Math.PI*2),u.fill()},n=a=>(c,u,h)=>{if(!(a?.width>0&&a?.height>0))throw new TypeError("Character image must be decoded and have positive dimensions");const f=Math.min(u/a.width,h/a.height),d=a.width*f,p=a.height*f;c.drawImage(a,(u-d)/2,(h-p)/2,d,p)};s.register("player_hero",64,64,l?n(l):o("#53eccc")),s.register("enemy_chaser",40,40,e?n(e):o("#fa536e")),s.register("enemy_elite",56,56,t?n(t):o("#ffad53")),s.register("bullet_orb",20,20,o("#92faff")),s.register("particle_soft",20,20,(a,c,u)=>{const h=a.createRadialGradient(c/2,u/2,0,c/2,u/2,c/2);h.addColorStop(0,"#fff"),h.addColorStop(1,"#ffffff00"),a.fillStyle=h,a.fillRect(0,0,c,u)}),s.register("particle_spark",12,12,(a,c,u)=>{a.fillStyle="#fff",a.beginPath(),a.moveTo(c/2,0),a.lineTo(c,u/2),a.lineTo(c/2,u),a.lineTo(0,u/2),a.closePath(),a.fill()}),s.register("slash_trail",128,16,(a,c,u)=>{const h=a.createLinearGradient(0,0,c,0);h.addColorStop(0,"#ffffff00"),h.addColorStop(1,"#ffffffff"),a.fillStyle=h,a.fillRect(0,0,c,u)}),s.register("shadow_oval",48,20,(a,c,u)=>{a.fillStyle="#0008",a.beginPath(),a.ellipse(c/2,u/2,c/2,u/2,0,0,Math.PI*2),a.fill()},{makeWhite:!1}),s.register("ground_grid",128,128,(a,c,u)=>{a.fillStyle="#101b2a",a.fillRect(0,0,c,u),a.strokeStyle="#244256",a.lineWidth=1,a.strokeRect(.5,.5,c-1,u-1)},{makeWhite:!1});for(const a of r)typeof a.sheet=="function"?s.registerSheet(a.name,a.sheet(a.image),a):s.registerImage(a.name,a.image,a);return s.build()}var ce=`in vec2 aPosition;
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
`,fe=`struct GlobalFilterUniforms {
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
`,Ht=`struct KawaseBlurUniforms {
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
}`,$t=Object.defineProperty,jt=(l,e,t)=>e in l?$t(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,R=(l,e,t)=>(jt(l,typeof e!="symbol"?e+"":e,t),t);const We=class He extends ue{constructor(...e){let t=e[0]??{};(typeof t=="number"||Array.isArray(t))&&(B("6.0.0","KawaseBlurFilter constructor params are now options object. See params: { strength, quality, clamp, pixelSize }"),t={strength:t},e[1]!==void 0&&(t.quality=e[1]),e[2]!==void 0&&(t.clamp=e[2])),t={...He.DEFAULT_OPTIONS,...t};const r=Q.from({vertex:{source:fe,entryPoint:"mainVertex"},fragment:{source:t?.clamp?Ht:qt,entryPoint:"mainFragment"}}),i=K.from({vertex:ce,fragment:t?.clamp?Wt:Xt,name:"kawase-blur-filter"});super({gpuProgram:r,glProgram:i,resources:{kawaseBlurUniforms:{uOffset:{value:new Float32Array(2),type:"vec2<f32>"}}}}),R(this,"uniforms"),R(this,"_pixelSize",{x:0,y:0}),R(this,"_clamp"),R(this,"_kernels",[]),R(this,"_blur"),R(this,"_quality"),this.uniforms=this.resources.kawaseBlurUniforms.uniforms,this.pixelSize=t.pixelSize??{x:1,y:1},Array.isArray(t.strength)?this.kernels=t.strength:typeof t.strength=="number"&&(this._blur=t.strength,this.quality=t.quality??3),this._clamp=!!t.clamp}apply(e,t,r,i){const s=this.pixelSizeX/t.source.width,o=this.pixelSizeY/t.source.height;let n;if(this._quality===1||this._blur===0)n=this._kernels[0]+.5,this.uniforms.uOffset[0]=n*s,this.uniforms.uOffset[1]=n*o,e.applyFilter(this,t,r,i);else{const a=k.getSameSizeTexture(t);let c=t,u=a,h;const f=this._quality-1;for(let d=0;d<f;d++)n=this._kernels[d]+.5,this.uniforms.uOffset[0]=n*s,this.uniforms.uOffset[1]=n*o,e.applyFilter(this,c,u,!0),h=c,c=u,u=h;n=this._kernels[f]+.5,this.uniforms.uOffset[0]=n*s,this.uniforms.uOffset[1]=n*o,e.applyFilter(this,c,r,i),k.returnTexture(a)}}get strength(){return this._blur}set strength(e){this._blur=e,this._generateKernels()}get quality(){return this._quality}set quality(e){this._quality=Math.max(1,Math.round(e)),this._generateKernels()}get kernels(){return this._kernels}set kernels(e){Array.isArray(e)&&e.length>0?(this._kernels=e,this._quality=e.length,this._blur=Math.max(...e)):(this._kernels=[0],this._quality=1)}get pixelSize(){return this._pixelSize}set pixelSize(e){if(typeof e=="number"){this.pixelSizeX=this.pixelSizeY=e;return}if(Array.isArray(e)){this.pixelSizeX=e[0],this.pixelSizeY=e[1];return}this._pixelSize=e}get pixelSizeX(){return this.pixelSize.x}set pixelSizeX(e){this.pixelSize.x=e}get pixelSizeY(){return this.pixelSize.y}set pixelSizeY(e){this.pixelSize.y=e}get clamp(){return this._clamp}_updatePadding(){this.padding=Math.ceil(this._kernels.reduce((e,t)=>e+t+.5,0))}_generateKernels(){const e=this._blur,t=this._quality,r=[e];if(e>0){let i=e;const s=e/t;for(let o=1;o<t;o++)i-=s,r.push(i)}this._kernels=r,this._updatePadding()}};R(We,"DEFAULT_OPTIONS",{strength:4,quality:3,clamp:!1,pixelSize:{x:1,y:1}});let Kt=We;var Qt=`in vec2 vTextureCoord;
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
`,tr=Object.defineProperty,rr=(l,e,t)=>e in l?tr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,$e=(l,e,t)=>(rr(l,typeof e!="symbol"?e+"":e,t),t);const je=class Ke extends ue{constructor(e){e={...Ke.DEFAULT_OPTIONS,...e};const t=Q.from({vertex:{source:fe,entryPoint:"mainVertex"},fragment:{source:er,entryPoint:"mainFragment"}}),r=K.from({vertex:ce,fragment:Zt,name:"extract-brightness-filter"});super({gpuProgram:t,glProgram:r,resources:{extractBrightnessUniforms:{uThreshold:{value:e.threshold,type:"f32"}}}}),$e(this,"uniforms"),this.uniforms=this.resources.extractBrightnessUniforms.uniforms}get threshold(){return this.uniforms.uThreshold}set threshold(e){this.uniforms.uThreshold=e}};$e(je,"DEFAULT_OPTIONS",{threshold:.5});let ir=je;var sr=Object.defineProperty,nr=(l,e,t)=>e in l?sr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,I=(l,e,t)=>(nr(l,typeof e!="symbol"?e+"":e,t),t);const Qe=class Je extends ue{constructor(e){e={...Je.DEFAULT_OPTIONS,...e};const t=Q.from({vertex:{source:fe,entryPoint:"mainVertex"},fragment:{source:Jt,entryPoint:"mainFragment"}}),r=K.from({vertex:ce,fragment:Qt,name:"advanced-bloom-filter"});super({gpuProgram:t,glProgram:r,resources:{advancedBloomUniforms:{uBloomScale:{value:e.bloomScale,type:"f32"},uBrightness:{value:e.brightness,type:"f32"}},uMapTexture:z.WHITE}}),I(this,"uniforms"),I(this,"bloomScale",1),I(this,"brightness",1),I(this,"_extractFilter"),I(this,"_blurFilter"),this.uniforms=this.resources.advancedBloomUniforms.uniforms,this._extractFilter=new ir({threshold:e.threshold}),this._blurFilter=new Kt({strength:e.kernels??e.blur,quality:e.kernels?void 0:e.quality}),Object.assign(this,e)}apply(e,t,r,i){const s=k.getSameSizeTexture(t);this._extractFilter.apply(e,t,s,!0);const o=k.getSameSizeTexture(t);this._blurFilter.apply(e,s,o,!0),this.uniforms.uBloomScale=this.bloomScale,this.uniforms.uBrightness=this.brightness,this.resources.uMapTexture=o.source,e.applyFilter(this,t,r,i),k.returnTexture(o),k.returnTexture(s)}get threshold(){return this._extractFilter.threshold}set threshold(e){this._extractFilter.threshold=e}get kernels(){return this._blurFilter.kernels}set kernels(e){this._blurFilter.kernels=e}get blur(){return this._blurFilter.strength}set blur(e){this._blurFilter.strength=e}get quality(){return this._blurFilter.quality}set quality(e){this._blurFilter.quality=e}get pixelSize(){return this._blurFilter.pixelSize}set pixelSize(e){typeof e=="number"&&(e={x:e,y:e}),Array.isArray(e)&&(e={x:e[0],y:e[1]}),this._blurFilter.pixelSize=e}get pixelSizeX(){return this._blurFilter.pixelSizeX}set pixelSizeX(e){this._blurFilter.pixelSizeX=e}get pixelSizeY(){return this._blurFilter.pixelSizeY}set pixelSizeY(e){this._blurFilter.pixelSizeY=e}};I(Qe,"DEFAULT_OPTIONS",{threshold:.5,bloomScale:1,brightness:1,blur:8,quality:4,pixelSize:{x:1,y:1}});let or=Qe;class ar{constructor(e,{textures:t=["enemy_chaser"],clips:r=null,scale:i=1,worldScale:s=1,offsetX:o=0,offsetY:n=0,syncRotation:a=!1,flipByDirection:c=!1,cull:u=!0}={}){if(!e?.worldRoot||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a swarm layer");const h=r??(Array.isArray(t)?t.map(f=>({frames:[f]})):null);if(!Array.isArray(h)||h.length===0)throw new TypeError("Swarm clips or textures must be a non-empty array");if(![i,s,o,n].every(Number.isFinite)||i<=0||s<=0)throw new RangeError("Swarm scale and worldScale must be positive and offsets must be finite");this.renderer=e,this.scale=i,this.worldScale=s,this.offsetX=o,this.offsetY=n,this.syncRotation=!!a,this.flipByDirection=!!c,this.cull=!!u,this.clips=h.map(f=>{if(!f||!Array.isArray(f.frames)||f.frames.length===0||f.frames.some(m=>typeof m!="string"||!e.atlas.textures.has(m)))throw new TypeError("Swarm clip frames must be existing atlas frame names");const d=f.fps??8;if(!Number.isFinite(d)||d<=0)throw new RangeError("Swarm clip fps must be positive");const p=f.frames.map(m=>{const g=e.atlas.textures.get(m);return{texture:g,white:e.atlas.textures.get(m+"_white")??g,radius:Math.hypot(g.orig.width,g.orig.height)*.5}});return{frames:p,fps:d,loop:f.loop!==!1,radius:Math.max(...p.map(m=>m.radius))}}),this.layer=new j({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),e.worldRoot.addChildAt(this.layer,e.worldRoot.getChildIndex(e.entityLayer)),this.particles=[],this.pool=[],this.pendingParticles=[],this.visibleCount=0,this.disposed=!1}sync(e){if(this.disposed)throw new Error("Swarm layer is disposed");if(!e?.activeIds||!e.posX||!e.posY||!Number.isInteger(e.count))throw new TypeError("sync requires an HGame CPU SwarmSimulation");const t=e.count;if(t<0||t>e.activeIds.length)throw new RangeError("Swarm count exceeds active ID capacity");const r=this.renderer.camera,i=this.renderer.app.screen,s=i.width/2,o=i.height/2,n=r.zoom;if(!(n>0)||!Number.isFinite(n))throw new RangeError("Camera zoom must be finite and positive");const a=r.x+(-s-r.shakeX)/n,c=r.x+(s-r.shakeX)/n,u=r.y+(-o-r.shakeY)/n,h=r.y+(o-r.shakeY)/n;let f=0;for(let d=0;d<t;d++){const p=e.activeIds[d],m=e.posX[p]*this.worldScale+this.offsetX,g=e.posY[p]*this.worldScale+this.offsetY,y=this.clips[(e.animClip?.[p]??0)%this.clips.length],x=(e.scale?.[p]??1)*this.scale;if(this.cull){const w=y.radius*Math.abs(x);if(m+w<a||m-w>c||g+w<u||g-w>h)continue}let T=0;if(y.frames.length>1){const w=e.animTime?.[p]??0,b=Number.isFinite(w)?Math.max(0,Math.floor(w*y.fps)):0;T=y.loop?b%y.frames.length:Math.min(b,y.frames.length-1)}const E=y.frames[T];let v=this.particles[f];const F=e.flash?.[p]>0?E.white:E.texture;v||(v=this.pool.pop()??new he({texture:F,anchorX:.5,anchorY:.5}),this.particles.push(v),this.pendingParticles.push(v),this.pendingParticles.length===4096&&this.flushPending()),v.texture!==F&&(v.texture=F),v.x=m,v.y=g;const P=e.rot?.[p]??0;v.rotation=this.syncRotation?P:0,v.scaleX=this.flipByDirection&&Math.sin(P)<0?-x:x,v.scaleY=x,f++}if(this.flushPending(),f<this.particles.length){const d=this.layer.removeParticles(f);this.particles.length=f;for(const p of d)this.pool.push(p)}return this.visibleCount=f,f}flushPending(){this.pendingParticles.length&&this.layer.addParticle(...this.pendingParticles),this.pendingParticles.length=0}dispose(){this.disposed||(this.disposed=!0,this.layer.removeFromParent(),this.layer.destroy(),this.particles.length=0,this.pool.length=0,this.pendingParticles.length=0,this.visibleCount=0,this.renderer.swarmLayers.delete(this))}}class lr{constructor(e,t,{frames:r,chunkSize:i=32,originX:s=0,originY:o=0}={}){if(!e?.bgLayer||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a tilemap layer");if(!t||typeof t.get!="function"||!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<1||t.height<1||!(t.tileWidth>0)||!(t.tileHeight>0))throw new TypeError("A rectangular HGame TileMap with positive tile dimensions is required");if(!r||typeof r!="object"||Array.isArray(r))throw new TypeError("frames must map tile values to atlas frame names");if(!Number.isInteger(i)||i<1||i>128)throw new RangeError("chunkSize must be an integer from 1 to 128");if(!Number.isFinite(s)||!Number.isFinite(o))throw new RangeError("Tilemap origin must be finite");this.renderer=e,this.map=t,this.frames=new Map;for(const[n,a]of Object.entries(r)){if(a==null)continue;const c=e.atlas.textures.get(a);if(!c)throw new Error("Unknown tilemap atlas frame: "+a);this.frames.set(n,c)}this.chunkSize=i,this.originX=s,this.originY=o,this.cols=Math.ceil(t.width/i),this.rows=Math.ceil(t.height/i),this.root=new M,this.root.eventMode="none",this.root.interactiveChildren=!1,this.chunks=new Array(this.cols*this.rows),this.disposed=!1;try{for(let n=0;n<this.rows;n++)for(let a=0;a<this.cols;a++)this.buildChunk(a,n);e.bgLayer.addChild(this.root),this.update()}catch(n){throw this.root.destroy({children:!0}),n}}buildChunk(e,t){const r=t*this.cols+e;let i=this.chunks[r];i?i.removeParticles():(i=new j({dynamicProperties:{position:!1,vertex:!1,uvs:!1,rotation:!1,color:!1}}),this.chunks[r]=i,this.root.addChild(i));const s=e*this.chunkSize,o=t*this.chunkSize,n=Math.min(this.map.width,s+this.chunkSize),a=Math.min(this.map.height,o+this.chunkSize),c=[];for(let u=o;u<a;u++)for(let h=s;h<n;h++){const f=this.frames.get(String(this.map.get(h,u)));if(!f)continue;const d=new he({texture:f,x:this.originX+h*this.map.tileWidth,y:this.originY+u*this.map.tileHeight});d.scaleX=this.map.tileWidth/f.orig.width,d.scaleY=this.map.tileHeight/f.orig.height,c.push(d),c.length===4096&&(i.addParticle(...c),c.length=0)}c.length&&i.addParticle(...c)}refreshTile(e,t){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw new RangeError("Tile is outside the map");this.buildChunk(Math.floor(e/this.chunkSize),Math.floor(t/this.chunkSize))}update(){if(this.disposed)return;const e=this.renderer.camera,t=this.renderer.app.screen,r=e.zoom;if(!(r>0)||!Number.isFinite(r))throw new RangeError("Camera zoom must be finite and positive");const i=e.x+(-t.width/2-e.shakeX)/r,s=e.x+(t.width/2-e.shakeX)/r,o=e.y+(-t.height/2-e.shakeY)/r,n=e.y+(t.height/2-e.shakeY)/r,a=this.chunkSize*this.map.tileWidth,c=this.chunkSize*this.map.tileHeight;for(let u=0;u<this.rows;u++)for(let h=0;h<this.cols;h++){const f=this.originX+h*a,d=this.originY+u*c;this.chunks[u*this.cols+h].visible=!(f+a<i||f>s||d+c<o||d>n)}}dispose(){this.disposed||(this.disposed=!0,this.root.removeFromParent(),this.root.destroy({children:!0}),this.chunks.length=0,this.renderer.tilemapLayers.delete(this))}}class mr{constructor(e,{maxPixels:t=23e5,maxPixelRatio:r=2,qualityController:i=null}={}){if(!Number.isFinite(t)||t<1||!Number.isFinite(r)||r<=0)throw new RangeError("Renderer pixel budget and maximum pixel ratio must be positive");if(this.atlas=e,this.maxPixels=t,this.maxPixelRatio=r,i&&(typeof i.sampleFrame!="function"||typeof i.resetMeasurements!="function"))throw new TypeError("qualityController must support sampleFrame and resetMeasurements");this.qualityController=i,this.lastFrameTime=null,this.app=new Re,this.entityMap=new Map,this.spritePool=[],this.swarmLayers=new Set,this.tilemapLayers=new Set,this.camera={x:0,y:0,targetX:0,targetY:0,zoom:1,shakeX:0,shakeY:0}}async init(e){this.mount=e;const{width:t,height:r,resolution:i}=this.planViewport();await this.app.init({preference:"webgpu",width:t,height:r,resolution:i,autoDensity:!0,backgroundColor:725019,autoStart:!1}),this.app.ticker.stop(),this.app.canvas.id="game",this.app.canvas.setAttribute("aria-label","游戏画面"),e.appendChild(this.app.canvas),this.worldRoot=new M,this.worldRoot.eventMode="none",this.worldRoot.interactiveChildren=!1,this.bgLayer=new M;const s=new Ft({texture:this.atlas.get("ground_grid"),width:4096,height:4096});this.grid=s,s.position.set(-2048,-2048),this.bgLayer.addChild(s),this.shadowLayer=new M,this.entityLayer=new M({sortableChildren:!0}),this.enemyLayer=new j({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),this.enemyParticles=[],this.enemyPool=[],this.pendingEnemies=[],this.trailLayer=new M,this.particleLayer=new j({dynamicProperties:{position:!0,vertex:!0,rotation:!0,color:!0,uvs:!0}}),this.worldRoot.addChild(this.bgLayer,this.shadowLayer,this.enemyLayer,this.entityLayer,this.trailLayer,this.particleLayer),this.app.stage.addChild(this.worldRoot),this.bloom=new or({threshold:.62,bloomScale:.4,brightness:1,blur:3}),this.bloomEnabled=!1,this.effectFilters=[],this.applyFilters(),this.viewport={width:t,height:r,resolution:i},typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(e))}planViewport(){const e=Math.max(1,Math.floor(this.mount?.clientWidth||1)),t=Math.max(1,Math.floor(this.mount?.clientHeight||1)),r=Number(globalThis.devicePixelRatio)||1,i=this.qualityController?.state?.dynamicScale??1,s=Math.max(1/Math.min(e,t),Math.min(r,this.maxPixelRatio,Math.sqrt(this.maxPixels/(e*t)))*i);return{width:e,height:t,resolution:s}}resize(){if(this.disposed||!this.app.renderer)return!1;const e=this.planViewport(),t=this.viewport;return t&&t.width===e.width&&t.height===e.height&&t.resolution===e.resolution?!1:(this.app.renderer.resize(e.width,e.height,e.resolution),this.viewport=e,this.onResize?.(),!0)}resetQualityMeasurements(){this.lastFrameTime=null,this.qualityController?.resetMeasurements()}setBloom({enabled:e=!0,threshold:t,bloomScale:r,brightness:i,blur:s}={}){if(!this.bloom||this.disposed)throw new Error("Initialize Renderer2D before configuring bloom");for(const[o,n]of Object.entries({threshold:t,bloomScale:r,brightness:i,blur:s}))if(n!==void 0&&(!Number.isFinite(n)||n<0))throw new RangeError(`Bloom ${o} must be a finite non-negative number`);t!==void 0&&(this.bloom.threshold=t),r!==void 0&&(this.bloom.bloomScale=r),i!==void 0&&(this.bloom.brightness=i),s!==void 0&&(this.bloom.blur=s),this.bloomEnabled=!!e,this.applyFilters()}setEffectFilters(e){this.effectFilters=e,this.applyFilters()}applyFilters(){const e=this.effectFilters;this.app.stage.filters=this.bloomEnabled||e.length?[this.bloom,...e]:[]}createSwarmLayer(e){const t=new ar(this,e);return this.swarmLayers.add(t),t}createTilemapLayer(e,t){const r=new lr(this,e,t);return this.tilemapLayers.add(r),r}syncEnemies(e,t){if(this.enemyParticles.length>e.length){const r=this.enemyLayer.removeParticles(e.length);this.enemyParticles.length=e.length;for(const i of r)this.enemyPool.push(i)}for(let r=0;r<e.length;r++){const i=e[r];let s=this.enemyParticles[r];const o=(i.elite?"enemy_elite":"enemy_chaser")+(i.flash>0?"_white":"");s||(s=this.enemyPool.pop()??new he({texture:this.atlas.get(o),anchorX:.5,anchorY:.5}),this.enemyParticles.push(s),this.pendingEnemies.push(s),this.pendingEnemies.length===4096&&this.flushEnemies());const n=this.atlas.get(o);s.texture!==n&&(s.texture=n),s.x=i.x,s.y=i.y;const a=t*7+i.id*.37;s.rotation=Math.sin(a)*.09;const c=Math.sin(a*2);s.scaleX=1+c*.035,s.scaleY=1-c*.05}this.flushEnemies()}flushEnemies(){this.pendingEnemies.length&&this.enemyLayer.addParticle(...this.pendingEnemies),this.pendingEnemies.length=0}alloc(e){const t=this.spritePool.pop()??new nt;return t.texture=this.atlas.get(e),t.anchor.set(.5),t.alpha=1,t.tint=16777215,t.scale.set(1),t.rotation=0,t.visible=!0,t}syncEntity(e,t){let r=this.entityMap.get(e);r||(r={sprite:this.alloc(t.tex),shadow:null,flashTimer:0,animScaleX:1,animScaleY:1},this.entityMap.set(e,r),this.entityLayer.addChild(r.sprite)),r.baseTex=t.tex;const i=r.sprite,s=this.atlas.get(t.tex);return i.texture=r.flashTimer>0?this.atlas.textures.get(t.tex+"_white")??s:s,i.position.set(t.x,t.y),i.rotation=t.rot??0,i.scale.set((t.scaleX??1)*r.animScaleX,(t.scaleY??1)*r.animScaleY),i.tint=r.flashTimer>0?16777215:t.tint??16777215,i.alpha=t.alpha??1,i.zIndex=t.zIndex??t.y,t.hasShadow!==!1?(r.shadow||(r.shadow=this.alloc("shadow_oval"),this.shadowLayer.addChild(r.shadow)),r.shadow.visible=!0,r.shadow.position.set(t.x,t.y+18),r.shadow.alpha=.35):r.shadow&&(r.shadow.visible=!1),r}releaseEntity(e){const t=this.entityMap.get(e);t&&(t.sprite.removeFromParent(),this.spritePool.push(t.sprite),t.shadow&&(t.shadow.removeFromParent(),this.spritePool.push(t.shadow)),this.entityMap.delete(e))}update(e){const t=this.camera,r=1-Math.exp(-10*e);t.x+=(t.targetX-t.x)*r,t.y+=(t.targetY-t.y)*r,this.worldRoot.scale.set(t.zoom),this.worldRoot.position.set(this.app.screen.width/2-t.x*t.zoom+t.shakeX,this.app.screen.height/2-t.y*t.zoom+t.shakeY);for(const i of this.tilemapLayers)i.update();for(const i of this.entityMap.values())i.flashTimer=Math.max(0,i.flashTimer-e)}screenToWorld(e,t){return{x:(e-this.app.screen.width/2-this.camera.shakeX)/this.camera.zoom+this.camera.x,y:(t-this.app.screen.height/2-this.camera.shakeY)/this.camera.zoom+this.camera.y}}worldToScreen(e,t){return{x:(e-this.camera.x)*this.camera.zoom+this.app.screen.width/2+this.camera.shakeX,y:(t-this.camera.y)*this.camera.zoom+this.app.screen.height/2+this.camera.shakeY}}render(){if(this.qualityController){const e=performance.now();this.lastFrameTime!==null&&this.qualityController.sampleFrame(e-this.lastFrameTime)&&this.resize(),this.lastFrameTime=e}this.app.renderer.render(this.app.stage)}dispose(){if(!this.disposed){this.disposed=!0,this.resizeObserver?.disconnect(),this.resizeObserver=null,this.onResize=null;for(const e of this.swarmLayers)e.dispose();for(const e of this.tilemapLayers)e.dispose();for(const e of this.spritePool)e.destroy();this.spritePool.length=0,this.enemyParticles.length=0,this.enemyPool.length=0,this.pendingEnemies.length=0,this.entityMap.clear(),this.app.stage.filters=[],this.effectFilters.length=0,this.bloom.destroy(),this.app.destroy({removeView:!0},{children:!0}),this.atlas.dispose()}}}function gr(l,{resetInput:e=()=>{},onVisibility:t=()=>{}}={}){let r=!1;function i(a){a?r&&(r=!1,l.running&&l.paused&&l.resume()):(e(),l.running&&!l.paused&&(r=l.pause())),t(a)}const s=l.platform.lifecycle,o=s.on("visibility",i),n=s.on("focus",a=>{a||e()});return{sync(){i(s.visible)},dispose(){o(),n(),r=!1}}}export{bt as B,ke as M,he as P,mr as R,gr as b,pr as c,ce as v,fe as w};
