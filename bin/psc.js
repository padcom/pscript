#!/usr/bin/env node
// psc (§11): the transpiler command, also available as `pscript transpile` (D62).
import process from 'node:process'
import { PScriptError } from '../dist/index.js'
import { transpile } from './transpile.js'

try {
  transpile(process.argv.slice(2), 'psc')
} catch (e) {
  console.error(e instanceof PScriptError ? e.message : `psc: ${e.message}`)
  process.exitCode = 1
}
