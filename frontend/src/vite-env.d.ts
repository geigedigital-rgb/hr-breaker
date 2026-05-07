/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EMAIL_ASSET_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
