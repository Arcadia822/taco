'use client'

import React from 'react'
import { AnimatedSpan, Terminal } from './terminal'

export interface AgentRun {
  id: number
  handoff: string
}

export interface AgentTerminalLabels {
  title: string
  defaultHandoff: string
  placeholder: string
  pasted: (lines: number) => string
  /** `taco comments` first hit, e.g. `[open] spec.md:5:32 > quote`, plus a "+N more" tail. */
  firstHit: string
  moreHits: string
  /** One added line from the data-model.mmd diff. */
  diffLine: string
  summary: string
  replay: string
}

interface AgentTerminalProps {
  run: AgentRun
  /** false: the finished transcript, shown at rest from the top; true: replay line by line. */
  animate: boolean
  done: boolean
  tacoFile: string
  labels: AgentTerminalLabels
  onDone: () => void
  onReplay: () => void
}

// A Codex-style transcript: the pasted Taco handoff, then tool calls, then the agent's reply.
export function AgentTerminal({ run, animate, done, tacoFile, labels, onDone, onReplay }: AgentTerminalProps) {
  const [firstLine] = run.handoff.split('\n')
  const lineCount = run.handoff.split('\n').length

  return (
    <Terminal
      key={animate ? run.id : 'at-rest'}
      title={labels.title}
      className="agent-terminal"
      sequence={animate}
      startOnView={false}
      onComplete={onDone}
      footer={
        <div className="agent-input">
          <span className="agent-input__caret">›</span>
          {done ? (
            <button type="button" className="agent-input__replay" onClick={onReplay}>
              ↺ {labels.replay}
            </button>
          ) : (
            <span className="agent-input__placeholder">{animate ? '' : labels.placeholder}</span>
          )}
        </div>
      }
    >
      <AnimatedSpan className="agent-banner">
        <span className="agent-banner__name">&gt;_ agent</span>
        <span className="agent-dim">model: default · cwd: ~/taco</span>
      </AnimatedSpan>
      <AnimatedSpan className="agent-user">
        <span>› {firstLine}</span>
        <span className="agent-dim">{labels.pasted(lineCount)}</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 700 : 0} className="agent-tool">
        <span><b>• Ran</b> taco comments {tacoFile} --status open</span>
        <span className="agent-dim">  └ {labels.firstHit}</span>
        <span className="agent-dim">    {labels.moreHits}</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 700 : 0} className="agent-tool">
        <span><b>• Read</b> spec.md, data-model.mmd</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 900 : 0} className="agent-tool">
        <span><b>• Edited</b> data-model.mmd <span className="agent-add">(+3</span> <span className="agent-del">−0)</span></span>
        <span className="agent-diff">  + {labels.diffLine}</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 600 : 0} className="agent-tool">
        <span><b>• Resolved</b> comment on spec.md:5</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 700 : 0} className="agent-tool">
        <span><b>• Ran</b> taco validate {tacoFile}</span>
        <span className="agent-dim">  └ Validated Taco runtime security 1: no issues.</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 500 : 0} className="agent-rule">─ Worked for 38s ─</AnimatedSpan>
      <AnimatedSpan className="agent-reply">{labels.summary}</AnimatedSpan>
    </Terminal>
  )
}
