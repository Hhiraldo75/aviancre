import { createElement, useMemo } from 'react'
import { parseMarkdown, type Block, type Inline } from '../../lib/markdown'

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((n, i) => {
    if (n.type === 'text') return n.text
    if (n.type === 'code') return (
      <code key={i} className="rounded bg-slate-800 px-1 py-0.5 text-[11px] text-slate-200">
        {n.text}
      </code>
    )
    if (n.type === 'strong') return (
      <strong key={i} className="font-semibold text-slate-100">
        <Inlines nodes={n.children} />
      </strong>
    )
    return (
      <em key={i}>
        <Inlines nodes={n.children} />
      </em>
    )
  })
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mb-3 text-base font-semibold text-slate-100',
  2: 'mb-2 mt-6 border-b border-slate-700 pb-1 text-sm font-semibold text-slate-100',
  3: 'mb-1.5 mt-4 text-xs font-semibold text-slate-100',
}
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const
const cell = 'min-w-28 px-3 py-1.5 align-top'

function BlockView({ block: b }: { block: Block }) {
  switch (b.type) {
    case 'heading':
      // The panel title is the h2, so memo headings start at h3.
      return createElement(
        `h${Math.min(b.level + 2, 6)}`,
        { className: HEADING_CLASS[b.level] ?? HEADING_CLASS[3] },
        <Inlines nodes={b.children} />,
      )
    case 'paragraph':
      return (
        <p className="my-2">
          <Inlines nodes={b.children} />
        </p>
      )
    case 'rule':
      return <hr className="my-4 border-slate-700" />
    case 'list': {
      const items = b.items.map((item, i) => (
        <li key={i}>
          <Inlines nodes={item} />
        </li>
      ))
      return b.ordered ? (
        <ol start={b.start} className="my-2 list-decimal space-y-1 pl-5 marker:text-slate-500">
          {items}
        </ol>
      ) : (
        <ul className="my-2 list-disc space-y-1 pl-5 marker:text-slate-500">{items}</ul>
      )
    }
    case 'table': {
      const align = (c: number) => ALIGN[b.align[c] ?? 'left']
      const hasHeader = b.header.some((h) => h.length > 0)
      return (
        <div className="my-3 overflow-x-auto rounded border border-slate-700">
          <table className="w-full border-collapse">
            {hasHeader && (
              <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  {b.header.map((h, c) => (
                    <th key={c} className={`${cell} font-medium ${align(c)}`}>
                      <Inlines nodes={h} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r} className={hasHeader || r > 0 ? 'border-t border-slate-700/70' : ''}>
                  {row.map((nodes, c) => (
                    <td key={c} className={`${cell} ${align(c)}`}>
                      <Inlines nodes={nodes} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
  }
}

/** Renders trusted Markdown (headings, lists, tables, bold/italic/code) as React elements, without raw HTML. */
export default function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <div className="text-xs leading-relaxed text-slate-300">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  )
}
