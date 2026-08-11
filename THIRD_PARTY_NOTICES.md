# Third-party notices

Taco reuses and adapts portions of the Bento kernel and bento/spaces patterns:

- Project: Bento — the office suite that fits in a file
- Source: https://github.com/nyblnet/bento
- License: MIT
- Copyright: Copyright (c) 2026 The Bento authors

The reused portions include the single-file Vite configuration, pristine-shell
serialization technique, save-in-place/download fallback behavior, recovery
snapshots, and local version history. The current v0.2 surface uses the
single-file build pattern, direct file-title editing, generic two-level CRDT
engine, local and encrypted online collaboration transports, blind relay,
sharing capability model, and browser storage wrappers.
Adapted source files retain SPDX and copyright notices.

Taco bundles Tiptap and its Markdown extension for WYSIWYG editing with
bidirectional Markdown parsing and serialization:

- Project: Tiptap
- Source: https://github.com/ueberdosis/tiptap
- Version: 3.29.2
- License: MIT
- Copyright: Copyright (c) 2025, Tiptap GmbH

Taco uses Lowlight and Highlight.js grammars through Tiptap's
CodeBlockLowlight extension for editable syntax highlighting:

- Project: Lowlight
- Source: https://github.com/wooorm/lowlight
- Version: 3.3.0
- License: MIT

Taco optionally loads Mermaid from a pinned CDN URL when the active document
contains a Mermaid fence. Mermaid is a development dependency for validating
the bundled specification diagrams and is not embedded in Taco single-file artifacts:

- Project: Mermaid
- Source: https://github.com/mermaid-js/mermaid
- Version: 11.16.1
- License: MIT

Taco uses Lucide icons for its interface iconography:

- Project: Lucide
- Source: https://github.com/lucide-icons/lucide
- Version: 1.31.0
- License: ISC
- Copyright: Copyright (c) 2026 Lucide Icons and Contributors

The Taco product mark adapts the geometry of `mdi:chart-bubble`, splitting its
three bubbles into independently colored shapes:

- Project: Material Design Icons
- Source: https://pictogrammers.com/library/mdi/icon/chart-bubble/
- Version: 7.4.47
- License: Apache License 2.0

The Markdown typography and table-of-contents treatment are adapted from the
open-source Supabase Docs implementation while retaining Taco's own shell and
file sidebar:

- Project: Supabase Docs
- Source: https://github.com/supabase/supabase/tree/master/apps/docs
- License: Apache License 2.0

The Bento MIT license text is reproduced below:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
