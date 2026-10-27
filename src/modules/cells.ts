// Reading binding cells (§5.6.8): a slot of the exporting module's environment, or a host module's live export.
import type { Slot } from '@/runtime/values'
import type { BindingCell } from './module-record'

/**
 * Reads a binding cell.
 *
 * @param cell the cell
 * @returns the value, or `UNINITIALIZED` for a binding still in its TDZ
 */
export function readCell(cell: BindingCell): Slot {
  return 'read' in cell ? cell.read() : cell.env.slots[cell.slot]
}
