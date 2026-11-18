export function createGpuFrameTimer(gl: any): {
    begin: () => boolean;
    end: () => void;
    poll: () => number | null;
    reset: () => void;
} | null;
