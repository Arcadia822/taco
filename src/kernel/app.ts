// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Adapted for Taco from Bento kernel/src/app.ts.

export interface AppConfig {
  appId: string
  appName: string
}

let config: AppConfig | null = null

export function configureApp(cfg: AppConfig): void {
  config = cfg
}

export function appConfig(): AppConfig {
  if (!config) throw new Error('taco kernel: configureApp() was never called')
  return config
}
