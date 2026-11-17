import{j,E as h,f as S,u as E,k as O,d as G,y as M,C as m,G as D,w as B,z as H,A as N}from"./Geometry-BaCAlYjk.js";const v=[];j.handleByNamedList(h.Environment,v);async function $(n){if(!n)for(let e=0;e<v.length;e++){const t=v[e];if(t.value.test()){await t.value.load();return}}}let u;function k(){if(typeof u=="boolean")return u;try{u=new Function("param1","param2","param3","return param1[param2] === param3;")({a:"b"},"a","b")===!0}catch{u=!1}return u}var V=(n=>(n[n.NONE=0]="NONE",n[n.COLOR=16384]="COLOR",n[n.STENCIL=1024]="STENCIL",n[n.DEPTH=256]="DEPTH",n[n.COLOR_DEPTH=16640]="COLOR_DEPTH",n[n.COLOR_STENCIL=17408]="COLOR_STENCIL",n[n.DEPTH_STENCIL=1280]="DEPTH_STENCIL",n[n.ALL=17664]="ALL",n))(V||{});class W{constructor(e){this.items=[],this._name=e}emit(e,t,r,i,s,a,o,l){const{name:I,items:p}=this;for(let d=0,R=p.length;d<R;d++)p[d][I](e,t,r,i,s,a,o,l);return this}add(e){return e[this._name]&&(this.remove(e),this.items.push(e)),this}remove(e){const t=this.items.indexOf(e);return t!==-1&&this.items.splice(t,1),this}contains(e){return this.items.indexOf(e)!==-1}removeAll(){return this.items.length=0,this}destroy(){this.removeAll(),this.items=null,this._name=null}get empty(){return this.items.length===0}get name(){return this._name}}const z=["init","destroy","contextChange","resolutionChange","resetState","renderEnd","renderStart","render","update","postrender","prerender"],P=class A extends S{constructor(e){super(),this.tick=0,this.uid=E("renderer"),this.runners=Object.create(null),this.renderPipes=Object.create(null),this._initOptions={},this._systemsHash=Object.create(null),this.type=e.type,this.name=e.name,this.config=e;const t=[...z,...this.config.runners??[]];this._addRunners(...t),this._unsafeEvalCheck()}async init(e={}){const t=e.skipExtensionImports===!0?!0:e.manageImports===!1;await $(t),!t&&this.config.loaders&&await Promise.all(this.config.loaders.map(r=>r.value.load())),this._addSystems(this.config.systems),this._addPipes(this.config.renderPipes,this.config.renderPipeAdaptors);for(const r in this._systemsHash)e={...this._systemsHash[r].constructor.defaultOptions,...e};e={...A.defaultOptions,...e},this._roundPixels=e.roundPixels?1:0;for(let r=0;r<this.runners.init.items.length;r++)await this.runners.init.items[r].init(e);this._initOptions=e}render(e,t){this.tick++;let r=e;if(r instanceof O&&(r={container:r},t&&(G(M,"passing a second argument is deprecated, please use render options instead"),r.target=t.renderTexture)),r.target||(r.target=this.view.renderTarget),r.target===this.view.renderTarget&&(this._lastObjectRendered=r.container,r.clearColor??(r.clearColor=this.background.colorRgba),r.clear??(r.clear=this.background.clearBeforeRender)),r.clearColor){const i=Array.isArray(r.clearColor)&&r.clearColor.length===4;r.clearColor=i?r.clearColor:m.shared.setValue(r.clearColor).toArray()}r.transform||(r.container.updateLocalTransform(),r.transform=r.container.localTransform),r.container.visible&&(r.container.enableRenderGroup(),this.runners.prerender.emit(r),this.runners.renderStart.emit(r),this.runners.render.emit(r),this.runners.renderEnd.emit(r),this.runners.postrender.emit(r))}resize(e,t,r){const i=this.view.resolution;this.view.resize(e,t,r),this.emit("resize",this.view.screen.width,this.view.screen.height,this.view.resolution),r!==void 0&&r!==i&&this.runners.resolutionChange.emit(r)}clear(e={}){const t=this;e.target||(e.target=t.renderTarget.renderTarget),e.clearColor||(e.clearColor=this.background.colorRgba),e.clear??(e.clear=V.ALL);const{clear:r,clearColor:i,target:s,mipLevel:a,layer:o}=e;m.shared.setValue(i??this.background.colorRgba),t.renderTarget.clear(s,r,m.shared.toArray(),a??0,o??0)}get resolution(){return this.view.resolution}set resolution(e){this.view.resolution=e,this.runners.resolutionChange.emit(e)}get width(){return this.view.texture.frame.width}get height(){return this.view.texture.frame.height}get canvas(){return this.view.canvas}get lastObjectRendered(){return this._lastObjectRendered}get renderingToScreen(){return this.renderTarget.renderingToScreen}get screen(){return this.view.screen}_addRunners(...e){e.forEach(t=>{this.runners[t]=new W(t)})}_addSystems(e){let t;for(t in e){const r=e[t];this._addSystem(r.value,r.name)}}_addSystem(e,t){const r=new e(this);if(this[t])throw new Error(`Whoops! The name "${t}" is already in use`);this[t]=r,this._systemsHash[t]=r;for(const i in this.runners)this.runners[i].add(r);return this}_addPipes(e,t){const r=t.reduce((i,s)=>(i[s.name]=s.value,i),{});e.forEach(i=>{const s=i.value,a=i.name,o=r[a];this.renderPipes[a]=new s(this,o?new o:null),this.runners.destroy.add(this.renderPipes[a])})}destroy(e=!1){this.runners.destroy.items.reverse(),this.runners.destroy.emit(e),(e===!0||typeof e=="object"&&e.releaseGlobalResources)&&D.release(),Object.values(this.runners).forEach(t=>{t.destroy()}),this._systemsHash=null,this.renderPipes=null,this.removeAllListeners()}generateTexture(e){return this.textureGenerator.generateTexture(e)}get roundPixels(){return!!this._roundPixels}_unsafeEvalCheck(){if(!k())throw new Error("Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module to enable support.")}resetState(){this.runners.resetState.emit()}};P.defaultOptions={resolution:1,failIfMajorPerformanceCaveat:!1,roundPixels:!1};let ue=P;const C="8.23.0";class K{static init(){globalThis.__PIXI_APP_INIT__?.(this,C)}static destroy(){}}K.extension=h.Application;class F{constructor(e){this._renderer=e}init(){globalThis.__PIXI_RENDERER_INIT__?.(this._renderer,C)}destroy(){this._renderer=null}}F.extension={type:[h.WebGLSystem,h.WebGPUSystem],name:"initHook",priority:-10};class he{constructor(e){typeof e=="number"?this.rawBinaryData=new ArrayBuffer(e):e instanceof Uint8Array?this.rawBinaryData=e.buffer:this.rawBinaryData=e,this.uint32View=new Uint32Array(this.rawBinaryData),this.float32View=new Float32Array(this.rawBinaryData),this.size=this.rawBinaryData.byteLength}get int8View(){return this._int8View||(this._int8View=new Int8Array(this.rawBinaryData)),this._int8View}get uint8View(){return this._uint8View||(this._uint8View=new Uint8Array(this.rawBinaryData)),this._uint8View}get int16View(){return this._int16View||(this._int16View=new Int16Array(this.rawBinaryData)),this._int16View}get int32View(){return this._int32View||(this._int32View=new Int32Array(this.rawBinaryData)),this._int32View}get float64View(){return this._float64Array||(this._float64Array=new Float64Array(this.rawBinaryData)),this._float64Array}get bigUint64View(){return this._bigUint64Array||(this._bigUint64Array=new BigUint64Array(this.rawBinaryData)),this._bigUint64Array}view(e){return this[`${e}View`]}destroy(){this.rawBinaryData=null,this.uint32View=null,this.float32View=null,this.uint16View=null,this._int8View=null,this._uint8View=null,this._int16View=null,this._int32View=null,this._float64Array=null,this._bigUint64Array=null}static sizeOf(e){switch(e){case"int8":case"uint8":return 1;case"int16":case"uint16":return 2;case"int32":case"uint32":case"float32":return 4;default:throw new Error(`${e} isn't a valid view type`)}}}const L={normal:"normal-npm",add:"add-npm",screen:"screen-npm"};var X=(n=>(n[n.DISABLED=0]="DISABLED",n[n.RENDERING_MASK_ADD=1]="RENDERING_MASK_ADD",n[n.MASK_ACTIVE=2]="MASK_ACTIVE",n[n.INVERSE_MASK_ACTIVE=3]="INVERSE_MASK_ACTIVE",n[n.RENDERING_MASK_REMOVE=4]="RENDERING_MASK_REMOVE",n[n.NONE=5]="NONE",n))(X||{});function de(n,e){return e.alphaMode==="no-premultiply-alpha"&&L[n]||n}function g(n,e,t){if(n)for(const r in n){const i=r.toLocaleLowerCase(),s=e[i];if(s){let a=n[r];r==="header"&&(a=a.replace(/@in\s+[^;]+;\s*/g,"").replace(/@out\s+[^;]+;\s*/g,"")),t&&s.push(`//----${t}----//`),s.push(a)}else B(`${r} placement hook does not exist in shader`)}}const q=/\{\{(.*?)\}\}/g;function w(n){const e={};return(n.match(q)?.map(r=>r.replace(/[{()}]/g,""))??[]).forEach(r=>{e[r]=[]}),e}function _(n,e){let t;const r=/@in\s+([^;]+);/g;for(;(t=r.exec(n))!==null;)e.push(t[1])}function x(n,e,t=!1){const r=[];_(e,r),n.forEach(o=>{o.header&&_(o.header,r)});const i=r;t&&i.sort();const s=i.map((o,l)=>`       @location(${l}) ${o},`).join(`
`);let a=e.replace(/@in\s+[^;]+;\s*/g,"");return a=a.replace("{{in}}",`
${s}
`),a}function y(n,e){let t;const r=/@out\s+([^;]+);/g;for(;(t=r.exec(n))!==null;)e.push(t[1])}function J(n){const t=/\b(\w+)\s*:/g.exec(n);return t?t[1]:""}function Q(n){const e=/@.*?\s+/g;return n.replace(e,"")}function Y(n,e){const t=[];y(e,t),n.forEach(l=>{l.header&&y(l.header,t)});let r=0;const i=t.sort().map(l=>l.indexOf("builtin")>-1?l:`@location(${r++}) ${l}`).join(`,
`),s=t.sort().map(l=>`       var ${Q(l)};`).join(`
`),a=`return VSOutput(
            ${t.sort().map(l=>` ${J(l)}`).join(`,
`)});`;let o=e.replace(/@out\s+[^;]+;\s*/g,"");return o=o.replace("{{struct}}",`
${i}
`),o=o.replace("{{start}}",`
${s}
`),o=o.replace("{{return}}",`
${a}
`),o}function b(n,e){let t=n;for(const r in e){const i=e[r];i.join(`
`).length?t=t.replace(`{{${r}}}`,`//-----${r} START-----//
${i.join(`
`)}
//----${r} FINISH----//`):t=t.replace(`{{${r}}}`,"")}return t}const c=Object.create(null),f=new Map;let Z=0;function ee({template:n,bits:e}){const t=T(n,e);if(c[t])return c[t];const{vertex:r,fragment:i}=re(n,e);return c[t]=U(r,i,e),c[t]}function te({template:n,bits:e}){const t=T(n,e);return c[t]||(c[t]=U(n.vertex,n.fragment,e)),c[t]}function re(n,e){const t=e.map(a=>a.vertex).filter(a=>!!a),r=e.map(a=>a.fragment).filter(a=>!!a);let i=x(t,n.vertex,!0);i=Y(t,i);const s=x(r,n.fragment,!0);return{vertex:i,fragment:s}}function T(n,e){return e.map(t=>(f.has(t)||f.set(t,Z++),f.get(t))).sort((t,r)=>t-r).join("-")+n.vertex+n.fragment}function U(n,e,t){const r=w(n),i=w(e);return t.forEach(s=>{g(s.vertex,r,s.name),g(s.fragment,i,s.name)}),{vertex:b(n,r),fragment:b(e,i)}}const ne=`
    @in aPosition: vec2<f32>;
    @in aUV: vec2<f32>;

    @out @builtin(position) vPosition: vec4<f32>;
    @out vUV : vec2<f32>;
    @out vColor : vec4<f32>;

    {{header}}

    struct VSOutput {
        {{struct}}
    };

    @vertex
    fn main( {{in}} ) -> VSOutput {

        var worldTransformMatrix = globalUniforms.uWorldTransformMatrix;
        var modelMatrix = mat3x3<f32>(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
          );
        var position = aPosition;
        var uv = aUV;

        {{start}}

        vColor = vec4<f32>(1., 1., 1., 1.);

        {{main}}

        vUV = uv;

        var modelViewProjectionMatrix = globalUniforms.uProjectionMatrix * worldTransformMatrix * modelMatrix;

        vPosition =  vec4<f32>((modelViewProjectionMatrix *  vec3<f32>(position, 1.0)).xy, 0.0, 1.0);

        vColor *= globalUniforms.uWorldColorAlpha;

        {{end}}

        {{return}}
    };
`,ie=`
    @in vUV : vec2<f32>;
    @in vColor : vec4<f32>;

    {{header}}

    @fragment
    fn main(
        {{in}}
      ) -> @location(0) vec4<f32> {

        {{start}}

        var outColor:vec4<f32>;

        {{main}}

        var finalColor:vec4<f32> = outColor * vColor;

        {{end}}

        return finalColor;
      };
`,se=`
    in vec2 aPosition;
    in vec2 aUV;

    out vec4 vColor;
    out vec2 vUV;

    {{header}}

    void main(void){

        mat3 worldTransformMatrix = uWorldTransformMatrix;
        mat3 modelMatrix = mat3(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
          );
        vec2 position = aPosition;
        vec2 uv = aUV;

        {{start}}

        vColor = vec4(1.);

        {{main}}

        vUV = uv;

        mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;

        gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);

        vColor *= uWorldColorAlpha;

        {{end}}
    }
`,ae=`

    in vec4 vColor;
    in vec2 vUV;

    out vec4 finalColor;

    {{header}}

    void main(void) {

        {{start}}

        vec4 outColor;

        {{main}}

        finalColor = outColor * vColor;

        {{end}}
    }
`,oe={name:"global-uniforms-bit",vertex:{header:`
        struct GlobalUniforms {
            uProjectionMatrix:mat3x3<f32>,
            uWorldTransformMatrix:mat3x3<f32>,
            uWorldColorAlpha: vec4<f32>,
            uResolution: vec2<f32>,
        }

        @group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
        `}},le={name:"global-uniforms-bit",vertex:{header:`
          uniform mat3 uProjectionMatrix;
          uniform mat3 uWorldTransformMatrix;
          uniform vec4 uWorldColorAlpha;
          uniform vec2 uResolution;
        `}};function me({bits:n,name:e}){const t=ee({template:{fragment:ie,vertex:ne},bits:[oe,...n]});return H.from({name:e,vertex:{source:t.vertex,entryPoint:"main"},fragment:{source:t.fragment,entryPoint:"main"}})}function fe({bits:n,name:e}){return new N({name:e,...te({template:{vertex:se,fragment:ae},bits:[le,...n]})})}const ve={name:"round-pixels-bit",vertex:{header:`
            fn roundPixels(position: vec2<f32>, targetSize: vec2<f32>) -> vec2<f32>
            {
                return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
            }
        `}},pe={name:"round-pixels-bit",vertex:{header:`
            vec2 roundPixels(vec2 position, vec2 targetSize)
            {
                return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
            }
        `}};class ge{constructor(e){this.items=Object.create(null);const{renderer:t,type:r,onUnload:i,priority:s,name:a}=e;this._renderer=t,t.gc.addResourceHash(this,"items",r,s??0),this._onUnload=i,this.name=a}add(e){return this.items[e.uid]?!1:(this.items[e.uid]=e,e.once("unload",this.remove,this),e._gcLastUsed=this._renderer.gc.now,!0)}remove(e,...t){if(!this.items[e.uid])return;const r=e._gpuData[this._renderer.uid];r&&(this._onUnload?.(e,...t),e.off("unload",this.remove,this),r.destroy(),e._gpuData[this._renderer.uid]=null,this.items[e.uid]=null)}removeAll(...e){Object.values(this.items).forEach(t=>t&&this.remove(t,...e))}destroy(...e){this.removeAll(...e),this.items=Object.create(null),this._renderer=null,this._onUnload=null}}function we(n,e,t){const r=(n>>24&255)/255;e[t++]=(n&255)/255*r,e[t++]=(n>>8&255)/255*r,e[t++]=(n>>16&255)/255*r,e[t++]=r}export{ue as A,V as C,ge as G,F as R,X as S,he as V,fe as a,pe as b,me as c,we as d,C as e,W as f,de as g,K as h,ve as r,k as u};
