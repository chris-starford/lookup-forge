// Minimal stand-in for @types/react (not available offline). Used only for type-checking the UI in this sandbox.
declare module 'react' {
  export type ReactNode = any;
  export function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
  export function useState<T = undefined>(): [T | undefined, (v: T | undefined | ((prev: T | undefined) => T | undefined)) => void];
  export function useRef<T>(init: T): { current: T };
  export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: unknown[]): T;
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react-dom/client' { export function createRoot(el: Element): { render(node: any): void }; }
declare module '*.css';
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [name: string]: any }
  interface IntrinsicAttributes { key?: any }
}
