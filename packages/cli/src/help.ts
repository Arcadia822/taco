export const CLI_SCHEMA_HELP = 'taco-cli-help/1'
export const CLI_SCHEMA_SKILLS = 'taco-cli-skills/1'
import pkg from '../package.json' with { type: 'json' }
export const CLI_BINARY_VERSION: string = pkg.version
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
]

export const ROOT_HELP: CommandHelpOutput = {
  schema: CLI_SCHEMA_HELP,
  binaryVersion: CLI_BINARY_VERSION,
  command: [],
  summary: 'Taco CLI: publish, review, and synchronize standalone Taco specifications',
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
      code: 'LOCAL_IO_ERROR',
      exitCode: 1,
      recovery: 'Read the local .taco.html file and the Host response message',
    },
    {
      code: 'CONFLICT_ERROR',
      exitCode: 4,
      recovery: 'The subscribed Taco is closed; read the final events with events or --after',
    },
    {
      code: 'NETWORK_TIMEOUT',
      exitCode: 5,
      recovery: 'The Host stayed unreachable past the reconnect window; retry later',
    },
    {
      code: 'CURSOR_EXPIRED',
      exitCode: 6,
      recovery: 'Resume from the earliest sequence the Host still retains',
    },
  ],
  examples: [
    {
      invocation: 'taco-cli publish design.taco.html --dry-run',
      purpose: 'Preview upload bundle locally',
    },
    {
      invocation: 'taco-cli publish design.taco.html',
      purpose: 'Project the local bundle to pure taco/files data and POST it to the Host',
    },
    { invocation: 'taco-cli subscribe <tacoId>', purpose: 'Stream realtime events from Taco' },
    {
      invocation: 'taco-cli skills read taco',
      purpose: 'Read the embedded post-install Agent workflow without network access',
    },
  ],
  commands: [
    { name: 'publish', summary: 'Validate, project, and publish a local Taco to the Host' },
    {
      name: 'update',
      summary: 'Validate a replacement revision locally; network update is not implemented',
    },
    { name: 'subscribe', summary: 'Stream realtime events via Server-Sent Events' },
    { name: 'events', summary: 'Page the persistent event log' },
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
    summary: 'Validate, project, and publish a local Taco as a Host paste',
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
        description: 'Perform local projection and validation without reaching the network',
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
        'PublishResponse JSON object containing command, host, id, tacoId, title, blobUrl, url, createdAt',
      stderr: 'ErrorResponse JSON on failure',
      streaming: false,
    },
    errors: [
      {
        code: 'VALIDATION_ERROR',
        exitCode: 2,
        recovery: 'Verify HTML container validity, file path, or payload limit',
      },
      {
        code: 'LOCAL_IO_ERROR',
        exitCode: 1,
        recovery: 'Read the local file and the Host response message',
      },
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
    summary: 'Validate a replacement revision locally; network update is not implemented',
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
        description: 'Required: only the local projection check is implemented',
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
      stdout: 'Local projection summary for the proposed revision',
      stderr: 'ErrorResponse JSON on failure',
      streaming: false,
    },
    errors: [
      {
        code: 'VALIDATION_ERROR',
        exitCode: 2,
        recovery: 'Pass --dry-run; a network update is rejected as not implemented',
      },
    ],
    examples: [
      {
        invocation: 'taco-cli update <tacoId> design.taco.html --base <revisionId> --dry-run',
        purpose: 'Project the proposed revision locally against the stated base',
      },
    ],
  },
  subscribe: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['subscribe'],
    summary: 'Subscribe to the persistent realtime events stream over Server-Sent Events',
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
      stdout: 'NDJSON stream of ready and event frames',
      stderr: 'ErrorResponse or diagnostic frames',
      streaming: true,
    },
    errors: [
      {
        code: 'CURSOR_EXPIRED',
        exitCode: 6,
        recovery: 'Resume from the earliest sequence the Host still retains',
      },
      {
        code: 'TACO_CLOSED',
        exitCode: 4,
        recovery: 'Read the final events through events or an explicit --after cursor',
      },
      {
        code: 'NETWORK_TIMEOUT',
        exitCode: 5,
        recovery: 'The Host stayed unreachable past the reconnect window; retry later',
      },
    ],
    examples: [
      {
        invocation: 'taco-cli subscribe <tacoId>',
        purpose: 'Stream new events from the live watermark',
      },
      {
        invocation: 'taco-cli subscribe <tacoId> --after 42',
        purpose: 'Replay events after 42 then stream live',
      },
    ],
  },
  events: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['events'],
    summary: 'Page the persistent event log recorded for a Taco',
    positionals: [
      { name: 'tacoId', type: 'uuid', required: true, description: 'Target Taco UUID' },
    ],
    options: [
      {
        name: '--after',
        type: 'sequence',
        required: false,
        default: null,
        description: 'Exclusive cursor sequence string to page after',
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
      stdout: 'JSON object containing events, throughSequence, nextCursor, and hasMore',
      stderr: 'ErrorResponse JSON on failure',
      streaming: false,
    },
    errors: [
      {
        code: 'LOCAL_IO_ERROR',
        exitCode: 1,
        recovery: 'Read the Host response message; confirm the Taco UUID',
      },
    ],
    examples: [
      {
        invocation: 'taco-cli events <tacoId>',
        purpose: 'Read every recorded event for the Taco',
      },
    ],
  },
  skills: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['skills'],
    summary: 'List or read the Agent guides embedded in this binary, with no network access',
    positionals: [
      {
        name: 'action',
        type: 'list|read',
        required: true,
        description: 'list every embedded guide, or read one by id',
      },
      {
        name: 'skillId',
        type: 'id',
        required: false,
        default: null,
        description: 'Required by read; the embedded guide id, such as taco',
      },
      {
        name: 'path',
        type: 'path',
        required: false,
        default: 'SKILL.md',
        description: 'Required by read; a file inside the guide, such as references/publishing.md',
      },
    ],
    options: [],
    environment: [],
    output: {
      stdout: 'JSON object containing the requested guide listing or file body',
      stderr: 'ErrorResponse JSON on failure',
      streaming: false,
    },
    errors: [
      {
        code: 'VALIDATION_ERROR',
        exitCode: 2,
        recovery: 'Pass a known guide id and a path inside that guide',
      },
    ],
    examples: [
      { invocation: 'taco-cli skills list', purpose: 'List embedded guides' },
      {
        invocation: 'taco-cli skills read taco references/publishing.md',
        purpose: 'Read the publishing contract before publishing',
      },
    ],
  },
}
