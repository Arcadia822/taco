export const CLI_SCHEMA_HELP = 'taco-cli-help/1'
export const CLI_SCHEMA_SKILLS = 'taco-cli-skills/1'
export const CLI_BINARY_VERSION = '0.1.3'
export const DEFAULT_HOST = 'http://localhost:32167'

export interface HelpPositional {
  name: string
  type: string
  required: boolean
  description: string
}

export interface HelpOption {
  name: string
  type: string
  required: boolean
  default: unknown
  description: string
}

export interface HelpEnvironment {
  name: string
  default: string
  precedence: string
  description: string
}

export interface HelpError {
  code: string
  exitCode: number
  recovery: string
}

export interface HelpExample {
  invocation: string
  purpose: string
}

export interface CommandHelpOutput {
  schema: 'taco-cli-help/1'
  binaryVersion: string
  command: string[]
  summary: string
  positionals: HelpPositional[]
  options: HelpOption[]
  environment: HelpEnvironment[]
  output: {
    stdout: string
    stderr: string
    streaming: boolean
  }
  errors: HelpError[]
  examples: HelpExample[]
  commands?: Array<{ name: string; summary: string }>
  publicNotice?: string
  skills?: string[]
}

const GLOBAL_ENV: HelpEnvironment[] = [
  {
    name: 'TACO_HOST_URL',
    default: DEFAULT_HOST,
    precedence: '--host > TACO_HOST_URL > default',
    description: 'Target Host origin (HTTPS for remote, loopback HTTP permitted)',
  },
  {
    name: 'TACO_HOST_API_KEY',
    default: '',
    precedence: 'TACO_HOST_API_KEY > stored key for origin',
    description: 'Management ApiKey for Taco publication and administration',
  },
]

export const ROOT_HELP: CommandHelpOutput = {
  schema: CLI_SCHEMA_HELP,
  binaryVersion: CLI_BINARY_VERSION,
  command: [],
  summary: 'Taco CLI: publish, review, synchronize and export standalone Taco specifications',
  positionals: [],
  options: [
    {
      name: '--host',
      type: 'origin',
      required: false,
      default: DEFAULT_HOST,
      description: 'Host origin URL for remote operations',
    },
    {
      name: '--help',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Display offline JSON help for command',
    },
  ],
  environment: GLOBAL_ENV,
  output: {
    stdout: 'Single JSON object for commands; NDJSON for streams',
    stderr: 'Single line structured ErrorResponse on failure',
    streaming: false,
  },
  errors: [
    {
      code: 'VALIDATION_ERROR',
      exitCode: 2,
      recovery: 'Check parameters, file paths, or protocol schema',
    },
    {
      code: 'AUTH_ERROR',
      exitCode: 3,
      recovery: 'Provide valid ApiKey or verify host origin match',
    },
    { code: 'CONFLICT_ERROR', exitCode: 4, recovery: 'Base revision mismatch or closed Taco' },
  ],
  examples: [
    {
      invocation: 'taco-cli publish design.taco.html --dry-run',
      purpose: 'Preview upload bundle locally',
    },
    {
      invocation: 'taco-cli publish design.taco.html',
      purpose: 'Publish new Taco with automatic anonymous bootstrap',
    },
    { invocation: 'taco-cli subscribe <tacoId>', purpose: 'Stream realtime events from Taco' },
    {
      invocation: 'taco-cli skills read taco',
      purpose: 'Read the embedded post-install Agent workflow without network access',
    },
  ],
  commands: [
    { name: 'publish', summary: 'Publish new Taco and initial revision' },
    { name: 'update', summary: 'Publish new revision for existing Taco' },
    { name: 'subscribe', summary: 'Stream realtime events via WebSocket' },
    { name: 'events', summary: 'Page persistent event log' },
    { name: 'close', summary: 'Close Taco into read-only archived state' },
    { name: 'export', summary: 'Export complete Taco archive bundle' },
    { name: 'delete', summary: 'Mark Taco deleted' },
    { name: 'skills list', summary: 'List offline Agent guides embedded in this binary' },
    { name: 'skills read', summary: 'Read embedded installation, publishing, and review guidance' },
  ],
  publicNotice:
    'All published tacos, revisions, comments, and assets are public by default. No private or ACL switches.',
  skills: ['taco'],
}

export const COMMAND_HELPS: Record<string, CommandHelpOutput> = {
  publish: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['publish'],
    summary: 'Publish a new Taco and initial revision',
    positionals: [
      {
        name: 'file',
        type: 'path',
        required: true,
        description: 'Path to local .taco.html container file',
      },
    ],
    options: [
      {
        name: '--dry-run',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Perform local projection and size/security check without uploading',
      },
      {
        name: '--request-id',
        type: 'uuid',
        required: false,
        default: null,
        description: 'Explicit UUID idempotency key for recovery',
      },
      {
        name: '--host',
        type: 'origin',
        required: false,
        default: DEFAULT_HOST,
        description: 'Override target Host origin',
      },
    ],
    environment: GLOBAL_ENV,
    output: {
      stdout:
        'PublishResponse JSON object containing tacoId, revisionId, url, revisionUrl, contentHash',
      stderr: 'ErrorResponse JSON on failure',
      streaming: false,
    },
    errors: [
      {
        code: 'VALIDATION_ERROR',
        exitCode: 2,
        recovery: 'Verify HTML container validity or file path',
      },
      {
        code: 'IDEMPOTENCY_MISMATCH',
        exitCode: 4,
        recovery: 'Use distinct idempotency key or identical payload',
      },
      { code: 'PAYLOAD_TOO_LARGE', exitCode: 2, recovery: 'Ensure payload is within 32 MiB limit' },
    ],
    examples: [
      {
        invocation: 'taco-cli publish design.taco.html --dry-run',
        purpose: 'Preview projected payload locally',
      },
      { invocation: 'taco-cli publish design.taco.html', purpose: 'Publish new Taco' },
    ],
  },
  update: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['update'],
    summary: 'Publish a new revision for an existing Taco',
    positionals: [
      { name: 'tacoId', type: 'uuid', required: true, description: 'Target Taco UUID' },
      {
        name: 'file',
        type: 'path',
        required: true,
        description: 'Path to local .taco.html container file',
      },
    ],
    options: [
      {
        name: '--base',
        type: 'uuid',
        required: true,
        default: null,
        description: 'Base revision UUID expected to be currently active',
      },
      {
        name: '--dry-run',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Local projection check without uploading',
      },
      {
        name: '--request-id',
        type: 'uuid',
        required: false,
        default: null,
        description: 'Explicit UUID idempotency key',
      },
      {
        name: '--host',
        type: 'origin',
        required: false,
        default: DEFAULT_HOST,
        description: 'Target Host origin',
      },
    ],
    environment: GLOBAL_ENV,
    output: {
      stdout: 'PublishResponse JSON object for the new revision',
      stderr: 'ErrorResponse JSON on failure',
      streaming: false,
    },
    errors: [
      {
        code: 'REVISION_CONFLICT',
        exitCode: 4,
        recovery: 'Fetch current revision and re-base changes',
      },
      {
        code: 'TACO_CLOSED',
        exitCode: 4,
        recovery: 'Cannot update closed Taco; create new Taco instead',
      },
      {
        code: 'AUTH_FORBIDDEN',
        exitCode: 3,
        recovery: 'Must be owner of the Taco to publish revisions',
      },
    ],
    examples: [
      {
        invocation: 'taco-cli update <tacoId> design.taco.html --base <revisionId>',
        purpose: 'Publish revision onto specified base',
      },
    ],
  },
  subscribe: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['subscribe'],
    summary: 'Subscribe to persistent realtime events stream',
    positionals: [
      { name: 'tacoId', type: 'uuid', required: true, description: 'Target Taco UUID' },
    ],
    options: [
      {
        name: '--after',
        type: 'sequence',
        required: false,
        default: null,
        description: 'Exclusive cursor sequence string to resume from',
      },
      {
        name: '--host',
        type: 'origin',
        required: false,
        default: DEFAULT_HOST,
        description: 'Target Host origin',
      },
    ],
    environment: GLOBAL_ENV,
    output: {
      stdout: 'NDJSON stream of ready, event, and checkpoint frames',
      stderr: 'ErrorResponse or diagnostic frames',
      streaming: true,
    },
    errors: [
      { code: 'CURSOR_EXPIRED', exitCode: 6, recovery: 'Resume from earliest available sequence' },
      {
        code: 'TACO_CLOSED',
        exitCode: 4,
        recovery: 'Provide valid --after to read final events or export',
      },
    ],
    examples: [
      {
        invocation: 'taco-cli subscribe <tacoId>',
        purpose: 'Stream new events from live watermark',
      },
      {
        invocation: 'taco-cli subscribe <tacoId> --after 42',
        purpose: 'Replay events after 42 then stream live',
      },
    ],
  },
}
