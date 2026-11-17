/** @param {unknown} image */
export function retainScopedImage(image: unknown): void;
/**
 * Drop renderer copies immediately before the final scope closes the image.
 * The returned unsubscribe holds no reference to the image itself.
 * @param {object} image
 * @param {(image: object) => void} listener
 */
export function onScopedImageRelease(image: object, listener: (image: object) => void): (() => boolean) | null;
/** @param {unknown} image */
export function releaseScopedImage(image: unknown): void;
