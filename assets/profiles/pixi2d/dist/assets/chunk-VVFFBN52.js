import{b as Ut}from"./chunk-TG2H7QRH.js";import{a as Ot,c as kt}from"./chunk-JBYDH65S.js";import{c as Ue}from"./chunk-5QDWTKBM.js";import{c as Ie,g as Lt,k as ue}from"./chunk-2LS5CLLR.js";import{b as It,c as zt,h as Dt,i as Vt,j as ge,m as le,q as ze}from"./chunk-JPAM2STR.js";import{a as Z,h as ce,j as D,l as nt,p as G,q as Gt,r as at,s as ne,t as lt,u as ut,w as te,x as V}from"./chunk-OSHW72LA.js";import{D as T,F as he,J as z,K as de,L as O,M as Et,N as xe,P as ee,Q as Ee,R as I,S as re,T as ae,a as w,b as C,d as Me,g as se,h as P,j as R,m as S,q as it,r as Rt,s as Ge,w as st,x as Mt}from"./chunk-SUZODPXE.js";var Wt={extension:{type:w.Environment,name:"browser",priority:-1},test:()=>!0,load:async()=>{await import("./chunk-NHTAZLCO.js")}};var Nt={extension:{type:w.Environment,name:"webworker",priority:0},test:()=>typeof self<"u"&&self.WorkerGlobalScope!==void 0,load:async()=>{await import("./chunk-6A3HUDP2.js")}};var Oe;function Xt(l){return Oe!==void 0||(Oe=(()=>{let e={stencil:!0,failIfMajorPerformanceCaveat:l??Ie.defaultOptions.failIfMajorPerformanceCaveat};try{if(!he.get().getWebGLRenderingContext())return!1;let r=he.get().createCanvas().getContext("webgl",e),o=!!r?.getContextAttributes()?.stencil;if(r){let i=r.getExtension("WEBGL_lose_context");i&&i.loseContext()}return r=null,o}catch{return!1}})()),Oe}var ke;async function Yt(l={}){return ke!==void 0||(ke=await(async()=>{let e=he.get().getNavigator().gpu;if(!e)return!1;try{return await(await e.requestAdapter(l)).requestDevice(),!0}catch{return!1}})()),ke}var Ht=["webgl","webgpu","canvas"];async function qt(l){let e=[];l.preference?Array.isArray(l.preference)?e=l.preference.slice():(e.push(l.preference),Ht.forEach(i=>{i!==l.preference&&e.push(i)})):e=Ht.slice();let t,r={};for(let i=0;i<e.length;i++){let s=e[i];if(s==="webgpu"&&await Yt()){let{WebGPURenderer:n}=await import("./chunk-H5BIV5CZ.js");t=n,r={...l,...l.webgpu};break}else if(s==="webgl"&&Xt(l.failIfMajorPerformanceCaveat??Ie.defaultOptions.failIfMajorPerformanceCaveat)){let{WebGLRenderer:n}=await import("./chunk-GBGZ4RIX.js");t=n,r={...l,...l.webgl};break}else if(s==="canvas"){let{CanvasRenderer:n}=await import("./chunk-HHHD4WY2.js");t=n,r={...l,...l.canvasOptions};break}}if(delete r.webgpu,delete r.webgl,delete r.canvasOptions,!t)throw new Error("No available renderer for the current environment");let o=new t;return await o.init(r),o}var ye=class{static init(e){Object.defineProperty(this,"resizeTo",{configurable:!0,set(t){globalThis.removeEventListener("resize",this.queueResize),this._resizeTo=t,t&&(globalThis.addEventListener("resize",this.queueResize),this.resize())},get(){return this._resizeTo}}),this.queueResize=()=>{this._resizeTo&&(this._cancelResize(),this._resizeId=requestAnimationFrame(()=>this.resize()))},this._cancelResize=()=>{this._resizeId&&(cancelAnimationFrame(this._resizeId),this._resizeId=null)},this.resize=()=>{if(!this._resizeTo)return;this._cancelResize();let t,r;if(this._resizeTo===globalThis.window)t=globalThis.innerWidth,r=globalThis.innerHeight;else{let{clientWidth:o,clientHeight:i}=this._resizeTo;t=o,r=i}this.renderer.resize(t,r),this.render()},this._resizeId=null,this._resizeTo=null,this.resizeTo=e.resizeTo||null}static destroy(){globalThis.removeEventListener("resize",this.queueResize),this._cancelResize(),this._cancelResize=null,this.queueResize=null,this.resizeTo=null,this.resize=null}};ye.extension=w.Application;var ve=class{static init(e){e=Object.assign({autoStart:!0,sharedTicker:!1},e),Object.defineProperty(this,"ticker",{configurable:!0,set(t){this._ticker&&this._ticker.remove(this.render,this),this._ticker=t,t&&t.add(this.render,this,Gt.LOW)},get(){return this._ticker}}),this.stop=()=>{this._ticker.stop()},this.start=()=>{this._ticker.start()},this._ticker=null,this.ticker=e.sharedTicker?at.shared:new at,e.autoStart&&this.start()}static destroy(){if(this._ticker){let e=this._ticker;this.ticker=null,e.destroy()}}};ve.extension=w.Application;C.add(ye);C.add(ve);var jt=class ft{constructor(...e){this.stage=new G,e[0]!==void 0&&S(R,"Application constructor options are deprecated, please use Application.init() instead.")}async init(e){e={...e},this.stage||(this.stage=new G),this.renderer=await qt(e),ft._plugins.forEach(t=>{t.init.call(this,e)})}render(){this.renderer.render({container:this.stage})}get canvas(){return this.renderer.canvas}get view(){return S(R,"Application.view is deprecated, please use Application.canvas instead."),this.renderer.canvas}get screen(){return this.renderer.screen}get domContainerRoot(){return this.renderer.renderPipes.dom?._domElement}destroy(e=!1,t=!1){let r=ft._plugins.slice(0);r.reverse(),r.forEach(o=>{o.destroy.call(this)}),this.stage.destroy(t),this.stage=null,this.renderer.destroy(e),this.renderer=null}};jt._plugins=[];var be=jt;C.handleByList(w.Application,be._plugins);C.add(Lt);function pt(l,e,t,r,o,i,s,n){let a=s-t,p=n-r,u=o-t,f=i-r,m=l-t,c=e-r,x=a*a+p*p,d=a*u+p*f,h=a*m+p*c,v=u*u+f*f,y=u*m+f*c,b=1/(x*v-d*d),g=(v*h-d*y)*b,F=(x*y-d*h)*b;return g>=0&&F>=0&&g+F<1}var Kt=class Qt extends ae{constructor(...e){let t=e[0]??{};t instanceof Float32Array&&(S(R,"use new MeshGeometry({ positions, uvs, indices }) instead"),t={positions:t,uvs:e[1],indices:e[2]}),t={...Qt.defaultOptions,...t};let r=t.positions||new Float32Array([0,0,1,0,1,1,0,1]),o=t.uvs;o||(t.positions?o=new Float32Array(r.length):o=new Float32Array([0,0,1,0,1,1,0,1]));let i=t.indices||new Uint32Array([0,1,2,0,2,3]),s=t.shrinkBuffersToFit,n=new re({data:r,label:"attribute-mesh-positions",shrinkToFit:s,usage:I.VERTEX|I.COPY_DST}),a=new re({data:o,label:"attribute-mesh-uvs",shrinkToFit:s,usage:I.VERTEX|I.COPY_DST}),p=new re({data:i,label:"index-mesh-buffer",shrinkToFit:s,usage:I.INDEX|I.COPY_DST});super({attributes:{aPosition:{buffer:n,format:"float32x2",stride:8,offset:0},aUV:{buffer:a,format:"float32x2",stride:8,offset:0}},indexBuffer:p,topology:t.topology}),this.batchMode="auto"}get positions(){return this.attributes.aPosition.buffer.data}set positions(e){this.attributes.aPosition.buffer.data=e}get uvs(){return this.attributes.aUV.buffer.data}set uvs(e){this.attributes.aUV.buffer.data=e}get indices(){return this.indexBuffer.data}set indices(e){this.indexBuffer.data=e}};Kt.defaultOptions={topology:"triangle-list",shrinkBuffersToFit:!1};var X=Kt;var fe=class{constructor(){this.batcherName="default",this.packAsQuad=!1,this.indexOffset=0,this.attributeOffset=0,this.roundPixels=0,this._batcher=null,this._batch=null,this._textureMatrixUpdateId=-1,this._uvUpdateId=-1}get blendMode(){return this.renderable.groupBlendMode}get topology(){return this._topology||this.geometry.topology}set topology(e){this._topology=e}reset(){this.renderable=null,this.texture=null,this._batcher=null,this._batch=null,this.geometry=null,this._uvUpdateId=-1,this._textureMatrixUpdateId=-1}setTexture(e){this.texture!==e&&(this.texture=e,this._textureMatrixUpdateId=-1)}get uvs(){let t=this.geometry.getBuffer("aUV"),r=t.data,o=r,i=this.texture.textureMatrix;return i.isSimple||(o=this._transformedUvs,(this._textureMatrixUpdateId!==i._updateID||this._uvUpdateId!==t._updateID)&&((!o||o.length<r.length)&&(o=this._transformedUvs=new Float32Array(r.length)),this._textureMatrixUpdateId=i._updateID,this._uvUpdateId=t._updateID,i.multiplyUvs(r,o))),o}get positions(){return this.geometry.positions}get indices(){return this.geometry.indices}get color(){return this.renderable.groupColorAlpha}get groupTransform(){return this.renderable.groupTransform}get attributeSize(){return this.geometry.positions.length/2}get indexSize(){return this.geometry.indices.length}};var De=class{destroy(){}},we=class{constructor(e,t){this.localUniforms=new ee({uTransformMatrix:{value:new P,type:"mat3x3<f32>"},uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uRound:{value:0,type:"f32"}}),this.localUniformsBindGroup=new Et({0:this.localUniforms}),this.renderer=e,this._adaptor=t,this._adaptor.init()}validateRenderable(e){let t=this._getMeshData(e),r=t.batched,o=e.batched;if(t.batched=o,r!==o)return!0;if(o){let i=e._geometry;if(i.indices.length!==t.indexSize||i.positions.length!==t.vertexSize)return t.indexSize=i.indices.length,t.vertexSize=i.positions.length,!0;let s=this._getBatchableMesh(e);return s.texture.uid!==e._texture.uid&&(s._textureMatrixUpdateId=-1),!s._batcher.checkAndUpdateTexture(s,e._texture)}return!1}addRenderable(e,t){let r=this.renderer.renderPipes.batch,o=this._getMeshData(e);if(e.didViewUpdate&&(o.indexSize=e._geometry.indices?.length,o.vertexSize=e._geometry.positions?.length),o.batched){let i=this._getBatchableMesh(e);i.setTexture(e._texture),i.geometry=e._geometry,r.addToBatch(i,t)}else r.break(t),t.add(e)}updateRenderable(e){if(e.batched){let t=this._getBatchableMesh(e);t.setTexture(e._texture),t.geometry=e._geometry,t._batcher.updateElement(t)}}execute(e){if(!e.isRenderable)return;e.state.blend&&(e.state.blendMode=le(e.groupBlendMode,e.texture._source));let t=this.localUniforms;t.uniforms.uTransformMatrix=e.groupTransform,t.uniforms.uRound=this.renderer._roundPixels|e._roundPixels,t.update(),ue(e.groupColorAlpha,t.uniforms.uColor,0),this._adaptor.execute(this,e)}_getMeshData(e){var t,r;return(t=e._gpuData)[r=this.renderer.uid]||(t[r]=new De),e._gpuData[this.renderer.uid].meshData||this._initMeshData(e)}_initMeshData(e){return e._gpuData[this.renderer.uid].meshData={batched:e.batched,indexSize:0,vertexSize:0},e._gpuData[this.renderer.uid].meshData}_getBatchableMesh(e){var t,r;return(t=e._gpuData)[r=this.renderer.uid]||(t[r]=new De),e._gpuData[this.renderer.uid].batchableMesh||this._initBatchableMesh(e)}_initBatchableMesh(e){let t=new fe;return t.renderable=e,t.setTexture(e._texture),t.transform=e.groupTransform,t.roundPixels=this.renderer._roundPixels|e._roundPixels,e._gpuData[this.renderer.uid].batchableMesh=t,t}destroy(){this.localUniforms=null,this.localUniformsBindGroup=null,this._adaptor.destroy(),this._adaptor=null,this.renderer=null}};we.extension={type:[w.WebGLPipes,w.WebGPUPipes],name:"mesh"};C.add(we);var Ve=class extends ne{constructor(...e){let t=e[0];t instanceof ae&&(S(R,"Mesh: use new Mesh({ geometry, shader }) instead"),t={geometry:t,shader:e[1]},e[3]&&(S(R,"Mesh: drawMode argument has been removed, use geometry.topology instead"),t.geometry.topology=e[3]));let{geometry:r,shader:o,texture:i,roundPixels:s,state:n,...a}=t;super({label:"Mesh",...a}),this.renderPipeId="mesh",this._shader=null,this.allowChildren=!1,this.shader=o??null,this.texture=i??o?.texture??T.WHITE,this.state=n??te.for2d(),this._geometry=r,this._geometry.on("update",this.onViewUpdate,this),this.roundPixels=s??!1}get material(){return S(R,"mesh.material property has been removed, use mesh.shader instead"),this._shader}set shader(e){this._shader!==e&&(this._shader=e,this.onViewUpdate())}get shader(){return this._shader}set geometry(e){this._geometry!==e&&(this._geometry?.off("update",this.onViewUpdate,this),e.on("update",this.onViewUpdate,this),this._geometry=e,this.onViewUpdate())}get geometry(){return this._geometry}set texture(e){e||(e=T.EMPTY);let t=this._texture;t!==e&&(t&&t.dynamic&&t.off("update",this.onViewUpdate,this),e.dynamic&&e.on("update",this.onViewUpdate,this),this.shader&&(this.shader.texture=e),this._texture=e,this.onViewUpdate())}get texture(){return this._texture}get batched(){return this._shader||(this.state.data&12)!==0?!1:this._geometry instanceof X?this._geometry.batchMode==="auto"?this._geometry.positions.length/2<=100:this._geometry.batchMode==="batch":!1}get bounds(){return this._geometry.bounds}updateBounds(){this._bounds=this._geometry.bounds}containsPoint(e){let{x:t,y:r}=e;if(!this.bounds.containsPoint(t,r))return!1;let o=this.geometry.getBuffer("aPosition").data,i=this.geometry.topology==="triangle-strip"?3:1;if(this.geometry.getIndex()){let s=this.geometry.getIndex().data,n=s.length;for(let a=0;a+2<n;a+=i){let p=s[a]*2,u=s[a+1]*2,f=s[a+2]*2;if(pt(t,r,o[p],o[p+1],o[u],o[u+1],o[f],o[f+1]))return!0}}else{let s=o.length/2;for(let n=0;n+2<s;n+=i){let a=n*2,p=(n+1)*2,u=(n+2)*2;if(pt(t,r,o[a],o[a+1],o[p],o[p+1],o[u],o[u+1]))return!0}}return!1}destroy(e){if(super.destroy(e),typeof e=="boolean"?e:e?.texture){let r=typeof e=="boolean"?e:e?.textureSource;this._texture.destroy(r)}this._geometry?.off("update",this.onViewUpdate,this),this._texture=null,this._geometry=null,this._shader=null}};var Le=class{constructor({matrix:e,observer:t}={}){this.dirty=!0,this._matrix=e??new P,this.observer=t,this.position=new Z(this,0,0),this.scale=new Z(this,1,1),this.pivot=new Z(this,0,0),this.skew=new Z(this,0,0),this._rotation=0,this._cx=1,this._sx=0,this._cy=0,this._sy=1}get matrix(){let e=this._matrix;return this.dirty&&(e.a=this._cx*this.scale.x,e.b=this._sx*this.scale.x,e.c=this._cy*this.scale.y,e.d=this._sy*this.scale.y,e.tx=this.position.x-(this.pivot.x*e.a+this.pivot.y*e.c),e.ty=this.position.y-(this.pivot.x*e.b+this.pivot.y*e.d),this.dirty=!1),e}_onUpdate(e){this.dirty=!0,e===this.skew&&this.updateSkew(),this.observer?._onUpdate(this)}updateSkew(){this._cx=Math.cos(this._rotation+this.skew.y),this._sx=Math.sin(this._rotation+this.skew.y),this._cy=-Math.sin(this._rotation-this.skew.x),this._sy=Math.cos(this._rotation-this.skew.x),this.dirty=!0}toString(){return`[pixi.js/math:Transform position=(${this.position.x}, ${this.position.y}) rotation=${this.rotation} scale=(${this.scale.x}, ${this.scale.y}) skew=(${this.skew.x}, ${this.skew.y}) ]`}setFromMatrix(e){e.decompose(this),this.dirty=!0}get rotation(){return this._rotation}set rotation(e){this._rotation!==e&&(this._rotation=e,this._onUpdate(this.skew))}};var We=new P,L=new P,k=[new se,new se,new se,new se],Te=class{constructor(e){this._renderer=e}validateRenderable(e){return!1}addRenderable(e,t){this._renderer.renderPipes.batch.break(t),t.add(e)}updateRenderable(e){}execute(e){let t=this._renderer,r=t.canvasContext,o=r.activeContext;o.save(),r.setBlendMode(e.groupBlendMode);let i=t.globalUniforms.globalUniformData?.worldColor??4294967295,s=e.groupColorAlpha,n=(i>>>24&255)/255,a=(s>>>24&255)/255,p=t.filter?.alphaMultiplier??1,u=n*a*p;if(u<=0){o.restore();return}o.globalAlpha=u;let f=i&16777215,m=s&16777215,c=ce(Ge(m,f)),x=e.texture,d=Ue.getTintedPattern(x,c),h=e.width,v=e.height,y=e.groupTransform,b=x.source._resolution??x.source.resolution??1;L.copyFrom(e._tileTransform.matrix),e.applyAnchorToTexture||L.translate(-e.anchor.x*h,-e.anchor.y*v);let g=L.tx,F=L.ty;L.scale(1/b,1/b),L.tx=g,L.ty=F,We.identity(),We.prepend(L),We.prepend(y);let A=t._roundPixels|e._roundPixels;r.setContextTransform(We,A===1),o.fillStyle=d;let B=e.anchor.x*-h,U=e.anchor.y*-v;k[0].set(B,U),k[1].set(B+h,U),k[2].set(B+h,U+v),k[3].set(B,U+v);for(let _=0;_<4;_++)L.applyInverse(k[_],k[_]);o.beginPath(),o.moveTo(k[0].x,k[0].y);for(let _=1;_<4;_++)o.lineTo(k[_].x,k[_].y);o.closePath(),o.fill(),o.restore()}destroy(){this._renderer=null}};Te.extension={type:[w.CanvasPipes],name:"tilingSprite"};var $t={name:"tiling-bit",vertex:{header:`
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
        `}},Jt={name:"tiling-bit",vertex:{header:`
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

        `}};var mt,ct,Ne=class extends Ee{constructor(){mt??(mt=It({name:"tiling-sprite-shader",bits:[Ot,$t,Dt]})),ct??(ct=zt({name:"tiling-sprite-shader",bits:[kt,Jt,Vt]}));let e=new ee({uMapCoord:{value:new P,type:"mat3x3<f32>"},uClampFrame:{value:new Float32Array([0,0,1,1]),type:"vec4<f32>"},uClampOffset:{value:new Float32Array([0,0]),type:"vec2<f32>"},uTextureTransform:{value:new P,type:"mat3x3<f32>"},uSizeAnchor:{value:new Float32Array([100,100,.5,.5]),type:"vec4<f32>"}});super({glProgram:ct,gpuProgram:mt,resources:{localUniforms:new ee({uTransformMatrix:{value:new P,type:"mat3x3<f32>"},uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uRound:{value:0,type:"f32"}}),tilingUniforms:e,uTexture:T.EMPTY.source,uSampler:T.EMPTY.source.style}})}updateUniforms(e,t,r,o,i,s){let n=this.resources.tilingUniforms,a=s.width,p=s.height,u=s.textureMatrix,f=n.uniforms.uTextureTransform;f.set(r.a*a/e,r.b*a/t,r.c*p/e,r.d*p/t,r.tx/e,r.ty/t),f.invert(),n.uniforms.uMapCoord=u.mapCoord,n.uniforms.uClampFrame=u.uClampFrame,n.uniforms.uClampOffset=u.uClampOffset,n.uniforms.uTextureTransform=f,n.uniforms.uSizeAnchor[0]=e,n.uniforms.uSizeAnchor[1]=t,n.uniforms.uSizeAnchor[2]=o,n.uniforms.uSizeAnchor[3]=i,s&&(this.resources.uTexture=s.source,this.resources.uSampler=s.source.style)}};var Xe=class extends X{constructor(){super({positions:new Float32Array([0,0,1,0,1,1,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])})}};function Zt(l,e){let t=l.anchor.x,r=l.anchor.y;e[0]=-t*l.width,e[1]=-r*l.height,e[2]=(1-t)*l.width,e[3]=-r*l.height,e[4]=(1-t)*l.width,e[5]=(1-r)*l.height,e[6]=-t*l.width,e[7]=(1-r)*l.height}function er(l,e,t,r){let o=0,i=l.length/(e||2),s=r.a,n=r.b,a=r.c,p=r.d,u=r.tx,f=r.ty;for(t*=e;o<i;){let m=l[t],c=l[t+1];l[t]=s*m+a*c+u,l[t+1]=n*m+p*c+f,t+=e,o++}}function tr(l,e){let t=l.texture,r=t.frame.width,o=t.frame.height,i=0,s=0;l.applyAnchorToTexture&&(i=l.anchor.x,s=l.anchor.y),e[0]=e[6]=-i,e[2]=e[4]=1-i,e[1]=e[3]=-s,e[5]=e[7]=1-s;let n=l._tileTransform.matrix,a=P.shared;a.set(n.a*r/l.width,n.b*r/l.height,n.c*o/l.width,n.d*o/l.height,n.tx/l.width,n.ty/l.height),a.invert(),er(e,2,0,a)}var Ye=new Xe,ht=class{constructor(){this.canBatch=!0,this.geometry=new X({indices:Ye.indices.slice(),positions:Ye.positions.slice(),uvs:Ye.uvs.slice()})}destroy(){this.geometry.destroy(),this.shader?.destroy()}},Se=class{constructor(e){this._state=te.default2d,this._renderer=e,this._managedTilingSprites=new ze({renderer:e,type:"renderable",name:"tilingSprite"})}validateRenderable(e){let t=this._getTilingSpriteData(e),r=t.canBatch;this._updateCanBatch(e);let o=t.canBatch;if(o&&o===r){let{batchableMesh:i}=t;return!i._batcher.checkAndUpdateTexture(i,e.texture)}return r!==o}addRenderable(e,t){let r=this._renderer.renderPipes.batch;this._updateCanBatch(e);let o=this._getTilingSpriteData(e),{geometry:i,canBatch:s}=o;if(s){o.batchableMesh||(o.batchableMesh=new fe);let n=o.batchableMesh;e.didViewUpdate&&(this._updateBatchableMesh(e),n.geometry=i,n.renderable=e,n.transform=e.groupTransform,n.setTexture(e._texture)),n.roundPixels=this._renderer._roundPixels|e._roundPixels,r.addToBatch(n,t)}else r.break(t),o.shader||(o.shader=new Ne),this.updateRenderable(e),t.add(e)}execute(e){let t=this._renderer,{shader:r}=this._getTilingSpriteData(e);r.groups[0]=t.globalUniforms.bindGroup;let o=r.resources.localUniforms.uniforms;o.uTransformMatrix=e.groupTransform,o.uRound=t._roundPixels|e._roundPixels,ue(e.groupColorAlpha,o.uColor,0),this._state.blendMode=le(e.groupBlendMode,e.texture._source),t.encoder.draw({geometry:Ye,shader:r,state:this._state})}updateRenderable(e){let t=this._getTilingSpriteData(e),{canBatch:r}=t;if(r){let{batchableMesh:o}=t;e.didViewUpdate&&this._updateBatchableMesh(e),o._batcher.updateElement(o)}else if(e.didViewUpdate){let{shader:o}=t;o.updateUniforms(e.width,e.height,e._tileTransform.matrix,e.anchor.x,e.anchor.y,e.texture)}}_getTilingSpriteData(e){return e._gpuData[this._renderer.uid]||this._initTilingSpriteData(e)}_initTilingSpriteData(e){let t=new ht;return t.renderable=e,e._gpuData[this._renderer.uid]=t,this._managedTilingSprites.add(e),t}_updateBatchableMesh(e){let t=this._getTilingSpriteData(e),{geometry:r}=t,o=e.texture.source.style;o.addressMode!=="repeat"&&(o.addressMode="repeat",o.update()),tr(e,r.uvs),Zt(e,r.positions)}destroy(){this._managedTilingSprites.destroy(),this._renderer=null}_updateCanBatch(e){let t=this._getTilingSpriteData(e),r=e.texture,o=!0;return this._renderer.type===xe.WEBGL&&(o=this._renderer.context.supports.nonPowOf2wrapping),t.canBatch=r.textureMatrix.isSimple&&(o||r.source.isPowerOfTwo),t.canBatch}};Se.extension={type:[w.WebGLPipes,w.WebGPUPipes],name:"tilingSprite"};C.add(Te);C.add(Se);var rr=class He extends ne{constructor(...e){let t=e[0]||{};t instanceof T&&(t={texture:t}),e.length>1&&(S(R,"use new TilingSprite({ texture, width:100, height:100 }) instead"),t.width=e[1],t.height=e[2]),t={...He.defaultOptions,...t};let{texture:r,anchor:o,tilePosition:i,tileScale:s,tileRotation:n,width:a,height:p,applyAnchorToTexture:u,roundPixels:f,...m}=t??{};super({label:"TilingSprite",...m}),this.renderPipeId="tilingSprite",this.batched=!0,this.allowChildren=!1,this._anchor=new Z({_onUpdate:()=>{this.onViewUpdate()}}),this.applyAnchorToTexture=u,this.texture=r,this._width=a??r.width,this._height=p??r.height,this._tileTransform=new Le({observer:{_onUpdate:()=>this.onViewUpdate()}}),o&&(this.anchor=o),this.tilePosition=i,this.tileScale=s,this.tileRotation=n,this.roundPixels=f??!1}static from(e,t={}){return typeof e=="string"?new He({texture:Ut.get(e),...t}):new He({texture:e,...t})}get uvRespectAnchor(){return S(R,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture}set uvRespectAnchor(e){S(R,"uvRespectAnchor is deprecated, please use applyAnchorToTexture instead"),this.applyAnchorToTexture=e}get clampMargin(){return this._texture.textureMatrix.clampMargin}set clampMargin(e){this._texture.textureMatrix.clampMargin=e}get anchor(){return this._anchor}set anchor(e){typeof e=="number"?this._anchor.set(e):this._anchor.copyFrom(e)}get tilePosition(){return this._tileTransform.position}set tilePosition(e){this._tileTransform.position.copyFrom(e)}get tileScale(){return this._tileTransform.scale}set tileScale(e){typeof e=="number"?this._tileTransform.scale.set(e):this._tileTransform.scale.copyFrom(e)}set tileRotation(e){this._tileTransform.rotation=e}get tileRotation(){return this._tileTransform.rotation}get tileTransform(){return this._tileTransform}set texture(e){e||(e=T.EMPTY);let t=this._texture;t!==e&&(t&&t.dynamic&&t.off("update",this.onViewUpdate,this),e.dynamic&&e.on("update",this.onViewUpdate,this),this._texture=e,this.onViewUpdate())}get texture(){return this._texture}set width(e){this._width=e,this.onViewUpdate()}get width(){return this._width}set height(e){this._height=e,this.onViewUpdate()}get height(){return this._height}setSize(e,t){typeof e=="object"&&(t=e.height??e.width,e=e.width),this._width=e,this._height=t??e,this.onViewUpdate()}getSize(e){return e||(e={}),e.width=this._width,e.height=this._height,e}updateBounds(){let e=this._bounds,t=this._anchor,r=this._width,o=this._height;e.minX=-t._x*r,e.maxX=e.minX+r,e.minY=-t._y*o,e.maxY=e.minY+o}containsPoint(e){let t=this._width,r=this._height,o=-t*this._anchor._x,i=0;return e.x>=o&&e.x<=o+t&&(i=-r*this._anchor._y,e.y>=i&&e.y<=i+r)}destroy(e=!1){if(super.destroy(e),this._anchor=null,this._tileTransform=null,this._bounds=null,typeof e=="boolean"?e:e?.texture){let r=typeof e=="boolean"?e:e?.textureSource;this._texture.destroy(r)}this._texture=null}};rr.defaultOptions={texture:T.EMPTY,anchor:{x:0,y:0},tilePosition:{x:0,y:0},tileScale:{x:1,y:1},tileRotation:0,applyAnchorToTexture:!1};var dt=rr;var or=class ir extends X{constructor(e){let{width:t,points:r,textureScale:o}={...ir.defaultOptions,...e};super({positions:new Float32Array(r.length*4),uvs:new Float32Array(r.length*4),indices:new Uint32Array((r.length-1)*6)}),this.points=r,this._width=t,this.textureScale=o,this._build()}get width(){return this._width}_build(){let e=this.points;if(!e)return;let t=this.getBuffer("aPosition"),r=this.getBuffer("aUV"),o=this.getIndex();if(e.length<1)return;t.data.length/4!==e.length&&(t.data=new Float32Array(e.length*4),r.data=new Float32Array(e.length*4),o.data=new Uint16Array((e.length-1)*6));let i=r.data,s=o.data;i[0]=0,i[1]=0,i[2]=0,i[3]=1;let n=0,a=e[0],p=this._width*this.textureScale,u=e.length;for(let m=0;m<u;m++){let c=m*4;if(this.textureScale>0){let x=a.x-e[m].x,d=a.y-e[m].y,h=Math.sqrt(x*x+d*d);a=e[m],n+=h/p}else n=m/(u-1);i[c]=n,i[c+1]=0,i[c+2]=n,i[c+3]=1}let f=0;for(let m=0;m<u-1;m++){let c=m*2;s[f++]=c,s[f++]=c+1,s[f++]=c+2,s[f++]=c+2,s[f++]=c+1,s[f++]=c+3}r.update(),o.update(),this.updateVertices()}updateVertices(){let e=this.points;if(e.length<1)return;let t=e[0],r,o=0,i=0,s=this.buffers[0].data,n=e.length,a=this.textureScale>0?this.textureScale*this._width/2:this._width/2;for(let p=0;p<n;p++){let u=e[p],f=p*4;p<e.length-1?r=e[p+1]:r=u,i=-(r.x-t.x),o=r.y-t.y;let m=(1-p/(n-1))*10;m>1&&(m=1);let c=Math.sqrt(o*o+i*i);c<1e-6?(o=0,i=0):(o/=c,i/=c,o*=a,i*=a),s[f]=u.x+o,s[f+1]=u.y+i,s[f+2]=u.x-o,s[f+3]=u.y-i,t=u}this.buffers[0].update()}update(){this.textureScale>0?this._build():this.updateVertices()}};or.defaultOptions={width:200,points:[],textureScale:0};var sr=or;var nr=class ar extends Ve{constructor(e){let{width:t,texture:r,points:o,textureScale:i,...s}={...ar.defaultOptions,...e},n=new sr(st({width:t??r.height,points:o,textureScale:i}));i>0&&(r.source.style.addressMode="repeat"),super(st({...s,texture:r,geometry:n})),this.autoUpdate=!0,this.onRender=this._render}_render(){let e=this.geometry;(this.autoUpdate||e._width!==this.texture.height)&&(e._width=this.texture.height,e.update())}};nr.defaultOptions={textureScale:0};var Dr=nr;var qe=class{execute(e,t){let r=e.renderer,o=r.canvasContext.activeContext,i=t.particleChildren,s=t.texture;o.save(),r.canvasContext.setContextTransform(t.worldTransform,t.roundPixels),r.canvasContext.setBlendMode(t.groupBlendMode);let n=t.groupColorAlpha,a=r.filter?.alphaMultiplier??1,p=(n>>>24&255)/255*a;for(let u=0;u<i.length;u++){let f=i[u],m=f.texture||s;if(!m?.source?.resource)continue;let c=f.color,x=(c>>>24&255)/255*p;if(x<=0)continue;let d=c&16777215,h=((d&255)<<16)+(d&65280)+(d>>16&255),v=m.source.resource;h!==16777215&&(v=Ue.getTintedCanvas({texture:m},h));let y=m.frame,b=m.source.resolution,g=y.x*b,F=y.y*b,A=y.width*b,B=y.height*b;o.globalAlpha=x;let U=-f.anchorX*y.width,_=-f.anchorY*y.height;f.rotation!==0||f.scaleX!==1||f.scaleY!==1?(o.save(),o.translate(f.x,f.y),o.rotate(f.rotation),o.scale(f.scaleX,f.scaleY),o.drawImage(v,g,F,A,B,U,_,y.width,y.height),o.restore()):o.drawImage(v,g,F,A,B,f.x+U,f.y+_,y.width,y.height)}o.restore()}};function xt(l,e=null){let t=l*6;if(t>65535?e||(e=new Uint32Array(t)):e||(e=new Uint16Array(t)),e.length!==t)throw new Error(`Out buffer length is incorrect, got ${e.length} and expected ${t}`);for(let r=0,o=0;r<t;r+=6,o+=4)e[r+0]=o+0,e[r+1]=o+1,e[r+2]=o+2,e[r+3]=o+0,e[r+4]=o+2,e[r+5]=o+3;return e}function ur(l){return{dynamicUpdate:lr(l,!0),staticUpdate:lr(l,!1)}}function lr(l,e){let t=[];t.push(`

        var index = 0;

        for (let i = 0; i < ps.length; ++i)
        {
            const p = ps[i];

            `);let r=0;for(let i in l){let s=l[i];if(e!==s.dynamic)continue;t.push(`offset = index + ${r}`),t.push(s.code);let n=de(s.format);r+=n.stride/4}t.push(`
            index += stride * 4;
        }
    `),t.unshift(`
        var stride = ${r};
        var offset = 0, w0 = 0, w1 = 0, h0 = 0, h1 = 0;
    `);let o=t.join(`
`);return new Function("ps","f32v","u32v",o)}var je=class{constructor(e){this._size=0,this._generateParticleUpdateCache={};let t=this._size=e.size??1e3,r=e.properties,o=0,i=0;for(let u in r){let f=r[u],m=de(f.format);f.dynamic?i+=m.stride:o+=m.stride}this._dynamicStride=i/4,this._staticStride=o/4,this.staticAttributeBuffer=new ge(t*4*o),this.dynamicAttributeBuffer=new ge(t*4*i),this.indexBuffer=xt(t);let s=new ae,n=0,a=0;this._staticBuffer=new re({data:new Float32Array(1),label:"static-particle-buffer",shrinkToFit:!1,usage:I.VERTEX|I.COPY_DST}),this._dynamicBuffer=new re({data:new Float32Array(1),label:"dynamic-particle-buffer",shrinkToFit:!1,usage:I.VERTEX|I.COPY_DST});for(let u in r){let f=r[u],m=de(f.format);f.dynamic?(s.addAttribute(f.attributeName,{buffer:this._dynamicBuffer,stride:this._dynamicStride*4,offset:n*4,format:f.format}),n+=m.size):(s.addAttribute(f.attributeName,{buffer:this._staticBuffer,stride:this._staticStride*4,offset:a*4,format:f.format}),a+=m.size)}s.addIndex(this.indexBuffer);let p=this.getParticleUpdate(r);this._dynamicUpload=p.dynamicUpdate,this._staticUpload=p.staticUpdate,this.geometry=s}getParticleUpdate(e){let t=Vr(e);return this._generateParticleUpdateCache[t]?this._generateParticleUpdateCache[t]:(this._generateParticleUpdateCache[t]=this.generateParticleUpdate(e),this._generateParticleUpdateCache[t])}generateParticleUpdate(e){return ur(e)}update(e,t){e.length>this._size&&(t=!0,this._size=Math.max(e.length,this._size*1.5|0),this.staticAttributeBuffer=new ge(this._size*this._staticStride*4*4),this.dynamicAttributeBuffer=new ge(this._size*this._dynamicStride*4*4),this.indexBuffer=xt(this._size),this.geometry.indexBuffer.setDataWithSize(this.indexBuffer,this.indexBuffer.byteLength,!0));let r=this.dynamicAttributeBuffer;if(this._dynamicUpload(e,r.float32View,r.uint32View),this._dynamicBuffer.setDataWithSize(this.dynamicAttributeBuffer.float32View,e.length*this._dynamicStride*4,!0),t){let o=this.staticAttributeBuffer;this._staticUpload(e,o.float32View,o.uint32View),this._staticBuffer.setDataWithSize(o.float32View,e.length*this._staticStride*4,!0)}}destroy(){this._staticBuffer.destroy(),this._dynamicBuffer.destroy(),this.geometry.destroy()}};function Vr(l){let e=[];for(let t in l){let r=l[t];e.push(t,r.code,r.dynamic?"d":"s")}return e.join("_")}var fr=`varying vec2 vUV;
varying vec4 vColor;

uniform sampler2D uTexture;

void main(void){
    vec4 color = texture2D(uTexture, vUV) * vColor;
    gl_FragColor = color;
}`;var pr=`attribute vec2 aVertex;
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
`;var gt=`
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
}`;var Ke=class extends Ee{constructor(){let e=z.from({vertex:pr,fragment:fr}),t=O.from({fragment:{source:gt,entryPoint:"mainFragment"},vertex:{source:gt,entryPoint:"mainVertex"}});super({glProgram:e,gpuProgram:t,resources:{uTexture:T.WHITE.source,uSampler:new Mt({}),uniforms:{uTranslationMatrix:{value:new P,type:"mat3x3<f32>"},uColor:{value:new Me(16777215),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}}})}};var W=class{constructor(e,t){this.state=te.for2d(),this.localUniforms=new ee({uTranslationMatrix:{value:new P,type:"mat3x3<f32>"},uColor:{value:new Float32Array(4),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}),this.renderer=e,this.adaptor=t,this.defaultShader=new Ke,this.state=te.for2d(),this._managedContainers=new ze({renderer:e,type:"renderable",name:"particleContainer"})}validateRenderable(e){return!1}addRenderable(e,t){this.renderer.renderPipes.batch.break(t),t.add(e)}getBuffers(e){return e._gpuData[this.renderer.uid]||this._initBuffer(e)}_initBuffer(e){return e._gpuData[this.renderer.uid]=new je({size:e.particleChildren.length,properties:e._properties}),this._managedContainers.add(e),e._gpuData[this.renderer.uid]}updateRenderable(e){}execute(e){let t=e.particleChildren;if(t.length===0)return;let r=this.renderer,o=this.getBuffers(e);e.texture||(e.texture=t[0].texture);let i=this.state;o.update(t,e._childrenDirty),e._childrenDirty=!1,i.blendMode=le(e.groupBlendMode,e.texture._source);let s=this.localUniforms.uniforms,n=s.uTranslationMatrix;e.worldTransform.copyTo(n);let a=r.globalUniforms.globalUniformData;n.tx-=a.offset.x,n.ty-=a.offset.y,n.prepend(a.projectionMatrix),s.uResolution=a.resolution,s.uRound=r._roundPixels|e._roundPixels;let p=e.groupColorAlpha,u=a.worldColor,f=(p>>>24)*(u>>>24)/255|0,m=Ge(p&16777215,u&16777215);ue((f<<24|m)>>>0,s.uColor,0),this.adaptor.execute(this,e)}destroy(){this._managedContainers.destroy(),this.renderer=null,this.defaultShader&&(this.defaultShader.destroy(),this.defaultShader=null)}};W.extension={type:[w.CanvasPipes],name:"particle"};var _e=class extends W{constructor(e){super(e,new qe)}};_e.extension={type:[w.CanvasPipes],name:"particle"};var Qe=class{execute(e,t){let r=e.state,o=e.renderer,i=t.shader||e.defaultShader;i.resources.uTexture=t.texture._source,i.resources.uniforms=e.localUniforms;let s=o.gl,n=e.getBuffers(t);o.shader.bind(i),o.state.set(r),o.geometry.bind(n.geometry,i.glProgram);let p=n.geometry.indexBuffer.data.BYTES_PER_ELEMENT===2?s.UNSIGNED_SHORT:s.UNSIGNED_INT;s.drawElements(s.TRIANGLES,t.particleChildren.length*6,p,0)}};var Ce=class extends W{constructor(e){super(e,new Qe)}};Ce.extension={type:[w.WebGLPipes],name:"particle"};var $e=class{execute(e,t){let r=e.renderer,o=t.shader||e.defaultShader;o.groups[0]=r.renderPipes.uniformBatch.getUniformBindGroup(e.localUniforms,!0),o.groups[1]=r.texture.getTextureBindGroup(t.texture);let i=e.state,s=e.getBuffers(t);r.encoder.draw({geometry:s.geometry,shader:t.shader||e.defaultShader,state:i,size:t.particleChildren.length*6})}};var Pe=class extends W{constructor(e){super(e,new $e)}};Pe.extension={type:[w.WebGPUPipes],name:"particle"};var mr=class yt{constructor(e){if(e instanceof T)this.texture=e,nt(this,yt.defaultOptions,{});else{let t={...yt.defaultOptions,...e};nt(this,t,{})}}get alpha(){return this._alpha}set alpha(e){this._alpha=Math.min(Math.max(e,0),1),this._updateColor()}get tint(){return ce(this._tint)}set tint(e){this._tint=typeof e=="number"?ce(e):Me.shared.setValue(e??16777215).toBgrNumber(),this._updateColor()}_updateColor(){this.color=this._tint+((this._alpha*255|0)<<24)}};mr.defaultOptions={anchorX:0,anchorY:0,x:0,y:0,scaleX:1,scaleY:1,rotation:0,tint:16777215,alpha:1};var oe=mr;var vt={vertex:{attributeName:"aVertex",format:"float32x2",code:`
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
        `,dynamic:!1}};C.add(Ce);C.add(Pe);C.add(_e);var Lr=new Rt(0,0,0,0),Wr=48,cr=class bt extends ne{constructor(e={}){e={...bt.defaultOptions,...e,dynamicProperties:{...bt.defaultOptions.dynamicProperties,...e?.dynamicProperties}};let{dynamicProperties:t,shader:r,roundPixels:o,texture:i,particles:s,...n}=e;super({label:"ParticleContainer",...n}),this.renderPipeId="particle",this.batched=!1,this._childrenDirty=!1,this.texture=i||null,this.shader=r,this._properties={};for(let a in vt){let p=vt[a],u=t[a];this._properties[a]={...p,dynamic:u}}this.allowChildren=!0,this.roundPixels=o??!1,this.particleChildren=s??[]}addParticle(...e){for(let t=0;t<e.length;t++)this.particleChildren.push(e[t]);return this.onViewUpdate(),e[0]}removeParticle(...e){if(e.length>Wr)return this._removeParticlesInOnePass(e)&&this.onViewUpdate(),e[0];let t=!1;for(let r=0;r<e.length;r++){let o=this.particleChildren.indexOf(e[r]);o>-1&&(this.particleChildren.splice(o,1),t=!0)}return t&&this.onViewUpdate(),e[0]}_removeParticlesInOnePass(e){let t=new Map;for(let s=0;s<e.length;s++){let n=e[s];t.set(n,(t.get(n)??0)+1)}let r=this.particleChildren,o=r.length,i=0;for(let s=0;s<o;s++){let n=r[s],a=t.get(n);a?t.set(n,a-1):r[i++]=n}return r.length=i,i!==o}update(){this._childrenDirty=!0}onViewUpdate(){this._childrenDirty=!0,super.onViewUpdate()}get bounds(){return Lr}updateBounds(){}destroy(e=!1){if(super.destroy(e),typeof e=="boolean"?e:e?.texture){let r=typeof e=="boolean"?e:e?.textureSource,o=this.texture??this.particleChildren[0]?.texture;o&&o.destroy(r)}this.texture=null,this.shader?.destroy()}removeParticles(e,t){e??(e=0),t??(t=this.particleChildren.length);let r=this.particleChildren.splice(e,t-e);return this.onViewUpdate(),r}removeParticleAt(e){let t=this.particleChildren.splice(e,1);return this.onViewUpdate(),t[0]}addParticleAt(e,t){return this.particleChildren.splice(t,0,e),this.onViewUpdate(),e}addChild(...e){throw new Error("ParticleContainer.addChild() is not available. Please use ParticleContainer.addParticle()")}removeChild(...e){throw new Error("ParticleContainer.removeChild() is not available. Please use ParticleContainer.removeParticle()")}removeChildren(e,t){throw new Error("ParticleContainer.removeChildren() is not available. Please use ParticleContainer.removeParticles()")}removeChildAt(e){throw new Error("ParticleContainer.removeChildAt() is not available. Please use ParticleContainer.removeParticleAt()")}getChildAt(e){throw new Error("ParticleContainer.getChildAt() is not available. Please use ParticleContainer.getParticleAt()")}setChildIndex(e,t){throw new Error("ParticleContainer.setChildIndex() is not available. Please use ParticleContainer.setParticleIndex()")}getChildIndex(e){throw new Error("ParticleContainer.getChildIndex() is not available. Please use ParticleContainer.getParticleIndex()")}addChildAt(e,t){throw new Error("ParticleContainer.addChildAt() is not available. Please use ParticleContainer.addParticleAt()")}swapChildren(e,t){throw new Error("ParticleContainer.swapChildren() is not available. Please use ParticleContainer.swapParticles()")}reparentChild(...e){throw new Error("ParticleContainer.reparentChild() is not available with the particle container")}reparentChildAt(e,t){throw new Error("ParticleContainer.reparentChildAt() is not available with the particle container")}};cr.defaultOptions={dynamicProperties:{vertex:!1,position:!0,rotation:!1,uvs:!1,color:!1},roundPixels:!1};var Y=cr;C.add(Wt,Nt);var wt=class{constructor(e=1024){if(!Number.isInteger(e)||e<8)throw new RangeError("Atlas size must be an integer of at least 8 pixels");this.size=e,this.canvas=document.createElement("canvas"),this.canvas.width=this.canvas.height=e,this.ctx=this.canvas.getContext("2d"),this.x=this.y=2,this.rowHeight=0,this.frames=new Map,this.textures=new Map,this.source=null}register(e,t,r,o,{makeWhite:i=!0}={}){if(typeof e!="string"||!e||!Number.isInteger(t)||!Number.isInteger(r)||t<=0||r<=0||typeof o!="function")throw new TypeError("Atlas frames require a name, positive integer dimensions and a draw function");if(this.frames.has(e+"_white"))throw new Error("Invalid or duplicate atlas frame: "+e);this.checkCapacity([{name:e,width:t,height:r},...i?[{name:e+"_white",width:t,height:r}]:[]]);let s=document.createElement("canvas");s.width=t,s.height=r;let n=s.getContext("2d");o(n,t,r),this.pack(e,s),i&&(n.globalCompositeOperation="source-in",n.fillStyle="#ffffff",n.fillRect(0,0,t,r),this.pack(e+"_white",s))}checkCapacity(e){if(this.source)throw new Error("Cannot add frames to a built atlas");let t=this.x,r=this.y,o=this.rowHeight,i=new Set;for(let{name:s,width:n,height:a}of e){if(typeof s!="string"||!s||i.has(s)||this.frames.has(s))throw new Error("Invalid or duplicate atlas frame: "+s);if(!Number.isInteger(n)||!Number.isInteger(a)||n<=0||a<=0)throw new RangeError("Atlas dimensions must be positive integers");if(i.add(s),n+4>this.size||a+4>this.size)throw new RangeError("Atlas frame too large: "+s);if(t+n+2>this.size&&(t=2,r+=o+4,o=0),r+a+2>this.size)throw new RangeError("Procedural atlas is full");t+=n+4,o=Math.max(o,a)}}registerImage(e,t,{width:r=t?.width,height:o=t?.height,makeWhite:i=!0}={}){if(!(t?.width>0&&t?.height>0))throw new TypeError("Atlas image must be decoded and have positive dimensions: "+e);this.register(e,r,o,(s,n,a)=>{let p=Math.min(n/t.width,a/t.height),u=t.width*p,f=t.height*p;s.drawImage(t,(n-u)/2,(a-f)/2,u,f)},{makeWhite:i})}registerSheet(e,t,{width:r,height:o,makeWhite:i=!0}={}){let s=t?.image;if(typeof e!="string"||!e||!s||!(s.width>0&&s.height>0)||!Number.isSafeInteger(t.length)||t.length<1||typeof t.frame!="function")throw new TypeError("registerSheet requires a name and a decoded HGame SpriteSheet");let n=[],a=[];for(let p=0;p<t.length;p++){let u=t.frame(p),f=`${e}/${p}`;if(![u?.x,u?.y,u?.width,u?.height].every(Number.isFinite)||u.x<0||u.y<0||u.width<=0||u.height<=0||u.x+u.width>s.width||u.y+u.height>s.height)throw new RangeError("SpriteSheet frame is outside the image: "+f);let m=r??u.width,c=o??u.height;if(this.frames.has(f+"_white"))throw new Error("Invalid or duplicate atlas frame: "+f);n.push({name:f,rect:u,width:m,height:c}),a.push({name:f,width:m,height:c}),i&&a.push({name:f+"_white",width:m,height:c})}this.checkCapacity(a);for(let p of n){let u=p.rect;this.register(p.name,p.width,p.height,(f,m,c)=>{f.drawImage(s,u.x,u.y,u.width,u.height,0,0,m,c)},{makeWhite:i})}return n.map(p=>p.name)}pack(e,t){let{width:r,height:o}=t;if(r+4>this.size||o+4>this.size)throw new RangeError("Atlas frame too large: "+e);if(this.x+r+2>this.size&&(this.x=2,this.y+=this.rowHeight+4,this.rowHeight=0),this.y+o+2>this.size)throw new RangeError("Procedural atlas is full");let i=this.x,s=this.y,n=this.ctx;n.drawImage(t,i,s),n.drawImage(t,0,0,r,1,i,s-1,r,1),n.drawImage(t,0,o-1,r,1,i,s+o,r,1),n.drawImage(t,0,0,1,o,i-1,s,1,o),n.drawImage(t,r-1,0,1,o,i+r,s,1,o),n.drawImage(t,0,0,1,1,i-1,s-1,1,1),n.drawImage(t,r-1,0,1,1,i+r,s-1,1,1),n.drawImage(t,0,o-1,1,1,i-1,s+o,1,1),n.drawImage(t,r-1,o-1,1,1,i+r,s+o,1,1),this.frames.set(e,new it(i,s,r,o)),this.x+=r+4,this.rowHeight=Math.max(this.rowHeight,o)}build(){if(this.source)return this;this.source=new ut({resource:this.canvas,scaleMode:"linear"});for(let[e,t]of this.frames)this.textures.set(e,new T({source:this.source,frame:t}));return this}get(e){return this.textures.get(e)??T.WHITE}dispose(){for(let e of this.textures.values())e.destroy();this.textures.clear(),this.source?.destroy(),this.source=null}};function hr({playerImage:l=null,enemyImage:e=null,eliteImage:t=e,extraFrames:r=[],size:o=1024}={}){let i=new wt(o),s=(a,p=.4)=>(u,f,m)=>{u.fillStyle=a,u.beginPath(),u.arc(f/2,m/2,Math.min(f,m)*p,0,Math.PI*2),u.fill()},n=a=>(p,u,f)=>{if(!(a?.width>0&&a?.height>0))throw new TypeError("Character image must be decoded and have positive dimensions");let m=Math.min(u/a.width,f/a.height),c=a.width*m,x=a.height*m;p.drawImage(a,(u-c)/2,(f-x)/2,c,x)};i.register("player_hero",64,64,l?n(l):s("#53eccc")),i.register("enemy_chaser",40,40,e?n(e):s("#fa536e")),i.register("enemy_elite",56,56,t?n(t):s("#ffad53")),i.register("bullet_orb",20,20,s("#92faff")),i.register("particle_soft",20,20,(a,p,u)=>{let f=a.createRadialGradient(p/2,u/2,0,p/2,u/2,p/2);f.addColorStop(0,"#fff"),f.addColorStop(1,"#ffffff00"),a.fillStyle=f,a.fillRect(0,0,p,u)});for(let[a,p]of["#ff6622","#ffbb33","#ffed99"].entries())i.register("particle_fire_"+a,20,20,(u,f,m)=>{let c=u.createRadialGradient(f/2,m/2,0,f/2,m/2,f/2);c.addColorStop(0,p),c.addColorStop(1,p+"00"),u.fillStyle=c,u.fillRect(0,0,f,m)},{makeWhite:!1});i.register("particle_spark",12,12,(a,p,u)=>{a.fillStyle="#fff",a.beginPath(),a.moveTo(p/2,0),a.lineTo(p,u/2),a.lineTo(p/2,u),a.lineTo(0,u/2),a.closePath(),a.fill()}),i.register("slash_trail",128,16,(a,p,u)=>{let f=a.createLinearGradient(0,0,p,0);f.addColorStop(0,"#ffffff00"),f.addColorStop(1,"#ffffffff"),a.fillStyle=f,a.fillRect(0,0,p,u)}),i.register("shadow_oval",48,20,(a,p,u)=>{a.fillStyle="#0008",a.beginPath(),a.ellipse(p/2,u/2,p/2,u/2,0,0,Math.PI*2),a.fill()},{makeWhite:!1}),i.register("ground_grid",128,128,(a,p,u)=>{a.fillStyle="#101b2a",a.fillRect(0,0,p,u),a.strokeStyle="#244256",a.lineWidth=1,a.strokeRect(.5,.5,p-1,u-1)},{makeWhite:!1});for(let a of r)typeof a.sheet=="function"?i.registerSheet(a.name,a.sheet(a.image),a):i.registerImage(a.name,a.image,a);return i.build()}var H=`in vec2 aPosition;
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
`;var q=`struct GlobalFilterUniforms {
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
}`;var dr=`
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
}`;var xr=`struct KawaseBlurUniforms {
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
}`;var gr=`
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
`;var yr=`struct KawaseBlurUniforms {
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
}`;var Nr=Object.defineProperty,Xr=(l,e,t)=>e in l?Nr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,ie=(l,e,t)=>(Xr(l,typeof e!="symbol"?e+"":e,t),t),vr=class br extends V{constructor(...e){let t=e[0]??{};(typeof t=="number"||Array.isArray(t))&&(S("6.0.0","KawaseBlurFilter constructor params are now options object. See params: { strength, quality, clamp, pixelSize }"),t={strength:t},e[1]!==void 0&&(t.quality=e[1]),e[2]!==void 0&&(t.clamp=e[2])),t={...br.DEFAULT_OPTIONS,...t};let r=O.from({vertex:{source:q,entryPoint:"mainVertex"},fragment:{source:t?.clamp?yr:xr,entryPoint:"mainFragment"}}),o=z.from({vertex:H,fragment:t?.clamp?gr:dr,name:"kawase-blur-filter"});super({gpuProgram:r,glProgram:o,resources:{kawaseBlurUniforms:{uOffset:{value:new Float32Array(2),type:"vec2<f32>"}}}}),ie(this,"uniforms"),ie(this,"_pixelSize",{x:0,y:0}),ie(this,"_clamp"),ie(this,"_kernels",[]),ie(this,"_blur"),ie(this,"_quality"),this.uniforms=this.resources.kawaseBlurUniforms.uniforms,this.pixelSize=t.pixelSize??{x:1,y:1},Array.isArray(t.strength)?this.kernels=t.strength:typeof t.strength=="number"&&(this._blur=t.strength,this.quality=t.quality??3),this._clamp=!!t.clamp}apply(e,t,r,o){let i=this.pixelSizeX/t.source.width,s=this.pixelSizeY/t.source.height,n;if(this._quality===1||this._blur===0)n=this._kernels[0]+.5,this.uniforms.uOffset[0]=n*i,this.uniforms.uOffset[1]=n*s,e.applyFilter(this,t,r,o);else{let a=D.getSameSizeTexture(t),p=t,u=a,f,m=this._quality-1;for(let c=0;c<m;c++)n=this._kernels[c]+.5,this.uniforms.uOffset[0]=n*i,this.uniforms.uOffset[1]=n*s,e.applyFilter(this,p,u,!0),f=p,p=u,u=f;n=this._kernels[m]+.5,this.uniforms.uOffset[0]=n*i,this.uniforms.uOffset[1]=n*s,e.applyFilter(this,p,r,o),D.returnTexture(a)}}get strength(){return this._blur}set strength(e){this._blur=e,this._generateKernels()}get quality(){return this._quality}set quality(e){this._quality=Math.max(1,Math.round(e)),this._generateKernels()}get kernels(){return this._kernels}set kernels(e){Array.isArray(e)&&e.length>0?(this._kernels=e,this._quality=e.length,this._blur=Math.max(...e)):(this._kernels=[0],this._quality=1)}get pixelSize(){return this._pixelSize}set pixelSize(e){if(typeof e=="number"){this.pixelSizeX=this.pixelSizeY=e;return}if(Array.isArray(e)){this.pixelSizeX=e[0],this.pixelSizeY=e[1];return}this._pixelSize=e}get pixelSizeX(){return this.pixelSize.x}set pixelSizeX(e){this.pixelSize.x=e}get pixelSizeY(){return this.pixelSize.y}set pixelSizeY(e){this.pixelSize.y=e}get clamp(){return this._clamp}_updatePadding(){this.padding=Math.ceil(this._kernels.reduce((e,t)=>e+t+.5,0))}_generateKernels(){let e=this._blur,t=this._quality,r=[e];if(e>0){let o=e,i=e/t;for(let s=1;s<t;s++)o-=i,r.push(o)}this._kernels=r,this._updatePadding()}};ie(vr,"DEFAULT_OPTIONS",{strength:4,quality:3,clamp:!1,pixelSize:{x:1,y:1}});var wr=vr;var Tr=`in vec2 vTextureCoord;
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
`;var Sr=`struct AdvancedBloomUniforms {
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
`;var _r=`
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
`;var Cr=`struct ExtractBrightnessUniforms {
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
`;var Yr=Object.defineProperty,Hr=(l,e,t)=>e in l?Yr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,Pr=(l,e,t)=>(Hr(l,typeof e!="symbol"?e+"":e,t),t),Fr=class Br extends V{constructor(e){e={...Br.DEFAULT_OPTIONS,...e};let t=O.from({vertex:{source:q,entryPoint:"mainVertex"},fragment:{source:Cr,entryPoint:"mainFragment"}}),r=z.from({vertex:H,fragment:_r,name:"extract-brightness-filter"});super({gpuProgram:t,glProgram:r,resources:{extractBrightnessUniforms:{uThreshold:{value:e.threshold,type:"f32"}}}}),Pr(this,"uniforms"),this.uniforms=this.resources.extractBrightnessUniforms.uniforms}get threshold(){return this.uniforms.uThreshold}set threshold(e){this.uniforms.uThreshold=e}};Pr(Fr,"DEFAULT_OPTIONS",{threshold:.5});var Ar=Fr;var qr=Object.defineProperty,jr=(l,e,t)=>e in l?qr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,pe=(l,e,t)=>(jr(l,typeof e!="symbol"?e+"":e,t),t),Rr=class Mr extends V{constructor(e){e={...Mr.DEFAULT_OPTIONS,...e};let t=O.from({vertex:{source:q,entryPoint:"mainVertex"},fragment:{source:Sr,entryPoint:"mainFragment"}}),r=z.from({vertex:H,fragment:Tr,name:"advanced-bloom-filter"});super({gpuProgram:t,glProgram:r,resources:{advancedBloomUniforms:{uBloomScale:{value:e.bloomScale,type:"f32"},uBrightness:{value:e.brightness,type:"f32"}},uMapTexture:T.WHITE}}),pe(this,"uniforms"),pe(this,"bloomScale",1),pe(this,"brightness",1),pe(this,"_extractFilter"),pe(this,"_blurFilter"),this.uniforms=this.resources.advancedBloomUniforms.uniforms,this._extractFilter=new Ar({threshold:e.threshold}),this._blurFilter=new wr({strength:e.kernels??e.blur,quality:e.kernels?void 0:e.quality}),Object.assign(this,e)}apply(e,t,r,o){let i=D.getSameSizeTexture(t);this._extractFilter.apply(e,t,i,!0);let s=D.getSameSizeTexture(t);this._blurFilter.apply(e,i,s,!0),this.uniforms.uBloomScale=this.bloomScale,this.uniforms.uBrightness=this.brightness,this.resources.uMapTexture=s.source,e.applyFilter(this,t,r,o),D.returnTexture(s),D.returnTexture(i)}get threshold(){return this._extractFilter.threshold}set threshold(e){this._extractFilter.threshold=e}get kernels(){return this._blurFilter.kernels}set kernels(e){this._blurFilter.kernels=e}get blur(){return this._blurFilter.strength}set blur(e){this._blurFilter.strength=e}get quality(){return this._blurFilter.quality}set quality(e){this._blurFilter.quality=e}get pixelSize(){return this._blurFilter.pixelSize}set pixelSize(e){typeof e=="number"&&(e={x:e,y:e}),Array.isArray(e)&&(e={x:e[0],y:e[1]}),this._blurFilter.pixelSize=e}get pixelSizeX(){return this._blurFilter.pixelSizeX}set pixelSizeX(e){this._blurFilter.pixelSizeX=e}get pixelSizeY(){return this._blurFilter.pixelSizeY}set pixelSizeY(e){this._blurFilter.pixelSizeY=e}};pe(Rr,"DEFAULT_OPTIONS",{threshold:.5,bloomScale:1,brightness:1,blur:8,quality:4,pixelSize:{x:1,y:1}});var Tt=Rr;var Gr=`
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uCenter;
uniform float uTime;
uniform float uSpeed;
uniform vec4 uWave;

uniform vec4 uInputSize;
uniform vec4 uInputClamp;

const float PI = 3.14159;

void main()
{
    float uAmplitude = uWave[0];
    float uWavelength = uWave[1];
    float uBrightness = uWave[2];
    float uRadius = uWave[3];

    float halfWavelength = uWavelength * 0.5 / uInputSize.x;
    float maxRadius = uRadius / uInputSize.x;
    float currentRadius = uTime * uSpeed / uInputSize.x;

    float fade = 1.0;

    if (maxRadius > 0.0) {
        if (currentRadius > maxRadius) {
            finalColor = texture(uTexture, vTextureCoord);
            return;
        }
        fade = 1.0 - pow(currentRadius / maxRadius, 2.0);
    }

    vec2 dir = vec2(vTextureCoord - uCenter / uInputSize.xy);
    dir.y *= uInputSize.y / uInputSize.x;
    float dist = length(dir);

    if (dist <= 0.0 || dist < currentRadius - halfWavelength || dist > currentRadius + halfWavelength) {
        finalColor = texture(uTexture, vTextureCoord);
        return;
    }

    vec2 diffUV = normalize(dir);

    float diff = (dist - currentRadius) / halfWavelength;

    float p = 1.0 - pow(abs(diff), 2.0);

    // float powDiff = diff * pow(p, 2.0) * ( amplitude * fade );
    float powDiff = 1.25 * sin(diff * PI) * p * ( uAmplitude * fade );

    vec2 offset = diffUV * powDiff / uInputSize.xy;

    // Do clamp :
    vec2 coord = vTextureCoord + offset;
    vec2 clampedCoord = clamp(coord, uInputClamp.xy, uInputClamp.zw);
    vec4 color = texture(uTexture, clampedCoord);
    if (coord != clampedCoord) {
        color *= max(0.0, 1.0 - length(coord - clampedCoord));
    }

    // No clamp :
    // finalColor = texture(uTexture, vTextureCoord + offset);

    color.rgb *= 1.0 + (uBrightness - 1.0) * p * fade;

    finalColor = color;
}
`;var Ur=`
struct ShockWaveUniforms {
    uTime: f32,
    uOffset: vec2<f32>,
    uSpeed: f32,
    uWave: vec4<f32>,
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
@group(1) @binding(0) var<uniform> shockwaveUniforms : ShockWaveUniforms;

@fragment
fn mainFragment(
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>
) -> @location(0) vec4<f32> {

    let uTime = shockwaveUniforms.uTime;
    let uOffset = shockwaveUniforms.uOffset;
    let uSpeed = shockwaveUniforms.uSpeed;
    let uAmplitude = shockwaveUniforms.uWave[0];
    let uWavelength = shockwaveUniforms.uWave[1];
    let uBrightness = shockwaveUniforms.uWave[2];
    let uRadius = shockwaveUniforms.uWave[3];
    let halfWavelength: f32 = uWavelength * 0.5 / gfu.uInputSize.x;
    let maxRadius: f32 = uRadius / gfu.uInputSize.x;
    let currentRadius: f32 = uTime * uSpeed / gfu.uInputSize.x;
    var fade: f32 = 1.0;
    var returnColorOnly: bool = false;
    
    if (maxRadius > 0.0) {
        if (currentRadius > maxRadius) {
            returnColorOnly = true;
        }
        fade = 1.0 - pow(currentRadius / maxRadius, 2.0);
    }
    var dir: vec2<f32> = vec2<f32>(uv - uOffset / gfu.uInputSize.xy);
    dir.y *= gfu.uInputSize.y / gfu.uInputSize.x;

    let dist:f32 = length(dir);

    if (dist <= 0.0 || dist < currentRadius - halfWavelength || dist > currentRadius + halfWavelength) {
        returnColorOnly = true;
    }

    let diffUV: vec2<f32> = normalize(dir);
    let diff: f32 = (dist - currentRadius) / halfWavelength;
    let p: f32 = 1.0 - pow(abs(diff), 2.0);
    let powDiff: f32 = 1.25 * sin(diff * PI) * p * ( uAmplitude * fade );
    let offset: vec2<f32> = diffUV * powDiff / gfu.uInputSize.xy;
    // Do clamp :
    let coord: vec2<f32> = uv + offset;
    let clampedCoord: vec2<f32> = clamp(coord, gfu.uInputClamp.xy, gfu.uInputClamp.zw);

    var clampedColor: vec4<f32> = textureSample(uTexture, uSampler, clampedCoord);
    
    if (boolVec2(coord, clampedCoord)) 
    {
        clampedColor *= max(0.0, 1.0 - length(coord - clampedCoord));
    }
    // No clamp :
    var finalColor = clampedColor;

    return select(finalColor, textureSample(uTexture, uSampler, uv), returnColorOnly);
}

fn boolVec2(x: vec2<f32>, y: vec2<f32>) -> bool
{
    if (x.x == y.x && x.y == y.y)
    {
        return true;
    }
    
    return false;
}

const PI: f32 = 3.14159265358979323846264;
`;var Kr=Object.defineProperty,Qr=(l,e,t)=>e in l?Kr(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t,St=(l,e,t)=>(Qr(l,typeof e!="symbol"?e+"":e,t),t),Er=class Ir extends V{constructor(...e){let t=e[0]??{};(Array.isArray(t)||"x"in t&&"y"in t)&&(S("6.0.0","ShockwaveFilter constructor params are now options object. See params: { center, speed, amplitude, wavelength, brightness, radius, time }"),t={center:t,...e[1]},e[2]!==void 0&&(t.time=e[2])),t={...Ir.DEFAULT_OPTIONS,...t};let r=O.from({vertex:{source:q,entryPoint:"mainVertex"},fragment:{source:Ur,entryPoint:"mainFragment"}}),o=z.from({vertex:H,fragment:Gr,name:"shockwave-filter"});super({gpuProgram:r,glProgram:o,resources:{shockwaveUniforms:{uTime:{value:t.time,type:"f32"},uCenter:{value:t.center,type:"vec2<f32>"},uSpeed:{value:t.speed,type:"f32"},uWave:{value:new Float32Array(4),type:"vec4<f32>"}}}}),St(this,"uniforms"),St(this,"time"),this.time=0,this.uniforms=this.resources.shockwaveUniforms.uniforms,Object.assign(this,t)}apply(e,t,r,o){this.uniforms.uTime=this.time,e.applyFilter(this,t,r,o)}get center(){return this.uniforms.uCenter}set center(e){Array.isArray(e)&&(e={x:e[0],y:e[1]}),this.uniforms.uCenter=e}get centerX(){return this.uniforms.uCenter.x}set centerX(e){this.uniforms.uCenter.x=e}get centerY(){return this.uniforms.uCenter.y}set centerY(e){this.uniforms.uCenter.y=e}get speed(){return this.uniforms.uSpeed}set speed(e){this.uniforms.uSpeed=e}get amplitude(){return this.uniforms.uWave[0]}set amplitude(e){this.uniforms.uWave[0]=e}get wavelength(){return this.uniforms.uWave[1]}set wavelength(e){this.uniforms.uWave[1]=e}get brightness(){return this.uniforms.uWave[2]}set brightness(e){this.uniforms.uWave[2]=e}get radius(){return this.uniforms.uWave[3]}set radius(e){this.uniforms.uWave[3]=e}};St(Er,"DEFAULT_OPTIONS",{center:{x:0,y:0},speed:500,amplitude:30,wavelength:160,brightness:1,radius:-1});var $r=Er;var Je=class{constructor(e,{textures:t=["enemy_chaser"],clips:r=null,scale:o=1,worldScale:i=1,offsetX:s=0,offsetY:n=0,syncRotation:a=!1,flipByDirection:p=!1,cull:u=!0}={}){if(!e?.worldRoot||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a swarm layer");let f=r??(Array.isArray(t)?t.map(m=>({frames:[m]})):null);if(!Array.isArray(f)||f.length===0)throw new TypeError("Swarm clips or textures must be a non-empty array");if(![o,i,s,n].every(Number.isFinite)||o<=0||i<=0)throw new RangeError("Swarm scale and worldScale must be positive and offsets must be finite");this.renderer=e,this.scale=o,this.worldScale=i,this.offsetX=s,this.offsetY=n,this.syncRotation=!!a,this.flipByDirection=!!p,this.cull=!!u,this.clips=f.map(m=>{if(!m||!Array.isArray(m.frames)||m.frames.length===0||m.frames.some(d=>typeof d!="string"||!e.atlas.textures.has(d)))throw new TypeError("Swarm clip frames must be existing atlas frame names");let c=m.fps??8;if(!Number.isFinite(c)||c<=0)throw new RangeError("Swarm clip fps must be positive");let x=m.frames.map(d=>{let h=e.atlas.textures.get(d);return{texture:h,white:e.atlas.textures.get(d+"_white")??h,radius:Math.hypot(h.orig.width,h.orig.height)*.5}});return{frames:x,fps:c,loop:m.loop!==!1,radius:Math.max(...x.map(d=>d.radius))}}),this.dynamicUvs=this.clips.some(m=>m.frames.length>1),this.dynamicRotation=this.syncRotation,this.layer=new Y({dynamicProperties:{position:!0,uvs:this.dynamicUvs,rotation:this.dynamicRotation,vertex:!0}}),e.worldRoot.addChildAt(this.layer,e.worldRoot.getChildIndex(e.entityLayer)),this.particles=[],this.pool=[],this.pendingParticles=[],this.visibleCount=0,this.disposed=!1}sync(e){if(this.disposed)throw new Error("Swarm layer is disposed");if(!e?.activeIds||!e.posX||!e.posY||!Number.isInteger(e.count))throw new TypeError("sync requires an HGame CPU SwarmSimulation");let t=e.count;if(t<0||t>e.activeIds.length)throw new RangeError("Swarm count exceeds active ID capacity");let r=this.renderer.camera,o=this.renderer.app.screen,i=o.width/2,s=o.height/2,n=r.zoom;if(!(n>0)||!Number.isFinite(n))throw new RangeError("Camera zoom must be finite and positive");let a=r.x+(-i-r.shakeX)/n,p=r.x+(i-r.shakeX)/n,u=r.y+(-s-r.shakeY)/n,f=r.y+(s-r.shakeY)/n,m=this.clips,c=m.length===1?m[0]:null,x=e.posX,d=e.posY,h=e.activeIds,v=e.animClip,y=e.scale,b=e.rot,g=e.animTime,F=e.flash,A=this.worldScale,B=this.offsetX,U=this.offsetY,_=this.scale,M=this.cull,j=this.syncRotation,Fe=this.flipByDirection,Be=this.dynamicUvs,kr=this.dynamicRotation,Ae=!1,N=0;for(let K=0;K<t;K++){let Q=h[K],tt=x[Q]*A+B,rt=d[Q]*A+U,$=c??m[(v?.[Q]??0)%m.length],Re=(y?.[Q]??1)*_;if(M){let J=$.radius*Math.abs(Re);if(tt+J<a||tt-J>p||rt+J<u||rt-J>f)continue}let Ct=0;if($.frames.length>1){let J=g?.[Q]??0,At=Number.isFinite(J)?Math.max(0,Math.floor(J*$.fps)):0;Ct=$.loop?At%$.frames.length:Math.min(At,$.frames.length-1)}let Pt=$.frames[Ct],E=this.particles[N],ot=F?.[Q]>0?Pt.white:Pt.texture;E||(E=this.pool.pop()??new oe({texture:ot,anchorX:.5,anchorY:.5}),this.particles.push(E),this.pendingParticles.push(E),this.pendingParticles.length===4096&&this.flushPending()),E.texture!==ot&&(E.texture=ot,Be||(Ae=!0)),E.x=tt,E.y=rt;let Ft=j||Fe?b?.[Q]??0:0,Bt=j?Ft:0;E.rotation!==Bt&&(E.rotation=Bt,kr||(Ae=!0)),E.scaleX=Fe&&Math.sin(Ft)<0?-Re:Re,E.scaleY=Re,N++}if(this.flushPending(),N<this.particles.length){for(let K=N;K<this.particles.length;K++)this.pool.push(this.particles[K]);this.particles.length=N,this.layer.particleChildren.length=N,Ae=!0}return Ae&&this.layer.update(),this.visibleCount=N,N}flushPending(){this.pendingParticles.length&&this.layer.addParticle(...this.pendingParticles),this.pendingParticles.length=0}dispose(){this.disposed||(this.disposed=!0,this.layer.removeFromParent(),this.layer.destroy(),this.particles.length=0,this.pool.length=0,this.pendingParticles.length=0,this.visibleCount=0,this.renderer.swarmLayers.delete(this))}};var Ze=class{constructor(e,t,{frames:r,layer:o="background",chunkSize:i=32,maxCachedChunks:s=128,originX:n=0,originY:a=0}={}){if(!e?.bgLayer||!e?.atlas?.textures)throw new TypeError("Initialize Renderer2D before creating a tilemap layer");if(!t||typeof t.get!="function"||!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<1||t.height<1||!Number.isFinite(t.tileWidth)||!Number.isFinite(t.tileHeight)||!(t.tileWidth>0)||!(t.tileHeight>0))throw new TypeError("A rectangular HGame TileMap with positive tile dimensions is required");if(!r||typeof r!="object"||Array.isArray(r))throw new TypeError("frames must map tile values to atlas frame names");if(o!=="background"&&o!=="foreground")throw new RangeError("Tilemap layer must be background or foreground");if(!Number.isInteger(i)||i<1||i>128)throw new RangeError("chunkSize must be an integer from 1 to 128");if(!Number.isInteger(s)||s<1||s>4096)throw new RangeError("maxCachedChunks must be an integer from 1 to 4096");if(!Number.isFinite(n)||!Number.isFinite(a))throw new RangeError("Tilemap origin must be finite");this.renderer=e,this.map=t,this.frames=new Map;for(let[p,u]of Object.entries(r)){if(u==null)continue;let f=e.atlas.textures.get(u);if(!f)throw new Error("Unknown tilemap atlas frame: "+u);this.frames.set(p,f)}this.chunkSize=i,this.maxCachedChunks=s,this.originX=n,this.originY=a,this.cols=Math.ceil(t.width/i),this.rows=Math.ceil(t.height/i),this.root=new G,this.root.eventMode="none",this.root.interactiveChildren=!1,this.chunks=new Map,this.visibleRange=null,this.disposed=!1;try{(o==="foreground"?e.foregroundLayer:e.bgLayer).addChild(this.root),this.update()}catch(p){throw this.root.destroy({children:!0}),p}}buildChunk(e,t){let r=t*this.cols+e,o=e*this.chunkSize,i=t*this.chunkSize,s=Math.min(this.map.width,o+this.chunkSize),n=Math.min(this.map.height,i+this.chunkSize),a=new Y({dynamicProperties:{position:!1,vertex:!1,uvs:!1,rotation:!1,color:!1}}),p={view:a,x0:o,y0:i,x1:s,y1:n,cells:new Array((s-o)*(n-i)).fill(null)};return this.chunks.set(r,p),this.root.addChild(a),this.refreshChunk(p),p}updateCell(e,t,r){let o=(r-e.y0)*(e.x1-e.x0)+t-e.x0,i=e.cells[o],s=this.frames.get(String(this.map.get(t,r)));if(!s)return i?(e.cells[o]=null,2):0;let n=this.originX+t*this.map.tileWidth,a=this.originY+r*this.map.tileHeight,p=this.map.tileWidth/s.orig.width,u=this.map.tileHeight/s.orig.height;if(i&&i.texture===s&&i.x===n&&i.y===a&&i.scaleX===p&&i.scaleY===u)return 0;let f=i??new oe({texture:s});return f.texture=s,f.x=n,f.y=a,f.scaleX=p,f.scaleY=u,e.cells[o]=f,i?1:2}commitChunkChanges(e,t){if(t===2){let r=e.view.particleChildren;r.length=0;for(let o of e.cells)o&&r.push(o)}t>0&&e.view.update()}refreshChunk(e){let t=0;for(let r=e.y0;r<e.y1;r++)for(let o=e.x0;o<e.x1;o++)t=Math.max(t,this.updateCell(e,o,r));this.commitChunkChanges(e,t)}cachedChunkAt(e,t){return this.chunks.get(Math.floor(t/this.chunkSize)*this.cols+Math.floor(e/this.chunkSize))}refreshTile(e,t){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw new RangeError("Tile is outside the map");let r=this.cachedChunkAt(e,t);r&&this.refreshChunk(r)}setTile(e,t,r){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Number.isInteger(e)||!Number.isInteger(t)||e<0||t<0||e>=this.map.width||t>=this.map.height)throw new RangeError("Tile is outside the map");if(typeof this.map.set!="function")throw new TypeError("Tilemap must support set");if(Object.is(this.map.get(e,t),r))return;this.map.set(e,t,r);let o=this.cachedChunkAt(e,t);o&&this.commitChunkChanges(o,this.updateCell(o,e,t))}setTiles(e){if(this.disposed)throw new Error("Tilemap layer is disposed");if(!Array.isArray(e))throw new TypeError("Tile edits must be an array");if(typeof this.map.set!="function")throw new TypeError("Tilemap must support set");for(let r of e)if(!r||!Object.hasOwn(r,"value")||!Number.isInteger(r.x)||!Number.isInteger(r.y)||r.x<0||r.y<0||r.x>=this.map.width||r.y>=this.map.height)throw new RangeError("Each tile edit needs an in-bounds x, y, and value");let t=new Map;try{for(let{x:r,y:o,value:i}of e){if(Object.is(this.map.get(r,o),i))continue;this.map.set(r,o,i);let s=this.cachedChunkAt(r,o);if(!s)continue;let n=this.updateCell(s,r,o);n>0&&t.set(s,Math.max(n,t.get(s)??0))}}finally{for(let[r,o]of t)this.commitChunkChanges(r,o)}}update(){if(this.disposed)return;let e=this.renderer.camera,t=this.renderer.app.screen,r=e.zoom;if(!(r>0)||!Number.isFinite(r))throw new RangeError("Camera zoom must be finite and positive");let o=e.x+(-t.width/2-e.shakeX)/r,i=e.x+(t.width/2-e.shakeX)/r,s=e.y+(-t.height/2-e.shakeY)/r,n=e.y+(t.height/2-e.shakeY)/r,a=this.chunkSize*this.map.tileWidth,p=this.chunkSize*this.map.tileHeight,u=Math.max(0,Math.ceil((o-this.originX)/a)-1),f=Math.min(this.cols-1,Math.floor((i-this.originX)/a)),m=Math.max(0,Math.ceil((s-this.originY)/p)-1),c=Math.min(this.rows-1,Math.floor((n-this.originY)/p)),x=this.visibleRange;if(!(x&&x.x0===u&&x.x1===f&&x.y0===m&&x.y1===c)){if(x)for(let d=x.y0;d<=x.y1;d++)for(let h=x.x0;h<=x.x1;h++)(h<u||h>f||d<m||d>c)&&(this.chunks.get(d*this.cols+h).view.visible=!1);for(let d=m;d<=c;d++)for(let h=u;h<=f;h++){let v=d*this.cols+h,y=this.chunks.get(v)??this.buildChunk(h,d);y.view.visible=!0,this.chunks.delete(v),this.chunks.set(v,y)}for(let[d,h]of this.chunks){if(this.chunks.size<=this.maxCachedChunks||h.view.visible)break;h.view.removeFromParent(),h.view.destroy(),this.chunks.delete(d)}this.visibleRange={x0:u,x1:f,y0:m,y1:c}}}dispose(){this.disposed||(this.disposed=!0,this.root.removeFromParent(),this.root.destroy({children:!0}),this.chunks.clear(),this.visibleRange=null,this.renderer.tilemapLayers.delete(this))}};var zr=["webgpu","webgl","canvas"],et=class{constructor(e,{backend:t="auto",maxPixels:r=23e5,maxPixelRatio:o=2,qualityController:i=null,qualityPresets:s=null}={}){if(t!=="auto"&&!zr.includes(t))throw new RangeError("Invalid Pixi renderer backend: "+t);if(!Number.isFinite(r)||r<1||!Number.isFinite(o)||o<=0)throw new RangeError("Renderer pixel budget and maximum pixel ratio must be positive");if(this.atlas=e,this.maxPixels=r,this.maxPixelRatio=o,this.backendPreference=t,i&&(typeof i.sampleFrame!="function"||typeof i.resetMeasurements!="function"))throw new TypeError("qualityController must support sampleFrame and resetMeasurements");this.qualityController=i,this.qualityPresets=s,this.lastFrameTime=null,this.app=new be,this.entityMap=new Map,this.spritePool=[],this.enemyParticles=[],this.enemyPool=[],this.pendingEnemies=[],this.swarmLayers=new Set,this.tilemapLayers=new Set,this.effectChannels=new Map,this.beforeRenderCallbacks=new Set,this.camera={x:0,y:0,targetX:0,targetY:0,zoom:1,shakeX:0,shakeY:0}}async init(e){this.mount=e;let{width:t,height:r,resolution:o}=this.planViewport(),i={width:t,height:r,resolution:o,autoDensity:!0,backgroundColor:725019,autoStart:!1},s=[],n=!1,a=this.backendPreference==="auto"?zr:[this.backendPreference];for(let u of a){let f=this.app??=new be;try{await f.init({...i,preference:[u]}),n=!0,this.backend=u;break}catch(m){s.push(m),this.app=null;try{f.renderer?f.destroy({removeView:!0},{children:!0}):f.stage?.destroy({children:!0})}catch(c){s.push(c),console.warn("Failed to clean up a Pixi renderer:",c)}}}if(!n)throw new AggregateError(s,"Unable to initialize a Pixi renderer");this.isCanvas=this.app.renderer.type===xe.CANVAS,this.app.ticker.stop(),this.app.canvas.id="game",this.app.canvas.setAttribute("aria-label","\u6E38\u620F\u753B\u9762"),this.app.canvas.dataset.rendererBackend=this.backend,this.updateQualityMarker(),e.appendChild(this.app.canvas),this.worldRoot=new G,this.worldRoot.eventMode="none",this.worldRoot.interactiveChildren=!1,this.bgLayer=new G;let p=new dt({texture:this.atlas.get("ground_grid"),width:4096,height:4096});this.grid=p,p.position.set(-2048,-2048),this.bgLayer.addChild(p),this.shadowLayer=new G,this.entityLayer=new G({sortableChildren:!0}),this.foregroundLayer=new G,this.enemyLayer=new Y({dynamicProperties:{position:!0,uvs:!0,rotation:!0,vertex:!0}}),this.trailLayer=new G,this.particleLayer=new Y({dynamicProperties:{position:!0,vertex:!0,rotation:!0,color:!0,uvs:!0}}),this.worldRoot.addChild(this.bgLayer,this.shadowLayer,this.enemyLayer,this.entityLayer,this.foregroundLayer,this.trailLayer,this.particleLayer),this.app.stage.addChild(this.worldRoot),this.bloom=new Tt({threshold:.62,bloomScale:.4,brightness:1,blur:3}),this.bloom.resolution="inherit",this.bloomEnabled=!1,this.app.stage.filterArea=this.app.screen,this.applyFilters(),this.viewport={width:t,height:r,resolution:o},this.syncCameraView(),typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(e))}planViewport(){let e=Math.max(1,Math.floor(this.mount?.clientWidth||1)),t=Math.max(1,Math.floor(this.mount?.clientHeight||1)),r=Number(globalThis.devicePixelRatio)||1,o=this.qualityController?.state,i=o?.dynamicScale??1,s=this.qualityPresets?.[o?.tier]?.maxPixelRatio??this.maxPixelRatio,n=Math.max(1/Math.min(e,t),Math.min(r,this.maxPixelRatio,s,Math.sqrt(this.maxPixels/(e*t)))*i);return{width:e,height:t,resolution:n}}resize(){if(this.disposed||!this.app?.renderer)return!1;this.updateQualityMarker();let e=this.planViewport(),t=this.viewport;return t&&t.width===e.width&&t.height===e.height&&t.resolution===e.resolution?!1:(this.app.renderer.resize(e.width,e.height,e.resolution),this.viewport=e,this.app.stage.filterArea=this.app.screen,this.syncCameraView(),this.onResize?.(),!0)}updateQualityMarker(){let e=this.qualityController?.state?.tier;e&&(this.app.canvas.dataset.qualityTier=e)}renderDiagnostics(){let e=this.app.renderer.gpu?.adapter,t=e?.info;return{backend:this.backend,adapter:e?{vendor:t?.vendor||null,architecture:t?.architecture||null,device:t?.device||null,description:t?.description||null,fallback:t?.isFallbackAdapter??e.isFallbackAdapter??null}:null}}resetQualityMeasurements(){this.lastFrameTime=null,this.qualityController?.resetMeasurements()}setQuality(e){if(typeof this.qualityController?.setMode!="function")throw new Error("Renderer2D has no configurable quality controller");return this.qualityController.setMode(e)?(this.lastFrameTime=null,this.resize(),!0):!1}setBloom({enabled:e=!0,threshold:t,bloomScale:r,brightness:o,blur:i}={}){if(!this.bloom||this.disposed)throw new Error("Initialize Renderer2D before configuring bloom");for(let[s,n]of Object.entries({threshold:t,bloomScale:r,brightness:o,blur:i}))if(n!==void 0&&(!Number.isFinite(n)||n<0))throw new RangeError(`Bloom ${s} must be a finite non-negative number`);t!==void 0&&(this.bloom.threshold=t),r!==void 0&&(this.bloom.bloomScale=r),o!==void 0&&(this.bloom.brightness=o),i!==void 0&&(this.bloom.blur=i),this.bloomEnabled=!!e,this.applyFilters()}setEffectFilters(e,{owner:t=this,beforeRender:r=null,bloom:o=!0}={}){e.length?this.effectChannels.set(t,{filters:e,beforeRender:r,bloom:o}):this.effectChannels.delete(t),this.applyFilters()}onBeforeRender(e){if(typeof e!="function")throw new TypeError("Expected a render preparation callback");return this.beforeRenderCallbacks.add(e),()=>this.beforeRenderCallbacks.delete(e)}applyFilters(){let e=[];if(!this.isCanvas){let t=this.bloomEnabled;for(let r of this.effectChannels.values())e.push(...r.filters),t||=r.bloom;t&&e.unshift(this.bloom)}this.app.stage.filters=e}createSwarmLayer(e){let t=new Je(this,e);return this.swarmLayers.add(t),t}createTilemapLayer(e,t){let r=new Ze(this,e,t);return this.tilemapLayers.add(r),r}syncEnemies(e,t){let r=this.enemyTextures??=["enemy_chaser","enemy_chaser_white","enemy_elite","enemy_elite_white"].map(v=>this.atlas.get(v)),o=this.enemyCullRadius??=Math.max(...r.map(v=>Math.hypot(v.orig.width,v.orig.height)*.525)),{x:i,y:s,zoom:n,shakeX:a,shakeY:p}=this.camera,{width:u,height:f}=this.app.screen,m=i+(-u/2-a)/n-o,c=i+(u/2-a)/n+o,x=s+(-f/2-p)/n-o,d=s+(f/2-p)/n+o,h=0;for(let v=0;v<e.length;v++){let y=e[v];if(y.x<m||y.x>c||y.y<x||y.y>d)continue;let b=r[(y.elite?2:0)+(y.flash>0?1:0)],g=this.enemyParticles[h++];g||(g=this.enemyPool.pop()??new oe({texture:b,anchorX:.5,anchorY:.5}),this.enemyParticles.push(g),this.pendingEnemies.push(g),this.pendingEnemies.length===4096&&this.flushEnemies()),g.texture!==b&&(g.texture=b),g.x=y.x,g.y=y.y;let F=t*7+y.id*.37;g.rotation=Math.sin(F)*.09;let A=Math.sin(F*2);g.scaleX=1+A*.035,g.scaleY=1-A*.05}if(this.flushEnemies(),h<this.enemyParticles.length){for(let v=h;v<this.enemyParticles.length;v++)this.enemyPool.push(this.enemyParticles[v]);this.enemyParticles.length=h,this.enemyLayer.particleChildren.length=h,this.enemyLayer.update()}}flushEnemies(){this.pendingEnemies.length&&this.enemyLayer.addParticle(...this.pendingEnemies),this.pendingEnemies.length=0}alloc(e){let t=this.spritePool.pop()??new lt;return t.texture=this.atlas.get(e),t.anchor.set(.5),t.alpha=1,t.tint=16777215,t.scale.set(1),t.rotation=0,t.visible=!0,t}syncEntity(e,t){let r=this.entityMap.get(e);r||(r={sprite:this.alloc(t.tex),shadow:null,flashTimer:0,animScaleX:1,animScaleY:1},this.entityMap.set(e,r),this.entityLayer.addChild(r.sprite)),r.baseTex=t.tex;let o=r.sprite,i=this.atlas.get(t.tex);return o.texture=r.flashTimer>0?this.atlas.textures.get(t.tex+"_white")??i:i,o.position.set(t.x,t.y),o.rotation=t.rot??0,o.scale.set((t.scaleX??1)*r.animScaleX,(t.scaleY??1)*r.animScaleY),o.tint=r.flashTimer>0?16777215:t.tint??16777215,o.alpha=t.alpha??1,o.zIndex=t.zIndex??t.y,t.hasShadow!==!1?(r.shadow||(r.shadow=this.alloc("shadow_oval"),this.shadowLayer.addChild(r.shadow)),r.shadow.visible=!0,r.shadow.position.set(t.x,t.y+18),r.shadow.alpha=.35):r.shadow&&(r.shadow.visible=!1),r}releaseEntity(e){let t=this.entityMap.get(e);t&&(t.sprite.removeFromParent(),this.spritePool.push(t.sprite),t.shadow&&(t.shadow.removeFromParent(),this.spritePool.push(t.shadow)),this.entityMap.delete(e))}update(e){let t=this.camera,r=1-Math.exp(-10*e);t.x+=(t.targetX-t.x)*r,t.y+=(t.targetY-t.y)*r,this.syncCameraView();for(let o of this.entityMap.values())o.flashTimer=Math.max(0,o.flashTimer-e)}syncCameraView(){let e=this.camera;this.worldRoot.scale.set(e.zoom),this.worldRoot.position.set(this.app.screen.width/2-e.x*e.zoom+e.shakeX,this.app.screen.height/2-e.y*e.zoom+e.shakeY);for(let t of this.tilemapLayers)t.update()}screenToWorld(e,t){return{x:(e-this.app.screen.width/2-this.camera.shakeX)/this.camera.zoom+this.camera.x,y:(t-this.app.screen.height/2-this.camera.shakeY)/this.camera.zoom+this.camera.y}}worldToScreen(e,t,r={x:0,y:0}){return r.x=(e-this.camera.x)*this.camera.zoom+this.app.screen.width/2+this.camera.shakeX,r.y=(t-this.camera.y)*this.camera.zoom+this.app.screen.height/2+this.camera.shakeY,r}render(e){if(this.qualityController&&e!==null){if(e===void 0){let t=performance.now();e=this.lastFrameTime===null?0:t-this.lastFrameTime,this.lastFrameTime=t}else e===0&&this.resetQualityMeasurements();e>0&&this.qualityController.sampleFrame(e)&&this.resize()}for(let t of this.beforeRenderCallbacks)t();if(!this.isCanvas)for(let t of this.effectChannels.values())t.beforeRender?.();this.app.renderer.render(this.app.stage)}dispose(){if(!this.disposed){this.disposed=!0;try{this.resizeObserver?.disconnect(),this.resizeObserver=null,this.onResize=null;for(let t of this.swarmLayers)t.dispose();for(let t of this.tilemapLayers)t.dispose();for(let t of this.spritePool)t.destroy();this.spritePool.length=0,this.enemyParticles.length=0,this.enemyPool.length=0,this.pendingEnemies.length=0,this.entityMap.clear();let e=this.app?.stage;e&&(e.filters=[]),this.effectChannels.clear(),this.beforeRenderCallbacks.clear(),this.bloom?.destroy(),this.app?.renderer?this.app.destroy({removeView:!0},{children:!0}):e&&!e.destroyed&&e.destroy({children:!0})}finally{this.atlas.dispose()}}}};function Or(l,{resetInput:e=()=>{},onVisibility:t=()=>{}}={}){let r=!1;function o(a){a?r&&(r=!1,l.running&&l.paused&&l.resume()):(e(),l.running&&!l.paused&&(r=l.pause())),t(a)}let i=l.platform.lifecycle,s=i.on("visibility",o),n=i.on("focus",a=>{a||e()});return{sync(){o(i.visible)},dispose(){s(),n(),r=!1}}}async function _t(l){let e=await fetch(new URL(l,document.baseURI));if(!e.ok)throw new Error(`Could not load ${l}: HTTP ${e.status}`);return e.json()}function me(l){let e=location.port==="4175"&&location.pathname.startsWith("/local-games/"),t=new URL(e?"/runtime/hgame/":"./vendor/hgame/",document.baseURI);return import(new URL(l,t).href)}async function nl(l,{mount:e=document.querySelector("#game-canvas"),createAtlas:t=hr,rendererOptions:r}={}){if(!e)throw new Error("Missing Pixi game canvas mount");if(typeof l!="function")throw new TypeError("Pixi game setup callback is required");let[o,i,s,{createGameApplication:n},{defineProject:a},{Scene:p},{Entity:u},{Component:f},{createAdaptiveQualityController:m,QUALITY2D_PRESETS:c}]=await Promise.all([_t("./game.config.json"),_t("./engine.config.json"),_t("./src/presentation.json"),me("core/application.js"),me("core/config.js"),me("core/scene.js"),me("core/entity.js"),me("core/component.js"),me("integrations/quality3d.js")]),x=a(i),d=s.quality??"auto",h=d==="auto"&&x.tickHz===0?"high":d,v=m({mode:h,device:{mobile:globalThis.matchMedia?.("(pointer: coarse)")?.matches??!1,memoryGB:navigator.deviceMemory??null}}),y=await t(),b,g,F,A,B,U=()=>g.renderDiagnostics();function _(M){M.persisted||b.dispose()}try{g=new et(y,{backend:s.backend??"auto",qualityController:v,qualityPresets:c,maxPixelRatio:3,...r}),await g.init(e),F=g.app.canvas,b=n({project:x,gameId:o.id,gameVersion:o.version,renderer:{render(j,Fe){let Be=Fe?.unscaledDeltaSeconds;g.render(x.tickHz===0?null:Be===void 0?void 0:Be*1e3)},resize(){g.resize()},dispose(){window.removeEventListener("pagehide",_),B&&window.__hgameState===B&&delete window.__hgameState,window.__hgameRenderDiagnostics===U&&delete window.__hgameRenderDiagnostics,delete e.dataset.engineReady,delete F.dataset.engineReady;try{A?.dispose()}finally{g.dispose()}}}}),window.addEventListener("pagehide",_),await b.installFeatures();let M=await l({app:b,renderer:g,Scene:p,Entity:u,Component:f});if(b.disposed)throw new Error("Pixi game was disposed during setup");if(typeof M?.scene!="string"||!b.scenes.get(M.scene))throw new Error("Pixi game setup must return the name of a registered scene in { scene }");return A=Or(b,{...M.visibility,onVisibility(j){g.resetQualityMeasurements(),M.visibility?.onVisibility?.(j)}}),g.onResize=()=>{x.tickHz===0&&b.running&&!b.paused&&g.render(null)},b.scenes.start(M.scene),b.start(),A.sync(),B=M.state,B&&(window.__hgameState=B),window.__hgameRenderDiagnostics=U,e.dataset.engineReady="true",F.dataset.engineReady="true",{app:b,renderer:g}}catch(M){try{b?b.dispose():g?g.dispose():y.dispose()}catch(j){throw new AggregateError([M,j],"Pixi game startup and cleanup failed")}throw M}}export{Dr as a,oe as b,Y as c,hr as d,$r as e,_t as f,me as g,nl as h};
