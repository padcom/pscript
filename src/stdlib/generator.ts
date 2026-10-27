// `next`, `return` and `throw` of generator objects (D42, §4.4.16). Each returns a plain `{ value, done }` object.
import { GeneratorObject, type IteratorStep, type ResumeMode } from '@/runtime/generators'
import { typeError } from '@/runtime/script-error'
import { Object as ScriptObject, type NativeImpl, type Realm, type Value } from '@/runtime/values'
import { defineMethods, method } from './native'

function stepObject(realm: Realm, { value, done }: IteratorStep): ScriptObject {
  const result = new ScriptObject(realm.ObjectPrototype)

  result.props.set('value', value)
  result.props.set('done', done)

  return result
}

// A missing argument is null (D37): `gen.next()` makes the paused `yield` give null.
function resumeWith(realm: Realm, mode: ResumeMode): NativeImpl {
  return (_, self, args) => {
    if (!(self instanceof GeneratorObject)) throw typeError(`Generator.prototype.${mode} called on a non-generator`)
    if (args.length > 1) throw typeError(`${mode}() expects at most 1 argument, got ${args.length}`)

    return stepObject(realm, self.driver.resume(mode, args.length === 0 ? null : args[0] as Value))
  }
}

/**
 * Installs the methods of generator objects.
 *
 * @param realm the realm
 */
export function installGenerator(realm: Realm) {
  defineMethods(realm, realm.GeneratorPrototype, {
    next: method(1, resumeWith(realm, 'next')),
    return: method(1, resumeWith(realm, 'return')),
    throw: method(1, resumeWith(realm, 'throw')),
    toString: method(0, () => '[object Generator]'),
  })
}
