#!/usr/bin/env node
/**
 * Unity BatchMode ground-truth exporter for Piloto Studio VFX assets.
 * Runs against an isolated temporary Unity project (never opening a locked user workspace)
 * to produce:
 *   1. Authoritative glTF 2.0 `.glb` meshes directly from `UnityEngine.Mesh` (LHS->RHS + glTF UVs),
 *      eliminating `.fbx`/`.obj`/`.asset`/Blender orientation discrepancies.
 *   2. `unity_calibration.json`: empirical ground-truth probes for `scalingMode`, `RenderAlignment`,
 *      and `startRotation3D` using `ParticleSystemRenderer.BakeMesh`.
 *   3. `unity-vfx-oracle.json`: per-prefab, per-ParticleSystem world-space ground-truth bounds,
 *      centers, spans, and velocities for automated parity verification across all prefabs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'webasset/assets/vfx');
const DEFAULT_WORK_DIR = path.join(os.tmpdir(), 'hgame-unity-vfx-oracle');

export function resolveUnityVfxConfig() {
  let cfg = {};
  const localCfgPath = path.join(REPO_ROOT, '.hgame.local.json');
  if (fs.existsSync(localCfgPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(localCfgPath, 'utf8'));
    } catch {
      cfg = {};
    }
  }
  const unityExe = process.env.HGAME_UNITY_EXE || cfg.unityVfx?.unityExe || '';
  const pilotoRoot = process.env.HGAME_PILOTO_ROOT || cfg.unityVfx?.pilotoRoot || '';
  return { unityExe, pilotoRoot };
}

function normKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function readUnityVersionFromExe(unityExe) {
  const pkgVerTxt = path.join(path.dirname(unityExe), 'Data', 'Resources', 'packageVersion.txt');
  const m = fs.existsSync(pkgVerTxt) ? fs.readFileSync(pkgVerTxt, 'utf8').match(/\d+\.\d+\.\d+[a-z0-9]*/) : null;
  if (m) return m[0];
  const exeParent = path.basename(path.dirname(path.dirname(unityExe)));
  if (/^\d+\.\d+\.\d+/.test(exeParent)) return exeParent;
  return '6000.6.9f1';
}

function copyFilteredUnityTree(srcDir, dstDir) {
  const ALLOWED_EXT = new Set(['.fbx', '.obj', '.asset', '.prefab', '.meta']);
  let copied = 0;
  function walk(sDir, dDir) {
    fs.mkdirSync(dDir, { recursive: true });
    for (const ent of fs.readdirSync(sDir, { withFileTypes: true })) {
      const sp = path.join(sDir, ent.name);
      const dp = path.join(dDir, ent.name);
      if (ent.isDirectory()) {
        walk(sp, dp);
      } else {
        const ext = path.extname(ent.name).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) continue;
        // Skip .png.meta / .tga.meta / .shadergraph.meta / .mat.meta etc. when source asset isn't copied
        if (ext === '.meta') {
          const baseExt = path.extname(ent.name.slice(0, -5)).toLowerCase();
          if (baseExt && !ALLOWED_EXT.has(baseExt)) continue;
        }
        const needCopy = !fs.existsSync(dp) || fs.statSync(sp).size !== fs.statSync(dp).size || fs.statSync(sp).mtimeMs > fs.statSync(dp).mtimeMs + 1000;
        if (needCopy) {
          fs.copyFileSync(sp, dp);
        }
        copied++;
      }
    }
  }
  walk(srcDir, dstDir);
  return copied;
}

function buildEditorCSharpSource() {
  return `using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

public static class HGameVfxOracleExporter
{
    private static readonly Encoding UTF8NoBom = new UTF8Encoding(false);

    [Serializable]
    private class ConfigPayload
    {
        public string meshOutDir;
        public string meshIndexPath;
        public string meshManifestPath;
        public string calibrationOutPath;
        public string oracleOutPath;
        public string assetRootUnityPath;
        public string bundleRootUnityPath;
        public int exportMeshes = 1;
        public int runCalibration = 1;
        public int runOracle = 1;
    }

    private static string NormKey(string str)
    {
        if (string.IsNullOrEmpty(str)) return "";
        var sb = new StringBuilder(str.Length);
        bool prevUnder = true;
        foreach (char c in str.ToLowerInvariant())
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
            {
                sb.Append(c);
                prevUnder = false;
            }
            else if (!prevUnder)
            {
                sb.Append('_');
                prevUnder = true;
            }
        }
        string res = sb.ToString().Trim('_');
        return res;
    }

    private static string Fmt(float v)
    {
        if (float.IsNaN(v) || float.IsInfinity(v)) return "0";
        return v.ToString("R", CultureInfo.InvariantCulture);
    }

    private static string JsonStr(string s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder(s.Length + 4);
        sb.Append('"');
        foreach (char c in s)
        {
            if (c == '\\\\') sb.Append("\\\\\\\\");
            else if (c == '"') sb.Append("\\\\\\"");
            else if (c == '\\n') sb.Append("\\\\n");
            else if (c == '\\r') sb.Append("\\\\r");
            else if (c == '\\t') sb.Append("\\\\t");
            else sb.Append(c);
        }
        sb.Append('"');
        return sb.ToString();
    }

    private static string JsonVec3(Vector3 v)
    {
        return "[" + Fmt(v.x) + "," + Fmt(v.y) + "," + Fmt(v.z) + "]";
    }

    private static string JsonVec3Rhs(Vector3 v)
    {
        return "[" + Fmt(v.x) + "," + Fmt(v.y) + "," + Fmt(-v.z) + "]";
    }

    public static void RunBatchExport()
    {
        string cfgPath = Environment.GetEnvironmentVariable("HGAME_UNITY_ORACLE_CFG");
        if (string.IsNullOrEmpty(cfgPath) || !File.Exists(cfgPath))
        {
            Debug.LogError("HGAME_UNITY_ORACLE_CFG missing or not found: " + cfgPath);
            EditorApplication.Exit(2);
            return;
        }
        var cfg = JsonUtility.FromJson<ConfigPayload>(File.ReadAllText(cfgPath, Encoding.UTF8));
        try
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            if (cfg.runCalibration != 0)
            {
                WriteCalibrationProbe(cfg.calibrationOutPath);
            }
            if (cfg.exportMeshes != 0)
            {
                ExportAllMeshesToGlb(cfg.meshOutDir, cfg.meshIndexPath, cfg.meshManifestPath, cfg.assetRootUnityPath);
            }
            if (cfg.runOracle != 0)
            {
                ExportPrefabOracle(cfg.bundleRootUnityPath, cfg.oracleOutPath);
            }
            Debug.Log("HGAME_ORACLE_COMPLETE");
        }
        catch (Exception ex)
        {
            Debug.LogException(ex);
            EditorApplication.Exit(3);
            return;
        }
        EditorApplication.Exit(0);
    }

    private static Mesh CreateLPrismMesh()
    {
        var m = new Mesh { name = "LPrismProbe" };
        // Asymmetric probe vertices along +X (1), +Y (2), +Z (3) in Unity LHS
        m.vertices = new[]
        {
            new Vector3(0f, 0f, 0f),
            new Vector3(1f, 0f, 0f),
            new Vector3(0f, 2f, 0f),
            new Vector3(0f, 0f, 3f),
        };
        m.triangles = new[] { 0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2 };
        m.RecalculateNormals();
        return m;
    }

    private static void WriteCalibrationProbe(string outPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(outPath));
        var camGo = new GameObject("OracleProbeCam");
        var cam = camGo.AddComponent<Camera>();
        cam.transform.position = new Vector3(0f, 6f, -10f);
        cam.transform.LookAt(Vector3.zero);
        var mat = new Material(Shader.Find("Particles/Standard Unlit") ?? Shader.Find("Sprites/Default"));
        var probeMesh = CreateLPrismMesh();

        var sb = new StringBuilder();
        sb.AppendLine("{");
        sb.AppendLine("  \\"cameraPosLhs\\": " + JsonVec3(cam.transform.position) + ",");
        sb.AppendLine("  \\"cameraQuatLhs\\": [" + Fmt(cam.transform.rotation.x) + "," + Fmt(cam.transform.rotation.y) + "," + Fmt(cam.transform.rotation.z) + "," + Fmt(cam.transform.rotation.w) + "],");
        sb.AppendLine("  \\"probes\\": [");

        var entries = new List<string>();

        void RunCase(string label, ParticleSystemRenderMode rMode, ParticleSystemRenderSpace align, ParticleSystemScalingMode sclMode, ParticleSystemSimulationSpace simSpace, Vector3 parentPos, Vector3 parentEuler, Vector3 parentScl, Vector3 childPos, Vector3 childEuler, Vector3 childScl, bool rot3d, Vector3 rotDeg, float velX = 0f, float velY = 0f, float velZ = 0f, bool withBoxShape = false)
        {
            var rootGo = new GameObject("ProbeRoot");
            rootGo.transform.position = parentPos;
            rootGo.transform.eulerAngles = parentEuler;
            rootGo.transform.localScale = parentScl;

            var childGo = new GameObject("ProbePS");
            childGo.transform.SetParent(rootGo.transform, false);
            childGo.transform.localPosition = childPos;
            childGo.transform.localEulerAngles = childEuler;
            childGo.transform.localScale = childScl;

            var ps = childGo.AddComponent<ParticleSystem>();
            var psr = childGo.GetComponent<ParticleSystemRenderer>();
            psr.sharedMaterial = mat;
            psr.renderMode = rMode;
            psr.alignment = align;
            if (rMode == ParticleSystemRenderMode.Mesh) psr.mesh = probeMesh;

            var main = ps.main;
            main.playOnAwake = false;
            main.loop = false;
            main.duration = 1f;
            main.startLifetime = 2f;
            main.startSpeed = 0f;
            main.startSize = 1f;
            main.simulationSpace = simSpace;
            main.scalingMode = sclMode;
            if (rot3d)
            {
                main.startRotation3D = true;
                main.startRotationX = rotDeg.x * Mathf.Deg2Rad;
                main.startRotationY = rotDeg.y * Mathf.Deg2Rad;
                main.startRotationZ = rotDeg.z * Mathf.Deg2Rad;
            }
            else
            {
                main.startRotation3D = false;
                main.startRotation = rotDeg.z * Mathf.Deg2Rad;
            }

            var em = ps.emission;
            em.enabled = true;
            em.rateOverTime = 0f;
            em.SetBursts(new[] { new ParticleSystem.Burst(0f, 1) });

            var sh = ps.shape;
            if (withBoxShape)
            {
                sh.enabled = true;
                sh.shapeType = ParticleSystemShapeType.Box;
                sh.scale = new Vector3(0.6f, 10f, 1f);
                sh.rotation = new Vector3(90f, 0f, 0f);
                sh.position = Vector3.zero;
            }
            else
            {
                sh.enabled = false;
            }

            if (Mathf.Abs(velX) > 1e-4f || Mathf.Abs(velY) > 1e-4f || Mathf.Abs(velZ) > 1e-4f)
            {
                var vel = ps.velocityOverLifetime;
                vel.enabled = true;
                vel.space = ParticleSystemSimulationSpace.Local;
                vel.x = velX;
                vel.y = velY;
                vel.z = velZ;
            }

            ps.useAutoRandomSeed = false;
            ps.randomSeed = 1337;
            ps.Simulate(0.05f, true, true);

            var particles = new ParticleSystem.Particle[16];
            int count = ps.GetParticles(particles);
            var baked = new Mesh();
            psr.BakeMesh(baked, cam, ParticleSystemBakeMeshOptions.BakeRotationAndScale);
            var verts = baked.vertices;
            var cs = new StringBuilder();
            cs.Append("    { \\"label\\": " + JsonStr(label));
            cs.Append(", \\"count\\": " + count);
            if (count > 0)
            {
                cs.Append(", \\"pPosRaw\\": " + JsonVec3(particles[0].position));
                cs.Append(", \\"pSize3D\\": " + JsonVec3(particles[0].GetCurrentSize3D(ps)));
                cs.Append(", \\"pRot3D\\": " + JsonVec3(particles[0].rotation3D));
                cs.Append(", \\"pVel\\": " + JsonVec3(particles[0].velocity));
            }
            cs.Append(", \\"bakedVertsRhs\\": [");
            for (int vi = 0; vi < Math.Min(4, verts.Length); vi++)
            {
                if (vi > 0) cs.Append(",");
                cs.Append(JsonVec3Rhs(verts[vi]));
            }
            cs.Append("] }");
            entries.Add(cs.ToString());

            UnityEngine.Object.DestroyImmediate(baked);
            UnityEngine.Object.DestroyImmediate(rootGo);
        }

        // Probe mesh alignment modes with parent+child rotation
        foreach (ParticleSystemRenderSpace al in new[] {
            ParticleSystemRenderSpace.View,
            ParticleSystemRenderSpace.World,
            ParticleSystemRenderSpace.Local,
            ParticleSystemRenderSpace.Facing,
        })
        {
            RunCase("mesh_align_" + al + "_rot0", ParticleSystemRenderMode.Mesh, al, ParticleSystemScalingMode.Hierarchy, ParticleSystemSimulationSpace.Local,
                Vector3.zero, new Vector3(20f, 35f, 50f), Vector3.one, Vector3.zero, Vector3.zero, Vector3.one, false, Vector3.zero);
            RunCase("mesh_align_" + al + "_rot3d", ParticleSystemRenderMode.Mesh, al, ParticleSystemScalingMode.Hierarchy, ParticleSystemSimulationSpace.Local,
                Vector3.zero, new Vector3(20f, 35f, 50f), Vector3.one, Vector3.zero, Vector3.zero, Vector3.one, true, new Vector3(-30f, 45f, 60f));
        }

        RunCase("mesh_align_Velocity", ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.Velocity, ParticleSystemScalingMode.Hierarchy, ParticleSystemSimulationSpace.World,
            Vector3.zero, Vector3.zero, Vector3.one, Vector3.zero, Vector3.zero, Vector3.one, false, Vector3.zero, 1f, 2f, -1f);

        // Probe billboard alignment modes (quad vertex world positions!)
        RunCase("bill_align_Local_rot0", ParticleSystemRenderMode.Billboard, ParticleSystemRenderSpace.Local, ParticleSystemScalingMode.Hierarchy, ParticleSystemSimulationSpace.Local,
            Vector3.zero, new Vector3(20f, 35f, 50f), Vector3.one, Vector3.zero, Vector3.zero, Vector3.one, false, Vector3.zero);
        RunCase("bill_align_Local_rot3d", ParticleSystemRenderMode.Billboard, ParticleSystemRenderSpace.Local, ParticleSystemScalingMode.Hierarchy, ParticleSystemSimulationSpace.Local,
            Vector3.zero, new Vector3(20f, 35f, 50f), Vector3.one, Vector3.zero, Vector3.zero, Vector3.one, true, new Vector3(-30f, 45f, 60f));
        RunCase("bill_align_World_rot3d", ParticleSystemRenderMode.Billboard, ParticleSystemRenderSpace.World, ParticleSystemScalingMode.Hierarchy, ParticleSystemSimulationSpace.Local,
            Vector3.zero, new Vector3(20f, 35f, 50f), Vector3.one, Vector3.zero, Vector3.zero, Vector3.one, true, new Vector3(-30f, 45f, 60f));

        // Probe scaling modes with box shape + non-uniform parent/local scales
        foreach (ParticleSystemScalingMode sm in new[] { ParticleSystemScalingMode.Hierarchy, ParticleSystemScalingMode.Local, ParticleSystemScalingMode.Shape })
        {
            RunCase("scale_mesh_" + sm + "_simLocal", ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.Local, sm, ParticleSystemSimulationSpace.Local,
                Vector3.zero, Vector3.zero, new Vector3(2f, 3f, 4f), new Vector3(1f, 0.5f, -2f), Vector3.zero, new Vector3(0.5f, 0.7f, 0.9f), false, Vector3.zero);
            RunCase("scale_mesh_" + sm + "_simWorld", ParticleSystemRenderMode.Mesh, ParticleSystemRenderSpace.Local, sm, ParticleSystemSimulationSpace.World,
                Vector3.zero, Vector3.zero, new Vector3(2f, 3f, 4f), new Vector3(1f, 0.5f, -2f), Vector3.zero, new Vector3(0.5f, 0.7f, 0.9f), false, Vector3.zero);
        }

        sb.AppendLine(string.Join(",\\n", entries));
        sb.AppendLine("  ]");
        sb.AppendLine("}");
        File.WriteAllText(outPath, sb.ToString(), UTF8NoBom);

        UnityEngine.Object.DestroyImmediate(probeMesh);
        UnityEngine.Object.DestroyImmediate(mat);
        UnityEngine.Object.DestroyImmediate(camGo);
    }

    private static byte[] Pad4(byte[] raw)
    {
        int rem = raw.Length & 3;
        if (rem == 0) return raw;
        var res = new byte[raw.Length + (4 - rem)];
        Buffer.BlockCopy(raw, 0, res, 0, raw.Length);
        return res;
    }

    private struct ExportedMeshInfo
    {
        public string name;
        public Vector3 minRhs;
        public Vector3 maxRhs;
        public int vertexCount;
        public int triangleCount;
        public string guid;
        public long localId;
    }

    private static void WriteMultiMeshGlb(string dstPath, List<Mesh> meshes, List<ExportedMeshInfo> outInfos)
    {
        var binStream = new MemoryStream();
        var bufferViewsJson = new List<string>();
        var accessorsJson = new List<string>();
        var meshesJson = new List<string>();
        var nodesJson = new List<string>();
        var sceneNodes = new List<string>();

        int PushBuffer(byte[] bytes, int target)
        {
            int offset = (int)binStream.Position;
            byte[] padded = Pad4(bytes);
            binStream.Write(padded, 0, padded.Length);
            int bvIdx = bufferViewsJson.Count;
            string tStr = target > 0 ? (",\\"target\\":" + target) : "";
            bufferViewsJson.Add("{\\"buffer\\":0,\\"byteOffset\\":" + offset + ",\\"byteLength\\":" + bytes.Length + tStr + "}");
            return bvIdx;
        }

        for (int mi = 0; mi < meshes.Count; mi++)
        {
            Mesh src = meshes[mi];
            int vCount = src.vertexCount;
            if (vCount <= 0) continue;

            var srcVerts = src.vertices;
            var srcNorms = src.normals;
            if (srcNorms == null || srcNorms.Length != vCount)
            {
                var tmp = UnityEngine.Object.Instantiate(src);
                tmp.RecalculateNormals();
                srcNorms = tmp.normals;
                UnityEngine.Object.DestroyImmediate(tmp);
            }
            var srcUv0 = src.uv;
            var srcUv1 = src.uv2;

            var mergedTris = new List<int>();
            for (int sm = 0; sm < src.subMeshCount; sm++)
            {
                var smTris = src.GetTriangles(sm);
                for (int t = 0; t + 2 < smTris.Length; t += 3)
                {
                    mergedTris.Add(smTris[t]);
                    mergedTris.Add(smTris[t + 2]);
                    mergedTris.Add(smTris[t + 1]);
                }
            }
            if (mergedTris.Count == 0) continue;

            Vector3 minR = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            Vector3 maxR = new Vector3(float.MinValue, float.MinValue, float.MinValue);

            var posBytes = new byte[vCount * 12];
            var nrmBytes = new byte[vCount * 12];
            for (int i = 0; i < vCount; i++)
            {
                float px = srcVerts[i].x, py = srcVerts[i].y, pz = -srcVerts[i].z;
                if (px < minR.x) minR.x = px; if (px > maxR.x) maxR.x = px;
                if (py < minR.y) minR.y = py; if (py > maxR.y) maxR.y = py;
                if (pz < minR.z) minR.z = pz; if (pz > maxR.z) maxR.z = pz;
                Buffer.BlockCopy(BitConverter.GetBytes(px), 0, posBytes, i * 12, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(py), 0, posBytes, i * 12 + 4, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(pz), 0, posBytes, i * 12 + 8, 4);

                float nx = srcNorms[i].x, ny = srcNorms[i].y, nz = -srcNorms[i].z;
                Buffer.BlockCopy(BitConverter.GetBytes(nx), 0, nrmBytes, i * 12, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(ny), 0, nrmBytes, i * 12 + 4, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(nz), 0, nrmBytes, i * 12 + 8, 4);
            }
            int posBv = PushBuffer(posBytes, 34962);
            int posAcc = accessorsJson.Count;
            accessorsJson.Add("{\\"bufferView\\":" + posBv + ",\\"componentType\\":5126,\\"count\\":" + vCount + ",\\"type\\":\\"VEC3\\",\\"min\\":" + JsonVec3(minR) + ",\\"max\\":" + JsonVec3(maxR) + "}");

            int nrmBv = PushBuffer(nrmBytes, 34962);
            int nrmAcc = accessorsJson.Count;
            accessorsJson.Add("{\\"bufferView\\":" + nrmBv + ",\\"componentType\\":5126,\\"count\\":" + vCount + ",\\"type\\":\\"VEC3\\"}");

            var attrs = new List<string> { "\\"POSITION\\":" + posAcc, "\\"NORMAL\\":" + nrmAcc };

            if (srcUv0 != null && srcUv0.Length == vCount)
            {
                var uvBytes = new byte[vCount * 8];
                for (int i = 0; i < vCount; i++)
                {
                    Buffer.BlockCopy(BitConverter.GetBytes(srcUv0[i].x), 0, uvBytes, i * 8, 4);
                    Buffer.BlockCopy(BitConverter.GetBytes(1f - srcUv0[i].y), 0, uvBytes, i * 8 + 4, 4);
                }
                int uvBv = PushBuffer(uvBytes, 34962);
                int uvAcc = accessorsJson.Count;
                accessorsJson.Add("{\\"bufferView\\":" + uvBv + ",\\"componentType\\":5126,\\"count\\":" + vCount + ",\\"type\\":\\"VEC2\\"}");
                attrs.Add("\\"TEXCOORD_0\\":" + uvAcc);
            }
            if (srcUv1 != null && srcUv1.Length == vCount)
            {
                var uvBytes = new byte[vCount * 8];
                for (int i = 0; i < vCount; i++)
                {
                    Buffer.BlockCopy(BitConverter.GetBytes(srcUv1[i].x), 0, uvBytes, i * 8, 4);
                    Buffer.BlockCopy(BitConverter.GetBytes(1f - srcUv1[i].y), 0, uvBytes, i * 8 + 4, 4);
                }
                int uvBv = PushBuffer(uvBytes, 34962);
                int uvAcc = accessorsJson.Count;
                accessorsJson.Add("{\\"bufferView\\":" + uvBv + ",\\"componentType\\":5126,\\"count\\":" + vCount + ",\\"type\\":\\"VEC2\\"}");
                attrs.Add("\\"TEXCOORD_1\\":" + uvAcc);
            }

            bool use32 = vCount > 65535;
            byte[] idxBytes = new byte[mergedTris.Count * (use32 ? 4 : 2)];
            for (int i = 0; i < mergedTris.Count; i++)
            {
                if (use32) Buffer.BlockCopy(BitConverter.GetBytes((uint)mergedTris[i]), 0, idxBytes, i * 4, 4);
                else Buffer.BlockCopy(BitConverter.GetBytes((ushort)mergedTris[i]), 0, idxBytes, i * 2, 2);
            }
            int idxBv = PushBuffer(idxBytes, 34963);
            int idxAcc = accessorsJson.Count;
            accessorsJson.Add("{\\"bufferView\\":" + idxBv + ",\\"componentType\\":" + (use32 ? 5125 : 5123) + ",\\"count\\":" + mergedTris.Count + ",\\"type\\":\\"SCALAR\\"}");

            int meshIdx = meshesJson.Count;
            string mName = string.IsNullOrEmpty(src.name) ? ("Mesh_" + mi) : src.name;
            meshesJson.Add("{\\"name\\":" + JsonStr(mName) + ",\\"primitives\\":[{\\"attributes\\":{" + string.Join(",", attrs) + "},\\"indices\\":" + idxAcc + "}]}");
            int nodeIdx = nodesJson.Count;
            nodesJson.Add("{\\"name\\":" + JsonStr(mName) + ",\\"mesh\\":" + meshIdx + "}");
            sceneNodes.Add(nodeIdx.ToString(CultureInfo.InvariantCulture));

            AssetDatabase.TryGetGUIDAndLocalFileIdentifier(src, out string guid, out long localId);
            outInfos.Add(new ExportedMeshInfo
            {
                name = mName,
                minRhs = minR,
                maxRhs = maxR,
                vertexCount = vCount,
                triangleCount = mergedTris.Count / 3,
                guid = guid ?? "",
                localId = localId,
            });
        }

        if (meshesJson.Count == 0) return;

        byte[] binData = binStream.ToArray();
        string jsonStr = "{" +
            "\\"asset\\":{\\"version\\":\\"2.0\\",\\"generator\\":\\"HGame-UnityOracleExporter\\"}," +
            "\\"scene\\":0," +
            "\\"scenes\\":[{\\"nodes\\":[" + string.Join(",", sceneNodes) + "]}]," +
            "\\"nodes\\":[" + string.Join(",", nodesJson) + "]," +
            "\\"meshes\\":[" + string.Join(",", meshesJson) + "]," +
            "\\"buffers\\":[{\\"byteLength\\":" + binData.Length + "}]," +
            "\\"bufferViews\\":[" + string.Join(",", bufferViewsJson) + "]," +
            "\\"accessors\\":[" + string.Join(",", accessorsJson) + "]" +
            "}";
        byte[] jsonBytes = Encoding.UTF8.GetBytes(jsonStr);
        int jPad = (4 - (jsonBytes.Length & 3)) & 3;
        byte[] jsonPadded = new byte[jsonBytes.Length + jPad];
        Buffer.BlockCopy(jsonBytes, 0, jsonPadded, 0, jsonBytes.Length);
        for (int i = 0; i < jPad; i++) jsonPadded[jsonBytes.Length + i] = 0x20;

        int totalLen = 12 + 8 + jsonPadded.Length + 8 + binData.Length;
        using (var fs = new FileStream(dstPath, FileMode.Create, FileAccess.Write))
        using (var bw = new BinaryWriter(fs))
        {
            bw.Write((uint)0x46546C67);
            bw.Write((uint)2);
            bw.Write((uint)totalLen);
            bw.Write((uint)jsonPadded.Length);
            bw.Write((uint)0x4E4F534A);
            bw.Write(jsonPadded);
            bw.Write((uint)binData.Length);
            bw.Write((uint)0x004E4942);
            bw.Write(binData);
        }
    }

    private static void ExportAllMeshesToGlb(string meshOutDir, string meshIndexPath, string meshManifestPath, string assetRootUnityPath)
    {
        Directory.CreateDirectory(meshOutDir);
        string rootPrefix = string.IsNullOrEmpty(assetRootUnityPath) ? "Assets/Piloto Studio/" : assetRootUnityPath;
        if (!rootPrefix.EndsWith("/")) rootPrefix += "/";
        string[] allPaths = AssetDatabase.GetAllAssetPaths();
        var modelPaths = new List<string>();
        foreach (string p in allPaths)
        {
            if (!p.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)) continue;
            string ext = Path.GetExtension(p).ToLowerInvariant();
            if (ext == ".fbx" || ext == ".obj" || ext == ".asset") modelPaths.Add(p);
        }
        modelPaths.Sort(StringComparer.OrdinalIgnoreCase);

        var indexEntries = new List<string>();
        var manifestEntries = new List<string>();
        var exportedKeys = new HashSet<string>();

        foreach (string assetPath in modelPaths)
        {
            var objs = AssetDatabase.LoadAllAssetsAtPath(assetPath);
            var meshes = new List<Mesh>();
            foreach (var o in objs)
            {
                if (o is Mesh m && !m.name.StartsWith("__preview", StringComparison.OrdinalIgnoreCase))
                {
                    meshes.Add(m);
                }
            }
            if (meshes.Count == 0) continue;

            string meshKey = NormKey(Path.GetFileNameWithoutExtension(assetPath));
            if (string.IsNullOrEmpty(meshKey) || exportedKeys.Contains(meshKey)) continue;

            string glbFileName = meshKey + ".glb";
            string dstPath = Path.Combine(meshOutDir, glbFileName);
            var infos = new List<ExportedMeshInfo>();
            WriteMultiMeshGlb(dstPath, meshes, infos);
            if (infos.Count == 0) continue;

            exportedKeys.Add(meshKey);
            var subNames = new List<string>();
            foreach (var info in infos)
            {
                subNames.Add(JsonStr(info.name));
                if (!string.IsNullOrEmpty(info.guid))
                {
                    manifestEntries.Add(
                        "  " + JsonStr(info.guid + ":" + info.localId) + ": { " +
                        "\\"meshKey\\": " + JsonStr(meshKey) +
                        ", \\"subMeshName\\": " + JsonStr(info.name) +
                        ", \\"multi\\": " + (infos.Count > 1 ? "true" : "false") +
                        ", \\"vertexCount\\": " + info.vertexCount +
                        ", \\"triangleCount\\": " + info.triangleCount +
                        ", \\"boundsMinRhs\\": " + JsonVec3(info.minRhs) +
                        ", \\"boundsMaxRhs\\": " + JsonVec3(info.maxRhs) +
                        " }"
                    );
                }
            }
            indexEntries.Add("  " + JsonStr(meshKey) + ": { \\"file\\": " + JsonStr("meshes/" + glbFileName) + ", \\"subMeshes\\": [" + string.Join(", ", subNames) + "] }");
        }

        File.WriteAllText(meshIndexPath, "{\\n" + string.Join(",\\n", indexEntries) + "\\n}\\n", UTF8NoBom);
        Directory.CreateDirectory(Path.GetDirectoryName(meshManifestPath));
        File.WriteAllText(meshManifestPath, "{\\n" + string.Join(",\\n", manifestEntries) + "\\n}\\n", UTF8NoBom);
        Debug.Log("HGAME_MESHES_EXPORTED count=" + exportedKeys.Count);
    }

    private static string GetRelPath(Transform root, Transform node)
    {
        if (node == root) return "";
        var parts = new List<string>();
        var cur = node;
        while (cur != null && cur != root)
        {
            parts.Add(cur.name);
            cur = cur.parent;
        }
        parts.Reverse();
        return string.Join("/", parts);
    }

    private static float EstimateFirstBurstTime(ParticleSystem ps)
    {
        var em = ps.emission;
        if (!em.enabled) return 0f;
        var rate = em.rateOverTime;
        bool hasRate = rate.constantMax > 0.001f || (rate.mode == ParticleSystemCurveMode.Curve && rate.curveMultiplier > 0.001f);
        if (hasRate) return 0f;
        if (em.burstCount > 0)
        {
            float minT = float.MaxValue;
            for (int i = 0; i < em.burstCount; i++)
            {
                var b = em.GetBurst(i);
                if (b.time < minT) minT = b.time;
            }
            if (minT < float.MaxValue) return minT;
        }
        return 0f;
    }

    private static void ExportPrefabOracle(string bundleRootUnityPath, string oracleOutPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(oracleOutPath));
        string[] guids = AssetDatabase.FindAssets("t:Prefab", new[] { bundleRootUnityPath });
        var prefabPaths = new List<string>(guids.Length);
        foreach (string g in guids) prefabPaths.Add(AssetDatabase.GUIDToAssetPath(g));
        prefabPaths.Sort(StringComparer.OrdinalIgnoreCase);

        var camGo = new GameObject("OracleSimCam");
        var cam = camGo.AddComponent<Camera>();
        cam.transform.position = new Vector3(0f, 6f, -10f);
        cam.transform.LookAt(Vector3.zero);
        var fallbackMat = new Material(Shader.Find("Particles/Standard Unlit") ?? Shader.Find("Sprites/Default"));

        var prefabJsonEntries = new List<string>();
        var particleBuf = new ParticleSystem.Particle[2048];
        var bakedMesh = new Mesh();

        foreach (string pfPath in prefabPaths)
        {
            var asset = AssetDatabase.LoadAssetAtPath<GameObject>(pfPath);
            if (asset == null) continue;
            var inst = UnityEngine.Object.Instantiate(asset, Vector3.zero, Quaternion.identity);
            try
            {
                var allPs = inst.GetComponentsInChildren<ParticleSystem>(false);
                if (allPs == null || allPs.Length == 0) continue;

                var subSet = new HashSet<ParticleSystem>();
                foreach (var ps in allPs)
                {
                    var sub = ps.subEmitters;
                    if (!sub.enabled) continue;
                    for (int si = 0; si < sub.subEmittersCount; si++)
                    {
                        var childPs = sub.GetSubEmitterSystem(si);
                        if (childPs != null) subSet.Add(childPs);
                    }
                }

                var layerEntries = new List<string>();
                for (int li = 0; li < allPs.Length; li++)
                {
                    var ps = allPs[li];
                    if (subSet.Contains(ps)) continue;
                    var psr = ps.GetComponent<ParticleSystemRenderer>();
                    if (psr == null) continue;

                    if (psr.sharedMaterial == null) psr.sharedMaterial = fallbackMat;
                    ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
                    ps.useAutoRandomSeed = false;
                    ps.randomSeed = 1337;

                    var main = ps.main;
                    float delay = main.startDelay.constantMax;
                    float burstT = EstimateFirstBurstTime(ps);
                    float lifeMin = Math.Max(0.05f, main.startLifetime.constantMax);
                    float simT = delay + burstT + Math.Min(0.12f, lifeMin * 0.35f);
                    simT = Math.Max(0.05f, simT);

                    // Step sequentially if simT is past delay so bursts trigger accurately
                    if (simT > 0.2f)
                    {
                        float preT = Math.Max(0f, delay + burstT - 0.01f);
                        if (preT > 0f) ps.Simulate(preT, false, true);
                        ps.Simulate(simT - preT, false, false);
                    }
                    else
                    {
                        ps.Simulate(simT, false, true);
                    }

                    int pCount = ps.GetParticles(particleBuf);
                    Vector3 posMinR = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
                    Vector3 posMaxR = new Vector3(float.MinValue, float.MinValue, float.MinValue);
                    Vector3 posSumR = Vector3.zero;
                    Vector3 velSumR = Vector3.zero;

                    bool isLocal = main.simulationSpace == ParticleSystemSimulationSpace.Local;
                    bool isCustom = main.simulationSpace == ParticleSystemSimulationSpace.Custom && main.customSimulationSpace != null;
                    Transform simTr = isLocal ? ps.transform : (isCustom ? main.customSimulationSpace : null);
                    Vector3 tPos = simTr != null ? simTr.position : Vector3.zero;
                    Quaternion tRot = simTr != null ? simTr.rotation : Quaternion.identity;
                    Vector3 tScl = (simTr != null && main.scalingMode != ParticleSystemScalingMode.Shape) ? simTr.lossyScale : Vector3.one;

                    for (int pi = 0; pi < pCount; pi++)
                    {
                        Vector3 lp = particleBuf[pi].position;
                        Vector3 lv = particleBuf[pi].totalVelocity;
                        Vector3 wp = simTr != null ? (tPos + tRot * Vector3.Scale(lp, tScl)) : lp;
                        Vector3 wv = simTr != null ? (tRot * lv) : lv;
                        Vector3 wpR = new Vector3(wp.x, wp.y, -wp.z);
                        Vector3 wvR = new Vector3(wv.x, wv.y, -wv.z);
                        posMinR = Vector3.Min(posMinR, wpR);
                        posMaxR = Vector3.Max(posMaxR, wpR);
                        posSumR += wpR;
                        velSumR += wvR;
                    }

                    bakedMesh.Clear();
                    int bakedVertCount = 0;
                    Vector3 bakedMinR = Vector3.zero;
                    Vector3 bakedMaxR = Vector3.zero;
                    bool isMeshMode = psr.renderMode == ParticleSystemRenderMode.Mesh;
                    bool hasValidMesh = true;
                    if (isMeshMode)
                    {
                        hasValidMesh = psr.mesh != null && psr.mesh.vertexCount > 0;
                        if (!hasValidMesh && psr.meshCount > 0)
                        {
                            var ms = new Mesh[psr.meshCount];
                            int got = psr.GetMeshes(ms);
                            for (int mi = 0; mi < got; mi++)
                            {
                                if (ms[mi] != null && ms[mi].vertexCount > 0) { hasValidMesh = true; break; }
                            }
                        }
                    }
                    // BakeMesh in -nographics NullGfxDevice is safe on Mesh renderers with valid mesh(es) and on standard quads when enabled
                    if (pCount > 0 && psr.enabled && psr.renderMode != ParticleSystemRenderMode.None && hasValidMesh
                        && (isMeshMode || psr.renderMode == ParticleSystemRenderMode.Billboard || psr.renderMode == ParticleSystemRenderMode.HorizontalBillboard || psr.renderMode == ParticleSystemRenderMode.VerticalBillboard))
                    {
                        try
                        {
                            psr.BakeMesh(bakedMesh, cam, ParticleSystemBakeMeshOptions.BakeRotationAndScale);
                            var bv = bakedMesh.vertices;
                            bakedVertCount = bv != null ? bv.Length : 0;
                            if (bakedVertCount > 0)
                            {
                                bakedMinR = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
                                bakedMaxR = new Vector3(float.MinValue, float.MinValue, float.MinValue);
                                for (int vi = 0; vi < bakedVertCount; vi++)
                                {
                                    Vector3 vr = new Vector3(bv[vi].x, bv[vi].y, -bv[vi].z);
                                    bakedMinR = Vector3.Min(bakedMinR, vr);
                                    bakedMaxR = Vector3.Max(bakedMaxR, vr);
                                }
                            }
                        }
                        catch
                        {
                            bakedVertCount = 0;
                        }
                    }

                    Vector3 size3dSum = Vector3.zero;
                    for (int pi = 0; pi < pCount; pi++)
                    {
                        size3dSum += particleBuf[pi].GetCurrentSize3D(ps);
                    }
                    Vector3 posCenterR = pCount > 0 ? (posSumR / pCount) : Vector3.zero;
                    Vector3 posSpanR = pCount > 0 ? (posMaxR - posMinR) : Vector3.zero;
                    Vector3 velMeanR = pCount > 0 ? (velSumR / pCount) : Vector3.zero;
                    Vector3 size3dMean = pCount > 0 ? (size3dSum / pCount) : Vector3.zero;
                    Vector3 bakedCenterR = bakedVertCount > 0 ? ((bakedMinR + bakedMaxR) * 0.5f) : Vector3.zero;
                    Vector3 bakedSpanR = bakedVertCount > 0 ? (bakedMaxR - bakedMinR) : Vector3.zero;

                    var lsb = new StringBuilder();
                    lsb.Append("{");
                    lsb.Append("\\"name\\":" + JsonStr(ps.gameObject.name));
                    lsb.Append(",\\"path\\":" + JsonStr(GetRelPath(inst.transform, ps.transform)));
                    lsb.Append(",\\"simT\\":" + Fmt(simT));
                    lsb.Append(",\\"scalingMode\\":" + (int)main.scalingMode);
                    lsb.Append(",\\"simSpace\\":" + (int)main.simulationSpace);
                    lsb.Append(",\\"renderMode\\":" + (int)psr.renderMode);
                    lsb.Append(",\\"alignment\\":" + (int)psr.alignment);
                    lsb.Append(",\\"shapeType\\":" + (ps.shape.enabled ? (int)ps.shape.shapeType : -1));
                    lsb.Append(",\\"pCount\\":" + pCount);
                    lsb.Append(",\\"posCenterRhs\\":" + JsonVec3(posCenterR));
                    lsb.Append(",\\"posSpanRhs\\":" + JsonVec3(posSpanR));
                    lsb.Append(",\\"size3dMean\\":" + JsonVec3(size3dMean));
                    lsb.Append(",\\"velMeanRhs\\":" + JsonVec3(velMeanR));
                    lsb.Append(",\\"bakedVerts\\":" + bakedVertCount);
                    lsb.Append(",\\"bakedCenterRhs\\":" + JsonVec3(bakedCenterR));
                    lsb.Append(",\\"bakedSpanRhs\\":" + JsonVec3(bakedSpanR));
                    lsb.Append("}");
                    layerEntries.Add(lsb.ToString());
                }

                string relBundle = pfPath.StartsWith(bundleRootUnityPath + "/", StringComparison.OrdinalIgnoreCase)
                    ? pfPath.Substring(bundleRootUnityPath.Length + 1)
                    : pfPath;
                prefabJsonEntries.Add(
                    "  " + JsonStr(relBundle) + ": { \\"layers\\": [" + string.Join(",", layerEntries) + "] }"
                );
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(inst);
            }
        }

        UnityEngine.Object.DestroyImmediate(bakedMesh);
        UnityEngine.Object.DestroyImmediate(fallbackMat);
        UnityEngine.Object.DestroyImmediate(camGo);

        File.WriteAllText(oracleOutPath, "{\\n" + string.Join(",\\n", prefabJsonEntries) + "\\n}\\n", UTF8NoBom);
        Debug.Log("HGAME_ORACLE_EXPORTED prefabs=" + prefabJsonEntries.Count);
    }
}
`;
}

export function runUnityVfxOracle({
  unityExe,
  pilotoRoot,
  assetRoot,
  assetFolderName = 'Piloto Studio',
  bundleRootUnityPath,
  mergeMeshIndex = true,
  workDir = DEFAULT_WORK_DIR,
  outDir = DEFAULT_OUT_DIR,
  meshManifestPath,
  calibrationOutPath,
  oracleOutPath,
  exportMeshes = true,
  runCalibration = true,
  runOracle = true,
} = {}) {
  const resolvedMeshManifest = meshManifestPath || path.join(workDir, 'unity-mesh-manifest.json');
  const resolvedCalOut = calibrationOutPath || path.join(workDir, 'unity_calibration.json');
  const resolvedOracleOut = oracleOutPath || path.join(workDir, 'unity-vfx-oracle.json');
  const cfgDefaults = resolveUnityVfxConfig();
  const exe = unityExe || cfgDefaults.unityExe;
  const pRoot = assetRoot || pilotoRoot || cfgDefaults.pilotoRoot;
  if (!exe || !fs.existsSync(exe)) {
    throw new Error(`Unity executable not found. Configure .hgame.local.json (unityVfx.unityExe) or HGAME_UNITY_EXE. Resolved: "${exe}"`);
  }
  if (!pRoot || !fs.existsSync(pRoot)) {
    throw new Error(`Unity VFX root not found. Configure .hgame.local.json (unityVfx.pilotoRoot) or HGAME_PILOTO_ROOT or pass --asset-root. Resolved: "${pRoot}"`);
  }

  const projDir = path.join(workDir, 'unity_proj');
  const assetsDir = path.join(projDir, 'Assets');
  const editorDir = path.join(assetsDir, 'Editor');
  const settingsDir = path.join(projDir, 'ProjectSettings');
  const pkgDir = path.join(projDir, 'Packages');
  fs.mkdirSync(editorDir, { recursive: true });
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.mkdirSync(pkgDir, { recursive: true });

  const editorVer = readUnityVersionFromExe(exe);
  fs.writeFileSync(path.join(settingsDir, 'ProjectVersion.txt'), `m_EditorVersion: ${editorVer}\n`, 'utf8');
  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    JSON.stringify({
      dependencies: {
        'com.unity.modules.animation': '1.0.0',
        'com.unity.modules.imageconversion': '1.0.0',
        'com.unity.modules.particlesystem': '1.0.0',
        'com.unity.modules.physics': '1.0.0',
      },
    }, null, 2) + '\n',
    'utf8',
  );

  // Clean out stale URP/extra packages if directory existed previously
  const resolvedFolder = String(assetFolderName || 'Piloto Studio').replace(/[\\/]+/g, ' ').trim() || 'Piloto Studio';
  const copiedCount = copyFilteredUnityTree(pRoot, path.join(assetsDir, resolvedFolder));
  fs.writeFileSync(path.join(editorDir, 'HGameVfxOracleExporter.cs'), buildEditorCSharpSource(), 'utf8');

  const meshDir = path.join(outDir, 'meshes');
  const meshIndexPath = path.join(meshDir, 'mesh_index.json');
  const prevMeshIndex = mergeMeshIndex && fs.existsSync(meshIndexPath)
    ? JSON.parse(fs.readFileSync(meshIndexPath, 'utf8').replace(/^\uFEFF/, ''))
    : null;
  const runCfgPath = path.join(workDir, 'oracle_run_cfg.json');
  const unityLogPath = path.join(workDir, 'unity-oracle.log');

  const assetRootUnityPath = `Assets/${resolvedFolder}/`;
  const resolvedBundleUnityPath = bundleRootUnityPath
    || (resolvedFolder === 'Piloto Studio' ? 'Assets/Piloto Studio/Super Realistic FX Bundle' : `Assets/${resolvedFolder}`);

  fs.mkdirSync(meshDir, { recursive: true });
  fs.writeFileSync(runCfgPath, JSON.stringify({
    meshOutDir: meshDir.replace(/\\/g, '/'),
    meshIndexPath: meshIndexPath.replace(/\\/g, '/'),
    meshManifestPath: resolvedMeshManifest.replace(/\\/g, '/'),
    calibrationOutPath: resolvedCalOut.replace(/\\/g, '/'),
    oracleOutPath: resolvedOracleOut.replace(/\\/g, '/'),
    assetRootUnityPath,
    bundleRootUnityPath: resolvedBundleUnityPath,
    exportMeshes: exportMeshes ? 1 : 0,
    runCalibration: runCalibration ? 1 : 0,
    runOracle: runOracle ? 1 : 0,
  }, null, 2), 'utf8');

  console.log(`Running Unity BatchMode (${editorVer}), staged ${copiedCount} files in ${projDir}...`);
  execFileSync(
    exe,
    [
      '-batchmode',
      '-nographics',
      '-quit',
      '-projectPath', projDir,
      '-executeMethod', 'HGameVfxOracleExporter.RunBatchExport',
      '-logFile', unityLogPath,
    ],
    {
      env: { ...process.env, HGAME_UNITY_ORACLE_CFG: runCfgPath },
      stdio: 'inherit',
      timeout: 600_000,
    },
  );

  if (mergeMeshIndex && prevMeshIndex && fs.existsSync(meshIndexPath)) {
    const nextMeshIndex = JSON.parse(fs.readFileSync(meshIndexPath, 'utf8').replace(/^\uFEFF/, ''));
    const mergedMeshIndex = { ...prevMeshIndex, ...nextMeshIndex };
    fs.writeFileSync(meshIndexPath, JSON.stringify(mergedMeshIndex, null, 2) + '\n', 'utf8');
  }

  const meshCount = fs.existsSync(meshIndexPath) ? Object.keys(JSON.parse(fs.readFileSync(meshIndexPath, 'utf8'))).length : 0;
  const oracleCount = fs.existsSync(resolvedOracleOut) ? Object.keys(JSON.parse(fs.readFileSync(resolvedOracleOut, 'utf8'))).length : 0;
  return {
    projDir,
    unityLogPath,
    meshIndexPath,
    meshManifestPath: resolvedMeshManifest,
    calibrationOutPath: resolvedCalOut,
    oracleOutPath: resolvedOracleOut,
    meshCount,
    oracleCount,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const args = process.argv.slice(2);
  let workDir = DEFAULT_WORK_DIR;
  let outDir = DEFAULT_OUT_DIR;
  let assetRoot = '';
  let assetFolderName = 'Piloto Studio';
  let bundleRootUnityPath = '';
  let exportMeshes = true;
  let runCalibration = true;
  let runOracle = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--work-dir' && args[i + 1]) workDir = path.resolve(args[++i]);
    else if (args[i] === '--out' && args[i + 1]) outDir = path.resolve(args[++i]);
    else if (args[i] === '--asset-root' && args[i + 1]) assetRoot = path.resolve(args[++i]);
    else if (args[i] === '--asset-folder' && args[i + 1]) assetFolderName = args[++i];
    else if (args[i] === '--bundle-unity-path' && args[i + 1]) bundleRootUnityPath = args[++i];
    else if (args[i] === '--no-meshes') exportMeshes = false;
    else if (args[i] === '--no-calibration') runCalibration = false;
    else if (args[i] === '--no-oracle') runOracle = false;
  }
  const res = runUnityVfxOracle({
    workDir,
    outDir,
    assetRoot,
    assetFolderName,
    bundleRootUnityPath,
    exportMeshes,
    runCalibration,
    runOracle,
  });
  console.log(JSON.stringify(res, null, 2));
}
