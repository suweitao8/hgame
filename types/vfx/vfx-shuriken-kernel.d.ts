/**
 * Compiles a Shuriken layer into zero-GC LUT curves + Shader Profile GPU batch.
 */
export function compileShurikenLayer(layer: any, { THREE, scene, textures, meshGeometry, sharedUniforms, }?: {
    THREE?: null | undefined;
    scene?: null | undefined;
    textures?: {} | undefined;
    meshGeometry?: null | undefined;
    sharedUniforms?: null | undefined;
}): {
    layer: any;
    renderMode: any;
    renderModeId: any;
    isNone: boolean;
    isWarp: boolean;
    space: string;
    simSpeed: number;
    meshGlobalScale: number;
    velocityScale: number;
    lengthScale: number;
    alignToVelocity: boolean;
    aspectY: number;
    capacity: number;
    life: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    speed: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    sizeX: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    sizeY: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    sizeZ: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    sizeCurveX: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    sizeCurveY: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    sizeCurveZ: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    rot0X: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    rot0Y: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    rot0Z: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    spinX: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    spinY: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    spinZ: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    rotCurveX: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    rotCurveY: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    rotCurveZ: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    velX: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    velY: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    velZ: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    velCurve: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    orbitalY: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    radialVel: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    };
    forceX: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    forceY: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    forceZ: {
        kind: string;
        lut: Float32Array;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        v?: undefined;
    } | {
        kind: string;
        min: any;
        max: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        v?: undefined;
    } | {
        kind: string;
        v: any;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
        min?: undefined;
        max?: undefined;
    } | null;
    clampVel: {
        separateAxis: boolean;
        dampen: number;
        limitMag: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        limitX: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        limitY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        limitZ: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        drag: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
    } | null;
    rotBySpeed: {
        separateAxes: boolean;
        rangeMin: number;
        rangeMax: number;
        curveX: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        curveY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        curveZ: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
    } | null;
    inheritVelocity: {
        mode: any;
        multiplier: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
    } | null;
    startColor: {
        kind: string;
        rgba: number[];
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
    } | {
        kind: string;
        lut: Float32Array;
        rgba?: undefined;
        min?: undefined;
        max?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
    } | {
        kind: string;
        min: number[];
        max: number[];
        rgba?: undefined;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        rgba?: undefined;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
    };
    colorOverLifetime: {
        kind: string;
        rgba: number[];
        lut?: undefined;
        min?: undefined;
        max?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
    } | {
        kind: string;
        lut: Float32Array;
        rgba?: undefined;
        min?: undefined;
        max?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
    } | {
        kind: string;
        min: number[];
        max: number[];
        rgba?: undefined;
        lut?: undefined;
        lutMin?: undefined;
        lutMax?: undefined;
    } | {
        kind: string;
        lutMin: Float32Array;
        lutMax: Float32Array;
        rgba?: undefined;
        lut?: undefined;
        min?: undefined;
        max?: undefined;
    };
    customData: {
        custom1: {
            kind: string;
            grad: {
                kind: string;
                rgba: number[];
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                lut: Float32Array;
                rgba?: undefined;
                min?: undefined;
                max?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                min: number[];
                max: number[];
                rgba?: undefined;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                rgba?: undefined;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
            };
            comps?: undefined;
        } | {
            kind: string;
            comps: ({
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            })[];
            grad?: undefined;
        } | null;
        custom2: {
            kind: string;
            grad: {
                kind: string;
                rgba: number[];
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                lut: Float32Array;
                rgba?: undefined;
                min?: undefined;
                max?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                min: number[];
                max: number[];
                rgba?: undefined;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                rgba?: undefined;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
            };
            comps?: undefined;
        } | {
            kind: string;
            comps: ({
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            })[];
            grad?: undefined;
        } | null;
    } | null;
    streams: {
        custom1: boolean;
        custom2: boolean;
        agePercent: boolean;
        stableRandom: boolean;
        uv2: boolean;
    };
    flipbook: any;
    trail: any;
    subEmitters: any;
    mesh: any;
    material: any;
    renderState: {
        transparent: boolean;
        opaque: boolean;
        isWarp: boolean;
        premulAlpha: boolean;
        blending: any;
        blendEquation: any;
        blendSrc: any;
        blendDst: any;
        blendSrcAlpha: any;
        blendDstAlpha: any;
        side: any;
        depthTestIdx: number;
        depthWrite: boolean;
        renderOrder: number;
    } | null;
    gpuBuffers: {
        geo: any;
        arrays: {
            instPos: Float32Array;
            instRot: Float32Array;
            instScale: Float32Array;
            instVel: Float32Array;
            color: Float32Array;
            custom1: Float32Array;
            custom2: Float32Array;
            meta: Float32Array;
        };
        attrs: {
            aInstPos: any;
            aInstRot: any;
            aInstScale: any;
            aInstVel: any;
            aColor: any;
            aCustom1: any;
            aCustom2: any;
            aMeta: any;
        };
    } | null;
    soa: {
        cursor: number;
        activeCount: number;
        active: Uint8Array;
        effectSlotId: Int32Array;
        px: Float32Array;
        py: Float32Array;
        pz: Float32Array;
        vx: Float32Array;
        vy: Float32Array;
        vz: Float32Array;
        age: Float32Array;
        life: Float32Array;
        baseSx: Float32Array;
        baseSy: Float32Array;
        baseSz: Float32Array;
        rotX: Float32Array;
        rotY: Float32Array;
        rotZ: Float32Array;
        spinX: Float32Array;
        spinY: Float32Array;
        spinZ: Float32Array;
        gravity: Float32Array;
        drag: Float32Array;
        fx: Float32Array;
        fy: Float32Array;
        fz: Float32Array;
        orbitalY: Float32Array;
        centerX: Float32Array;
        centerZ: Float32Array;
        noiseStr: Float32Array;
        noiseFreq: Float32Array;
        noisePhase: Float32Array;
        randSize: Float32Array;
        randColor: Float32Array;
        randRot: Float32Array;
        randCustom: Float32Array;
        stableRand: Float32Array;
        startR: Float32Array;
        startG: Float32Array;
        startB: Float32Array;
        startA: Float32Array;
        fbRow: Uint16Array;
        trailId: Int32Array;
        birthSeq: Float64Array;
        ribbonTrailId: number;
        ribbonOrder: Int32Array;
    };
};
/**
 * Pure Shuriken runtime controller managing SoA particle simulation, instanced shader profile batches,
 * single-pass Warp detection, SoftParticles depth binding, and 3-tier quality guardrails.
 */
export function createShurikenKernel({ THREE, scene, trails, prng, }?: {
    THREE?: null | undefined;
    scene?: null | undefined;
    trails?: null | undefined;
    prng?: {
        nextFloat(): number;
        range(min: any, max: any): any;
        reset(newSeed?: number): void;
    } | undefined;
}): {
    registerTexture: (key: any, tex: any) => void;
    registerMeshGeometry: (key: any, geoOrObj: any) => void;
    registerLayer: (layer: any, customTextures?: null) => {
        layer: any;
        renderMode: any;
        renderModeId: any;
        isNone: boolean;
        isWarp: boolean;
        space: string;
        simSpeed: number;
        meshGlobalScale: number;
        velocityScale: number;
        lengthScale: number;
        alignToVelocity: boolean;
        aspectY: number;
        capacity: number;
        life: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        speed: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        sizeX: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        sizeY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        sizeZ: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        sizeCurveX: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        sizeCurveY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        sizeCurveZ: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        rot0X: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        rot0Y: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        rot0Z: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        spinX: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        spinY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        spinZ: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        rotCurveX: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        rotCurveY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        rotCurveZ: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        velX: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        velY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        velZ: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        velCurve: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        orbitalY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        radialVel: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        };
        forceX: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        forceY: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        forceZ: {
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        } | null;
        clampVel: {
            separateAxis: boolean;
            dampen: number;
            limitMag: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            limitX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            limitY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            limitZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            drag: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
        } | null;
        rotBySpeed: {
            separateAxes: boolean;
            rangeMin: number;
            rangeMax: number;
            curveX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            curveY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            curveZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
        } | null;
        inheritVelocity: {
            mode: any;
            multiplier: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
        } | null;
        startColor: {
            kind: string;
            rgba: number[];
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            lut: Float32Array;
            rgba?: undefined;
            min?: undefined;
            max?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            min: number[];
            max: number[];
            rgba?: undefined;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            rgba?: undefined;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
        };
        colorOverLifetime: {
            kind: string;
            rgba: number[];
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            lut: Float32Array;
            rgba?: undefined;
            min?: undefined;
            max?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            min: number[];
            max: number[];
            rgba?: undefined;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            rgba?: undefined;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
        };
        customData: {
            custom1: {
                kind: string;
                grad: {
                    kind: string;
                    rgba: number[];
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                } | {
                    kind: string;
                    lut: Float32Array;
                    rgba?: undefined;
                    min?: undefined;
                    max?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                } | {
                    kind: string;
                    min: number[];
                    max: number[];
                    rgba?: undefined;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    rgba?: undefined;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                };
                comps?: undefined;
            } | {
                kind: string;
                comps: ({
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                })[];
                grad?: undefined;
            } | null;
            custom2: {
                kind: string;
                grad: {
                    kind: string;
                    rgba: number[];
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                } | {
                    kind: string;
                    lut: Float32Array;
                    rgba?: undefined;
                    min?: undefined;
                    max?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                } | {
                    kind: string;
                    min: number[];
                    max: number[];
                    rgba?: undefined;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    rgba?: undefined;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                };
                comps?: undefined;
            } | {
                kind: string;
                comps: ({
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                })[];
                grad?: undefined;
            } | null;
        } | null;
        streams: {
            custom1: boolean;
            custom2: boolean;
            agePercent: boolean;
            stableRandom: boolean;
            uv2: boolean;
        };
        flipbook: any;
        trail: any;
        subEmitters: any;
        mesh: any;
        material: any;
        renderState: {
            transparent: boolean;
            opaque: boolean;
            isWarp: boolean;
            premulAlpha: boolean;
            blending: any;
            blendEquation: any;
            blendSrc: any;
            blendDst: any;
            blendSrcAlpha: any;
            blendDstAlpha: any;
            side: any;
            depthTestIdx: number;
            depthWrite: boolean;
            renderOrder: number;
        } | null;
        gpuBuffers: {
            geo: any;
            arrays: {
                instPos: Float32Array;
                instRot: Float32Array;
                instScale: Float32Array;
                instVel: Float32Array;
                color: Float32Array;
                custom1: Float32Array;
                custom2: Float32Array;
                meta: Float32Array;
            };
            attrs: {
                aInstPos: any;
                aInstRot: any;
                aInstScale: any;
                aInstVel: any;
                aColor: any;
                aCustom1: any;
                aCustom2: any;
                aMeta: any;
            };
        } | null;
        soa: {
            cursor: number;
            activeCount: number;
            active: Uint8Array;
            effectSlotId: Int32Array;
            px: Float32Array;
            py: Float32Array;
            pz: Float32Array;
            vx: Float32Array;
            vy: Float32Array;
            vz: Float32Array;
            age: Float32Array;
            life: Float32Array;
            baseSx: Float32Array;
            baseSy: Float32Array;
            baseSz: Float32Array;
            rotX: Float32Array;
            rotY: Float32Array;
            rotZ: Float32Array;
            spinX: Float32Array;
            spinY: Float32Array;
            spinZ: Float32Array;
            gravity: Float32Array;
            drag: Float32Array;
            fx: Float32Array;
            fy: Float32Array;
            fz: Float32Array;
            orbitalY: Float32Array;
            centerX: Float32Array;
            centerZ: Float32Array;
            noiseStr: Float32Array;
            noiseFreq: Float32Array;
            noisePhase: Float32Array;
            randSize: Float32Array;
            randColor: Float32Array;
            randRot: Float32Array;
            randCustom: Float32Array;
            stableRand: Float32Array;
            startR: Float32Array;
            startG: Float32Array;
            startB: Float32Array;
            startA: Float32Array;
            fbRow: Uint16Array;
            trailId: Int32Array;
            birthSeq: Float64Array;
            ribbonTrailId: number;
            ribbonOrder: Int32Array;
        };
    };
    emitParticle: (cl: any, opts?: {}) => any;
    setEffectTransform: (effectId: any, x: any, y: any, z: any, yaw?: number, vx?: number, vy?: number, vz?: number) => void;
    setQualityTier: (tier?: string) => void;
    getQualityTier: () => string;
    setDepthTexture: (depthTex: any, { near, far, width, height }?: {
        near?: number | undefined;
        far?: number | undefined;
        width?: number | undefined;
        height?: number | undefined;
    }) => void;
    setSceneTexture: (sceneTex: any, { width, height }?: {
        width?: number | undefined;
        height?: number | undefined;
    }) => void;
    hasActiveWarp: () => boolean;
    setWarpMeshesVisible: (visible: any) => void;
    update: (dt?: number) => void;
    reset: () => void;
    dispose: () => void;
    getStats: () => {
        qualityTier: string;
        compiledLayers: number;
        activeParticles: number;
        activeDrawCalls: number;
        warpActive: number;
    };
};
export const SHURIKEN_QUALITY_TIERS: Readonly<{
    high: Readonly<{
        emissionScale: 1;
        softParticles: true;
        warpScale: 1;
        skipSubEmitters: false;
    }>;
    med: Readonly<{
        emissionScale: 0.75;
        softParticles: false;
        warpScale: 0.5;
        skipSubEmitters: false;
    }>;
    low: Readonly<{
        emissionScale: 0.5;
        softParticles: false;
        warpScale: 0;
        skipSubEmitters: true;
    }>;
}>;
