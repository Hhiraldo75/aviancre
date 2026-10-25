import { useAppStore } from '../../store/useAppStore'

/** Why expense edits were just dropped (a T-12 loaded or removed, or a set made on other lines); dismissable. */
export default function AssumptionNotice({ propertyId }: { propertyId: string }) {
  const notice = useAppStore((s) => s.assumptionNotices[propertyId])
  const dismiss = useAppStore((s) => s.dismissAssumptionNotice)
  if (!notice) return null
  return (
    <div role="status" className="mt-2 flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-200">
      <span className="flex-1">{notice}</span>
      <button type="button" onClick={() => dismiss(propertyId)} className="text-amber-300 hover:text-amber-100" aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
