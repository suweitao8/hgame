import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyMagic } from '../src/magic.mjs';

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

test('identifies Windows PE executable from MZ header', () => {
  const r = identifyMagic(hex('4D 5A 90 00 03 00 00 00'), '.exe');
  assert.ok(r);
  assert.equal(r.id, 'pe');
  assert.equal(r.kind, 'executable');
  assert.match(r.label, /PE/i);
});

test('identifies ELF executable', () => {
  const r = identifyMagic(hex('7F 45 4C 46 02 01 01 00'), '.so');
  assert.equal(r.id, 'elf');
  assert.equal(r.kind, 'executable');
});

test('identifies little-endian Mach-O executable', () => {
  const r = identifyMagic(hex('CF FA ED FE 07 00 00 01'), '');
  assert.equal(r.id, 'macho');
  assert.equal(r.kind, 'executable');
});

test('identifies big-endian Mach-O executable', () => {
  const r = identifyMagic(hex('FE ED FA CE 00 00 00 0C'), '');
  assert.equal(r.id, 'macho');
});

test('treats CAFEBABE without .class extension as Mach-O universal binary', () => {
  const r = identifyMagic(hex('CA FE BA BE 00 00 00 01'), '');
  assert.equal(r.id, 'macho');
});

test('treats CAFEBABE with .class extension as Java class', () => {
  const r = identifyMagic(hex('CA FE BA BE 00 00 00 34'), '.class');
  assert.equal(r.id, 'java-class');
  assert.equal(r.kind, 'bytecode');
});

test('extension matching is case-insensitive', () => {
  const r = identifyMagic(hex('CA FE BA BE 00 00 00 34'), '.CLASS');
  assert.equal(r.id, 'java-class');
});

test('identifies ZIP archive', () => {
  const r = identifyMagic(hex('50 4B 03 04 14 00 00 00'), '.zip');
  assert.equal(r.id, 'zip');
  assert.equal(r.kind, 'archive');
});

test('identifies empty ZIP archive (EOCD only)', () => {
  const r = identifyMagic(hex('50 4B 05 06 00 00 00 00'), '.zip');
  assert.equal(r.id, 'zip');
});

test('identifies spanned ZIP archive marker', () => {
  const r = identifyMagic(hex('50 4B 07 08 00 00 00 00'), '.zip');
  assert.equal(r.id, 'zip');
});

test('identifies Adobe Flash SWF movie', () => {
  const uncompressed = identifyMagic(hex('46 57 53 0C 78 00 00 00'), '.swf');
  assert.equal(uncompressed.id, 'swf');
  const compressed = identifyMagic(hex('43 57 53 09 78 00 00 00'), '.swf');
  assert.equal(compressed.id, 'swf');
  const lzma = identifyMagic(hex('5A 57 53 0D 78 00 00 00'), '.swf');
  assert.equal(lzma.id, 'swf');
});

test('identifies WebAssembly module', () => {
  const r = identifyMagic(hex('00 61 73 6D 01 00 00 00'), '.wasm');
  assert.equal(r.id, 'wasm');
  assert.equal(r.kind, 'bytecode');
});

test('identifies Godot engine PCK container', () => {
  const r = identifyMagic(hex('47 44 50 43 01 00 00 00'), '.pck');
  assert.equal(r.id, 'godot-pck');
  assert.equal(r.kind, 'container');
});

test('identifies SQLite database', () => {
  const r = identifyMagic(hex('53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00'), '.db');
  assert.equal(r.id, 'sqlite');
  assert.equal(r.kind, 'database');
});

test('identifies UnityFS asset bundle container', () => {
  const r = identifyMagic(Buffer.from('UnityFS\0\0\0\0\0\0\0\0', 'binary'), '');
  assert.equal(r.id, 'unityfs');
  assert.equal(r.kind, 'container');
});

test('identifies Valve VPK container', () => {
  const r = identifyMagic(hex('34 12 AA 55'), '.vpk');
  assert.equal(r.id, 'vpk');
  assert.equal(r.kind, 'container');
});

test('returns null for unknown signature', () => {
  assert.equal(identifyMagic(hex('DE AD BE EF 00 00 00 00'), '.bin'), null);
});

test('returns null for empty or missing header bytes', () => {
  assert.equal(identifyMagic(Buffer.alloc(0), '.exe'), null);
  assert.equal(identifyMagic(null, '.exe'), null);
  assert.equal(identifyMagic(undefined, '.exe'), null);
});

test('returns null when buffer is too short to confirm a signature', () => {
  assert.equal(identifyMagic(hex('50 4B'), '.zip'), null);
  assert.equal(identifyMagic(hex('53 51 4C 69'), '.db'), null);
});

test("identifies RPG Maker RGSS archives by magic with version detail", () => {
  for (const version of [0x01, 0x02, 0x03]) {
    const result = identifyMagic(Buffer.concat([Buffer.from("RGSSAD\x00", "latin1"), Buffer.from([version])]), "dat");
    assert.equal(result.id, "rgss-archive");
    assert.equal(result.kind, "archive");
  }
});

test("identifies Ren'Py RPA archives by magic without relying on extension", () => {
  const result = identifyMagic(Buffer.from("RPA-3.0 00000000abc123", "latin1"), "bin");
  assert.equal(result.id, "rpa");
  assert.equal(result.kind, "archive");
});

test("identifies Unreal Pak containers by magic without relying on extension", () => {
  const result = identifyMagic(hex("E1 12 6F 5A 05 00"), "bin");
  assert.equal(result.id, "unreal-pak");
  assert.equal(result.kind, "archive");
});
