import { describe, expect, it } from 'vitest'
import {
  createPointerModel,
  finishGesture,
  hitZone,
  ignoreNeedsApply,
  modelHover,
  modelMouseDown,
  modelMouseMove,
  modelMouseUp,
  modelPin,
  modelSetIgnore,
  moveGesture,
  startGesture
} from '../src/shared/pointer'

const bounds = { x: 100, y: 80, width: 360, height: 640 }
const inside = { x: 220, y: 240 }

describe('click through and drag', () => {
  it('treats a still left or right click as speed and a right drag as a saved move', () => {
    const left = startGesture('chat', 'left', inside, bounds)
    expect(left).not.toBeNull()
    expect(finishGesture(left!, false)).toEqual({ speed: 'slower', save: false })
    const right = startGesture('chat', 'right', inside, bounds)
    expect(finishGesture(right!, false)).toEqual({ speed: 'faster', save: false })
    const dragged = moveGesture(right!, { x: inside.x + 30, y: inside.y + 12 }, false)
    expect(dragged.bounds).toEqual({ x: 130, y: 92, width: 360, height: 640 })
    expect(finishGesture(dragged.gesture, false).save).toBe(true)
    expect(moveGesture(right!, { x: inside.x + 30, y: inside.y + 12 }, true).bounds).toBeNull()
    expect(finishGesture({ ...dragged.gesture, moved: true }, true)).toEqual({ speed: null, save: false })
  })

  it('keeps clicks outside the panel from starting a gesture', () => {
    expect(hitZone({ x: 10, y: 10 }, bounds)).toBe('outside')
    expect(hitZone(inside, bounds)).toBe('chat')
    expect(hitZone({ x: bounds.x + bounds.width - 20, y: bounds.y + bounds.height - 18 }, bounds)).toBe('resize')
    expect(startGesture('outside', 'right', { x: 0, y: 0 }, bounds)).toBeNull()
  })

  it('reapplies mouse capture after a topmost re-assert', () => {
    expect(ignoreNeedsApply(false, false, false)).toBe(false)
    expect(ignoreNeedsApply(false, false, true)).toBe(true)
    let model = modelHover(createPointerModel(), 'chat')
    expect(model.nativeIgnore).toBe(false)
    model = modelPin(model)
    expect(model.nativeIgnore).toBe(true)
    const stuck = { ...model, pinned: false }
    expect(modelSetIgnore(stuck, false).nativeIgnore).toBe(true)
    const fixed = modelSetIgnore(model, false)
    expect(fixed.nativeIgnore).toBe(false)
    const down = modelMouseDown(modelPin(modelHover(createPointerModel(), 'chat')), 'chat', 'right', inside, bounds)
    const moved = modelMouseMove(down, { x: inside.x + 40, y: inside.y }, false)
    const ended = modelMouseUp(moved.model, false)
    expect(moved.bounds?.x).toBe(bounds.x + 40)
    expect(ended.result).toEqual({ speed: null, save: true })
    const outside = modelMouseDown(createPointerModel(), 'outside', 'left', { x: 0, y: 0 }, bounds)
    expect(outside.gesture).toBeNull()
    expect(outside.nativeIgnore).toBe(true)
  })
})
