/**
 * Compiles either `[v0, v1, ...]` uniform samples or `[[t0, v0], [t1, v1], ...]` keyframes
 * into a fixed 16-point `Float32Array` Curve LUT for O(1) runtime interpolation.
 * @param {number[] | Array<[number, number]> | number | null | undefined} curveRaw
 * @param {number} [defaultVal=1.0]
 * @returns {Float32Array}
 */
export function compileCurveLut16(curveRaw: number[] | Array<[number, number]> | number | null | undefined, defaultVal?: number | undefined): Float32Array;
/**
 * O(1) linear interpolation on a precompiled 16-point Curve LUT.
 * @param {Float32Array} lut
 * @param {number} age01
 * @returns {number}
 */
export function sampleCurveLut16(lut: Float32Array, age01: number): number;
/**
 * Validates a `VfxPresetV2` (`schemaVersion === 2`) declarative payload.
 * @param {object} preset
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateVfxPresetV2(preset: object): {
    ok: boolean;
    errors: string[];
};
/**
 * Compiles a validated `VfxPresetV2` into an immutable runtime descriptor with 16-point Curve LUTs.
 * @param {object} preset
 */
export function compileVfxPresetV2(preset: object): Readonly<{
    schemaVersion: 2;
    id: any;
    name: any;
    category: any;
    duration: number;
    loop: boolean;
    boundsRadius: number;
    emitters: any;
}>;
export const VFX_V2_SCHEMA_VERSION: 2;
export const VFX_CURVE_LUT_SAMPLES: 16;
/**
 * 3 built-in benchmark presets verifying VFX v2 capabilities without external Unreal assets.
 */
export const VFX_V2_BENCHMARK_PRESETS: readonly (Readonly<{
    schemaVersion: 2;
    id: "vfx_bench_explosion";
    name: "写实手雷爆炸 (PMA火转烟+碎块+闪光)";
    category: "v2 标杆预设";
    duration: 2.2;
    loop: false;
    boundsRadius: 6;
    emitters: ({
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
        };
        velocity: {
            speed: number[];
            inherit: number;
            alignVelocity: boolean;
            stretchFactor: number;
            dir?: undefined;
        };
        motion: {
            gravity: number;
            drag: number;
            curlNoise: {
                strength: number;
                frequency: number;
                speed: number;
            };
            groundBounce?: undefined;
            angularVel?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            dissolve: number[];
            additive: number[];
            emissive: number[];
        };
        material: {
            blendMode: string;
            mainTex: string;
            noiseTex: string;
            flipbook: {
                cols: number;
                rows: number;
                fps: number;
                frameBlend: boolean;
                randomStart: boolean;
                loop: boolean;
            };
            noiseScroll: number[];
            distortionStrength: number;
            dissolveEdgeWidth: number;
            dissolveEdgeColor: number[];
            emissiveBoost: number;
            lutRow: number;
            tint: number[];
            softParticleDepth: number;
            cameraOffset: number;
            meshKind?: undefined;
            fresnelPower?: undefined;
            doubleSided?: undefined;
        };
        events?: undefined;
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
        };
        velocity: {
            speed: number[];
            inherit: number;
            alignVelocity: boolean;
            stretchFactor: number;
            dir?: undefined;
        };
        motion: {
            gravity: number;
            drag: number;
            curlNoise: {
                strength: number;
                frequency: number;
                speed: number;
            };
            groundBounce: {
                enabled: boolean;
                groundY: number;
                restitution: number;
                friction: number;
            };
            angularVel?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            additive: number[];
            dissolve?: undefined;
            emissive?: undefined;
        };
        material: {
            blendMode: string;
            mainTex: string;
            emissiveBoost: number;
            lutRow: number;
            tint: number[];
            cameraOffset: number;
            noiseTex?: undefined;
            flipbook?: undefined;
            noiseScroll?: undefined;
            distortionStrength?: undefined;
            dissolveEdgeWidth?: undefined;
            dissolveEdgeColor?: undefined;
            softParticleDepth?: undefined;
            meshKind?: undefined;
            fresnelPower?: undefined;
            doubleSided?: undefined;
        };
        events?: undefined;
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
        };
        velocity: {
            speed: number[];
            inherit: number;
            alignVelocity?: undefined;
            stretchFactor?: undefined;
            dir?: undefined;
        };
        motion: {
            gravity: number;
            drag: number;
            angularVel: number[];
            groundBounce: {
                enabled: boolean;
                groundY: number;
                restitution: number;
                friction: number;
            };
            curlNoise?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            dissolve?: undefined;
            additive?: undefined;
            emissive?: undefined;
        };
        material: {
            blendMode: string;
            meshKind: string;
            mainTex: string;
            lutRow: number;
            tint: number[];
            noiseTex?: undefined;
            flipbook?: undefined;
            noiseScroll?: undefined;
            distortionStrength?: undefined;
            dissolveEdgeWidth?: undefined;
            dissolveEdgeColor?: undefined;
            emissiveBoost?: undefined;
            softParticleDepth?: undefined;
            cameraOffset?: undefined;
            fresnelPower?: undefined;
            doubleSided?: undefined;
        };
        events?: undefined;
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
        };
        velocity: {
            speed: number[];
            dir: number[];
            inherit?: undefined;
            alignVelocity?: undefined;
            stretchFactor?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            dissolve?: undefined;
            additive?: undefined;
            emissive?: undefined;
        };
        material: {
            blendMode: string;
            meshKind: string;
            mainTex: string;
            fresnelPower: number;
            emissiveBoost: number;
            tint: number[];
            doubleSided: boolean;
            noiseTex?: undefined;
            flipbook?: undefined;
            noiseScroll?: undefined;
            distortionStrength?: undefined;
            dissolveEdgeWidth?: undefined;
            dissolveEdgeColor?: undefined;
            lutRow?: undefined;
            softParticleDepth?: undefined;
            cameraOffset?: undefined;
        };
        motion?: undefined;
        events?: undefined;
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        events: {
            pointLightFlash: {
                color: number[];
                intensity: number;
                radius: number;
                duration: number;
            };
            cameraShake: {
                intensity: number;
                duration: number;
            };
            spawnDecal: {
                decalId: string;
                scale: number[];
                randomRotation: boolean;
            };
            playCue: string;
        };
        maxParticles?: undefined;
        spawn?: undefined;
        lifetime?: undefined;
        sizeStart?: undefined;
        shape?: undefined;
        velocity?: undefined;
        motion?: undefined;
        curves?: undefined;
        material?: undefined;
    })[];
}> | Readonly<{
    schemaVersion: 2;
    id: "vfx_bench_slash_shield";
    name: "ARPG 噪声刀光 + 能量护盾";
    category: "v2 标杆预设";
    duration: 1.5;
    loop: false;
    boundsRadius: 4.5;
    emitters: ({
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
        };
        velocity: {
            speed: number[];
            dir: number[];
            alignVelocity?: undefined;
            stretchFactor?: undefined;
        };
        motion: {
            angularVel: number[];
            gravity?: undefined;
            drag?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            dissolve: number[];
            additive: number[];
        };
        material: {
            blendMode: string;
            meshKind: string;
            mainTex: string;
            noiseTex: string;
            uvScroll: number[];
            noiseScroll: number[];
            distortionStrength: number;
            dissolveEdgeWidth: number;
            dissolveEdgeColor: number[];
            emissiveBoost: number;
            tint: number[];
            fresnelPower: number;
            doubleSided: boolean;
            lutRow?: undefined;
            lightningJitter?: undefined;
            ribbonLength?: undefined;
        };
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
        };
        velocity: {
            speed: number[];
            dir: number[];
            alignVelocity?: undefined;
            stretchFactor?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            dissolve: number[];
            additive?: undefined;
        };
        material: {
            blendMode: string;
            meshKind: string;
            mainTex: string;
            noiseTex: string;
            noiseScroll: number[];
            dissolveEdgeWidth: number;
            dissolveEdgeColor: number[];
            emissiveBoost: number;
            lutRow: number;
            tint: number[];
            fresnelPower: number;
            doubleSided: boolean;
            uvScroll?: undefined;
            distortionStrength?: undefined;
            lightningJitter?: undefined;
            ribbonLength?: undefined;
        };
        motion?: undefined;
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
        };
        velocity: {
            speed: number[];
            dir?: undefined;
            alignVelocity?: undefined;
            stretchFactor?: undefined;
        };
        material: {
            blendMode: string;
            lightningJitter: number;
            ribbonLength: number;
            tint: number[];
            emissiveBoost: number;
            meshKind?: undefined;
            mainTex?: undefined;
            noiseTex?: undefined;
            uvScroll?: undefined;
            noiseScroll?: undefined;
            distortionStrength?: undefined;
            dissolveEdgeWidth?: undefined;
            dissolveEdgeColor?: undefined;
            fresnelPower?: undefined;
            doubleSided?: undefined;
            lutRow?: undefined;
        };
        motion?: undefined;
        curves?: undefined;
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
        };
        velocity: {
            speed: number[];
            alignVelocity: boolean;
            stretchFactor: number;
            dir?: undefined;
        };
        motion: {
            gravity: number;
            drag: number;
            angularVel?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            dissolve?: undefined;
            additive?: undefined;
        };
        material: {
            blendMode: string;
            mainTex: string;
            emissiveBoost: number;
            lutRow: number;
            tint: number[];
            meshKind?: undefined;
            noiseTex?: undefined;
            uvScroll?: undefined;
            noiseScroll?: undefined;
            distortionStrength?: undefined;
            dissolveEdgeWidth?: undefined;
            dissolveEdgeColor?: undefined;
            fresnelPower?: undefined;
            doubleSided?: undefined;
            lightningJitter?: undefined;
            ribbonLength?: undefined;
        };
    })[];
}> | Readonly<{
    schemaVersion: 2;
    id: "vfx_bench_blood_splash";
    name: "可染色血浆 / 果汁喷溅 (LUT切换+落地贴花)";
    category: "v2 标杆预设";
    duration: 1.4;
    loop: false;
    boundsRadius: 4;
    emitters: ({
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
            angle: number;
        };
        velocity: {
            speed: number[];
            alignVelocity: boolean;
            stretchFactor: number;
        };
        motion: {
            gravity: number;
            drag: number;
            groundBounce: {
                enabled: boolean;
                groundY: number;
                restitution: number;
                friction: number;
            };
            curlNoise?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            additive: number[];
            dissolve?: undefined;
        };
        material: {
            blendMode: string;
            mainTex: string;
            lutRow: number;
            tint: number[];
            emissiveBoost: number;
            noiseTex?: undefined;
            flipbook?: undefined;
            dissolveEdgeWidth?: undefined;
            dissolveEdgeColor?: undefined;
        };
        subEmitters: {
            onCollision: string;
        };
        events?: undefined;
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        maxParticles: number;
        spawn: {
            burst: {
                time: number;
                count: number;
            }[];
            rate: number;
        };
        lifetime: number[];
        sizeStart: number[];
        shape: {
            type: string;
            radius: number;
            angle?: undefined;
        };
        velocity: {
            speed: number[];
            alignVelocity?: undefined;
            stretchFactor?: undefined;
        };
        motion: {
            gravity: number;
            drag: number;
            curlNoise: {
                strength: number;
                frequency: number;
                speed: number;
            };
            groundBounce?: undefined;
        };
        curves: {
            size: number[];
            alpha: number[];
            dissolve: number[];
            additive: number[];
        };
        material: {
            blendMode: string;
            mainTex: string;
            noiseTex: string;
            flipbook: {
                cols: number;
                rows: number;
                fps: number;
                frameBlend: boolean;
            };
            dissolveEdgeWidth: number;
            dissolveEdgeColor: number[];
            lutRow: number;
            tint: number[];
            emissiveBoost?: undefined;
        };
        subEmitters?: undefined;
        events?: undefined;
    } | {
        id: string;
        renderer: string;
        delay: number;
        minQuality: string;
        events: {
            spawnDecal: {
                decalId: string;
                scale: number[];
                randomRotation: boolean;
            };
            playCue: string;
        };
        maxParticles?: undefined;
        spawn?: undefined;
        lifetime?: undefined;
        sizeStart?: undefined;
        shape?: undefined;
        velocity?: undefined;
        motion?: undefined;
        curves?: undefined;
        material?: undefined;
        subEmitters?: undefined;
    })[];
}>)[];
