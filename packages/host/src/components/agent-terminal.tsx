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
  reviewTarget: string
  firstHit: string
  moreHits: string
  readTarget: string
  editedTarget: string
  editStats: string
  diffLine: string
  refreshCmd: string
  refreshOutput: string
  summary: string
  replay: string
}
interface AgentTerminalProps {
  run: AgentRun
  /** false: the finished transcript, shown at rest from the top; true: replay line by line. */
  animate: boolean
  done: boolean
  labels: AgentTerminalLabels
  onDone: () => void
  onReplay: () => void
}

// A Codex-style transcript: the pasted Taco handoff, then tool calls, then the agent's reply.
export function AgentTerminal({ run, animate, done, labels, onDone, onReplay }: AgentTerminalProps) {
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
        <span><b>• Read</b> {labels.reviewTarget}</span>
        <span className="agent-dim">  └ {labels.firstHit}</span>
        <span className="agent-dim">    {labels.moreHits}</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 500 : 0} className="agent-tool">
        <span><b>• Read</b> {labels.readTarget}</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 900 : 0} className="agent-tool">
        <span><b>• Edited</b> {labels.editedTarget} <span className="agent-add">{labels.editStats}</span> <span className="agent-del">−0)</span></span>
        <span className="agent-diff">  + {labels.diffLine}</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 700 : 0} className="agent-tool">
        <span><b>• Ran</b> {labels.refreshCmd}</span>
        <span className="agent-dim">  └ {labels.refreshOutput}</span>
      </AnimatedSpan>
      <AnimatedSpan delay={animate ? 500 : 0} className="agent-rule">─ Worked for 38s ─</AnimatedSpan>
      <AnimatedSpan className="agent-reply">{labels.summary}</AnimatedSpan>
    </Terminal>
  )
}
