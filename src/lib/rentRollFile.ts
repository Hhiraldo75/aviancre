import { parseCSV } from './csv'
import { excelSerialToISO, type Cell } from './rentRollCells'

/** File types the rent roll import reads. */
export const RENT_ROLL_EXTENSIONS = ['.csv', '.xlsx'] as const

/**
 * A rent roll file (CSV or Excel .xlsx) as a grid of cells for `parseRentRoll`.
 * Excel date cells become ISO dates; SheetJS is loaded only when an .xlsx is
 * read, so it stays out of the main bundle. Runs in the browser and in Node.
 */
export async function readRentRollFile(fileName: string, bytes: Uint8Array): Promise<Cell[][]> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv')) return parseCSV(new TextDecoder('utf-8').decode(bytes))
  if (lower.endsWith('.xlsx')) return readXlsx(bytes)
  throw new Error(`"${fileName}" is not a rent roll file. Use ${RENT_ROLL_EXTENSIONS.join(' or ')}.`)
}

async function readXlsx(bytes: Uint8Array): Promise<Cell[][]> {
  const XLSX = await import('xlsx')
  // Dates stay serial numbers (cellDates off) and are converted here, so the
  // result doesn't depend on the time zone the file is read in.
  const wb = XLSX.read(bytes, { type: 'array', cellNF: true, cellDates: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet?.['!ref']) return []
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904)
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const grid: Cell[][] = []
  // Row and column 0 are A1, even when the used range starts lower.
  for (let r = 0; r <= range.e.r; r++) {
    const row: Cell[] = []
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      if (!cell || cell.v === undefined || cell.t === 'e' || cell.t === 'z') row.push(null)
      else if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) row.push(excelSerialToISO(Number(cell.v) + (date1904 ? 1462 : 0)))
      else if (cell.t === 'n') row.push(Number(cell.v))
      else if (cell.t === 'd') row.push(cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v))
      else row.push(String(cell.v))
    }
    grid.push(row)
  }
  return grid
}
