import { Chip } from '../ui/Card'

/** Shown wherever results reflect edited assumptions; the tooltip lists the edits. */
export default function ChangedChip({ changes }: { changes: string[] }) {
  if (changes.length === 0) return null
  return (
    <Chip tone="violet" title={changes.join('\n')}>
      Assumptions changed
    </Chip>
  )
}
