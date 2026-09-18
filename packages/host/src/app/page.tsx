'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type ThemeMode = 'system' | 'light' | 'dark'
type LocaleCode = 'zh-Hans' | 'en'
type InfoTab = 'installation' | 'skill'

const I18N = {
  'zh-Hans': {
    title: 'Tacobin',
    tagline: '面向人类与 AI Agent 的单文件工作区协作空间',
    openHeader: '查看 Taco 空间',
    openHint: '输入或粘贴 Taco ID 或完整 URL，直接进入阅读与在线协作：',
    openPlaceholder: '输入 Taco ID (例如: 9d9528b6... 或完整 URL)',
    openButton: '进入',
    tabInstallation: '安装',
    tabSkill: 'Skill',
    copyTooltip: '复制',
    copiedTooltip: '已复制！',
    themeLabel: '切换主题',
    langLabel: '切换语言',
    githubLabel: '查看 Taco GitHub 源码仓库',
    systemTheme: '跟随系统',
    lightTheme: '明亮模式',
    darkTheme: '暗黑模式',
    agentSnippet: `你是工作在当前项目的 AI Agent。请遵循 Tacobin 协同与交付协议：
1. 本项目的成果与上下文统一沉淀为 Taco 单文件容器 (*.taco.html)。
2. 使用 taco-cli 独立命令行进行发布与审查，详细命令、帮助及离线技能可直接读取：taco-cli skills read taco
3. 发布到共享空间：taco-cli publish <path.taco.html> --host https://tacobin.arcadia-han.com
4. 实时订阅事件流：taco-cli subscribe <tacoId> --host https://tacobin.arcadia-han.com
5. 更多规范背景与自动化集成规则请参考仓库根目录核心文档：docs/agent-installation.md`,
    skillCommand: 'npx skills@latest add arcadia822/taco --skill=taco',
  },
  en: {
    title: 'Tacobin',
    tagline: 'Single-file workspace for humans and AI agents',
    openHeader: 'Open Taco Workspace',
    openHint: 'Enter or paste a Taco ID or URL to view and collaborate:',
    openPlaceholder: 'Enter Taco ID (e.g. 9d9528b6... or full URL)',
    openButton: 'Open',
    tabInstallation: 'Installation',
    tabSkill: 'Skill',
    copyTooltip: 'Copy',
    copiedTooltip: 'Copied!',
    themeLabel: 'Theme',
    langLabel: 'Language',
    githubLabel: 'View Taco on GitHub',
    systemTheme: 'System',
    lightTheme: 'Light',
    darkTheme: 'Dark',
    agentSnippet: `You are an AI Agent working in this repository. Follow the Tacobin delivery protocol:
1. Deliverables and context in this project are encapsulated in Taco containers (*.taco.html).
2. Use taco-cli to publish and review workspaces. For offline guidance and command reference, read: taco-cli skills read taco
3. Publish to shared space: taco-cli publish <path.taco.html> --host https://tacobin.arcadia-han.com
4. Subscribe to live events: taco-cli subscribe <tacoId> --host https://tacobin.arcadia-han.com
5. For installation and agent rules refer to: docs/agent-installation.md`,
    skillCommand: 'npx skills@latest add arcadia822/taco --skill=taco',
  },
}

export default function HomePage() {
  const router = useRouter()
  const [tacoIdInput, setTacoIdInput] = useState('')
  const [activeTab, setActiveTab] = useState<InfoTab>('installation')
  const [copiedText, setCopiedText] = useState(false)
  const [locale, setLocale] = useState<LocaleCode>('zh-Hans')
  const [themePreference, setThemePreference] = useState<ThemeMode>('system')
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [langMenuOpen, setLangMenuOpen] = useState(false)

  // Initialize theme and locale from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('taco-theme') as ThemeMode | null
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
      setThemePreference(savedTheme)
    }

    const savedLocale = localStorage.getItem('taco-locale')
    if (savedLocale === 'en' || savedLocale === 'zh-Hans') {
      setLocale(savedLocale)
    } else if (navigator.language.startsWith('en')) {
      setLocale('en')
    }
  }, [])

  // Apply appearance whenever themePreference changes
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const isDark = themePreference === 'system' ? media.matches : themePreference === 'dark'
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [themePreference])

  const t = I18N[locale]

  const handleOpenTaco = (e: React.FormEvent) => {
    e.preventDefault()
    const raw = tacoIdInput.trim()
    if (!raw) return
    const match = raw.match(/\/t\/([0-9a-f-]+)/i)
    const targetId = match ? match[1] : raw
    router.push(`/t/${targetId}`)
  }

  const switchTheme = (pref: ThemeMode) => {
    setThemePreference(pref)
    localStorage.setItem('taco-theme', pref)
    setThemeMenuOpen(false)
  }

  const switchLocale = (loc: LocaleCode) => {
    setLocale(loc)
    localStorage.setItem('taco-locale', loc)
    document.documentElement.lang = loc
    setLangMenuOpen(false)
  }

  const copyPayload = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedText(true)
      setTimeout(() => setCopiedText(false), 2000)
    })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        background: 'var(--paper)',
        color: 'var(--ink)',
      }}
    >
      {/* 顶部 Header：与 Taco 内容页 1:1 一致，包含 GitHub 链接 */}
      <header
        className="workspace-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '40px',
          minHeight: '40px',
          padding: '0 16px',
          gap: '8px',
          borderBottom: '1px solid var(--line)',
          background: 'transparent',
          position: 'relative',
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          onClick={() => router.push('/')}
        >
          <svg viewBox="0 0 24 24" style={{ width: '16px', height: '16px', display: 'block' }}>
            <circle cx="15.2" cy="8.8" r="4.8" fill="var(--brand-bubble-primary, #3ecf8e)" />
            <circle cx="7.2" cy="14.4" r="3.2" fill="var(--brand-bubble-secondary, #3b82f6)" />
            <circle cx="14.8" cy="18" r="2" fill="var(--brand-bubble-tertiary, #f97316)" />
          </svg>
          <strong style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '-0.01em' }}>Tacobin</strong>
        </div>

        <div style={{ flex: 1 }} />

        {/* GitHub 官方 Repo 图标链接 */}
        <a
          href="https://github.com/Arcadia822/taco"
          target="_blank"
          rel="noopener noreferrer"
          className="control-button control-button-icon"
          title={t.githubLabel}
          aria-label={t.githubLabel}
          style={{ textDecoration: 'none' }}
        >
          <svg className="ui-icon" viewBox="0 0 24 24" fill="currentColor">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            />
          </svg>
        </a>

        {/* 语言切换按钮 */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="control-button control-button-icon"
            title={t.langLabel}
            aria-label={t.langLabel}
            onClick={() => {
              setLangMenuOpen(!langMenuOpen)
              setThemeMenuOpen(false)
            }}
          >
            <svg
              className="ui-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18" />
              <path d="M12 3a15 15 0 0 1 0 18" />
              <path d="M12 3a15 15 0 0 0 0 18" />
            </svg>
          </button>

          {langMenuOpen && (
            <div className="topbar-popover language-menu" style={{ right: 0, top: '34px', position: 'absolute' }}>
              <button
                type="button"
                className={`popover-action sidebar-row ${locale === 'zh-Hans' ? 'is-active' : ''}`}
                onClick={() => switchLocale('zh-Hans')}
              >
                <span className="lang-badge">简</span>
                <span className="sidebar-row-label">简体中文</span>
              </button>
              <button
                type="button"
                className={`popover-action sidebar-row ${locale === 'en' ? 'is-active' : ''}`}
                onClick={() => switchLocale('en')}
              >
                <span className="lang-badge">EN</span>
                <span className="sidebar-row-label">English</span>
              </button>
            </div>
          )}
        </div>

        {/* 日夜模式切换按钮 */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="control-button control-button-icon theme-toggle"
            title={t.themeLabel}
            aria-label={t.themeLabel}
            onClick={() => {
              setThemeMenuOpen(!themeMenuOpen)
              setLangMenuOpen(false)
            }}
          >
            {themePreference === 'dark' ? (
              <svg
                className="ui-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z" />
              </svg>
            ) : themePreference === 'light' ? (
              <svg
                className="ui-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg
                className="ui-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
            )}
          </button>

          {themeMenuOpen && (
            <div className="topbar-popover theme-menu" style={{ right: 0, top: '34px', position: 'absolute' }}>
              <button
                type="button"
                className={`popover-action sidebar-row ${themePreference === 'system' ? 'is-active' : ''}`}
                onClick={() => switchTheme('system')}
              >
                <span className="sidebar-row-icon">
                  <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <rect width="20" height="14" x="2" y="3" rx="2" />
                    <line x1="8" x2="16" y1="21" y2="21" />
                    <line x1="12" x2="12" y1="17" y2="21" />
                  </svg>
                </span>
                <span className="sidebar-row-label">{t.systemTheme}</span>
              </button>
              <button
                type="button"
                className={`popover-action sidebar-row ${themePreference === 'light' ? 'is-active' : ''}`}
                onClick={() => switchTheme('light')}
              >
                <span className="sidebar-row-icon">
                  <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2m0 16v2M2 12h2m16 0h2" />
                  </svg>
                </span>
                <span className="sidebar-row-label">{t.lightTheme}</span>
              </button>
              <button
                type="button"
                className={`popover-action sidebar-row ${themePreference === 'dark' ? 'is-active' : ''}`}
                onClick={() => switchTheme('dark')}
              >
                <span className="sidebar-row-icon">
                  <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z" />
                  </svg>
                </span>
                <span className="sidebar-row-label">{t.darkTheme}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 主体区域：极简 Hero in land + 蓝丁胶质感居中布局 */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          maxWidth: '680px',
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        {/* 蓝丁气泡 Mark 质感图标 */}
        <div style={{ marginBottom: '20px', display: 'grid', placeItems: 'center' }}>
          <svg
            viewBox="0 0 24 24"
            style={{ width: '56px', height: '56px', filter: 'drop-shadow(0 12px 24px rgba(62,207,142,0.18))' }}
          >
            <circle cx="15.2" cy="8.8" r="4.8" fill="#3ecf8e" />
            <circle cx="7.2" cy="14.4" r="3.2" fill="#3b82f6" />
            <circle cx="14.8" cy="18" r="2" fill="#f97316" />
          </svg>
        </div>

        <h1
          style={{
            fontSize: '28px',
            fontWeight: 700,
            margin: '0 0 8px',
            letterSpacing: '-0.02em',
            textAlign: 'center',
          }}
        >
          {t.title}
        </h1>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--muted)',
            margin: '0 0 36px',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {t.tagline}
        </p>

        {/* 极简蓝丁胶质感输入框 */}
        <form onSubmit={handleOpenTaco} style={{ width: '100%', marginBottom: '40px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              background: 'var(--surface)',
              border: '1px solid var(--line-strong)',
              borderRadius: '999px',
              padding: '4px 6px 4px 16px',
              boxShadow: 'var(--shadow)',
              boxSizing: 'border-box',
              transition: 'border-color 160ms ease, box-shadow 160ms ease',
            }}
          >
            <span style={{ fontSize: '14px', color: 'var(--muted)', marginRight: '8px' }}>🔍</span>
            <input
              type="text"
              placeholder={t.openPlaceholder}
              value={tacoIdInput}
              onChange={(e) => setTacoIdInput(e.target.value)}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                color: 'var(--ink)',
                fontSize: '13px',
                outline: 'none',
                fontFamily: 'var(--mono)',
              }}
            />
            <button
              type="submit"
              style={{
                height: '32px',
                padding: '0 16px',
                borderRadius: '999px',
                border: 'none',
                background: 'var(--accent)',
                color: '#111',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 140ms ease',
              }}
            >
              {t.openButton}
            </button>
          </div>
        </form>

        {/* 外部独立选项卡 (Segmented Tab: 安装 vs Skill) */}
        <div style={{ width: '100%', marginBottom: '8px', paddingLeft: '2px', display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              setActiveTab('installation')
              setCopiedText(false)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px 0',
              fontSize: '12px',
              fontWeight: activeTab === 'installation' ? 700 : 500,
              color: activeTab === 'installation' ? 'var(--ink)' : 'var(--muted)',
              borderBottom: activeTab === 'installation' ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'color 140ms ease, border-color 140ms ease',
            }}
          >
            {t.tabInstallation}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('skill')
              setCopiedText(false)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px 0',
              fontSize: '12px',
              fontWeight: activeTab === 'skill' ? 700 : 500,
              color: activeTab === 'skill' ? 'var(--ink)' : 'var(--muted)',
              borderBottom: activeTab === 'skill' ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'color 140ms ease, border-color 140ms ease',
            }}
          >
            {t.tabSkill}
          </button>
        </div>

        {/* Soft 风格卡片内容 */}
        <div
          style={{
            width: '100%',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: '8px',
            padding: '10px 14px',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          {activeTab === 'installation' ? (
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                color: 'var(--muted)',
                lineHeight: 1.5,
                fontFamily: 'var(--sans)',
                flex: 1,
              }}
            >
              将 <code style={{ color: 'var(--ink)', background: 'var(--surface-2)', padding: '2px 4px', borderRadius: '4px' }}>docs/agent-installation.md</code> 挂载给 AI Agent 即可自动化生成、发布与协作 Taco 单文件工作区。
            </p>
          ) : (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <code
                style={{
                  display: 'block',
                  margin: 0,
                  fontSize: '12px',
                  color: 'var(--ink)',
                  fontFamily: 'var(--mono)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t.skillCommand}
              </code>
            </div>
          )}

          {/* 结尾单行 ghost icon 复制按钮 */}
          <button
            type="button"
            onClick={() => copyPayload(activeTab === 'installation' ? t.agentSnippet : t.skillCommand)}
            title={copiedText ? t.copiedTooltip : t.copyTooltip}
            aria-label={copiedText ? t.copiedTooltip : t.copyTooltip}
            className="control-button control-button-icon"
            style={{
              width: '24px',
              height: '24px',
              minWidth: '24px',
              minHeight: '24px',
              borderRadius: '4px',
              border: 'none',
              background: copiedText ? 'var(--accent-soft)' : 'transparent',
              color: copiedText ? 'var(--accent-dark)' : 'var(--muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background-color 140ms ease, color 140ms ease',
            }}
          >
            {copiedText ? (
              <svg viewBox="0 0 24 24" style={{ width: '14px', height: '14px', stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" style={{ width: '14px', height: '14px', stroke: 'currentColor', fill: 'none', strokeWidth: 1.75 }}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </main>
    </div>
  )
}
