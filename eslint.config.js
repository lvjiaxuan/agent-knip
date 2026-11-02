import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  pnpm: true,
  antislop: true,
  // README.md is prose, not a lint target.
  markdown: false,
  ignores: ['**/*.md'],
})
