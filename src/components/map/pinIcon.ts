/**
 * A map pin as a signed distance field, so one image can be tinted per deal
 * (`icon-color`, including the selected state) and given a halo. A teardrop
 * with a hole in its head, drawn at 2× for sharp edges.
 */
export const PIN_PIXEL_RATIO = 2
const HEAD_R = 18
const TIP_R = 1.5
/** Tip to head center. */
const LENGTH = 40
const HOLE_R = 6
/** Room for the halo around the shape. */
const BUFFER = 8
/** MapLibre's SDF encoding: the edge sits at 0.75, one unit per 8 image pixels. */
const SDF_PX = 8

/** Pixels from the image's bottom edge down to the pin's tip, for `icon-offset` (in screen px). */
export const PIN_TIP_OFFSET = (BUFFER + TIP_R) / PIN_PIXEL_RATIO

/** Signed distance (negative inside) to a cone from a round tip at the origin up to the head; y points up. */
function teardrop(x: number, y: number) {
  x = Math.abs(x)
  const b = (TIP_R - HEAD_R) / LENGTH
  const a = Math.sqrt(1 - b * b)
  const k = -b * x + a * y
  if (k < 0) return Math.hypot(x, y) - TIP_R
  if (k > a * LENGTH) return Math.hypot(x, y - LENGTH) - HEAD_R
  return a * x + b * y - TIP_R
}

export function pinIcon(): { width: number; height: number; data: Uint8Array } {
  const width = 2 * (HEAD_R + BUFFER)
  const height = Math.ceil(TIP_R + LENGTH + HEAD_R + 2 * BUFFER)
  const tipY = height - BUFFER - TIP_R
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = col + 0.5 - width / 2
      const y = tipY - (row + 0.5)
      const d = Math.max(teardrop(x, y), HOLE_R - Math.hypot(x, y - LENGTH))
      const i = (row * width + col) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.max(0, Math.min(255, Math.round(255 * (0.75 - d / SDF_PX))))
    }
  }
  return { width, height, data }
}
