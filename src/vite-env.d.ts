/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __DEFAULT_LOCALE__: string
declare const __EMBEDDED_ASSETS__: Readonly<Record<string, string>>
declare const __HOSTED_BUILD__: boolean

interface Window {
  taco: import('./main.ts').TacoFileApi
}
