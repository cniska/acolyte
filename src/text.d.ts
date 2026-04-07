declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.wasm" {
  const path: string;
  export default path;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
