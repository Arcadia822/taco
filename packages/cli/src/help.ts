export const CLI_SCHEMA_HELP = 'taco-cli-help/1'
export const CLI_SCHEMA_SKILLS = 'taco-cli-skills/1'
import pkg from '../package.json' with { type: 'json' }
export const CLI_BINARY_VERSION: string = pkg.version
export const DEFAULT_HOST = 'https://taco.arcadia-han.com'

export interface HelpPositional {
  name: string
  type: string
  required: boolean
  default?: unknown
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
    { name: 'new', summary: 'Create an empty standalone Taco file with default Complete or Lite shell' },
    { name: 'init', summary: 'Initialize document structure from built-in template' },
    { name: 'pack', summary: 'Package local source directory into standalone .taco.html container' },
    { name: 'verify', summary: 'Verify integrity, safe paths, data block, and diagram diagnostics of a local Taco' },
    { name: 'refresh', summary: 'Refresh Taco artifact with received feedback and canonical directory source' },
    { name: 'diff', summary: 'Read-only comparison across Taco artifacts, canonical directory, and handoff reviews' },
    { name: 'inspect', summary: 'Inspect structure, files, comments, and checkpoints of a local Taco container' },
    { name: 'extract', summary: 'Extract credential-free projected files or directory from local Taco container' },
    { name: 'open', summary: 'Open local Taco file in system browser, optionally with feedback loopback listener' },
    { name: 'listen', summary: 'Start loopback HTTP listener and emit clickable URL for local review feedback' },
    { name: 'publish', summary: 'Validate, project, and publish a local Taco to the Host' },
    {
      name: 'update',
      summary: 'Publish a replacement revision for an existing Taco, preserving URL and comments',
    },
    { name: 'subscribe', summary: 'Stream realtime events via Server-Sent Events' },
    { name: 'events', summary: 'Page the persistent event log' },
    {
      name: 'handoff',
      summary: 'Retrieve full immutable handoff content by tacoId and handoffId',
    },
    { name: 'skills list', summary: 'List offline Agent guides embedded in this binary' },
    { name: 'skills read', summary: 'Read embedded installation, publishing, and review guidance' },
  ],
  publicNotice:
    'All published tacos, revisions, comments, and assets are public by default. No private or ACL switches.',
  skills: ['taco'],
}

export const COMMAND_HELPS: Record<string, CommandHelpOutput> = {
  new: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['new'],
    summary: 'Create an empty standalone Taco file with default Complete or Lite shell',
    positionals: [
      { name: 'path', type: 'path', required: true, description: 'Destination path ending in .taco.html' },
    ],
    options: [
      { name: '--title', type: 'string', required: false, default: null, description: 'Document title' },
      { name: '--lite', type: 'boolean', required: false, default: false, description: 'Use lightweight CDN-backed shell instead of complete offline shell' },
    ],
    environment: [],
    output: { stdout: 'JSON summary of created file', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'VALIDATION_ERROR', exitCode: 2, recovery: 'Provide valid .taco.html target path' },
      { code: 'CONFLICT_ERROR', exitCode: 4, recovery: 'Target already exists; choose a new path' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check filesystem permissions' },
    ],
    examples: [
      { invocation: 'taco-cli new Design_Spec.taco.html --title "Design Spec"', purpose: 'Create empty Taco spec' },
    ],
  },
  init: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['init'],
    summary: 'Initialize document structure from built-in template',
    positionals: [
      { name: 'target', type: 'path', required: false, description: 'Destination path or directory' },
    ],
    options: [
      { name: '--template', type: 'string', required: false, default: 'spec', description: 'Template type (spec, architecture, api-reference, adr, prd, interaction)' },
      { name: '--title', type: 'string', required: false, default: null, description: 'Document title' },
      { name: '--lite', type: 'boolean', required: false, default: false, description: 'Use lite shell' },
      { name: '--list-templates', type: 'boolean', required: false, default: false, description: 'List available templates' },
    ],
    environment: [],
    output: { stdout: 'JSON summary of initialized files', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'VALIDATION_ERROR', exitCode: 2, recovery: 'Provide valid template name' },
      { code: 'CONFLICT_ERROR', exitCode: 4, recovery: 'Target already exists' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check filesystem permissions' },
    ],
    examples: [
      { invocation: 'taco-cli init docs/my-spec --template spec', purpose: 'Initialize spec template in directory' },
    ],
  },
  pack: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['pack'],
    summary: 'Package local source directory into standalone .taco.html container',
    positionals: [
      { name: 'dir', type: 'path', required: true, description: 'Source document directory' },
    ],
    options: [
      { name: '--out', type: 'path', required: false, default: null, description: 'Output .taco.html file path' },
      { name: '--title', type: 'string', required: false, default: null, description: 'Document title' },
      { name: '--entry', type: 'path', required: false, default: null, description: 'Initial file opened' },
      { name: '--root', type: 'path', required: false, default: null, description: 'Bundle root relative path' },
      { name: '--group', type: 'string', required: false, default: null, description: 'Sidebar group definition' },
      { name: '--ignore', type: 'glob', required: false, default: null, description: 'Patterns to ignore' },
      { name: '--lite', type: 'boolean', required: false, default: false, description: 'Use lite shell' },
      { name: '--dry-run', type: 'boolean', required: false, default: false, description: 'Preview output without writing' },
    ],
    environment: [],
    output: { stdout: 'JSON summary of packed container', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'VALIDATION_ERROR', exitCode: 2, recovery: 'Check paths, entries, or groups' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check filesystem permissions or source files' },
    ],
    examples: [
      { invocation: 'taco-cli pack docs/ --title Spec --out Spec.taco.html', purpose: 'Package documentation into Taco' },
    ],
  },
  verify: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['verify'],
    summary: 'Verify integrity, safe paths, data block, and diagram diagnostics of a local Taco',
    positionals: [
      { name: 'file', type: 'path', required: true, description: 'Path to .taco.html file' },
    ],
    options: [],
    environment: [],
    output: { stdout: 'JSON verification results', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'VALIDATION_ERROR', exitCode: 2, recovery: 'Fix invalid bundle structure or diagram syntax' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check file path and read access' },
    ],
    examples: [
      { invocation: 'taco-cli verify spec.taco.html', purpose: 'Verify Taco document integrity' },
    ],
  },
  refresh: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['refresh'],
    summary: 'Refresh Taco artifact with received feedback and canonical directory source',
    positionals: [
      { name: 'file', type: 'path', required: true, description: 'Path to original .taco.html file' },
    ],
    options: [
      { name: '--handoff', type: 'path', required: true, default: null, description: 'Path to handoff receipt file or - for stdin' },
      { name: '--dir', type: 'path', required: false, default: null, description: 'Canonical source directory' },
      { name: '--dry-run', type: 'boolean', required: false, default: false, description: 'Preview refresh without writing' },
    ],
    environment: [],
    output: { stdout: 'JSON summary of refreshed container', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'CONFLICT_ERROR', exitCode: 4, recovery: 'Resolve pending or conflicting edits in canonical source before refresh' },
      { code: 'VALIDATION_ERROR', exitCode: 2, recovery: 'Check handoff payload and baseline match' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check filesystem permissions' },
    ],
    examples: [
      { invocation: 'taco-cli refresh spec.taco.html --dir docs/ --handoff receipt.json', purpose: 'Refresh spec with review feedback' },
    ],
  },
  diff: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['diff'],
    summary: 'Read-only comparison across Taco artifacts, canonical directory, and handoff reviews',
    positionals: [
      { name: 'source', type: 'path', required: true, description: 'Source .taco.html or canonical directory' },
      { name: 'target', type: 'path', required: false, description: 'Target .taco.html file' },
    ],
    options: [
      { name: '--dir', type: 'path', required: false, default: null, description: 'Canonical directory to compare against' },
      { name: '--handoff', type: 'path', required: false, default: null, description: 'Handoff receipt file to compare against' },
    ],
    environment: [],
    output: { stdout: 'JSON structured difference report', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'VALIDATION_ERROR', exitCode: 2, recovery: 'Check comparison target arguments' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check file paths and read access' },
    ],
    examples: [
      { invocation: 'taco-cli diff spec.taco.html --dir docs/', purpose: 'Compare Taco against source directory' },
    ],
  },
  inspect: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['inspect'],
    summary: 'Inspect structure, files, comments, and checkpoints of a local Taco container',
    positionals: [
      { name: 'file', type: 'path', required: true, description: 'Path to .taco.html file' },
    ],
    options: [
      { name: '--credentials', type: 'boolean', required: false, default: false, description: 'Scan for embedded collaboration tokens without printing secrets' },
    ],
    environment: [],
    output: { stdout: 'JSON summary of Taco structure', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'VALIDATION_ERROR', exitCode: 2, recovery: 'Check file integrity' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check file path' },
    ],
    examples: [
      { invocation: 'taco-cli inspect spec.taco.html --credentials', purpose: 'Inspect Taco structure and credentials' },
    ],
  },
  extract: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['extract'],
    summary: 'Extract credential-free projected files or directory from local Taco container',
    positionals: [
      { name: 'file', type: 'path', required: true, description: 'Path to .taco.html file' },
    ],
    options: [
      { name: '--out-dir', type: 'path', required: false, default: null, description: 'Directory to extract files into' },
      { name: '--files', type: 'string', required: false, default: null, description: 'Comma-separated file paths to extract' },
      { name: '--dry-run', type: 'boolean', required: false, default: false, description: 'Preview extraction without writing' },
    ],
    environment: [],
    output: { stdout: 'JSON summary of extracted files', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'VALIDATION_ERROR', exitCode: 2, recovery: 'Check safe path boundaries and symlinks' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check filesystem permissions' },
      { code: 'CONFLICT_ERROR', exitCode: 4, recovery: 'Choose an output directory without existing target files' },
    ],
    examples: [
      { invocation: 'taco-cli extract spec.taco.html --out-dir extracted/', purpose: 'Safely extract files from Taco' },
    ],
  },
  open: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['open'],
    summary: 'Open local Taco file in system browser, optionally with feedback loopback listener',
    positionals: [
      { name: 'file', type: 'path', required: true, description: 'Path to .taco.html file' },
    ],
    options: [
      { name: '--listen', type: 'boolean', required: false, default: false, description: 'Start loopback listener for human review feedback' },
      { name: '--port', type: 'number', required: false, default: 0, description: 'Specific port for loopback HTTP listener' },
      { name: '--timeout', type: 'seconds', required: false, default: 300, description: 'Listener timeout in seconds' },
      { name: '--no-open', type: 'boolean', required: false, default: false, description: 'Do not automatically launch system browser' },
    ],
    environment: [],
    output: { stdout: 'Single JSON object or NDJSON stream if listening', stderr: 'ErrorResponse JSON on failure', streaming: false },
    errors: [
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check file path and browser launch capability' },
    ],
    examples: [
      { invocation: 'taco-cli open spec.taco.html --listen', purpose: 'Open Taco and listen for review feedback' },
    ],
  },
  listen: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['listen'],
    summary: 'Start loopback HTTP listener and emit clickable URL for local review feedback',
    positionals: [
      { name: 'file', type: 'path', required: true, description: 'Path to .taco.html file' },
    ],
    options: [
      { name: '--port', type: 'number', required: false, default: 0, description: 'Specific port for loopback HTTP listener' },
      { name: '--timeout', type: 'seconds', required: false, default: 300, description: 'Listener timeout in seconds' },
      { name: '--no-open', type: 'boolean', required: false, default: true, description: 'Do not launch system browser' },
    ],
    environment: [],
    output: { stdout: 'NDJSON stream of ready event and delivery receipt', stderr: 'ErrorResponse JSON on failure', streaming: true },
    errors: [
      { code: 'NETWORK_TIMEOUT', exitCode: 5, recovery: 'Listener timed out before review submission' },
      { code: 'CONFLICT_ERROR', exitCode: 4, recovery: 'Another listener is already running on this artifact' },
      { code: 'LOCAL_IO_ERROR', exitCode: 1, recovery: 'Check file path or port availability' },
    ],
    examples: [
      { invocation: 'taco-cli listen spec.taco.html --no-open', purpose: 'Start headless review feedback listener' },
    ],
  },
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
      {
        name: '--ttl',
        type: 'duration',
        required: false,
        default: '30d',
        description: 'Expiration duration before public access is lost (e.g. 1h, 7d, 30d, max 365d, or 0/none for permanent; expires public access, not physical deletion)',
      },
    ],
    environment: GLOBAL_ENV,
    output: {
      stdout:
        'PublishResponse JSON object containing command, host, id, tacoId, title, blobUrl, url, createdAt, expiresAt',
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
      { invocation: 'taco-cli publish design.taco.html --ttl 7d', purpose: 'Publish new Taco with 7-day expiration' },
    ],
  },
  update: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['update'],
    summary: 'Publish a replacement revision for an existing Taco, preserving URL and comments',
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
        required: false,
        default: null,
        description: 'Expected active revision UUID; defaults to the current revision fetched from the Host',
      },
      {
        name: '--dry-run',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Preview the projected revision payload locally without network access',
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
      stdout: 'Single JSON object containing the revision receipt (or projection summary on dry-run)',
      stderr: 'ErrorResponse JSON on failure',
      streaming: false,
    },
    errors: [
      {
        code: 'VALIDATION_ERROR',
        exitCode: 2,
        recovery: 'Check tacoId, file path, or --base revisionId UUID parameter',
      },
      {
        code: 'LOCAL_IO_ERROR',
        exitCode: 1,
        recovery: 'Verify local file exists and Host is reachable',
      },
      {
        code: 'CONFLICT_ERROR',
        exitCode: 4,
        recovery: 'The specified --base revision is stale or state version conflicted; pull latest state',
      },
      {
        code: 'TACO_GONE',
        exitCode: 2,
        recovery: 'The Taco has expired or was deleted',
      },
    ],
    examples: [
      {
        invocation: 'taco-cli update <tacoId> design.taco.html',
        purpose: 'Publish a replacement revision to the existing Taco URL',
      },
      {
        invocation: 'taco-cli update <tacoId> design.taco.html --dry-run',
        purpose: 'Project the proposed revision locally without network access',
      },
      {
        invocation: 'taco-cli update <tacoId> design.taco.html --base <revisionId>',
        purpose: 'Require a specific active revision when publishing the replacement',
      },
    ],
  },
  subscribe: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['subscribe'],
    summary:
      'Subscribe to Taco review events over Server-Sent Events (default: waits for handoff then exits)',
    positionals: [
      { name: 'tacoId', type: 'uuid', required: true, description: 'Target Taco UUID' },
    ],
    options: [
      {
        name: '--stream',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Stream all realtime events continuously (comment, file, handoff) without exiting on handoff (alias: --follow)',
      },
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
      {
        name: '--harness',
        type: 'string',
        required: false,
        default: null,
        description: 'Self-reported harness name: codex, claude-code, github-copilot, cursor, agy, pi, omp, openclaw, hermes, opencode, gemini-cli, other',
      },
      {
        name: '--model',
        type: 'string',
        required: false,
        default: null,
        description: 'Self-reported model family name: gpt, claude, gemini, other',
      },
      {
        name: '--model-id',
        type: 'string',
        required: false,
        default: null,
        description: 'Detailed model identifier (1-128 characters)',
      },
      {
        name: '--name',
        type: 'string',
        required: false,
        default: null,
        description: 'Self-reported display name for presence (1-64 characters)',
      },
      {
        name: '--session',
        type: 'string',
        required: false,
        default: null,
        description: 'Self-reported session title for presence (1-256 characters)',
      },
      {
        name: '--listener-id',
        type: 'uuid',
        required: false,
        default: null,
        description: 'Optional stable listener UUID (auto-generated if omitted)',
      },
    ],
    environment: GLOBAL_ENV,
    output: {
      stdout: 'NDJSON ready frame followed by review.handed_off frame (or full stream if --stream is given)',
      stderr: 'ErrorResponse or diagnostic frames',
      streaming: true,
    },
    errors: [
      {
        code: 'TACO_GONE',
        exitCode: 2,
        recovery: 'The Taco has expired or was deleted',
      },
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
      {
        code: 'VALIDATION_ERROR',
        exitCode: 2,
        recovery: 'Check parameter syntax, e.g. valid enum for --harness/--model or string length',
      },
    ],
    examples: [
      {
        invocation: 'taco-cli subscribe <tacoId>',
        purpose: 'Wait for the reviewer to click Handoff, output the handoff event, and exit cleanly with code 0',
      },
      {
        invocation: 'taco-cli subscribe <tacoId> --stream',
        purpose: 'Continuously stream all events (comments, status, handoff) without exiting',
      },
      {
        invocation: 'taco-cli subscribe <tacoId> --after 42',
        purpose: 'Wait for handoff occurring after sequence 42 then exit',
      },
      {
        invocation:
          'taco-cli subscribe <tacoId> --harness codex --model gpt --model-id gpt-5 --name "Agent"',
        purpose: 'Wait for handoff while self-reporting harness, model, and display name',
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
        name: '--through',
        type: 'sequence',
        required: false,
        default: null,
        description: 'Inclusive upper sequence bound for stable pagination',
      },
      {
        name: '--limit',
        type: 'integer',
        required: false,
        default: 100,
        description: 'Maximum events per page, from 1 to 500',
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
        code: 'TACO_GONE',
        exitCode: 2,
        recovery: 'The Taco has expired or was deleted',
      },
      {
        code: 'CURSOR_EXPIRED',
        exitCode: 6,
        recovery: 'Resume from the earliest sequence the Host still retains',
      },
      {
        code: 'VALIDATION_ERROR',
        exitCode: 2,
        recovery: 'Check parameter syntax, e.g. --after cursor must be a non-negative integer string',
      },
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
  handoff: {
    schema: CLI_SCHEMA_HELP,
    binaryVersion: CLI_BINARY_VERSION,
    command: ['handoff'],
    summary: 'Retrieve full immutable handoff content by tacoId and handoffId',
    positionals: [
      { name: 'tacoId', type: 'uuid', required: true, description: 'Target Taco UUID' },
      { name: 'handoffId', type: 'uuid', required: true, description: 'Target Handoff UUID' },
    ],
    options: [
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
      stdout: 'JSON object containing full immutable HandoffRecord',
      stderr: 'ErrorResponse JSON on failure',
      streaming: false,
    },
    errors: [
      {
        code: 'VALIDATION_ERROR',
        exitCode: 2,
        recovery: 'Provide valid tacoId and handoffId arguments',
      },
      {
        code: 'TACO_GONE',
        exitCode: 2,
        recovery: 'The Taco has expired or was deleted',
      },
      {
        code: 'CURSOR_EXPIRED',
        exitCode: 6,
        recovery: 'The event cursor is no longer retained; resume from the earliest sequence',
      },
      {
        code: 'LOCAL_IO_ERROR',
        exitCode: 1,
        recovery: 'Check Host connectivity or error response',
      },
    ],
    examples: [
      {
        invocation: 'taco-cli handoff <tacoId> <handoffId>',
        purpose: 'Fetch immutable handoff snapshot containing file diffs, checkpoints, and comments',
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
