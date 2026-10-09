import type { Property } from '../../types'
import { Chip } from './Card'

/** Marks a deal imported from a rent roll file; hover for the file and date. */
export default function ImportedChip({ from }: { from: NonNullable<Property['importedFrom']> }) {
  return (
    <Chip tone="emerald" title={`Imported from ${from.fileName} on ${from.importedAt}. Kept in this browser only.`}>
      Imported
    </Chip>
  )
}
