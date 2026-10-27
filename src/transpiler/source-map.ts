// Source maps of the emitted code (P11): version 3, from the AST locations, with a small VLQ encoder. The emitter
// marks where the code of a node starts with an invisible marker (`MARK_START index MARK_END`, two Unicode
// noncharacters around the index of the node's location); `resolveMarks()` removes the markers and records where they
// were.
import type { SourceLocation } from '@/parser/ast'

/** Starts a marker. */
export const MARK_START = '﷐'

/** Ends a marker. */
const MARK_END = '﷑'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * A version 3 source map.
 */
export interface SourceMap {
  /** always 3 */
  version: 3
  /** the generated file */
  file?: string
  /** the original files (one) */
  sources: string[]
  /** the original source text */
  sourcesContent?: string[]
  /** symbol names (unused) */
  names: string[]
  /** the Base64 VLQ mappings */
  mappings: string
}

/**
 * Encodes a number as a Base64 VLQ (the sign in the lowest bit, 5 bits per digit, continuation bit 32).
 *
 * @param value an integer
 * @returns the encoded digits
 */
export function encodeVlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1
  let text = ''

  do {
    const digit = rest & 31

    rest >>>= 5
    text += BASE64[rest > 0 ? digit | 32 : digit]
  } while (rest > 0)

  return text
}

/**
 * The marker of a node: its location is the `index`th of the emitter's list.
 *
 * @param index the index of the location
 * @returns the marker text
 */
export function marker(index: number): string {
  return `${MARK_START}${index}${MARK_END}`
}

/** A mapping: generated line and column, original line and column (all 0-based). */
type Segment = [number, number, number, number]

// `;` between lines, `,` between segments; every field but the generated line is relative to the previous segment
// (the generated column only within its line).
function encodeMappings(segments: Segment[]): string {
  const lines: string[][] = []
  const previous = { line: 0, column: 0 }
  let generatedColumn = 0

  for (const [line, column, sourceLine, sourceColumn] of segments) {
    while (lines.length <= line) {
      lines.push([])
      generatedColumn = 0
    }
    const fields = [column - generatedColumn, 0, sourceLine - previous.line, sourceColumn - previous.column]

    lines[line].push(fields.map(encodeVlq).join(''))
    generatedColumn = column
    previous.line = sourceLine
    previous.column = sourceColumn
  }

  return lines.map(line => line.join(',')).join(';')
}

/**
 * The position in the code being reassembled.
 */
class Cursor {
  line = 0
  column = 0

  advance(text: string) {
    const newline = text.lastIndexOf('\n')

    if (newline === -1) {
      this.column += text.length
    } else {
      this.line += text.split('\n').length - 1
      this.column = text.length - newline - 1
    }
  }
}

// Nested nodes starting at the same place: the outer one wins.
function addSegment(segments: Segment[], segment: Segment) {
  const last = segments.at(-1)

  if (last?.[0] !== segment[0] || last[1] !== segment[1]) segments.push(segment)
}

/**
 * Removes the markers from emitted code and computes the mappings they stand for.
 *
 * @param marked the code with markers
 * @param locations the locations the markers' indexes refer to
 * @returns the code and the mappings
 */
export function resolveMarks(marked: string, locations: SourceLocation[]): { code: string, mappings: string } {
  const segments: Segment[] = []
  const [first, ...parts] = marked.split(MARK_START)
  const code = [first]
  const cursor = new Cursor()

  cursor.advance(first)

  for (const part of parts) {
    const end = part.indexOf(MARK_END)
    const { line, column } = locations[Number(part.slice(0, end))].start

    addSegment(segments, [cursor.line, cursor.column, line - 1, column - 1])

    const text = part.slice(end + 1)

    code.push(text)
    cursor.advance(text)
  }

  return { code: code.join(''), mappings: encodeMappings(segments) }
}

// Base64 of the UTF-8 bytes (`btoa` only takes Latin-1).
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))

  return btoa(binary)
}

/**
 * The comment that embeds a source map in the code.
 *
 * @param map the source map
 * @returns the `//# sourceMappingURL=data:…` comment
 */
export function inlineSourceMapComment(map: SourceMap): string {
  return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64(JSON.stringify(map))}`
}
