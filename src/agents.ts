import type { AgentSpec } from './types'

/**
 * The whole registry. Discovery is limited to these paths on purpose:
 * no scanning of home, no guessing.
 *
 * Every path below was checked on a real Windows home (`ls ~`); entries that
 * could not be verified on a machine are marked as such.
 */
export const agents: AgentSpec[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bins: ['claude'],
    packages: ['@anthropic-ai/claude-code'],
    paths: [
      { path: '.claude', type: 'dir', kind: 'history' },
      // File, and it holds the OAuth account: never pruned.
      { path: '.claude.json', type: 'file', kind: 'credentials' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bins: ['codex'],
    packages: ['@openai/codex'],
    paths: [
      // Also contains auth.json; moving the directory is reversible.
      { path: '.codex', type: 'dir', kind: 'history' },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bins: ['gemini'],
    packages: ['@google/gemini-cli'],
    paths: [
      { path: '.gemini', type: 'dir', kind: 'history' },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    bins: ['cursor-agent'],
    paths: [
      { path: '.cursor', type: 'dir', kind: 'cache' },
    ],
    apps: {
      win32: ['%LOCALAPPDATA%/Programs/cursor'],
      darwin: ['/Applications/Cursor.app'],
    },
  },
  {
    id: 'aider',
    name: 'Aider',
    bins: ['aider'],
    pipx: ['aider-chat'],
    paths: [
      { path: '.aider.chat.history.md', type: 'file', kind: 'history' },
      { path: '.aider.input.history', type: 'file', kind: 'history' },
      { path: '.aider.conf.yml', type: 'file', kind: 'config' },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bins: ['opencode'],
    packages: ['opencode-ai'],
    paths: [
      { path: '.config/opencode', type: 'dir', kind: 'config' },
      { path: '.local/share/opencode', type: 'dir', kind: 'history' },
    ],
  },
]
