export function sampleGlb({ animated = true, externalImage = false } = {}) {
  const vertexData = Buffer.alloc(104);
  new Float32Array(vertexData.buffer,vertexData.byteOffset,9).set([0,0,0,1,0,0,0,1,0]);
  new Float32Array(vertexData.buffer,vertexData.byteOffset+36,6).set([0,0,1,0,0,1]);
  vertexData.writeUInt16LE(0,60);vertexData.writeUInt16LE(1,62);vertexData.writeUInt16LE(2,64);
  new Float32Array(vertexData.buffer,vertexData.byteOffset+68,2).set([0,1]);
  new Float32Array(vertexData.buffer,vertexData.byteOffset+76,6).set([0,0,0,0,0,0.2]);
  const json = {
    asset: {version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:'Test Mesh'}],
    buffers:[{byteLength:104}],
    bufferViews:[
      {buffer:0,byteOffset:0,byteLength:36},
      {buffer:0,byteOffset:36,byteLength:24},
      {buffer:0,byteOffset:60,byteLength:6},
      {buffer:0,byteOffset:68,byteLength:8},
      {buffer:0,byteOffset:76,byteLength:24},
    ],
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},
      {bufferView:1,componentType:5126,count:3,type:'VEC2'},
      {bufferView:2,componentType:5123,count:3,type:'SCALAR'},
      {bufferView:3,componentType:5126,count:2,type:'SCALAR',min:[0],max:[1]},
      {bufferView:4,componentType:5126,count:2,type:'VEC3'},
    ],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2}]}],
    ...(externalImage ? { images:[{uri:'https://example.invalid/texture.png'}] } : {}),
    ...(animated?{animations:[{name:'Run',samplers:[{input:3,output:4,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:0,path:'translation'}}]}]}:{}),
  };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonSize = (jsonBytes.length + 3) & ~3;
  const glb = Buffer.alloc(12+8+jsonSize+8+vertexData.length);
  glb.write('glTF',0); glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);
  glb.writeUInt32LE(jsonSize,12);glb.writeUInt32LE(0x4e4f534a,16);
  glb.fill(0x20,20,20+jsonSize);jsonBytes.copy(glb,20);
  const offset=20+jsonSize;glb.writeUInt32LE(vertexData.length,offset);glb.writeUInt32LE(0x004e4942,offset+4);
  vertexData.copy(glb,offset+8);
  return glb;
}
