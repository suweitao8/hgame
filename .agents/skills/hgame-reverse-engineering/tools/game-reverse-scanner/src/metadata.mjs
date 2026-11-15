import { open } from 'node:fs/promises';

const DEFAULT_MAX_METADATA_FILES = 100;
const DEFAULT_MAX_BYTES_PER_FILE = 256 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024;

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').toLowerCase();
}

function basename(value) {
  const normalized = normalizePath(value);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function isExactVersion(value) {
  return typeof value === 'string'
    && /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9a-z.-]+)?$/i.test(value.trim());
}

function addHint(target, hint) {
  const key = [hint.engineId || hint.name, hint.path, hint.rule, hint.version || ''].join('|');
  if (!target.some(item => [item.engineId || item.name, item.path, item.rule, item.version || ''].join('|') === key)) {
    target.push(hint);
  }
}

function metadataKind(file) {
  const path = normalizePath(file.path);
  const name = basename(file.path);
  const segments = path.split('/');

  if (path === 'projectsettings/projectversion.txt' || path.endsWith('/projectsettings/projectversion.txt')) return 'unity-project-version';
  if (name === 'build.version') return 'unreal-build-version';
  if (name === 'project.godot') return 'godot-project';
  if (name === 'game.project' && segments.length <= 3) return 'defold-project';
  if (name === 'conf.lua' && segments.length <= 3) return 'love-config';
  if (name === 'package.json' && (segments.length === 1 || path.endsWith('/resources/app/package.json') || path.endsWith('/www/package.json'))) return 'package-json';
  if (name === 'project.json' && segments.length <= 3) return 'project-json';
  return null;
}

async function readTextBounded(file, maxBytes) {
  const handle = await open(file.absolutePath, 'r');
  try {
    const info = await handle.stat();
    if (info.size > maxBytes) return { tooLarge: true, text: '' };
    const buffer = Buffer.alloc(info.size);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    return { tooLarge: false, text: buffer.subarray(0, bytesRead).toString('utf8') };
  } finally {
    await handle.close();
  }
}

function parseBuildVersion(text, filePath, result) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    result.warnings.push({
      code: 'metadata-invalid-json',
      path: filePath,
      message: `Build.version is not valid JSON: ${error.message}`,
    });
    return;
  }
  const major = parsed?.MajorVersion;
  const minor = parsed?.MinorVersion;
  const patch = parsed?.PatchVersion ?? 0;
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return;
  const version = `${major}.${minor}.${patch}`;
  addHint(result.engineHints, {
    engineId: 'unreal', path: filePath, rule: 'unreal-build-version', strength: 'strong',
    detail: 'Unreal Engine Build.version metadata was found.',
  });
  addHint(result.versionHints, {
    engineId: 'unreal', version, path: filePath, rule: 'unreal-build-version', strength: 'strong',
    detail: 'Version assembled from explicit MajorVersion, MinorVersion and PatchVersion fields.',
  });
}

function parsePackageJson(text, filePath, result) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    result.warnings.push({
      code: 'metadata-invalid-json',
      path: filePath,
      message: `package.json is not valid JSON: ${error.message}`,
    });
    return;
  }

  const creatorDeclaration = parsed.creator;
  const creatorVersion = typeof creatorDeclaration === 'string'
    ? creatorDeclaration
    : creatorDeclaration && typeof creatorDeclaration === 'object' && typeof creatorDeclaration.version === 'string'
      ? creatorDeclaration.version
      : undefined;
  const declaredCreatorVersion = creatorVersion || parsed.devDependencies?.cc || parsed.dependencies?.cc;
  if (declaredCreatorVersion) {
    addHint(result.engineHints, {
      engineId: 'cocos-creator', path: filePath, rule: 'cocos-creator-package-metadata', strength: 'moderate',
      detail: 'Cocos Creator metadata was declared in package.json.',
    });
    if (isExactVersion(declaredCreatorVersion)) {
      addHint(result.versionHints, {
        engineId: 'cocos-creator', version: declaredCreatorVersion.trim(), path: filePath,
        rule: 'cocos-creator-package-version', strength: 'strong',
        detail: 'An exact Cocos Creator version was declared in package.json.',
      });
    }
  }

  const electronVersion = parsed.devDependencies?.electron || parsed.dependencies?.electron;
  if (typeof electronVersion === 'string' && electronVersion.trim()) {
    addHint(result.engineHints, {
      engineId: 'electron', path: filePath, rule: 'electron-package-dependency', strength: 'moderate',
      detail: 'package.json declares Electron; this identifies the desktop wrapper, not the underlying game engine.',
    });
    addHint(result.runtimeHints, {
      name: 'Electron', version: electronVersion.trim(), engineId: 'electron', path: filePath,
      rule: 'electron-package-dependency', strength: 'moderate',
      detail: 'Declared dependency range only; installed runtime version was not checked.',
    });
  }
}

function parseGodotProject(text, filePath, result) {
  addHint(result.engineHints, {
    engineId: 'godot', path: filePath, rule: 'godot-project-file', strength: 'strong',
    detail: 'project.godot project configuration was found.',
  });
  const match = text.match(/config\/features\s*=\s*(?:PackedStringArray|PoolStringArray)?\s*\(?\s*["'](\d+\.\d+(?:\.\d+)?)/i);
  if (match) {
    addHint(result.versionHints, {
      engineId: 'godot', version: match[1], path: filePath, rule: 'godot-project-features', strength: 'strong',
      detail: 'Godot version was read from the first explicit config/features entry.',
    });
  }
}

function parseTextMetadata(kind, text, filePath, result) {
  if (kind === 'unity-project-version') {
    const match = text.match(/^m_EditorVersion\s*:\s*([^\r\n]+)$/im);
    addHint(result.engineHints, {
      engineId: 'unity', path: filePath, rule: 'unity-project-version-file', strength: 'strong',
      detail: 'Unity ProjectSettings/ProjectVersion.txt was found.',
    });
    if (match && match[1].trim()) {
      addHint(result.versionHints, {
        engineId: 'unity', version: match[1].trim(), path: filePath, rule: 'unity-editor-version', strength: 'strong',
        detail: 'Version was read from the explicit m_EditorVersion field.',
      });
    }
    return;
  }

  if (kind === 'unreal-build-version') {
    parseBuildVersion(text, filePath, result);
    return;
  }

  if (kind === 'godot-project') {
    parseGodotProject(text, filePath, result);
    return;
  }

  if (kind === 'package-json') {
    parsePackageJson(text, filePath, result);
    return;
  }

  if (kind === 'defold-project') {
    addHint(result.engineHints, {
      engineId: 'defold', path: filePath, rule: 'defold-game-project', strength: 'strong',
      detail: 'Defold game.project was found.',
    });
    const match = text.match(/^engine_version\s*=\s*["']?([^\s"']+)/im);
    if (match && isExactVersion(match[1])) {
      addHint(result.versionHints, {
        engineId: 'defold', version: match[1], path: filePath, rule: 'defold-engine-version', strength: 'strong',
        detail: 'An explicit engine_version field was found in game.project.',
      });
    }
    return;
  }

  if (kind === 'love-config') {
    if (/love\.conf\s*\(/i.test(text)) {
      addHint(result.engineHints, {
        engineId: 'love', path: filePath, rule: 'love-conf-file', strength: 'moderate',
        detail: 'A LÖVE conf.lua configuration callback was found.',
      });
      const match = text.match(/t\.version\s*=\s*["']([^"']+)["']/i);
      if (match && isExactVersion(match[1])) {
        addHint(result.versionHints, {
          engineId: 'love', version: match[1], path: filePath, rule: 'love-runtime-version', strength: 'strong',
          detail: 'An explicit LÖVE runtime version was assigned in conf.lua.',
        });
      }
    }
    return;
  }

  if (kind === 'project-json') {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      result.warnings.push({
        code: 'metadata-invalid-json', path: filePath,
        message: `project.json is not valid JSON: ${error.message}`,
      });
      return;
    }
    const version = parsed.engineVersion || parsed.creatorVersion;
    if (typeof version === 'string' && version.trim()) {
      addHint(result.engineHints, {
        engineId: 'cocos-creator', path: filePath, rule: 'cocos-creator-project-json', strength: 'moderate',
        detail: 'Cocos Creator engine metadata was found in project.json.',
      });
      if (isExactVersion(version)) {
        addHint(result.versionHints, {
          engineId: 'cocos-creator', version: version.trim(), path: filePath,
          rule: 'cocos-creator-project-version', strength: 'strong',
          detail: 'An exact engineVersion or creatorVersion field was found.',
        });
      }
    }
  }
}

function collectPackagePlatforms(archives, result) {
  for (const archive of archives) {
    const archivePath = normalizePath(archive.path);
    // The zip index produces plain member-name strings; tolerate {name}
    // objects so hand-built fixtures and future index shapes both work.
    const names = (archive.entries || [])
      .map(entry => normalizePath(typeof entry === 'string' ? entry : entry?.name));
    if ((archivePath.endsWith('.apk') && names.includes('androidmanifest.xml') && names.includes('classes.dex'))
      || (archivePath.endsWith('.aab') && names.some(name => name.endsWith('manifest/androidmanifest.xml')))) {
      addHint(result.platformHints, {
        name: 'Android', path: archive.path, rule: 'android-package-archive', strength: 'strong',
        detail: 'Android package manifest and DEX member names were found in the archive index.',
      });
    }
    if (archivePath.endsWith('.ipa') && names.some(name => /^payload\/[^/]+\.app\/info\.plist$/.test(name))) {
      addHint(result.platformHints, {
        name: 'iOS', path: archive.path, rule: 'ios-ipa-archive', strength: 'strong',
        detail: 'An iOS app bundle Info.plist member was found in the IPA archive index.',
      });
    }
    if (archivePath.endsWith('.jar') && names.some(name => name.endsWith('.class'))) {
      addHint(result.runtimeHints, {
        name: 'Java/JVM', version: 'unknown', path: archive.path,
        rule: 'jar-class-members', strength: 'moderate',
        detail: 'Java class member names were found in the JAR central directory; no specific engine is implied.',
      });
    }
  }
}

function collectBinaryRuntimeHints(files, result) {
  for (const file of files) {
    const magicId = file.magic?.id;
    if (magicId === 'pe') {
      addHint(result.platformHints, {
        name: 'Windows', path: file.path, rule: 'pe-binary', strength: 'moderate',
        detail: 'A PE-format binary was found.',
      });
      addHint(result.runtimeHints, {
        name: 'Windows PE native binary', version: 'unknown', path: file.path,
        rule: 'pe-binary', strength: 'moderate', detail: 'Native binary signature only; it does not identify a game engine.',
      });
    } else if (magicId === 'elf') {
      addHint(result.runtimeHints, {
        name: 'ELF native binary', version: 'unknown', path: file.path,
        rule: 'elf-binary', strength: 'moderate', detail: 'Native binary signature only; it does not identify a game engine.',
      });
      if (!/\/lib\/(?:arm|x86|mips|riscv)/i.test(file.path)) {
        addHint(result.platformHints, {
          name: 'Linux', path: file.path, rule: 'elf-binary', strength: 'weak',
          detail: 'An ELF binary was found outside a known Android ABI library path.',
        });
      }
    } else if (magicId === 'macho' || magicId === 'macho-fat') {
      addHint(result.platformHints, {
        name: 'Apple platform', path: file.path, rule: 'mach-o-binary', strength: 'moderate',
        detail: 'A Mach-O binary was found; macOS versus iOS requires bundle metadata.',
      });
      addHint(result.runtimeHints, {
        name: 'Mach-O native binary', version: 'unknown', path: file.path,
        rule: 'mach-o-binary', strength: 'moderate', detail: 'Native binary signature only; it does not identify a game engine.',
      });
    } else if (magicId === 'java-class') {
      addHint(result.runtimeHints, {
        name: 'Java/JVM', version: 'unknown', path: file.path,
        rule: 'java-class-file', strength: 'moderate', detail: 'Java class-file signature was found; the specific engine is not implied.',
      });
    } else if (magicId === 'wasm') {
      addHint(result.runtimeHints, {
        name: 'WebAssembly', version: 'unknown', path: file.path,
        rule: 'wasm-module', strength: 'moderate', detail: 'WebAssembly module signature was found; it does not identify a game engine.',
      });
    }
  }
}

/** Read a small allowlist of engine metadata files; never parse arbitrary game content. */
export async function collectMetadata(root, files, archives, options = {}) {
  const maxMetadataFiles = options.maxMetadataFiles ?? DEFAULT_MAX_METADATA_FILES;
  const maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  for (const [value, name] of [[maxMetadataFiles, 'maxMetadataFiles'], [maxBytesPerFile, 'maxBytesPerFile'], [maxTotalBytes, 'maxTotalBytes']]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  }

  const result = { engineHints: [], versionHints: [], runtimeHints: [], platformHints: [], warnings: [] };
  const candidates = files
    .map(file => ({ file, kind: metadataKind(file) }))
    .filter(item => item.kind && item.file.absolutePath)
    .sort((left, right) => left.file.path < right.file.path ? -1 : left.file.path > right.file.path ? 1 : 0);

  let totalBytesRead = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const { file, kind } = candidates[index];
    if (index >= maxMetadataFiles) {
      result.warnings.push({
        code: 'metadata-file-limit-reached', path: file.path,
        message: `Stopped after considering ${maxMetadataFiles} allowlisted metadata files.`,
      });
      break;
    }
    if (file.sizeBytes > maxBytesPerFile) {
      result.warnings.push({
        code: 'metadata-too-large', path: file.path,
        message: `Metadata file size ${file.sizeBytes} exceeds the per-file ${maxBytesPerFile}-byte read limit.`,
      });
      continue;
    }
    if (totalBytesRead + file.sizeBytes > maxTotalBytes) {
      result.warnings.push({
        code: 'metadata-total-limit-reached', path: file.path,
        message: `Reading this file would exceed the ${maxTotalBytes}-byte total metadata read limit.`,
      });
      break;
    }

    try {
      const read = await readTextBounded(file, maxBytesPerFile);
      if (read.tooLarge) {
        result.warnings.push({
          code: 'metadata-too-large', path: file.path,
          message: `Metadata file grew beyond the ${maxBytesPerFile}-byte read limit.`,
        });
        continue;
      }
      totalBytesRead += Buffer.byteLength(read.text, 'utf8');
      parseTextMetadata(kind, read.text, file.path, result);
    } catch (error) {
      result.warnings.push({
        code: 'metadata-unreadable', path: file.path,
        message: `Could not read allowlisted metadata: ${error.message}`,
      });
    }
  }

  collectPackagePlatforms(archives, result);
  collectBinaryRuntimeHints(files, result);
  return result;
}
