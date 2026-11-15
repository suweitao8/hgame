// magic.mjs — bounded magic-byte identification for the Game Reverse Scanner.
//
// identifyMagic(buffer, extension) inspects only the header bytes already read
// from a file (never the whole file) and returns { id, label, kind } or null.
// Signatures are matched in specificity order; CAFEBABE is disambiguated by
// the `.class` extension (Java class files vs Mach-O universal binaries).

const startsWith = (buffer, bytes, offset = 0) => {
  if (!buffer || buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
};

const ascii = (text) => {
  const bytes = new Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

const SIGNATURES = [
  {
    id: 'sqlite',
    label: 'SQLite 3 database',
    kind: 'database',
    bytes: ascii('SQLite format 3\0'),
  },
  {
    id: 'unityfs',
    label: 'Unity asset bundle (UnityFS)',
    kind: 'container',
    bytes: ascii('UnityFS'),
  },
  {
    id: 'godot-pck',
    label: 'Godot engine pack (PCK)',
    kind: 'container',
    bytes: ascii('GDPC'),
  },
  {
    id: 'zip',
    label: 'ZIP-family archive',
    kind: 'archive',
    match: (buffer) =>
      startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWith(buffer, [0x50, 0x4b, 0x07, 0x08]),
  },
  {
    id: 'vpk',
    label: 'Valve Pak (VPK)',
    kind: 'container',
    bytes: [0x34, 0x12, 0xaa, 0x55],
  },
  {
    id: 'unreal-pak',
    label: 'Unreal Pak container',
    kind: 'archive',
    bytes: [0xe1, 0x12, 0x6f, 0x5a],
  },
  {
    id: 'rgss-archive',
    label: 'RPG Maker RGSS archive',
    kind: 'archive',
    bytes: ascii('RGSSAD\x00'),
  },
  {
    id: 'rpa',
    label: 'Ren’Py RPA archive',
    kind: 'archive',
    bytes: ascii('RPA-'),
  },
  {
    id: 'wasm',
    label: 'WebAssembly module',
    kind: 'bytecode',
    bytes: [0x00, 0x61, 0x73, 0x6d],
  },
  {
    id: 'elf',
    label: 'ELF executable',
    kind: 'executable',
    bytes: [0x7f, 0x45, 0x4c, 0x46],
  },
  {
    id: 'macho',
    label: 'Mach-O executable',
    kind: 'executable',
    match: (buffer) =>
      startsWith(buffer, [0xce, 0xfa, 0xed, 0xfe]) ||
      startsWith(buffer, [0xcf, 0xfa, 0xed, 0xfe]) ||
      startsWith(buffer, [0xfe, 0xed, 0xfa, 0xce]) ||
      startsWith(buffer, [0xfe, 0xed, 0xfa, 0xcf]),
  },
  {
    id: 'java-class',
    label: 'Java class file',
    kind: 'bytecode',
    match: (buffer, ext) => ext === '.class' && startsWith(buffer, [0xca, 0xfe, 0xba, 0xbe]),
  },
  {
    id: 'macho',
    label: 'Mach-O universal binary (fat)',
    kind: 'executable',
    bytes: [0xca, 0xfe, 0xba, 0xbe],
  },
  {
    id: 'swf',
    label: 'Adobe Flash movie (SWF)',
    kind: 'asset',
    match: (buffer) =>
      startsWith(buffer, ascii('FWS')) ||
      startsWith(buffer, ascii('CWS')) ||
      startsWith(buffer, ascii('ZWS')),
  },
  {
    id: 'pe',
    label: 'Windows PE executable',
    kind: 'executable',
    bytes: ascii('MZ'),
  },
];

export function identifyMagic(buffer, extension = '') {
  if (!buffer || buffer.length === 0) return null;
  const ext = typeof extension === 'string' ? extension.toLowerCase() : '';
  for (const sig of SIGNATURES) {
    const hit = sig.match ? sig.match(buffer, ext) : startsWith(buffer, sig.bytes);
    if (hit) return { id: sig.id, label: sig.label, kind: sig.kind };
  }
  return null;
}
