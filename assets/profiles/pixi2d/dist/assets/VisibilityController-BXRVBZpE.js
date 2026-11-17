const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./browserAll-Dknvu5GT.js","./Geometry-b4_yFV4e.js","./init-CWUIAUpk.js","./canvasUtils-DiiUq8Hs.js","./webworkerAll-vTjiTUhh.js","./CanvasPool-D2lhgJD8.js","./WebGPURenderer-uoQZUmwt.js","./colorToUniform-MIizxb8Q.js","./RenderTargetSystem-BDuLvLx3.js","./localUniformBit-BOGrcT1E.js","./getTextureBatchBindGroup-D2l3TxEN.js","./getTexelRangeRects-BjZFLgKe.js","./WebGLRenderer-Q9cycPvx.js","./CanvasRenderer-B56f80B8.js"])))=>i.map(i=>d[i]);
import{E as v,D as ee,U as Ze,h as fe,j as C,k as R,d as B,o as I,m as be,c as k,e as T,M as U,a6 as V,P as Y,a7 as te,a8 as _e,Q as we,l as re,T as P,p as ie,W as et,V as Te,b as se,t as j,s as K,C as Pe,a9 as tt,aa as de,y as rt,R as it,J as st,F as ue,_ as E,I as nt}from"./Geometry-b4_yFV4e.js";import{C as ot}from"./init-CWUIAUpk.js";import{A as Ce,h as at,a as lt,b as ut,r as ct,d as ht,G as Se,c as ze,g as Ue,V as X}from"./colorToUniform-MIizxb8Q.js";import{c as Oe}from"./canvasUtils-DiiUq8Hs.js";import{a as ft,b as dt}from"./localUniformBit-BOGrcT1E.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))r(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const a of s.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&r(a)}).observe(document,{childList:!0,subtree:!0});function t(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function r(i){if(i.ep)return;i.ep=!0;const s=t(i);fetch(i.href,s)}})();const pt="modulepreload",mt=function(n,e){return new URL(n,e).href},pe={},D=function(e,t,r){let i=Promise.resolve();if(t&&t.length>0){let a=function(u){return Promise.all(u.map(c=>Promise.resolve(c).then(f=>({status:"fulfilled",value:f}),f=>({status:"rejected",reason:f}))))};const o=document.getElementsByTagName("link"),l=document.querySelector("meta[property=csp-nonce]"),h=l?.nonce||l?.getAttribute("nonce");i=a(t.map(u=>{if(u=mt(u,r),u in pe)return;pe[u]=!0;const c=u.endsWith(".css"),f=c?'[rel="stylesheet"]':"";if(!!r)for(let p=o.length-1;p>=0;p--){const x=o[p];if(x.href===u&&(!c||x.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${u}"]${f}`))return;const d=document.createElement("link");if(d.rel=c?"stylesheet":pt,c||(d.as="script"),d.crossOrigin="",d.href=u,h&&d.setAttribute("nonce",h),document.head.appendChild(d),c)return new Promise((p,x)=>{d.addEventListener("load",p),d.addEventListener("error",()=>x(new Error(`Unable to preload CSS for ${u}`)))})}))}function s(a){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=a,window.dispatchEvent(o),!o.defaultPrevented)throw a}return i.then(a=>{for(const o of a||[])o.status==="rejected"&&s(o.reason);return e().catch(s)})},xt={extension:{type:v.Environment,name:"browser",priority:-1},test:()=>!0,load:async()=>{await D(()=>import("./browserAll-Dknvu5GT.js"),__vite__mapDeps([0,1,2,3,4,5]),import.meta.url)}},gt={extension:{type:v.Environment,name:"webworker",priority:0},test:()=>typeof self<"u"&&self.WorkerGlobalScope!==void 0,load:async()=>{await D(()=>import("./webworkerAll-vTjiTUhh.js"),__vite__mapDeps([4,2,1,3,5]),import.meta.url)}};let N;function yt(n){return N!==void 0||(N=(()=>{const e={stencil:!0,failIfMajorPerformanceCaveat:n??Ce.defaultOptions.failIfMajorPerformanceCaveat};try{if(!ee.get().getWebGLRenderingContext())return!1;let r=ee.get().createCanvas().getContext("webgl",e);const i=!!r?.getContextAttributes()?.stencil;if(r){const s=r.getExtension("WEBGL_lose_context");s&&s.loseContext()}return r=null,i}catch{return!1}})()),N}let q;async function vt(n={}){return q!==void 0||(q=await(async()=>{const e=ee.get().getNavigator().gpu;if(!e)return!1;try{return await(await e.requestAdapter(n)).requestDevice(),!0}catch{return!1}})()),q}const me=["webgl","webgpu","canvas"];async function bt(n){let e=[];n.preference?Array.isArray(n.preference)?e=n.preference.slice():(e.push(n.preference),me.forEach(s=>{s!==n.preference&&e.push(s)})):e=me.slice();let t,r={};for(let s=0;s<e.length;s++){const a=e[s];if(a==="webgpu"&&await vt()){const{WebGPURenderer:o}=await D(async()=>{const{WebGPURenderer:l}=await import("./WebGPURenderer-uoQZUmwt.js");return{WebGPURenderer:l}},__vite__mapDeps([6,1,7,8,5,9,10,11]),import.meta.url);t=o,r={...n,...n.webgpu};break}else if(a==="webgl"&&yt(n.failIfMajorPerformanceCaveat??Ce.defaultOptions.failIfMajorPerformanceCaveat)){const{WebGLRenderer:o}=await D(async()=>{const{WebGLRenderer:l}=await import("./WebGLRenderer-Q9cycPvx.js");return{WebGLRenderer:l}},__vite__mapDeps([12,1,7,8,5,9,11]),import.meta.url);t=o,r={...n,...n.webgl};break}else if(a==="canvas"){const{CanvasRenderer:o}=await D(async()=>{const{CanvasRenderer:l}=await import("./CanvasRenderer-B56f80B8.js");return{CanvasRenderer:l}},__vite__mapDeps([13,1,8,7,5,3,10]),import.meta.url);t=o,r={...n,...n.canvasOptions};break}}if(delete r.webgpu,delete r.webgl,delete r.canvasOptions,!t)throw new Error("No available renderer for the current environment");const i=new t;return await i.init(r),i}class Ae{static init(e){Object.defineProperty(this,"resizeTo",{configurable:!0,set(t){globalThis.removeEventListener("resize",this.queueResize),this._resizeTo=t,t&&(globalThis.addEventListener("resize",this.queueResize),this.resize())},get(){return this._resizeTo}}),this.queueResize=()=>{this._resizeTo&&(this._cancelResize(),this._resizeId=requestAnimationFrame(()=>this.resize()))},this._cancelResize=()=>{this._resizeId&&(cancelAnimationFrame(this._resizeId),this._resizeId=null)},this.resize=()=>{if(!this._resizeTo)return;this._cancelResize();let t,r;if(this._resizeTo===globalThis.window)t=globalThis.innerWidth,r=globalThis.innerHeight;else{const{clientWidth:i,clientHeight:s}=this._resizeTo;t=i,r=s}this.renderer.resize(t,r),this.render()},this._resizeId=null,this._resizeTo=null,this.resizeTo=e.resizeTo||null}static destroy(){globalThis.removeEventListener("resize",this.queueResize),this._cancelResize(),this._cancelResize=null,this.queueResize=null,this.resizeTo=null,this.resize=null}}Ae.extension=v.Application;class Me{static init(e){e=Object.assign({autoStart:!0,sharedTicker:!1},e),Object.defineProperty(this,"ticker",{configurable:!0,set(t){this._ticker&&this._ticker.remove(this.render,this),this._ticker=t,t&&t.add(this.render,this,Ze.LOW)},get(){return this._ticker}}),this.stop=()=>{this._ticker.stop()},this.start=()=>{this._ticker.start()},this._ticker=null,this.ticker=e.sharedTicker?fe.shared:new fe,e.autoStart&&this.start()}static destroy(){if(this._ticker){const e=this._ticker;this.ticker=null,e.destroy()}}}Me.extension=v.Application;C.add(Ae);C.add(Me);const Re=class ne{constructor(...e){this.stage=new R,e[0]!==void 0&&B(I,"Application constructor options are deprecated, please use Application.init() instead.")}async init(e){e={...e},this.stage||(this.stage=new R),this.renderer=await bt(e),ne._plugins.forEach(t=>{t.init.call(this,e)})}render(){this.renderer.render({container:this.stage})}get canvas(){return this.renderer.canvas}get view(){return B(I,"Application.view is deprecated, please use Application.canvas instead."),this.renderer.canvas}get screen(){return this.renderer.screen}get domContainerRoot(){return this.renderer.renderPipes.dom?._domElement}destroy(e=!1,t=!1){const r=ne._plugins.slice(0);r.reverse(),r.forEach(i=>{i.destroy.call(this)}),this.stage.destroy(t),this.stage=null,this.renderer.destroy(e),this.renderer=null}};Re._plugins=[];let Be=Re;C.handleByList(v.Application,Be._plugins);C.add(at);const Fe=class Ee extends be{constructor(...e){let t=e[0]??{};t instanceof Float32Array&&(B(I,"use new MeshGeometry({ positions, uvs, indices }) instead"),t={positions:t,uvs:e[1],indices:e[2]}),t={...Ee.defaultOptions,...t};const r=t.positions||new Float32Array([0,0,1,0,1,1,0,1]);let i=t.uvs;i||(t.positions?i=new Float32Array(r.length):i=new Float32Array([0,0,1,0,1,1,0,1]));const s=t.indices||new Uint32Array([0,1,2,0,2,3]),a=t.shrinkBuffersToFit,o=new k({data:r,label:"attribute-mesh-positions",shrinkToFit:a,usage:T.VERTEX|T.COPY_DST}),l=new k({data:i,label:"attribute-mesh-uvs",shrinkToFit:a,usage:T.VERTEX|T.COPY_DST}),h=new k({data:s,label:"index-mesh-buffer",shrinkToFit:a,usage:T.INDEX|T.COPY_DST});super({attributes:{aPosition:{buffer:o,format:"float32x2",stride:8,offset:0},aUV:{buffer:l,format:"float32x2",stride:8,offset:0}},indexBuffer:h,topology:t.topology}),this.batchMode="auto"}get positions(){return this.attributes.aPosition.buffer.data}set positions(e){this.attributes.aPosition.buffer.data=e}get uvs(){return this.attributes.aUV.buffer.data}set uvs(e){this.attributes.aUV.buffer.data=e}get indices(){return this.indexBuffer.data}set indices(e){this.indexBuffer.data=e}};Fe.defaultOptions={topology:"triangle-list",shrinkBuffersToFit:!1};let Ie=Fe;class _t{constructor(){this.batcherName="default",this.packAsQuad=!1,this.indexOffset=0,this.attributeOffset=0,this.roundPixels=0,this._batcher=null,this._batch=null,this._textureMatrixUpdateId=-1,this._uvUpdateId=-1}get blendMode(){return this.renderable.groupBlendMode}get topology(){return this._topology||this.geometry.topology}set topology(e){this._topology=e}reset(){this.renderable=null,this.texture=null,this._batcher=null,this._batch=null,this.geometry=null,this._uvUpdateId=-1,this._textureMatrixUpdateId=-1}setTexture(e){this.texture!==e&&(this.texture=e,this._textureMatrixUpdateId=-1)}get uvs(){const t=this.geometry.getBuffer("aUV"),r=t.data;let i=r;const s=this.texture.textureMatrix;return s.isSimple||(i=this._transformedUvs,(this._textureMatrixUpdateId!==s._updateID||this._uvUpdateId!==t._updateID)&&((!i||i.length<r.length)&&(i=this._transformedUvs=new Float32Array(r.length)),this._textureMatrixUpdateId=s._updateID,this._uvUpdateId=t._updateID,s.multiplyUvs(r,i))),i}get positions(){return this.geometry.positions}get indices(){return this.geometry.indices}get color(){return this.renderable.groupColorAlpha}get groupTransform(){return this.renderable.groupTransform}get attributeSize(){return this.geometry.positions.length/2}get indexSize(){return this.geometry.indices.length}}class wt{constructor({matrix:e,observer:t}={}){this.dirty=!0,this._matrix=e??new U,this.observer=t,this.position=new V(this,0,0),this.scale=new V(this,1,1),this.pivot=new V(this,0,0),this.skew=new V(this,0,0),this._rotation=0,this._cx=1,this._sx=0,this._cy=0,this._sy=1}get matrix(){const e=this._matrix;return this.dirty&&(e.a=this._cx*this.scale.x,e.b=this._sx*this.scale.x,e.c=this._cy*this.scale.y,e.d=this._sy*this.scale.y,e.tx=this.position.x-(this.pivot.x*e.a+this.pivot.y*e.c),e.ty=this.position.y-(this.pivot.x*e.b+this.pivot.y*e.d),this.dirty=!1),e}_onUpdate(e){this.dirty=!0,e===this.skew&&this.updateSkew(),this.observer?._onUpdate(this)}updateSkew(){this._cx=Math.cos(this._rotation+this.skew.y),this._sx=Math.sin(this._rotation+this.skew.y),this._cy=-Math.sin(this._rotation-this.skew.x),this._sy=Math.cos(this._rotation-this.skew.x),this.dirty=!0}toString(){return`[pixi.js/math:Transform position=(${this.position.x}, ${this.position.y}) rotation=${this.rotation} scale=(${this.scale.x}, ${this.scale.y}) skew=(${this.skew.x}, ${this.skew.y}) ]`}setFromMatrix(e){e.decompose(this),this.dirty=!0}get rotation(){return this._rotation}set rotation(e){this._rotation!==e&&(this._rotation=e,this._onUpdate(this.skew))}}const W=new U,z=new U,w=[new Y,new Y,new Y,new Y];class Ve{constructor(e){this._renderer=e}validateRenderable(e){return!1}addRenderable(e,t){this._renderer.renderPipes.batch.break(t),t.add(e)}updateRenderable(e){}execute(e){const t=this._renderer,r=t.canvasContext,i=r.activeContext;i.save(),r.setBlendMode(e.groupBlendMode);const s=t.globalUniforms.globalUniformData?.worldColor??4294967295,a=e.groupColorAlpha,o=(s>>>24&255)/255,l=(a>>>24&255)/255,h=t.filter?.alphaMultiplier??1,u=o*l*h;if(u<=0){i.restore();return}i.globalAlpha=u;const c=s&16777215,f=a&16777215,m=te(_e(f,c)),d=e.texture,p=Oe.getTintedPattern(d,m),x=e.width,b=e.height,g=e.groupTransform,_=d.source._resolution??d.source.resolution??1;z.copyFrom(e._tileTransform.matrix),e.applyAnchorToTexture||z.translate(-e.anchor.x*x,-e.anchor.y*b);const S=z.tx,L=z.ty;z.scale(1/_,1/_),z.tx=S,z.ty=L,W.identity(),W.prepend(z),W.prepend(g);const G=t._roundPixels|e._roundPixels;r.setContextTransform(W,G===1),i.fillStyle=p;const O=e.anchor.x*-x,A=e.anchor.y*-b;w[0].set(O,A),w[1].set(O+x,A),w[2].set(O+x,A+b),w[3].set(O,A+b);for(let y=0;y<4;y++)z.applyInverse(w[y],w[y]);i.beginPath(),i.moveTo(w[0].x,w[0].y);for(let y=1;y<4;y++)i.lineTo(w[y].x,w[y].y);i.closePath(),i.fill(),i.restore()}destroy(){this._renderer=null}}Ve.extension={type:[v.CanvasPipes],name:"tilingSprite"};const Tt={name:"tiling-bit",vertex:{header:`
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

        `}};let J,Z;class Ct extends we{constructor(){J??(J=lt({name:"tiling-sprite-shader",bits:[ft,Tt,ct]})),Z??(Z=ut({name:"tiling-sprite-shader",bits:[dt,Pt,ht]}));const e=new re({uMapCoord:{value:new U,type:"mat3x3<f32>"},uClampFrame:{value:new Float32Array([0,0,1,1]),type:"vec4<f32>"},uClampOffset:{value:new Float32Array([0,0]),type:"vec2<f32>"},uTextureTransform:{value:new U,type:"mat3x3<f32>"},uSizeAnchor:{value:new Float32Array([100,100,.5,.5]),type:"vec4<f32>"}});super({glProgram:Z,gpuProgram:J,resources:{localUniforms:new re({uTransformMatrix:{value:new U,type:"mat3x3<f32>"},uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uRound:{value:0,type:"f32"}}),tilingUniforms:e,uTexture:P.EMPTY.source,uSampler:P.EMPTY.source.style}})}updateUniforms(e,t,r,i,s,a){const o=this.resources.tilingUniforms,l=a.width,h=a.height,u=a.textureMatrix,c=o.uniforms.uTextureTransform;c.set(r.a*l/e,r.b*l/t,r.c*h/e,r.d*h/t,r.tx/e,r.ty/t),c.invert(),o.uniforms.uMapCoord=u.mapCoord,o.uniforms.uClampFrame=u.uClampFrame,o.uniforms.uClampOffset=u.uClampOffset,o.uniforms.uTextureTransform=c,o.uniforms.uSizeAnchor[0]=e,o.uniforms.uSizeAnchor[1]=t,o.uniforms.uSizeAnchor[2]=i,o.uniforms.uSizeAnchor[3]=s,a&&(this.resources.uTexture=a.source,this.resources.uSampler=a.source.style)}}class St extends Ie{constructor(){super({positions:new Float32Array([0,0,1,0,1,1,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])})}}function zt(n,e){const t=n.anchor.x,r=n.anchor.y;e[0]=-t*n.width,e[1]=-r*n.height,e[2]=(1-t)*n.width,e[3]=-r*n.height,e[4]=(1-t)*n.width,e[5]=(1-r)*n.height,e[6]=-t*n.width,e[7]=(1-r)*n.height}function Ut(n,e,t,r){let i=0;const s=n.length/e,a=r.a,o=r.b,l=r.c,h=r.d,u=r.tx,c=r.ty;for(t*=e;i<s;){const f=n[t],m=n[t+1];n[t]=a*f+l*m+u,n[t+1]=o*f+h*m+c,t+=e,i++}}function Ot(n,e){const t=n.texture,r=t.frame.width,i=t.frame.height;let s=0,a=0;n.applyAnchorToTexture&&(s=n.anchor.x,a=n.anchor.y),e[0]=e[6]=-s,e[2]=e[4]=1-s,e[1]=e[3]=-a,e[5]=e[7]=1-a;const o=n._tileTransform.matrix,l=U.shared;l.set(o.a*r/n.width,o.b*r/n.height,o.c*i/n.width,o.d*i/n.height,o.tx/n.width,o.ty/n.height),l.invert(),Ut(e,2,0,l)}const $=new St;class At{constructor(){this.canBatch=!0,this.geometry=new Ie({indices:$.indices.slice(),positions:$.positions.slice(),uvs:$.uvs.slice()})}destroy(){this.geometry.destroy(),this.shader?.destroy()}}class ke{constructor(e){this._state=ie.default2d,this._renderer=e,this._managedTilingSprites=new Se({renderer:e,type:"renderable",name:"tilingSprite"})}validateRenderable(e){const t=this._getTilingSpriteData(e),r=t.canBatch;this._updateCanBatch(e);const i=t.canBatch;if(i&&i===r){const{batchableMesh:s}=t;return!s._batcher.checkAndUpdateTexture(s,e.texture)}return r!==i}addRenderable(e,t){const r=this._renderer.renderPipes.batch;this._updateCanBatch(e);const i=this._getTilingSpriteData(e),{geometry:s,canBatch:a}=i;if(a){i.batchableMesh||(i.batchableMesh=new _t);const o=i.batchableMesh;e.didViewUpdate&&(this._updateBatchableMesh(e),o.geometry=s,o.renderable=e,o.transform=e.groupTransform,o.setTexture(e._texture)),o.roundPixels=this._renderer._roundPixels|e._roundPixels,r.addToBatch(o,t)}else r.break(t),i.shader||(i.shader=new Ct),this.updateRenderable(e),t.add(e)}execute(e){const t=this._renderer,{shader:r}=this._getTilingSpriteData(e);r.groups[0]=t.globalUniforms.bindGroup;const i=r.resources.localUniforms.uniforms;i.uTransformMatrix=e.groupTransform,i.uRound=t._roundPixels|e._roundPixels,ze(e.groupColorAlpha,i.uColor,0),this._state.blendMode=Ue(e.groupBlendMode,e.texture._source),t.encoder.draw({geometry:$,shader:r,state:this._state})}updateRenderable(e){const t=this._getTilingSpriteData(e),{canBatch:r}=t;if(r){const{batchableMesh:i}=t;e.didViewUpdate&&this._updateBatchableMesh(e),i._batcher.updateElement(i)}else if(e.didViewUpdate){const{shader:i}=t;i.updateUniforms(e.width,e.height,e._tileTransform.matrix,e.anchor.x,e.anchor.y,e.texture)}}_getTilingSpriteData(e){return e._gpuData[this._renderer.uid]||this._initTilingSpriteData(e)}_initTilingSpriteData(e){const t=new At;return t.renderable=e,e._gpuData[this._renderer.uid]=t,this._managedTilingSprites.add(e),t}_updateBatchableMesh(e){const t=this._getTilingSpriteData(e),{geometry:r}=t,i=e.texture.source.style;i.addressMode!=="repeat"&&(i.addressMode="repeat",i.update()),Ot(e,r.uvs),zt(e,r.positions)}destroy(){this._managedTilingSprites.destroy(),this._renderer=null}_updateCanBatch(e){const t=this._getTilingSpriteData(e),r=e.texture;let i=!0;return this._renderer.type===et.WEBGL&&(i=this._renderer.context.supports.nonPowOf2wrapping),t.canBatch=r.textureMatrix.isSimple&&(i||r.source.isPowerOfTwo),t.canBatch}}ke.extension={type:[v.WebGLPipes,v.WebGPUPipes],name:"tilingSprite"};C.add(Ve);C.add(ke);const De=class H extends Te{constructor(...e){let t=e[0]||{};t instanceof P&&(t={texture:t}),e.length>1&&(B(I,"use new TilingSprite({ texture, width:100, height:100 }) instead"),t.width=e[1],t.height=e[2]),t={...H.defaultOptions,...t};const{texture:r,anchor:i,tilePosition:s,tileScale:a,tileRotation:o,width:l,height:h,applyAnchorToTexture:u,roundPixels:c,...f}=t??{};super({label:"TilingSprite",...f}),this.renderPipeId="tilingSprite",this.batched=!0,this.allowChildren=!1,this._anchor=new V({_onUpdate:()=>{this.onViewUpdate()}}),this.applyAnchorToTexture=u,this.texture=r,this._width=l??r.width,this._height=h??r.height,this._tileTransform=new wt({observer:{_onUpdate:()=>this.onViewUpdate()}}),i&&(this.anchor=i),this.tilePosition=s,this.tileScale=a,this.tileRotation=o,this.roundPixels=c??!1}static from(e,t={}){return typeof e=="string"?new H({texture:ot.get(e),...t}):new H({texture:e,...t})}get uvRespectAnchor(){return B(I,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture}set uvRespectAnchor(e){B(I,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture=e}get clampMargin(){return this._texture.textureMatrix.clampMargin}set clampMargin(e){this._texture.textureMatrix.clampMargin=e}get anchor(){return this._anchor}set anchor(e){typeof e=="number"?this._anchor.set(e):this._anchor.copyFrom(e)}get tilePosition(){return this._tileTransform.position}set tilePosition(e){this._tileTransform.position.copyFrom(e)}get tileScale(){return this._tileTransform.scale}set tileScale(e){typeof e=="number"?this._tileTransform.scale.set(e):this._tileTransform.scale.copyFrom(e)}set tileRotation(e){this._tileTransform.rotation=e}get tileRotation(){return this._tileTransform.rotation}get tileTransform(){return this._tileTransform}set texture(e){e||(e=P.EMPTY);const t=this._texture;t!==e&&(t&&t.dynamic&&t.off("update",this.onViewUpdate,this),e.dynamic&&e.on("update",this.onViewUpdate,this),this._texture=e,this.onViewUpdate())}get texture(){return this._texture}set width(e){this._width=e,this.onViewUpdate()}get width(){return this._width}set height(e){this._height=e,this.onViewUpdate()}get height(){return this._height}setSize(e,t){typeof e=="object"&&(t=e.height??e.width,e=e.width),this._width=e,this._height=t??e,this.onViewUpdate()}getSize(e){return e||(e={}),e.width=this._width,e.height=this._height,e}updateBounds(){const e=this._bounds,t=this._anchor,r=this._width,i=this._height;e.minX=-t._x*r,e.maxX=e.minX+r,e.minY=-t._y*i,e.maxY=e.minY+i}containsPoint(e){const t=this._width,r=this._height,i=-t*this._anchor._x;let s=0;return e.x>=i&&e.x<=i+t&&(s=-r*this._anchor._y,e.y>=s&&e.y<=s+r)}destroy(e=!1){if(super.destroy(e),this._anchor=null,this._tileTransform=null,this._bounds=null,typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource;this._texture.destroy(r)}this._texture=null}};De.defaultOptions={texture:P.EMPTY,anchor:{x:0,y:0},tilePosition:{x:0,y:0},tileScale:{x:1,y:1},tileRotation:0,applyAnchorToTexture:!1};let Mt=De;class Rt{execute(e,t){const r=e.renderer,i=r.canvasContext.activeContext,s=t.particleChildren,a=t.texture;i.save(),r.canvasContext.setContextTransform(t.worldTransform,t.roundPixels),r.canvasContext.setBlendMode(t.groupBlendMode);const o=t.groupColorAlpha,l=r.filter?.alphaMultiplier??1,h=(o>>>24&255)/255*l;for(let u=0;u<s.length;u++){const c=s[u],f=c.texture||a;if(!f?.source?.resource)continue;const m=c.color,d=(m>>>24&255)/255*h;if(d<=0)continue;const p=m&16777215,x=((p&255)<<16)+(p&65280)+(p>>16&255);let b=f.source.resource;x!==16777215&&(b=Oe.getTintedCanvas({texture:f},x));const g=f.frame,_=f.source.resolution,S=g.x*_,L=g.y*_,G=g.width*_,O=g.height*_;i.globalAlpha=d;const A=-c.anchorX*g.width,y=-c.anchorY*g.height;c.rotation!==0||c.scaleX!==1||c.scaleY!==1?(i.save(),i.translate(c.x,c.y),i.rotate(c.rotation),i.scale(c.scaleX,c.scaleY),i.drawImage(b,S,L,G,O,A,y,g.width,g.height),i.restore()):i.drawImage(b,S,L,G,O,c.x+A,c.y+y,g.width,g.height)}i.restore()}}function xe(n,e=null){const t=n*6;if(t>65535?e||(e=new Uint32Array(t)):e||(e=new Uint16Array(t)),e.length!==t)throw new Error(`Out buffer length is incorrect, got ${e.length} and expected ${t}`);for(let r=0,i=0;r<t;r+=6,i+=4)e[r+0]=i+0,e[r+1]=i+1,e[r+2]=i+2,e[r+3]=i+0,e[r+4]=i+2,e[r+5]=i+3;return e}function Bt(n){return{dynamicUpdate:ge(n,!0),staticUpdate:ge(n,!1)}}function ge(n,e){const t=[];t.push(`

        var index = 0;

        for (let i = 0; i < ps.length; ++i)
        {
            const p = ps[i];

            `);let r=0;for(const s in n){const a=n[s];if(e!==a.dynamic)continue;t.push(`offset = index + ${r}`),t.push(a.code);const o=se(a.format);r+=o.stride/4}t.push(`
            index += stride * 4;
        }
    `),t.unshift(`
        var stride = ${r};
        var offset = 0, w0 = 0, w1 = 0, h0 = 0, h1 = 0;
    `);const i=t.join(`
`);return new Function("ps","f32v","u32v",i)}class Ft{constructor(e){this._size=0,this._generateParticleUpdateCache={};const t=this._size=e.size??1e3,r=e.properties;let i=0,s=0;for(const u in r){const c=r[u],f=se(c.format);c.dynamic?s+=f.stride:i+=f.stride}this._dynamicStride=s/4,this._staticStride=i/4,this.staticAttributeBuffer=new X(t*4*i),this.dynamicAttributeBuffer=new X(t*4*s),this.indexBuffer=xe(t);const a=new be;let o=0,l=0;this._staticBuffer=new k({data:new Float32Array(1),label:"static-particle-buffer",shrinkToFit:!1,usage:T.VERTEX|T.COPY_DST}),this._dynamicBuffer=new k({data:new Float32Array(1),label:"dynamic-particle-buffer",shrinkToFit:!1,usage:T.VERTEX|T.COPY_DST});for(const u in r){const c=r[u],f=se(c.format);c.dynamic?(a.addAttribute(c.attributeName,{buffer:this._dynamicBuffer,stride:this._dynamicStride*4,offset:o*4,format:c.format}),o+=f.size):(a.addAttribute(c.attributeName,{buffer:this._staticBuffer,stride:this._staticStride*4,offset:l*4,format:c.format}),l+=f.size)}a.addIndex(this.indexBuffer);const h=this.getParticleUpdate(r);this._dynamicUpload=h.dynamicUpdate,this._staticUpload=h.staticUpdate,this.geometry=a}getParticleUpdate(e){const t=Et(e);return this._generateParticleUpdateCache[t]?this._generateParticleUpdateCache[t]:(this._generateParticleUpdateCache[t]=this.generateParticleUpdate(e),this._generateParticleUpdateCache[t])}generateParticleUpdate(e){return Bt(e)}update(e,t){e.length>this._size&&(t=!0,this._size=Math.max(e.length,this._size*1.5|0),this.staticAttributeBuffer=new X(this._size*this._staticStride*4*4),this.dynamicAttributeBuffer=new X(this._size*this._dynamicStride*4*4),this.indexBuffer=xe(this._size),this.geometry.indexBuffer.setDataWithSize(this.indexBuffer,this.indexBuffer.byteLength,!0));const r=this.dynamicAttributeBuffer;if(this._dynamicUpload(e,r.float32View,r.uint32View),this._dynamicBuffer.setDataWithSize(this.dynamicAttributeBuffer.float32View,e.length*this._dynamicStride*4,!0),t){const i=this.staticAttributeBuffer;this._staticUpload(e,i.float32View,i.uint32View),this._staticBuffer.setDataWithSize(i.float32View,e.length*this._staticStride*4,!0)}}destroy(){this._staticBuffer.destroy(),this._dynamicBuffer.destroy(),this.geometry.destroy()}}function Et(n){const e=[];for(const t in n){const r=n[t];e.push(t,r.code,r.dynamic?"d":"s")}return e.join("_")}var It=`varying vec2 vUV;
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
}`;class kt extends we{constructor(){const e=j.from({vertex:Vt,fragment:It}),t=K.from({fragment:{source:ye,entryPoint:"mainFragment"},vertex:{source:ye,entryPoint:"mainVertex"}});super({glProgram:e,gpuProgram:t,resources:{uTexture:P.WHITE.source,uSampler:new tt({}),uniforms:{uTranslationMatrix:{value:new U,type:"mat3x3<f32>"},uColor:{value:new Pe(16777215),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}}})}}class Q{constructor(e,t){this.state=ie.for2d(),this.localUniforms=new re({uTranslationMatrix:{value:new U,type:"mat3x3<f32>"},uColor:{value:new Float32Array(4),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}),this.renderer=e,this.adaptor=t,this.defaultShader=new kt,this.state=ie.for2d(),this._managedContainers=new Se({renderer:e,type:"renderable",name:"particleContainer"})}validateRenderable(e){return!1}addRenderable(e,t){this.renderer.renderPipes.batch.break(t),t.add(e)}getBuffers(e){return e._gpuData[this.renderer.uid]||this._initBuffer(e)}_initBuffer(e){return e._gpuData[this.renderer.uid]=new Ft({size:e.particleChildren.length,properties:e._properties}),this._managedContainers.add(e),e._gpuData[this.renderer.uid]}updateRenderable(e){}execute(e){const t=e.particleChildren;if(t.length===0)return;const r=this.renderer,i=this.getBuffers(e);e.texture||(e.texture=t[0].texture);const s=this.state;i.update(t,e._childrenDirty),e._childrenDirty=!1,s.blendMode=Ue(e.groupBlendMode,e.texture._source);const a=this.localUniforms.uniforms,o=a.uTranslationMatrix;e.worldTransform.copyTo(o);const l=r.globalUniforms.globalUniformData;o.tx-=l.offset.x,o.ty-=l.offset.y,o.prepend(l.projectionMatrix),a.uResolution=l.resolution,a.uRound=r._roundPixels|e._roundPixels;const h=e.groupColorAlpha,u=l.worldColor,c=(h>>>24)*(u>>>24)/255|0,f=_e(h&16777215,u&16777215);ze((c<<24|f)>>>0,a.uColor,0),this.adaptor.execute(this,e)}destroy(){this._managedContainers.destroy(),this.renderer=null,this.defaultShader&&(this.defaultShader.destroy(),this.defaultShader=null)}}Q.extension={type:[v.CanvasPipes],name:"particle"};class Le extends Q{constructor(e){super(e,new Rt)}}Le.extension={type:[v.CanvasPipes],name:"particle"};class Dt{execute(e,t){const r=e.state,i=e.renderer,s=t.shader||e.defaultShader;s.resources.uTexture=t.texture._source,s.resources.uniforms=e.localUniforms;const a=i.gl,o=e.getBuffers(t);i.shader.bind(s),i.state.set(r),i.geometry.bind(o.geometry,s.glProgram);const h=o.geometry.indexBuffer.data.BYTES_PER_ELEMENT===2?a.UNSIGNED_SHORT:a.UNSIGNED_INT;a.drawElements(a.TRIANGLES,t.particleChildren.length*6,h,0)}}class Ge extends Q{constructor(e){super(e,new Dt)}}Ge.extension={type:[v.WebGLPipes],name:"particle"};class Lt{execute(e,t){const r=e.renderer,i=t.shader||e.defaultShader;i.groups[0]=r.renderPipes.uniformBatch.getUniformBindGroup(e.localUniforms,!0),i.groups[1]=r.texture.getTextureBindGroup(t.texture);const s=e.state,a=e.getBuffers(t);r.encoder.draw({geometry:a.geometry,shader:t.shader||e.defaultShader,state:s,size:t.particleChildren.length*6})}}class Ye extends Q{constructor(e){super(e,new Lt)}}Ye.extension={type:[v.WebGPUPipes],name:"particle"};const Xe=class oe{constructor(e){if(e instanceof P)this.texture=e,de(this,oe.defaultOptions,{});else{const t={...oe.defaultOptions,...e};de(this,t,{})}}get alpha(){return this._alpha}set alpha(e){this._alpha=Math.min(Math.max(e,0),1),this._updateColor()}get tint(){return te(this._tint)}set tint(e){this._tint=typeof e=="number"?te(e):Pe.shared.setValue(e??16777215).toBgrNumber(),this._updateColor()}_updateColor(){this.color=this._tint+((this._alpha*255|0)<<24)}};Xe.defaultOptions={anchorX:0,anchorY:0,x:0,y:0,scaleX:1,scaleY:1,rotation:0,tint:16777215,alpha:1};let Ne=Xe;const ve={vertex:{attributeName:"aVertex",format:"float32x2",code:`
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
        `,dynamic:!1}};C.add(Ge);C.add(Ye);C.add(Le);const Gt=new rt(0,0,0,0),Yt=48,qe=class ae extends Te{constructor(e={}){e={...ae.defaultOptions,...e,dynamicProperties:{...ae.defaultOptions.dynamicProperties,...e?.dynamicProperties}};const{dynamicProperties:t,shader:r,roundPixels:i,texture:s,particles:a,...o}=e;super({label:"ParticleContainer",...o}),this.renderPipeId="particle",this.batched=!1,this._childrenDirty=!1,this.texture=s||null,this.shader=r,this._properties={};for(const l in ve){const h=ve[l],u=t[l];this._properties[l]={...h,dynamic:u}}this.allowChildren=!0,this.roundPixels=i??!1,this.particleChildren=a??[]}addParticle(...e){for(let t=0;t<e.length;t++)this.particleChildren.push(e[t]);return this.onViewUpdate(),e[0]}removeParticle(...e){if(e.length>Yt)return this._removeParticlesInOnePass(e)&&this.onViewUpdate(),e[0];let t=!1;for(let r=0;r<e.length;r++){const i=this.particleChildren.indexOf(e[r]);i>-1&&(this.particleChildren.splice(i,1),t=!0)}return t&&this.onViewUpdate(),e[0]}_removeParticlesInOnePass(e){const t=new Map;for(let a=0;a<e.length;a++){const o=e[a];t.set(o,(t.get(o)??0)+1)}const r=this.particleChildren,i=r.length;let s=0;for(let a=0;a<i;a++){const o=r[a],l=t.get(o);l?t.set(o,l-1):r[s++]=o}return r.length=s,s!==i}update(){this._childrenDirty=!0}onViewUpdate(){this._childrenDirty=!0,super.onViewUpdate()}get bounds(){return Gt}updateBounds(){}destroy(e=!1){if(super.destroy(e),typeof e=="boolean"?e:e?.texture){const r=typeof e=="boolean"?e:e?.textureSource,i=this.texture??this.particleChildren[0]?.texture;i&&i.destroy(r)}this.texture=null,this.shader?.destroy()}removeParticles(e,t){e??(e=0),t??(t=this.particleChildren.length);const r=this.particleChildren.splice(e,t-e);return this.onViewUpdate(),r}removeParticleAt(e){const t=this.particleChildren.splice(e,1);return this.onViewUpdate(),t[0]}addParticleAt(e,t){return this.particleChildren.splice(t,0,e),this.onViewUpdate(),e}addChild(...e){throw new Error("ParticleContainer.addChild() is not available. Please use ParticleContainer.addParticle()")}removeChild(...e){throw new Error("ParticleContainer.removeChild() is not available. Please use ParticleContainer.removeParticle()")}removeChildren(e,t){throw new Error("ParticleContainer.removeChildren() is not available. Please use ParticleContainer.removeParticles()")}removeChildAt(e){throw new Error("ParticleContainer.removeChildAt() is not available. Please use ParticleContainer.removeParticleAt()")}getChildAt(e){throw new Error("ParticleContainer.getChildAt() is not available. Please use ParticleContainer.getParticleAt()")}setChildIndex(e,t){throw new Error("ParticleContainer.setChildIndex() is not available. Please use ParticleContainer.setParticleIndex()")}getChildIndex(e){throw new Error("ParticleContainer.getChildIndex() is not available. Please use ParticleContainer.getParticleIndex()")}addChildAt(e,t){throw new Error("ParticleContainer.addChildAt() is not available. Please use ParticleContainer.addParticleAt()")}swapChildren(e,t){throw new Error("ParticleContainer.swapChildren() is not available. Please use ParticleContainer.swapParticles()")}reparentChild(...e){throw new Error("ParticleContainer.reparentChild() is not available with the particle container")}reparentChildAt(e,t){throw new Error("ParticleContainer.reparentChildAt() is not available with the particle container")}};qe.defaultOptions={dynamicProperties:{vertex:!1,position:!0,rotation:!1,uvs:!1,color:!1},roundPixels:!1};let le=qe;C.add(xt,gt);class Xt{constructor(e=1024){if(!Number.isInteger(e)||e<8)throw new RangeError("Atlas size must be an integer of at least 8 pixels");this.size=e,this.canvas=document.createElement("canvas"),this.canvas.width=this.canvas.height=e,this.ctx=this.canvas.getContext("2d"),this.x=this.y=2,this.rowHeight=0,this.frames=new Map,this.textures=new Map,this.source=null}register(e,t,r,i,{makeWhite:s=!0}={}){if(this.source||this.frames.has(e)||this.frames.has(e+"_white"))throw new Error("Invalid or duplicate atlas frame: "+e);if(typeof e!="string"||!e||!Number.isInteger(t)||!Number.isInteger(r)||t<=0||r<=0||typeof i!="function")throw new TypeError("Atlas frames require a name, positive integer dimensions and a draw function");const a=document.createElement("canvas");a.width=t,a.height=r;const o=a.getContext("2d");i(o,t,r),this.pack(e,a),s&&(o.globalCompositeOperation="source-in",o.fillStyle="#ffffff",o.fillRect(0,0,t,r),this.pack(e+"_white",a))}registerImage(e,t,{width:r=t?.width,height:i=t?.height,makeWhite:s=!0}={}){if(!(t?.width>0&&t?.height>0))throw new TypeError("Atlas image must be decoded and have positive dimensions: "+e);this.register(e,r,i,(a,o,l)=>{const h=Math.min(o/t.width,l/t.height),u=t.width*h,c=t.height*h;a.drawImage(t,(o-u)/2,(l-c)/2,u,c)},{makeWhite:s})}pack(e,t){const{width:r,height:i}=t;if(r+4>this.size||i+4>this.size)throw new RangeError("Atlas frame too large: "+e);if(this.x+r+2>this.size&&(this.x=2,this.y+=this.rowHeight+4,this.rowHeight=0),this.y+i+2>this.size)throw new RangeError("Procedural atlas is full");this.ctx.drawImage(t,this.x,this.y),this.frames.set(e,new it(this.x,this.y,r,i)),this.x+=r+4,this.rowHeight=Math.max(this.rowHeight,i)}build(){if(this.source)return this;this.source=new st({resource:this.canvas,scaleMode:"linear"});for(const[e,t]of this.frames)this.textures.set(e,new P({source:this.source,frame:t}));return this}get(e){return this.textures.get(e)??P.WHITE}dispose(){for(const e of this.textures.values())e.destroy();this.textures.clear(),this.source?.destroy(),this.source=null}}function dr({playerImage:n=null,enemyImage:e=null,eliteImage:t=e,extraFrames:r=[],size:i=1024}={}){const s=new Xt(i),a=(l,h=.4)=>(u,c,f)=>{u.fillStyle=l,u.beginPath(),u.arc(c/2,f/2,Math.min(c,f)*h,0,Math.PI*2),u.fill()},o=l=>(h,u,c)=>{if(!(l?.width>0&&l?.height>0))throw new TypeError("Character image must be decoded and have positive dimensions");const f=Math.min(u/l.width,c/l.height),m=l.width*f,d=l.height*f;h.drawImage(l,(u-m)/2,(c-d)/2,m,d)};s.register("player_hero",64,64,n?o(n):a("#53eccc")),s.register("enemy_chaser",40,40,e?o(e):a("#fa536e")),s.register("enemy_elite",56,56,t?o(t):a("#ffad53")),s.register("bullet_orb",20,20,a("#92faff")),s.register("particle_soft",20,20,(l,h,u)=>{const c=l.createRadialGradient(h/2,u/2,0,h/2,u/2,h/2);c.addColorStop(0,"#fff"),c.addColorStop(1,"#ffffff00"),l.fillStyle=c,l.fillRect(0,0,h,u)}),s.register("particle_spark",12,12,(l,h,u)=>{l.fillStyle="#fff",l.beginPath(),l.moveTo(h/2,0),l.lineTo(h,u/2),l.lineTo(h/2,u),l.lineTo(0,u/2),l.closePath(),l.fill()}),s.register("slash_trail",128,16,(l,h,u)=>{const c=l.createLinearGradient(0,0,h,0);c.addColorStop(0,"#ffffff00"),c.addColorStop(1,"#ffffffff"),l.fillStyle=c,l.fillRect(0,0,h,u)}),s.register("shadow_oval",48,20,(l,h,u)=>{l.fillStyle="#0008",l.beginPath(),l.ellipse(h/2,u/2,h/2,u/2,0,0,Math.PI*2),l.fill()},{makeWhite:!1}),s.register("ground_grid",128,128,(l,h,u)=>{l.fillStyle="#101b2a",l.fillRect(0,0,h,u),l.strokeStyle="#244256",l.lineWidth=1,l.strokeRect(.5,.5,h-1,u-1)},{makeWhite:!1});for(const l of r)s.registerImage(l.name,l.image,l);return s.build()}var ce=`in vec2 aPosition;
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
`,he=`struct GlobalFilterUniforms {
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
}`,Nt=`
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
}`,Ht=Object.defineProperty,jt=(n,e,t)=>e in n?Ht(n,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):n[e]=t,M=(n,e,t)=>(jt(n,typeof e!="symbol"?e+"":e,t),t);const We=class $e extends ue{constructor(...e){let t=e[0]??{};(typeof t=="number"||Array.isArray(t))&&(B("6.0.0","KawaseBlurFilter constructor params are now options object. See params: { strength, quality, clamp, pixelSize }"),t={strength:t},e[1]!==void 0&&(t.quality=e[1]),e[2]!==void 0&&(t.clamp=e[2])),t={...$e.DEFAULT_OPTIONS,...t};const r=K.from({vertex:{source:he,entryPoint:"mainVertex"},fragment:{source:t?.clamp?$t:qt,entryPoint:"mainFragment"}}),i=j.from({vertex:ce,fragment:t?.clamp?Wt:Nt,name:"kawase-blur-filter"});super({gpuProgram:r,glProgram:i,resources:{kawaseBlurUniforms:{uOffset:{value:new Float32Array(2),type:"vec2<f32>"}}}}),M(this,"uniforms"),M(this,"_pixelSize",{x:0,y:0}),M(this,"_clamp"),M(this,"_kernels",[]),M(this,"_blur"),M(this,"_quality"),this.uniforms=this.resources.kawaseBlurUniforms.uniforms,this.pixelSize=t.pixelSize??{x:1,y:1},Array.isArray(t.strength)?this.kernels=t.strength:typeof t.strength=="number"&&(this._blur=t.strength,this.quality=t.quality??3),this._clamp=!!t.clamp}apply(e,t,r,i){const s=this.pixelSizeX/t.source.width,a=this.pixelSizeY/t.source.height;let o;if(this._quality===1||this._blur===0)o=this._kernels[0]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*a,e.applyFilter(this,t,r,i);else{const l=E.getSameSizeTexture(t);let h=t,u=l,c;const f=this._quality-1;for(let m=0;m<f;m++)o=this._kernels[m]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*a,e.applyFilter(this,h,u,!0),c=h,h=u,u=c;o=this._kernels[f]+.5,this.uniforms.uOffset[0]=o*s,this.uniforms.uOffset[1]=o*a,e.applyFilter(this,h,r,i),E.returnTexture(l)}}get strength(){return this._blur}set strength(e){this._blur=e,this._generateKernels()}get quality(){return this._quality}set quality(e){this._quality=Math.max(1,Math.round(e)),this._generateKernels()}get kernels(){return this._kernels}set kernels(e){Array.isArray(e)&&e.length>0?(this._kernels=e,this._quality=e.length,this._blur=Math.max(...e)):(this._kernels=[0],this._quality=1)}get pixelSize(){return this._pixelSize}set pixelSize(e){if(typeof e=="number"){this.pixelSizeX=this.pixelSizeY=e;return}if(Array.isArray(e)){this.pixelSizeX=e[0],this.pixelSizeY=e[1];return}this._pixelSize=e}get pixelSizeX(){return this.pixelSize.x}set pixelSizeX(e){this.pixelSize.x=e}get pixelSizeY(){return this.pixelSize.y}set pixelSizeY(e){this.pixelSize.y=e}get clamp(){return this._clamp}_updatePadding(){this.padding=Math.ceil(this._kernels.reduce((e,t)=>e+t+.5,0))}_generateKernels(){const e=this._blur,t=this._quality,r=[e];if(e>0){let i=e;const s=e/t;for(let a=1;a<t;a++)i-=s,r.push(i)}this._kernels=r,this._updatePadding()}};M(We,"DEFAULT_OPTIONS",{strength:4,quality:3,clamp:!1,pixelSize:{x:1,y:1}});let Kt=We;var Qt=`in vec2 vTextureCoord;
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
`,tr=Object.defineProperty,rr=(n,e,t)=>e in n?tr(n,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):n[e]=t,He=(n,e,t)=>(rr(n,typeof e!="symbol"?e+"":e,t),t);const je=class Ke extends ue{constructor(e){e={...Ke.DEFAULT_OPTIONS,...e};const t=K.from({vertex:{source:he,entryPoint:"mainVertex"},fragment:{source:er,entryPoint:"mainFragment"}}),r=j.from({vertex:ce,fragment:Zt,name:"extract-brightness-filter"});super({gpuProgram:t,glProgram:r,resources:{extractBrightnessUniforms:{uThreshold:{value:e.threshold,type:"f32"}}}}),He(this,"uniforms"),this.uniforms=this.resources.extractBrightnessUniforms.uniforms}get threshold(){return this.uniforms.uThreshold}set threshold(e){this.uniforms.uThreshold=e}};He(je,"DEFAULT_OPTIONS",{threshold:.5});let ir=je;var sr=Object.defineProperty,nr=(n,e,t)=>e in n?sr(n,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):n[e]=t,F=(n,e,t)=>(nr(n,typeof e!="symbol"?e+"":e,t),t);const Qe=class Je extends ue{constructor(e){e={...Je.DEFAULT_OPTIONS,...e};const t=K.from({vertex:{source:he,entryPoint:"mainVertex"},fragment:{source:Jt,entryPoint:"mainFragment"}}),r=j.from({vertex:ce,fragment:Qt,name:"advanced-bloom-filter"});super({gpuProgram:t,glProgram:r,resources:{advancedBloomUniforms:{uBloomScale:{value:e.bloomScale,type:"f32"},uBrightness:{value:e.brightness,type:"f32"}},uMapTexture:P.WHITE}}),F(this,"uniforms"),F(this,"bloomScale",1),F(this,"brightness",1),F(this,"_extractFilter"),F(this,"_blurFilter"),this.uniforms=this.resources.advancedBloomUniforms.uniforms,this._extractFilter=new ir({threshold:e.threshold}),this._blurFilter=new Kt({strength:e.kernels??e.blur,quality:e.kernels?void 0:e.quality}),Object.assign(this,e)}apply(e,t,r,i){const s=E.getSameSizeTexture(t);this._extractFilter.apply(e,t,s,!0);const a=E.getSameSizeTexture(t);this._blurFilter.apply(e,s,a,!0),this.uniforms.uBloomScale=this.bloomScale,this.uniforms.uBrightness=this.brightness,this.resources.uMapTexture=a.source,e.applyFilter(this,t,r,i),E.returnTexture(a),E.returnTexture(s)}get threshold(){return this._extractFilter.threshold}set threshold(e){this._extractFilter.threshold=e}get kernels(){return this._blurFilter.kernels}set kernels(e){this._blurFilter.kernels=e}get blur(){return this._blurFilter.strength}set blur(e){this._blurFilter.strength=e}get quality(){return this._blurFilter.quality}set quality(e){this._blurFilter.quality=e}get pixelSize(){return this._blurFilter.pixelSize}set pixelSize(e){typeof e=="number"&&(e={x:e,y:e}),Array.isArray(e)&&(e={x:e[0],y:e[1]}),this._blurFilter.pixelSize=e}get pixelSizeX(){return this._blurFilter.pixelSizeX}set pixelSizeX(e){this._blurFilter.pixelSizeX=e}get pixelSizeY(){return this._blurFilter.pixelSizeY}set pixelSizeY(e){this._blurFilter.pixelSizeY=e}};F(Qe,"DEFAULT_OPTIONS",{threshold:.5,bloomScale:1,brightness:1,blur:8,quality:4,pixelSize:{x:1,y:1}});let or=Qe;class ar{constructor(e,{textures:t=["enemy_chaser"],scale:r=1,worldScale:i=1,offsetX:s=0,offsetY:a=0,syncRotation:o=!1,flipByDirection:l=!1,cull:h=!0}={}){if(!e?.worldRoot||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a swarm layer");if(!Array.isArray(t)||t.length===0||t.some(u=>typeof u!="string"||!e.atlas.textures.has(u)))throw new TypeError("Swarm textures must be existing atlas frame names");if(![r,i,s,a].every(Number.isFinite)||r<=0||i<=0)throw new RangeError("Swarm scale and worldScale must be positive and offsets must be finite");this.renderer=e,this.scale=r,this.worldScale=i,this.offsetX=s,this.offsetY=a,this.syncRotation=!!o,this.flipByDirection=!!l,this.cull=!!h,this.frames=t.map(u=>{const c=e.atlas.textures.get(u);return{texture:c,white:e.atlas.textures.get(u+"_white")??c,radius:Math.hypot(c.orig.width,c.orig.height)*.5}}),this.layer=new le({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),e.worldRoot.addChildAt(this.layer,e.worldRoot.getChildIndex(e.entityLayer)),this.particles=[],this.pool=[],this.pendingParticles=[],this.visibleCount=0,this.disposed=!1}sync(e){if(this.disposed)throw new Error("Swarm layer is disposed");if(!e?.activeIds||!e.posX||!e.posY||!Number.isInteger(e.count))throw new TypeError("sync requires an HGame CPU SwarmSimulation");const t=e.count;if(t<0||t>e.activeIds.length)throw new RangeError("Swarm count exceeds active ID capacity");const r=this.renderer.camera,i=this.renderer.app.screen,s=i.width/2,a=i.height/2,o=r.zoom;if(!(o>0)||!Number.isFinite(o))throw new RangeError("Camera zoom must be finite and positive");let l=0;for(let h=0;h<t;h++){const u=e.activeIds[h],c=e.posX[u]*this.worldScale+this.offsetX,f=e.posY[u]*this.worldScale+this.offsetY,m=this.frames[(e.animClip?.[u]??0)%this.frames.length],d=(e.scale?.[u]??1)*this.scale;if(this.cull){const g=(c-r.x)*o+s+r.shakeX,_=(f-r.y)*o+a+r.shakeY,S=m.radius*Math.abs(d)*o;if(g+S<0||g-S>i.width||_+S<0||_-S>i.height)continue}let p=this.particles[l];const x=e.flash?.[u]>0?m.white:m.texture;p||(p=this.pool.pop()??new Ne({texture:x,anchorX:.5,anchorY:.5}),this.particles.push(p),this.pendingParticles.push(p),this.pendingParticles.length===4096&&this.flushPending()),p.texture!==x&&(p.texture=x),p.x=c,p.y=f;const b=e.rot?.[u]??0;p.rotation=this.syncRotation?b:0,p.scaleX=this.flipByDirection&&Math.sin(b)<0?-d:d,p.scaleY=d,l++}if(this.flushPending(),l<this.particles.length){const h=this.layer.removeParticles(l);this.particles.length=l;for(const u of h)this.pool.push(u)}return this.visibleCount=l,l}flushPending(){this.pendingParticles.length&&this.layer.addParticle(...this.pendingParticles),this.pendingParticles.length=0}dispose(){this.disposed||(this.disposed=!0,this.layer.removeFromParent(),this.layer.destroy(),this.particles.length=0,this.pool.length=0,this.pendingParticles.length=0,this.visibleCount=0,this.renderer.swarmLayers.delete(this))}}class pr{constructor(e,{maxPixels:t=23e5,maxPixelRatio:r=2}={}){if(!Number.isFinite(t)||t<1||!Number.isFinite(r)||r<=0)throw new RangeError("Renderer pixel budget and maximum pixel ratio must be positive");this.atlas=e,this.maxPixels=t,this.maxPixelRatio=r,this.app=new Be,this.entityMap=new Map,this.spritePool=[],this.swarmLayers=new Set,this.camera={x:0,y:0,targetX:0,targetY:0,zoom:1,shakeX:0,shakeY:0}}async init(e){this.mount=e;const{width:t,height:r,resolution:i}=this.planViewport();await this.app.init({preference:"webgpu",width:t,height:r,resolution:i,autoDensity:!0,backgroundColor:725019,autoStart:!1}),this.app.ticker.stop(),this.app.canvas.id="game",this.app.canvas.setAttribute("aria-label","游戏画面"),e.appendChild(this.app.canvas),this.worldRoot=new R,this.worldRoot.eventMode="none",this.worldRoot.interactiveChildren=!1,this.bgLayer=new R;const s=new Mt({texture:this.atlas.get("ground_grid"),width:4096,height:4096});s.position.set(-2048,-2048),this.bgLayer.addChild(s),this.shadowLayer=new R,this.entityLayer=new R({sortableChildren:!0}),this.enemyLayer=new le({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),this.enemyParticles=[],this.enemyPool=[],this.pendingEnemies=[],this.trailLayer=new R,this.particleLayer=new le({dynamicProperties:{position:!0,vertex:!0,rotation:!0,color:!0,uvs:!0}}),this.worldRoot.addChild(this.bgLayer,this.shadowLayer,this.enemyLayer,this.entityLayer,this.trailLayer,this.particleLayer),this.app.stage.addChild(this.worldRoot),this.bloom=new or({threshold:.62,bloomScale:.4,brightness:1,blur:3}),this.app.stage.filters=[],this.viewport={width:t,height:r,resolution:i},typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(e))}planViewport(){const e=Math.max(1,Math.floor(this.mount?.clientWidth||1)),t=Math.max(1,Math.floor(this.mount?.clientHeight||1)),r=Number(globalThis.devicePixelRatio)||1,i=Math.max(1/Math.min(e,t),Math.min(r,this.maxPixelRatio,Math.sqrt(this.maxPixels/(e*t))));return{width:e,height:t,resolution:i}}resize(){if(this.disposed||!this.app.renderer)return!1;const e=this.planViewport(),t=this.viewport;return t&&t.width===e.width&&t.height===e.height&&t.resolution===e.resolution?!1:(this.app.renderer.resize(e.width,e.height,e.resolution),this.viewport=e,this.onResize?.(),!0)}createSwarmLayer(e){const t=new ar(this,e);return this.swarmLayers.add(t),t}syncEnemies(e,t){if(this.enemyParticles.length>e.length){const r=this.enemyLayer.removeParticles(e.length);this.enemyParticles.length=e.length;for(const i of r)this.enemyPool.push(i)}for(let r=0;r<e.length;r++){const i=e[r];let s=this.enemyParticles[r];const a=(i.elite?"enemy_elite":"enemy_chaser")+(i.flash>0?"_white":"");s||(s=this.enemyPool.pop()??new Ne({texture:this.atlas.get(a),anchorX:.5,anchorY:.5}),this.enemyParticles.push(s),this.pendingEnemies.push(s),this.pendingEnemies.length===4096&&this.flushEnemies()),s.texture=this.atlas.get(a),s.x=i.x,s.y=i.y;const o=t*7+i.id*.37;s.rotation=Math.sin(o)*.09,s.scaleX=1+Math.sin(o*2)*.035,s.scaleY=1-Math.sin(o*2)*.05}this.flushEnemies()}flushEnemies(){this.pendingEnemies.length&&this.enemyLayer.addParticle(...this.pendingEnemies),this.pendingEnemies.length=0}alloc(e){const t=this.spritePool.pop()??new nt;return t.texture=this.atlas.get(e),t.anchor.set(.5),t.alpha=1,t.tint=16777215,t.scale.set(1),t.rotation=0,t.visible=!0,t}syncEntity(e,t){let r=this.entityMap.get(e);r||(r={sprite:this.alloc(t.tex),shadow:this.alloc("shadow_oval"),flashTimer:0,animScaleX:1,animScaleY:1},this.entityMap.set(e,r),this.entityLayer.addChild(r.sprite),this.shadowLayer.addChild(r.shadow)),r.baseTex=t.tex;const i=r.sprite;return i.texture=this.atlas.get(r.flashTimer>0?t.tex+"_white":t.tex),i.position.set(t.x,t.y),i.rotation=t.rot??0,i.scale.set((t.scaleX??1)*r.animScaleX,(t.scaleY??1)*r.animScaleY),i.tint=r.flashTimer>0?16777215:t.tint??16777215,i.alpha=t.alpha??1,i.zIndex=t.zIndex??t.y,r.shadow.visible=t.hasShadow!==!1,r.shadow.position.set(t.x,t.y+18),r.shadow.alpha=.35,r}releaseEntity(e){const t=this.entityMap.get(e);t&&(t.sprite.removeFromParent(),t.shadow.removeFromParent(),this.spritePool.push(t.sprite,t.shadow),this.entityMap.delete(e))}update(e){const t=this.camera,r=1-Math.exp(-10*e);t.x+=(t.targetX-t.x)*r,t.y+=(t.targetY-t.y)*r,this.worldRoot.scale.set(t.zoom),this.worldRoot.position.set(this.app.screen.width/2-t.x*t.zoom+t.shakeX,this.app.screen.height/2-t.y*t.zoom+t.shakeY);for(const i of this.entityMap.values())i.flashTimer=Math.max(0,i.flashTimer-e)}screenToWorld(e,t){return{x:(e-this.app.screen.width/2-this.camera.shakeX)/this.camera.zoom+this.camera.x,y:(t-this.app.screen.height/2-this.camera.shakeY)/this.camera.zoom+this.camera.y}}worldToScreen(e,t){return{x:(e-this.camera.x)*this.camera.zoom+this.app.screen.width/2+this.camera.shakeX,y:(t-this.camera.y)*this.camera.zoom+this.app.screen.height/2+this.camera.shakeY}}render(){this.app.renderer.render(this.app.stage)}dispose(){if(!this.disposed){this.disposed=!0,this.resizeObserver?.disconnect(),this.resizeObserver=null,this.onResize=null;for(const e of this.swarmLayers)e.dispose();for(const e of this.spritePool)e.destroy();this.spritePool.length=0,this.enemyParticles.length=0,this.enemyPool.length=0,this.pendingEnemies.length=0,this.entityMap.clear(),this.app.stage.filters=[],this.bloom.destroy(),this.app.destroy({removeView:!0},{children:!0}),this.atlas.dispose()}}}function mr(n,{resetInput:e=()=>{},onVisibility:t=()=>{}}={}){let r=!1;function i(l){l?r&&(r=!1,n.running&&n.paused&&n.resume()):(e(),n.running&&!n.paused&&(r=n.pause())),t(l)}const s=n.platform.lifecycle,a=s.on("visibility",i),o=s.on("focus",l=>{l||e()});return{sync(){i(s.visible)},dispose(){a(),o(),r=!1}}}export{_t as B,Ie as M,Ne as P,pr as R,mr as b,dr as c,ce as v,he as w};
