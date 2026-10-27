// Module programs (§4.7): each directory under tests/modules is a module graph whose entry is `main.pscript`.
// `main.out` holds the expected output, `main.err` text the error message must contain. Graphs whose entry does not
// contain `@pscript-only` must also behave the same in Node.
import { describe, expect, it } from 'vitest'
import { errorName, expected, graphs, runGraph, sources } from './helpers/module-graphs'
import { runModulesInNode } from './helpers/node-modules'

describe('module programs', () => {
  it.each(graphs)('%s', async graph => {
    const { output, error } = await runGraph(sources(graph))
    const expectedError = expected(graph, '.err')

    if (expectedError === null) {
      expect(error).toBeUndefined()
      expect(output.join('\n')).toBe((expected(graph, '.out') ?? '').trimEnd())
    } else {
      expect(error?.message).toContain(expectedError.trim())
    }
  })
})

const differential = graphs.filter(graph => !sources(graph)['main.pscript'].includes('@pscript-only'))

describe('module programs against Node', () => {
  it.each(differential)('%s', async graph => {
    const modules = sources(graph)
    const pscript = await runGraph(modules)
    const node = runModulesInNode(modules, 'main.pscript')

    expect(pscript.output).toEqual(node.output)
    expect(errorName(pscript.error)).toBe(node.errorName)
  })
})
