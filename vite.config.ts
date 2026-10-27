/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { defineLibConfig } from '@padcom/vite-config-lib'
import pkg from './package.json' with { type: 'json' }
import { jison } from './build/vite-plugin-jison.ts'
import { inlineEnum } from './build/vite-plugin-inline-enum.ts'
import { Op } from './src/compiler/opcodes.ts'

export default defineConfig(defineLibConfig(pkg, {
  plugins: [jison(), inlineEnum('Op', Op, /\/src\/vm\/vm\.ts$/)],
  dts: {
    include: ['src'],
  },
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'], // D16: ES only, until upstream drops UMD
    },
  },
  test: {
    coverage: {
      include: ['src/**', 'build/**'],
      exclude: ['**/*.jison'], // generated parser
    },
  },
}))
