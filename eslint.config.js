import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  pnpm: true,
  antislop: true,
  // plan.md / README.md are prose specs, not lint targets.
  markdown: false,
  ignores: ['**/*.md'],
})
