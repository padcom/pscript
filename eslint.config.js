import config from '@padcom/eslint-config-typescript'

const nodeGlobals = config['flat/node'].find(entry => entry.name === 'padcom/flat/node-globals')

export default [
  { ignores: ['dist/**', 'coverage/**'] },
  ...config['flat/browser'],
  // build scripts, config files and tests run in Node
  { ...nodeGlobals, files: ['bin/**', 'build/**', 'tests/**', '*.config.*', 'vitest.setup.js'] },
]
