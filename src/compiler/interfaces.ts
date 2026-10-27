// Interface templates (§4.5.7): the requirements an INTERFACE instruction turns into an interface value.
import type { InterfaceDeclaration, InterfaceMember } from '@/parser/ast'
import { keyName } from './class-info'
import type { InterfaceMemberTemplate, InterfaceTemplate } from './function-proto'

const SUFFIXES: Partial<Record<InterfaceMember['kind'], string>> = { get: ' (getter)', set: ' (setter)' }

function description({ key, kind, params, hasRest }: InterfaceMember): string {
  const name = keyName(key)
  if (kind !== 'method') return name + (SUFFIXES[kind] ?? '')

  const names = params.map((param, i) => (hasRest && i === params.length - 1 ? '...' : '') + param.name)

  return `${name}(${names.join(', ')})`
}

function memberTemplate(member: InterfaceMember): InterfaceMemberTemplate {
  const { kind, params, hasRest, loc } = member
  const paramCount = hasRest ? params.length - 1 : params.length

  return { key: keyName(member.key), kind, paramCount, hasRest, description: description(member), loc }
}

/**
 * Builds the template of an interface declaration.
 *
 * @param node the declaration
 * @returns the template
 */
export function interfaceTemplate(node: InterfaceDeclaration): InterfaceTemplate {
  return { name: node.id.name, members: node.body.map(memberTemplate) }
}
