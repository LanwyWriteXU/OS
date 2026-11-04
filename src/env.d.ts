/// <reference types="vite/client" />

declare module '*.oml?raw' {
  const content: string;
  export default content;
}

declare module '*.osl?raw' {
  const content: string;
  export default content;
}
