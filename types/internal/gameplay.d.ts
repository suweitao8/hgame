/** Shared implementation helpers for the optional gameplay modules. */
export function finite(value: any, label: any): number;
export function nonNegative(value: any, label: any): any;
export function identifier(value: any, label?: string): string;
export function positiveInteger(value: any, label: any): any;
export function changes(input?: {}): any;
export function publisher(callback: any): {
    emit(event: any): void;
    subscribe(fn: any): () => boolean;
    clear(): void;
};
