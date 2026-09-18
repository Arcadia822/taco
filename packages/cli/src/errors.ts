export interface CliErrorPayload {
  error: {
    code: string
    message: string
    retryable: boolean
    requestId: string
    details?: Record<string, unknown>
  }
}

export const makeCliError = (
  code: string,
  message: string,
  options?: { retryable?: boolean; requestId?: string; details?: Record<string, unknown> },
): CliErrorPayload => ({
  error: {
    code,
    message,
    retryable: options?.retryable ?? false,
    requestId: options?.requestId ?? `req_cli_${Math.random().toString(36).slice(2, 10)}`,
    ...(options?.details ? { details: options.details } : {}),
  },
})

export const EXIT_CODES = {
  OK: 0,
  LOCAL_IO_ERROR: 1,
  VALIDATION_ERROR: 2,
  AUTH_ERROR: 3,
  CONFLICT_ERROR: 4,
  NETWORK_TIMEOUT: 5,
  CURSOR_EXPIRED: 6,
  SIGINT: 130,
  SIGTERM: 143,
} as const
