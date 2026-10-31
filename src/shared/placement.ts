export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function initialSize(workAreaHeight: number): { width: number; height: number } {
  return {
    width: 360,
    height: Math.max(420, Math.min(760, Math.round(workAreaHeight * 0.72)))
  }
}

export function defaultPlacement(work: Rect, size: { width: number; height: number }): { x: number; y: number } {
  const margin = 24
  return {
    x: Math.round(work.x + work.width - size.width - margin),
    y: Math.round(work.y + Math.max(margin, (work.height - size.height) / 2))
  }
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

export function clampPlacement(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  displays: Rect[]
): { x: number; y: number } {
  const anchorX = pos.x + Math.min(size.width / 2, 80)
  const anchorY = pos.y + 36
  if (displays.some((display) => contains(display, anchorX, anchorY))) return pos
  const primary = displays[0]
  if (!primary) return pos
  return defaultPlacement(primary, size)
}
