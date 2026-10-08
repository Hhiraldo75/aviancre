import type { ISODate } from '../../types'

/**
 * The monthly grid the engine runs on. Month index m is 0-based: m = 0 is the
 * first month of year 1. The grid covers the hold plus one year so the exit
 * can be valued on forward NOI.
 */

/** First day of the month after `asOf` — where the analysis starts. */
export function analysisStartFor(asOf: ISODate): ISODate {
  const d = new Date(asOf)
  return isoMonthStart(d.getUTCFullYear(), d.getUTCMonth() + 1)
}

/** ISO date for the 1st of a month; `month0` may run past 11 (it rolls into later years). */
export function isoMonthStart(year: number, month0: number): ISODate {
  const y = year + Math.floor(month0 / 12)
  const mo = ((month0 % 12) + 12) % 12
  return `${y}-${String(mo + 1).padStart(2, '0')}-01`
}

/** The 1st of month m of the analysis. */
export function monthStart(start: ISODate, m: number): ISODate {
  const d = new Date(start)
  return isoMonthStart(d.getUTCFullYear(), d.getUTCMonth() + m)
}

/** 1-based analysis year that month m falls in. */
export function analysisYear(m: number): number {
  return Math.floor(m / 12) + 1
}

export function calendarYear(iso: ISODate): number {
  return Number(iso.slice(0, 4))
}

/**
 * Month index of the first month starting after `date`, i.e. the first month a
 * lease expiring on `date` no longer covers. Can be negative or past the grid.
 */
export function monthAfter(start: ISODate, date: ISODate): number {
  const s = new Date(start)
  const d = new Date(date)
  const diff = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + (d.getUTCMonth() - s.getUTCMonth())
  return diff + 1
}
