/** Command-driven DOM presentation: no RAF, Canvas, or 2D physics needed. */
export function createDOMAdapter({ render }?: {}): {
    render: any;
    dispose(): void;
};
