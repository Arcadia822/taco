'use client'

// Adapted from Magic UI Terminal (MIT) — https://magicui.design/docs/components/terminal
// Changes: Tailwind classes replaced by plain CSS classes (see home.css `.mui-terminal*`).

import React, { Children, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useInView, type MotionProps } from 'motion/react'

interface SequenceContextValue {
  completeItem: (index: number) => void
  activeIndex: number
  sequenceStarted: boolean
}

const SequenceContext = createContext<SequenceContextValue | null>(null)
const ItemIndexContext = createContext<number | null>(null)

interface AnimatedSpanProps extends MotionProps {
  children: React.ReactNode
  delay?: number
  className?: string
  startOnView?: boolean
}

export const AnimatedSpan = ({ children, delay = 0, className, startOnView = false, ...props }: AnimatedSpanProps) => {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const isInView = useInView(elementRef as React.RefObject<Element>, { amount: 0.3, once: true })
  const sequence = useContext(SequenceContext)
  const itemIndex = useContext(ItemIndexContext)
  const [hasStarted, setHasStarted] = useState(false)

  useEffect(() => {
    if (!sequence || itemIndex === null || !sequence.sequenceStarted || hasStarted) return
    if (sequence.activeIndex === itemIndex) setHasStarted(true)
  }, [sequence, hasStarted, itemIndex])

  const shouldAnimate = sequence ? hasStarted : startOnView ? isInView : true
  // Lines waiting their turn take no space, so the transcript grows (and autoscrolls) line by line.
  if (sequence && !hasStarted) return null

  return (
    <motion.div
      ref={elementRef}
      initial={{ opacity: 0, y: -5 }}
      animate={shouldAnimate ? { opacity: 1, y: 0 } : { opacity: 0, y: -5 }}
      transition={{ duration: 0.3, delay: delay / 1000 }}
      className={className ? `mui-terminal__line ${className}` : 'mui-terminal__line'}
      onAnimationComplete={() => {
        // Only a line that actually played may advance the sequence; the initial hidden state must not.
        if (!sequence || itemIndex === null || !hasStarted) return
        sequence.completeItem(itemIndex)
      }}
      {...props}
    >
      {children}
    </motion.div>
  )
}

interface TypingAnimationProps extends Omit<MotionProps, 'children'> {
  children: string
  className?: string
  duration?: number
  delay?: number
  startOnView?: boolean
}

export const TypingAnimation = ({ children, className, duration = 60, delay = 0, startOnView = true, ...props }: TypingAnimationProps) => {
  const [displayedText, setDisplayedText] = useState('')
  const [started, setStarted] = useState(false)
  const elementRef = useRef<HTMLElement | null>(null)
  const isInView = useInView(elementRef as React.RefObject<Element>, { amount: 0.3, once: true })

  const sequence = useContext(SequenceContext)
  const itemIndex = useContext(ItemIndexContext)
  const hasSequence = sequence !== null
  const sequenceStarted = sequence?.sequenceStarted ?? false
  const sequenceActiveIndex = sequence?.activeIndex ?? null
  const completeRef = useRef<SequenceContextValue['completeItem'] | null>(null)
  const indexRef = useRef<number | null>(null)

  useEffect(() => {
    completeRef.current = sequence?.completeItem ?? null
    indexRef.current = itemIndex
  }, [sequence?.completeItem, itemIndex])

  useEffect(() => {
    let startTimeout: number | undefined
    if (hasSequence && itemIndex !== null) {
      if (sequenceStarted && !started && sequenceActiveIndex === itemIndex) setStarted(true)
    } else if (!startOnView || isInView) {
      startTimeout = window.setTimeout(() => setStarted(true), delay)
    }
    return () => window.clearTimeout(startTimeout)
  }, [delay, startOnView, isInView, started, hasSequence, sequenceActiveIndex, sequenceStarted, itemIndex])

  useEffect(() => {
    if (!started) return
    let i = 0
    const typingEffect = setInterval(() => {
      if (i < children.length) {
        setDisplayedText(children.substring(0, i + 1))
        i++
        return
      }
      clearInterval(typingEffect)
      const completeItem = completeRef.current
      const currentIndex = indexRef.current
      if (completeItem && currentIndex !== null) completeItem(currentIndex)
    }, duration)
    return () => clearInterval(typingEffect)
  }, [children, duration, started])

  return (
    <motion.span
      ref={elementRef}
      className={className ? `mui-terminal__line ${className}` : 'mui-terminal__line'}
      {...props}
    >
      {displayedText}
    </motion.span>
  )
}

interface TerminalProps {
  children: React.ReactNode
  title?: string
  className?: string
  sequence?: boolean
  startOnView?: boolean
  /** Fires once after the last sequenced line has finished animating. */
  onComplete?: () => void
  /** Pinned below the scrolling transcript (e.g. an input prompt). */
  footer?: React.ReactNode
}

export const Terminal = ({ children, title, className, sequence = true, startOnView = true, onComplete, footer }: TerminalProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLPreElement | null>(null)
  const isInView = useInView(containerRef as React.RefObject<Element>, { amount: 0.3, once: true })
  const [activeIndex, setActiveIndex] = useState(0)
  const sequenceHasStarted = sequence ? !startOnView || isInView : false
  const itemCount = Children.count(children)

  const contextValue = useMemo<SequenceContextValue | null>(() => {
    if (!sequence) return null
    return {
      completeItem: (index: number) => setActiveIndex((current) => (index === current ? current + 1 : current)),
      activeIndex,
      sequenceStarted: sequenceHasStarted,
    }
  }, [sequence, activeIndex, sequenceHasStarted])

  const completeRef = useRef(onComplete)
  completeRef.current = onComplete
  useEffect(() => {
    if (sequence && itemCount > 0 && activeIndex === itemCount) completeRef.current?.()
  }, [activeIndex, itemCount, sequence])

  // Follow the newest line while a sequence plays; a static transcript stays at the top.
  useEffect(() => {
    const body = bodyRef.current
    const transcript = body?.firstElementChild
    if (!sequence || !body || !transcript) return
    const observer = new ResizeObserver(() => { body.scrollTop = body.scrollHeight })
    observer.observe(transcript)
    return () => observer.disconnect()
  }, [sequence])

  const wrappedChildren = useMemo(() => {
    if (!sequence) return children
    return Children.toArray(children).map((child, index) => (
      <ItemIndexContext.Provider key={index} value={index}>
        {child as React.ReactNode}
      </ItemIndexContext.Provider>
    ))
  }, [children, sequence])

  const content = (
    <div ref={containerRef} className={className ? `mui-terminal ${className}` : 'mui-terminal'}>
      <div className="mui-terminal__bar">
        <span className="mui-terminal__dot" style={{ background: '#ef4444' }} />
        <span className="mui-terminal__dot" style={{ background: '#eab308' }} />
        <span className="mui-terminal__dot" style={{ background: '#22c55e' }} />
        {title ? <span className="mui-terminal__title">{title}</span> : null}
      </div>
      <pre ref={bodyRef} className="mui-terminal__body">
        <code className="mui-terminal__code">{wrappedChildren}</code>
      </pre>
      {footer}
    </div>
  )

  if (!sequence) return content
  return <SequenceContext.Provider value={contextValue}>{content}</SequenceContext.Provider>
}
