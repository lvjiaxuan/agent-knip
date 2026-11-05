import type { AgentSpec } from './types'

// One-time inventory: vercel-labs/skills src/agents.ts at 7ae8e2c63a163fcade6dd36f4223d37befa9b6f9 (2026-11-05).
// Keep local IDs claude/gemini for upstream claude-code/gemini-cli; all entries are maintained here.
/** Data locations are not install evidence; platforms only limit where a path applies. */
export const agents: AgentSpec[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bins: ['claude'],
    packages: ['@anthropic-ai/claude-code'],
    locations: [
      {
        role: 'data',
        path: '.claude',
        env: 'CLAUDE_CONFIG_DIR',
        type: 'dir',
        kind: 'history',
        protectedFiles: ['.credentials.json'],
      },
      {
        role: 'data',
        path: '.claude.json',
        type: 'file',
        kind: 'credentials',
      },
    ],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bins: ['codex'],
    packages: ['@openai/codex'],
    locations: [
      {
        role: 'data',
        path: '.codex',
        env: 'CODEX_HOME',
        type: 'dir',
        kind: 'history',
        protectedFiles: ['auth.json'],
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bins: ['gemini'],
    packages: ['@google/gemini-cli'],
    locations: [
      {
        role: 'data',
        path: '.gemini',
        type: 'dir',
        kind: 'history',
        protectedFiles: ['oauth_creds.json', 'google_accounts.json'],
      },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    bins: ['cursor-agent', 'cursor'],
    locations: [
      {
        role: 'data',
        path: '.cursor',
        type: 'dir',
        kind: 'cache',
      },
      {
        role: 'install',
        path: 'Programs/cursor',
        base: 'LOCALAPPDATA',
        type: 'dir',
        kind: 'config',
        platforms: ['win32'],
      },
      {
        role: 'install',
        path: 'Cursor.app',
        base: 'APPLICATIONS',
        type: 'dir',
        kind: 'config',
        platforms: ['darwin'],
      },
    ],
  },
  {
    id: 'aider',
    name: 'Aider',
    bins: ['aider'],
    pipx: ['aider-chat'],
    locations: [
      {
        role: 'data',
        path: '.aider.chat.history.md',
        type: 'file',
        kind: 'history',
      },
      {
        role: 'data',
        path: '.aider.input.history',
        type: 'file',
        kind: 'history',
      },
      {
        role: 'data',
        path: '.aider.conf.yml',
        type: 'file',
        kind: 'config',
      },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bins: ['opencode'],
    packages: ['opencode-ai'],
    locations: [
      {
        role: 'data',
        path: 'opencode',
        base: 'XDG_CONFIG_HOME',
        type: 'dir',
        kind: 'config',
      },
      {
        role: 'data',
        path: '.local/share/opencode',
        type: 'dir',
        kind: 'history',
      },
    ],
  },
  {
    id: 'zed',
    name: 'Zed',
    bins: ['zed'],
    locations: [
      {
        role: 'data',
        path: 'zed',
        base: 'XDG_CONFIG_HOME',
        type: 'dir',
        kind: 'config',
        platforms: ['linux', 'darwin'],
      },
      {
        role: 'data',
        path: 'Zed',
        base: 'APPDATA',
        type: 'dir',
        kind: 'config',
        platforms: ['win32'],
      },
      // Local Zed data includes conversations/databases, not only disposable caches.
      {
        role: 'data',
        path: 'Zed',
        base: 'LOCALAPPDATA',
        type: 'dir',
        kind: 'history',
        platforms: ['win32'],
      },
      {
        role: 'data',
        path: 'zed',
        base: 'FLATPAK_XDG_CONFIG_HOME',
        type: 'dir',
        kind: 'config',
        platforms: ['linux'],
      },
      {
        role: 'install',
        path: 'Programs/Zed',
        base: 'LOCALAPPDATA',
        type: 'dir',
        kind: 'config',
        platforms: ['win32'],
      },
      {
        role: 'install',
        path: 'Zed',
        base: 'PROGRAMFILES',
        type: 'dir',
        kind: 'config',
        platforms: ['win32'],
      },
      {
        role: 'install',
        path: 'Zed',
        base: 'PROGRAMFILES_X86',
        type: 'dir',
        kind: 'config',
        platforms: ['win32'],
      },
      {
        role: 'install',
        path: 'Zed.app',
        base: 'APPLICATIONS',
        type: 'dir',
        kind: 'config',
        platforms: ['darwin'],
      },
    ],
  },
  {
    id: 'adal',
    name: 'AdaL',
    locations: [
      {
        role: 'data',
        path: '.adal',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'aider-desk',
    name: 'AiderDesk',
    locations: [
      {
        role: 'data',
        path: '.aider-desk',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'amp',
    name: 'Amp',
    locations: [
      {
        role: 'data',
        path: '.config/amp',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    locations: [
      {
        role: 'data',
        path: '.gemini/antigravity',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'antigravity-cli',
    name: 'Antigravity CLI',
    locations: [
      {
        role: 'data',
        path: '.gemini/antigravity-cli',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'astrbot',
    name: 'AstrBot',
    locations: [
      {
        role: 'data',
        path: '.astrbot',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'augment',
    name: 'Augment',
    locations: [
      {
        role: 'data',
        path: '.augment',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'autohand-code',
    name: 'Autohand Code CLI',
    locations: [
      {
        role: 'data',
        path: '.autohand',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'bob',
    name: 'IBM Bob',
    locations: [
      {
        role: 'data',
        path: '.bob',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'cline',
    name: 'Cline',
    locations: [
      {
        role: 'data',
        path: '.cline',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'codearts-agent',
    name: 'CodeArts Agent',
    locations: [
      {
        role: 'data',
        path: '.codeartsdoer',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    locations: [
      {
        role: 'data',
        path: '.codebuddy',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'codemaker',
    name: 'Codemaker',
    locations: [
      {
        role: 'data',
        path: '.codemaker',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'codestudio',
    name: 'Code Studio',
    locations: [
      {
        role: 'data',
        path: '.codestudio',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'command-code',
    name: 'Command Code',
    locations: [
      {
        role: 'data',
        path: '.commandcode',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'continue',
    name: 'Continue',
    locations: [
      {
        role: 'data',
        path: '.continue',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'cortex',
    name: 'Cortex Code',
    locations: [
      {
        role: 'data',
        path: '.snowflake/cortex',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'crush',
    name: 'Crush',
    locations: [
      {
        role: 'data',
        path: '.config/crush',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'deepagents',
    name: 'Deep Agents',
    locations: [
      {
        role: 'data',
        path: '.deepagents',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'devin',
    name: 'Devin for Terminal',
    locations: [
      {
        role: 'data',
        path: '.config/devin',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'dexto',
    name: 'Dexto',
    locations: [
      {
        role: 'data',
        path: '.dexto',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'droid',
    name: 'Droid',
    locations: [
      {
        role: 'data',
        path: '.factory',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'firebender',
    name: 'Firebender',
    locations: [
      {
        role: 'data',
        path: '.firebender',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'forgecode',
    name: 'ForgeCode',
    locations: [
      {
        role: 'data',
        path: '.forge',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'fx',
    name: 'fx',
    locations: [
      {
        role: 'data',
        path: '.fx',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    locations: [
      {
        role: 'data',
        path: '.copilot',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'goose',
    name: 'Goose',
    locations: [
      {
        role: 'data',
        path: '.config/goose',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'grok',
    name: 'Grok Build',
    locations: [
      {
        role: 'data',
        path: '.grok',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'hermes-agent',
    name: 'Hermes Agent',
    locations: [
      {
        role: 'data',
        path: '.hermes',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'iflow-cli',
    name: 'iFlow CLI',
    locations: [
      {
        role: 'data',
        path: '.iflow',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'inference-sh',
    name: 'inference.sh',
    locations: [
      {
        role: 'data',
        path: '.inferencesh',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'jazz',
    name: 'Jazz',
    locations: [
      {
        role: 'data',
        path: '.jazz',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'junie',
    name: 'Junie',
    locations: [
      {
        role: 'data',
        path: '.junie',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'kilo',
    name: 'Kilo Code',
    locations: [
      {
        role: 'data',
        path: '.kilo',
        type: 'dir',
        kind: 'config',
      },
      {
        role: 'data',
        path: '.kilocode',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'kimchi',
    name: 'Kimchi',
    locations: [
      {
        role: 'data',
        path: '.config/kimchi',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'kimi-code-cli',
    name: 'Kimi Code CLI',
    locations: [
      {
        role: 'data',
        path: '.kimi-code',
        type: 'dir',
        kind: 'config',
      },
      {
        role: 'data',
        path: '.kimi',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'kiro-cli',
    name: 'Kiro CLI',
    locations: [
      {
        role: 'data',
        path: '.kiro',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'kode',
    name: 'Kode',
    locations: [
      {
        role: 'data',
        path: '.kode',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'lingma',
    name: 'Lingma',
    locations: [
      {
        role: 'data',
        path: '.lingma',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'loaf',
    name: 'Loaf',
    locations: [
      {
        role: 'data',
        path: '.loaf',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'mcpjam',
    name: 'MCPJam',
    locations: [
      {
        role: 'data',
        path: '.mcpjam',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'minimax-code',
    name: 'MiniMax Code',
    locations: [
      {
        role: 'data',
        path: '.minimax',
        type: 'dir',
        kind: 'config',
      },
      {
        role: 'install',
        base: 'APPLICATIONS',
        path: 'MiniMax Code.app',
        type: 'dir',
        kind: 'config',
        platforms: ['darwin'],
      },
    ],
  },
  {
    id: 'mistral-vibe',
    name: 'Mistral Vibe',
    locations: [
      {
        role: 'data',
        path: '.vibe',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'moxby',
    name: 'Moxby',
    locations: [
      {
        role: 'data',
        path: '.moxby',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'mux',
    name: 'Mux',
    locations: [
      {
        role: 'data',
        path: '.mux',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'neovate',
    name: 'Neovate',
    locations: [
      {
        role: 'data',
        path: '.neovate',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'ona',
    name: 'Ona',
    locations: [
      {
        role: 'data',
        path: '.ona',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    locations: [
      {
        role: 'data',
        path: '.openclaw',
        type: 'dir',
        kind: 'config',
      },
      {
        role: 'data',
        path: '.clawdbot',
        type: 'dir',
        kind: 'config',
      },
      {
        role: 'data',
        path: '.moltbot',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    locations: [
      {
        role: 'data',
        path: '.openhands',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'pi',
    name: 'Pi',
    bins: ['pi'],
    locations: [
      {
        role: 'data',
        path: '.pi/agent',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'pochi',
    name: 'Pochi',
    locations: [
      {
        role: 'data',
        path: '.pochi',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'posit-assistant',
    name: 'Posit Assistant',
    locations: [
      {
        role: 'data',
        path: '.posit/assistant',
        type: 'dir',
        kind: 'config',
      },
      {
        role: 'data',
        path: '.positai',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'qoder',
    name: 'Qoder',
    bins: ['qoder'],
    locations: [
      {
        role: 'data',
        path: '.qoder',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'qoder-cn',
    name: 'Qoder CN',
    bins: ['qoder-cn'],
    locations: [
      {
        role: 'data',
        path: '.qoder-cn',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    locations: [
      {
        role: 'data',
        path: '.qwen',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'reasonix',
    name: 'Reasonix',
    locations: [
      {
        role: 'data',
        path: '.reasonix',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'roo',
    name: 'Roo Code',
    locations: [
      {
        role: 'data',
        path: '.roo',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'rovodev',
    name: 'Rovo Dev',
    locations: [
      {
        role: 'data',
        path: '.rovodev',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'sarvam-code',
    name: 'Sarvam Code',
    locations: [
      {
        role: 'data',
        path: '.sarvam',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'tabnine-cli',
    name: 'Tabnine CLI',
    locations: [
      {
        role: 'data',
        path: '.tabnine',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'terramind',
    name: 'Terramind',
    locations: [
      {
        role: 'data',
        path: '.terramind',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'tinycloud',
    name: 'Tinycloud',
    locations: [
      {
        role: 'data',
        path: '.tinycloud',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'trae',
    name: 'Trae',
    locations: [
      {
        role: 'data',
        path: '.trae',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'trae-cn',
    name: 'Trae CN',
    locations: [
      {
        role: 'data',
        path: '.trae-cn',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'warp',
    name: 'Warp',
    locations: [
      {
        role: 'data',
        path: '.warp',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    locations: [
      {
        role: 'data',
        path: '.codeium/windsurf',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'zcode',
    name: 'ZCode',
    locations: [
      {
        role: 'data',
        path: '.zcode',
        type: 'dir',
        kind: 'config',
      },
      {
        role: 'install',
        base: 'APPLICATIONS',
        path: 'ZCode.app',
        type: 'dir',
        kind: 'config',
        platforms: ['darwin'],
      },
    ],
  },
  {
    id: 'zencoder',
    name: 'Zencoder',
    locations: [
      {
        role: 'data',
        path: '.zencoder',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'zenflow',
    name: 'Zenflow',
    locations: [
      {
        role: 'data',
        path: '.zencoder',
        type: 'dir',
        kind: 'config',
      },
    ],
  },

  // Eve and PromptScript only identify project files; do not invent home cleanup targets.
  {
    id: 'eve',
    name: 'Eve',
    locations: [],
  },
  {
    id: 'promptscript',
    name: 'PromptScript',
    locations: [],
  },
  // These are shared global skill locations, not evidence of a Replit/Universal installation.
  {
    id: 'replit',
    name: 'Replit',
    locations: [
      {
        role: 'data',
        path: 'agents/skills',
        base: 'XDG_CONFIG_HOME',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
  {
    id: 'universal',
    name: 'Universal',
    locations: [
      {
        role: 'data',
        path: 'agents/skills',
        base: 'XDG_CONFIG_HOME',
        type: 'dir',
        kind: 'config',
      },
    ],
  },
]
