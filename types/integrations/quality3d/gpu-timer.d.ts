export function createGpuFrameTimer(gl: any, { alternate }?: {
    alternate?: boolean | undefined;
}): {
    begin: (tag?: null) => boolean;
    end: () => void;
    poll: (onSample?: null) => number | null;
    reset: () => void;
} | null;
