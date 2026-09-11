declare module "./vendor/quickjs-loader.mjs" {
  const loader: (options?: Record<string, unknown>) => Promise<unknown>;
  export default loader;
}
