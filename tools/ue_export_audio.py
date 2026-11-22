"""
Read-only Unreal Engine 5.8 Python batch exporter for Milestone 3 Audio:
  - Exports SoundWave assets (skips SoundCue node graphs) to standard 16-bit PCM WAV
  - Skips ClassicZombieSFXv2 (true subset of Zombie_Sound_Effects_Bundle)
  - Skips V10_German (bypass FMOD; downstream Node reads Content/V10_German/Wavs directly)
  - Deduplicates HorrorSoundPack2 vs MegaBundleSoundPack/HorrorSoundPack2 by normalized stem + duration
  - Includes VFX audio folders: Vefects/Water/Audio and _Effects/FireworksWithSounds/Audio
  - Writes audio_source_meta.json (pack, relPath, duration, channels, sampleRate, bytes, dedup stats)

Strict Redline: NEVER modifies Anim58/Content or VaultCache. All outputs go to Saved/WebAssetExport/audio_staging.
"""

import json
import os
import re
import unreal

STAGING_ROOT = os.environ.get(
    "HGAME_AUDIO_STAGING",
    r"D:\UnrealWorkspace\Anim58\Saved\WebAssetExport\audio_staging",
)
PROBE_ONLY = os.environ.get("HGAME_AUDIO_PROBE_ONLY", "0") == "1"
os.makedirs(STAGING_ROOT, exist_ok=True)

ar = unreal.AssetRegistryHelpers.get_asset_registry()

ALLOWED_ROOT_PACKS = {
    "MeleeWeaponsSoundEffectsPack1",
    "SwordPackUE",
    "GunSoundPack",
    "RPGSkillSound",
    "SoundPackRPGGames",
    "RewardsLootsAudioPack",
    "Coin_And_Gem_SFX",
    "FootstepsSoundPack",
    "Doorssfx",
    "Survival_SFX",
    "Futuristic_Impacts",
    "Zombie_Sound_Effects_Bundle",
    "MegaBundleSoundPack",
    "HorrorSoundPack2",
}

SKIP_PACKS = {
    "ClassicZombieSFXv2",
    "V10_German",
}


def get_pack_and_rel(pkg_path):
    parts = [p for p in pkg_path.split("/") if p]
    # parts[0] == 'Game'
    if len(parts) < 3:
        return None, None
    top = parts[1]
    if top in SKIP_PACKS:
        return None, None
    if top in ALLOWED_ROOT_PACKS:
        return top, "/".join(parts[2:])
    if pkg_path.startswith("/Game/Vefects/Water/Audio/"):
        return "Vefects_Water", pkg_path[len("/Game/Vefects/Water/Audio/"):]
    if pkg_path.startswith("/Game/_Effects/FireworksWithSounds/Audio/"):
        return "FireworksWithSounds", pkg_path[len("/Game/_Effects/FireworksWithSounds/Audio/"):]
    return None, None


def norm_horror_dedup_key(asset_name, duration_sec):
    s = re.sub(r"^(?:sfx_|wav_|snd_|hsp2_)", "", asset_name.lower())
    s = re.sub(r"(?:_wav|_sfx)+$", "", s)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    dur_bucket = round(float(duration_sec or 0.0), 1)
    return f"{s}@{dur_bucket:.1f}"


def read_wave_props(sw_asset):
    dur = 0.0
    ch = 1
    sr = 44100
    for prop in ("duration",):
        try:
            dur = float(sw_asset.get_editor_property(prop))
        except Exception:
            pass
    for prop in ("num_channels",):
        try:
            ch = int(sw_asset.get_editor_property(prop))
        except Exception:
            pass
    for fn_name in ("get_sample_rate_for_current_platform",):
        try:
            fn = getattr(sw_asset, fn_name, None)
            if callable(fn):
                val = int(fn())
                if val > 0:
                    sr = val
        except Exception:
            pass
    if sr <= 0:
        sr = 44100
    return round(dur, 4), max(1, ch), sr


def export_wav(sw_asset, out_wav_abs):
    os.makedirs(os.path.dirname(out_wav_abs), exist_ok=True)
    if os.path.isfile(out_wav_abs) and os.path.getsize(out_wav_abs) > 128:
        return True
    task = unreal.AssetExportTask()
    task.object = sw_asset
    task.filename = out_wav_abs
    task.automated = True
    task.replace_identical = True
    task.prompt = False
    ok = unreal.Exporter.run_asset_export_task(task)
    return bool(ok) and os.path.isfile(out_wav_abs) and os.path.getsize(out_wav_abs) > 44


all_assets = ar.get_assets_by_path("/Game", recursive=True)
candidates = []
skipped_classic = 0
skipped_v10 = 0
skipped_soundcue = 0

for ad in all_assets:
    cls = str(ad.asset_class_path.asset_name)
    pkg = str(ad.package_name)
    name = str(ad.asset_name)
    if cls == "SoundCue":
        skipped_soundcue += 1
        continue
    if cls != "SoundWave":
        continue
    if pkg.startswith("/Game/ClassicZombieSFXv2/"):
        skipped_classic += 1
        continue
    if pkg.startswith("/Game/V10_German/"):
        skipped_v10 += 1
        continue
    pack, rel_pkg = get_pack_and_rel(pkg)
    if not pack:
        continue
    candidates.append({
        "pack": pack,
        "relPkg": rel_pkg,
        "name": name,
        "packageName": pkg,
        "objectPath": f"{pkg}.{name}",
    })

print(
    f"AUDIO_SCAN candidates={len(candidates)} skipped_classic={skipped_classic} "
    f"skipped_v10={skipped_v10} skipped_soundcue={skipped_soundcue}"
)

# Inspect & deduplicate HorrorSoundPack2 vs MegaBundleSoundPack/HorrorSoundPack2
horror_groups = {}
non_horror = []

for item in candidates:
    sw = unreal.load_asset(item["objectPath"])
    if not sw:
        continue
    dur, ch, sr = read_wave_props(sw)
    item["duration"] = dur
    item["channels"] = ch
    item["sampleRate"] = sr
    item["_asset"] = sw

    is_horror_overlap = (
        item["pack"] == "HorrorSoundPack2"
        or (item["pack"] == "MegaBundleSoundPack" and "HorrorSoundPack2" in item["packageName"])
    )
    if is_horror_overlap:
        key = norm_horror_dedup_key(item["name"], dur)
        # Priority score: sampleRate, then standalone HorrorSoundPack2 slightly preferred if tie
        prio = (sr, ch, 1 if item["pack"] == "HorrorSoundPack2" else 0)
        prev = horror_groups.get(key)
        if prev is None or prio > prev[0]:
            horror_groups[key] = (prio, item)
    else:
        non_horror.append(item)

kept_horror = [pair[1] for pair in horror_groups.values()]
horror_total = sum(
    1 for c in candidates
    if "_asset" in c and (c["pack"] == "HorrorSoundPack2" or (c["pack"] == "MegaBundleSoundPack" and "HorrorSoundPack2" in c["packageName"]))
)
dedup_horror_dropped = horror_total - len(kept_horror)
final_list = non_horror + kept_horror

print(
    f"AUDIO_DEDUP total_loaded={len(non_horror) + horror_total} kept={len(final_list)} "
    f"horror_dropped={dedup_horror_dropped} probe_only={PROBE_ONLY}"
)

records = []
export_ok = 0
export_fail = []

for idx, item in enumerate(final_list):
    sw = item.pop("_asset")
    rel_wav = f"{item['pack']}/{item['relPkg']}.wav".replace("//", "/")
    out_abs = os.path.join(STAGING_ROOT, rel_wav.replace("/", os.sep))
    if not PROBE_ONLY:
        ok = export_wav(sw, out_abs)
        if not ok:
            export_fail.append(item["objectPath"])
            continue
        export_ok += 1
    size_bytes = os.path.getsize(out_abs) if os.path.isfile(out_abs) else 0
    records.append({
        "id": f"{item['pack']}__{item['relPkg'].replace('/', '__')}",
        "pack": item["pack"],
        "name": item["name"],
        "relDir": os.path.dirname(item["relPkg"]).replace("\\", "/"),
        "relWav": rel_wav,
        "wavAbs": out_abs,
        "objectPath": item["objectPath"],
        "duration": item["duration"],
        "channels": item["channels"],
        "sampleRate": item["sampleRate"],
        "rawBytes": size_bytes,
    })
    if not PROBE_ONLY and (idx + 1) % 250 == 0:
        print(f"AUDIO_EXPORT_PROGRESS {idx + 1}/{len(final_list)} ok={export_ok} fail={len(export_fail)}")

meta = {
    "version": "1.0.0",
    "stagingRoot": STAGING_ROOT,
    "probeOnly": PROBE_ONLY,
    "skippedClassicZombie": skipped_classic,
    "skippedV10GermanUe": skipped_v10,
    "skippedSoundCue": skipped_soundcue,
    "dedupHorrorDropped": dedup_horror_dropped,
    "exportedCount": len(records),
    "failedCount": len(export_fail),
    "failed": export_fail,
    "items": records,
}
meta_path = os.path.join(STAGING_ROOT, "audio_source_meta.json")
with open(meta_path, "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)

print(f"AUDIO_EXPORT_DONE exported={len(records)} failed={len(export_fail)} meta={meta_path}")
