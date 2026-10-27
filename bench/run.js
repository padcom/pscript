// Micro benchmarks (§7.10 H3): each case runs in PScript (from the built library) and, for comparison, as plain
// JavaScript. Run with `npm run bench` (builds first).
import { Interpreter, compile } from '../dist/index.js'

// The §6.5 baseline: fib(27), a loop of 1e6, 1e5 object allocations, array map/filter; plus classes and strings.
const CASES = {
  'fib(27)': `
    function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
    fib(27)
  `,
  'loop of 1e6': `
    let sum = 0
    for (let i = 0; i < 1000000; i++) sum += i % 7
    sum
  `,
  '1e5 object allocations': `
    let last = null
    for (let i = 0; i < 100000; i++) last = { x: i, y: i * 2, next: last }
    last.x
  `,
  'array map/filter': `
    const values = []
    for (let i = 0; i < 100000; i++) values.push(i)
    values.map(v => v * 3).filter(v => v % 2 == 0).length
  `,
  'classes and methods': `
    class Vector {
      x
      y
      constructor(x, y) { this.x = x; this.y = y }
      add(other) { return new Vector(this.x + other.x, this.y + other.y) }
    }
    let v = new Vector(0, 0)
    for (let i = 0; i < 30000; i++) v = v.add(new Vector(1, 2))
    v.x + v.y
  `,
  'string building': `
    let text = ''
    for (let i = 0; i < 20000; i++) text += String(i % 10)
    text.length
  `,
}

const ROUNDS = 3

function median(times) {
  const sorted = [...times].sort((a, b) => a - b)

  return sorted[Math.floor(sorted.length / 2)]
}

function measure(run) {
  const times = []
  let result = null

  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now()

    result = run()
    times.push(performance.now() - start)
  }

  return { time: median(times), result }
}

function javascript(source) {
  return new Function(`'use strict'; return eval(${JSON.stringify(source.replaceAll(' == ', ' === '))})`)
}

const rows = Object.entries(CASES).map(([name, source]) => {
  const script = compile(source)
  const pscript = measure(() => new Interpreter({ stdout: () => {} }).execute(script))
  const native = measure(javascript(source))

  return { name, pscript, native }
})

console.log(`${'case'.padEnd(28)} ${'pscript ms'.padStart(11)} ${'js ms'.padStart(9)} ${'ratio'.padStart(7)}  result`)

for (const { name, pscript, native } of rows) {
  const ratio = `${(pscript.time / native.time).toFixed(0)}x`
  const times = `${pscript.time.toFixed(2).padStart(11)} ${native.time.toFixed(2).padStart(9)}`

  console.log(`${name.padEnd(28)} ${times} ${ratio.padStart(7)}  ${pscript.result}`)
}
