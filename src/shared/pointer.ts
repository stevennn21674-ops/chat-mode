import { LIMITS } from './types'

export const PANEL_INSET = 12
export const DRAG_SLOP = 5
export const RESIZE_GRIP = 28

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Cursor {
  x: number
  y: number
}

export type HitZone = 'outside' | 'chat' | 'resize'
export type ClickButton = 'left' | 'right'
export type GestureKind = 'left' | 'right' | 'resize'

export interface Gesture {
  kind: GestureKind
  sx: number
  sy: number
  bounds: Box
  moved: boolean
}

const SIZE = {
  widthMin: LIMITS.widthMin,
  widthMax: LIMITS.widthMax,
  heightMin: LIMITS.heightMin,
  heightMax: LIMITS.heightMax
}

export function hitZone(cursor: Cursor, bounds: Box, inset = PANEL_INSET): HitZone {
  const left = bounds.x + inset
  const top = bounds.y + inset
  const right = bounds.x + bounds.width - inset
  const bottom = bounds.y + bounds.height - inset
  if (cursor.x < left || cursor.y < top || cursor.x > right || cursor.y > bottom) return 'outside'
  if (cursor.x >= right - RESIZE_GRIP && cursor.y >= bottom - RESIZE_GRIP) return 'resize'
  return 'chat'
}

export function wantsIgnore(zone: HitZone, gesturing: boolean): boolean {
  if (gesturing) return false
  return zone === 'outside'
}

/**
 * setAlwaysOnTop / moveTop on Windows clears the native click-through flag
 * and drops forwarded mouse events. If the cached flag already matches, a
 * later setIgnore is skipped and the window stays click-through, so clicks
 * never start a drag or a speed change. After a pin, the flag must be written
 * again even when the cached value is unchanged.
 */
export function ignoreNeedsApply(cached: boolean, requested: boolean, afterPin: boolean): boolean {
  if (afterPin) return true
  return cached !== requested
}

export function startGesture(zone: HitZone, button: ClickButton, cursor: Cursor, bounds: Box): Gesture | null {
  if (zone === 'outside') return null
  return {
    kind: zone === 'resize' ? 'resize' : button,
    sx: cursor.x,
    sy: cursor.y,
    bounds: { ...bounds },
    moved: false
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function moveGesture(
  gesture: Gesture,
  cursor: Cursor,
  lockPosition: boolean
): { gesture: Gesture; bounds: Box | null } {
  const dx = cursor.x - gesture.sx
  const dy = cursor.y - gesture.sy
  const moved = gesture.moved || Math.abs(dx) + Math.abs(dy) > DRAG_SLOP
  const next: Gesture = moved === gesture.moved ? gesture : { ...gesture, moved }
  if (!moved || lockPosition) return { gesture: next, bounds: null }
  if (gesture.kind === 'right') {
    return {
      gesture: next,
      bounds: {
        x: Math.round(gesture.bounds.x + dx),
        y: Math.round(gesture.bounds.y + dy),
        width: gesture.bounds.width,
        height: gesture.bounds.height
      }
    }
  }
  if (gesture.kind === 'resize') {
    return {
      gesture: next,
      bounds: {
        x: gesture.bounds.x,
        y: gesture.bounds.y,
        width: clamp(gesture.bounds.width + dx, SIZE.widthMin, SIZE.widthMax),
        height: clamp(gesture.bounds.height + dy, SIZE.heightMin, SIZE.heightMax)
      }
    }
  }
  return { gesture: next, bounds: null }
}

export interface GestureResult {
  speed: 'slower' | 'faster' | null
  save: boolean
}

export function finishGesture(gesture: Gesture, lockPosition: boolean): GestureResult {
  if (!gesture.moved && gesture.kind === 'left') return { speed: 'slower', save: false }
  if (!gesture.moved && gesture.kind === 'right') return { speed: 'faster', save: false }
  if (gesture.moved && !lockPosition && (gesture.kind === 'right' || gesture.kind === 'resize')) {
    return { speed: null, save: true }
  }
  return { speed: null, save: false }
}

export interface PointerModel {
  cachedIgnore: boolean
  nativeIgnore: boolean
  gesture: Gesture | null
  pinned: boolean
}

export function createPointerModel(): PointerModel {
  return { cachedIgnore: true, nativeIgnore: true, gesture: null, pinned: false }
}

export function modelPin(model: PointerModel): PointerModel {
  return { ...model, nativeIgnore: true, pinned: true }
}

export function modelSetIgnore(model: PointerModel, ignore: boolean): PointerModel {
  if (model.gesture && ignore) return model
  if (!ignoreNeedsApply(model.cachedIgnore, ignore, model.pinned)) {
    return { ...model, pinned: false }
  }
  return { ...model, cachedIgnore: ignore, nativeIgnore: ignore, pinned: false }
}

export function modelHover(model: PointerModel, zone: HitZone): PointerModel {
  return modelSetIgnore(model, wantsIgnore(zone, Boolean(model.gesture)))
}

export function modelMouseDown(
  model: PointerModel,
  zone: HitZone,
  button: ClickButton,
  cursor: Cursor,
  bounds: Box
): PointerModel {
  if (model.gesture) return model
  const gesture = startGesture(zone, button, cursor, bounds)
  if (!gesture) return model
  return modelSetIgnore({ ...model, gesture, pinned: true }, false)
}

export function modelMouseMove(
  model: PointerModel,
  cursor: Cursor,
  lockPosition: boolean
): { model: PointerModel; bounds: Box | null } {
  if (!model.gesture) return { model, bounds: null }
  const stepped = moveGesture(model.gesture, cursor, lockPosition)
  return { model: { ...model, gesture: stepped.gesture }, bounds: stepped.bounds }
}

export function modelMouseUp(
  model: PointerModel,
  lockPosition: boolean
): { model: PointerModel; result: GestureResult | null } {
  if (!model.gesture) return { model, result: null }
  const result = finishGesture(model.gesture, lockPosition)
  return { model: { ...model, gesture: null }, result }
}
