import { describe, expect, it } from 'vitest'
import { createLineBag } from '../src/shared/fallback'
import { mulberry32 } from './rng'

describe('line variety', () => {
  it('does not repeat a line until the bag is exhausted', () => {
    const lines = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
    const bag = createLineBag(lines, mulberry32(11))
    const first: string[] = []
    for (let i = 0; i < lines.length; i++) first.push(bag.next())
    expect(new Set(first).size).toBe(lines.length)
    const sequence = [first[first.length - 1] ?? '']
    for (let i = 0; i < 15; i++) sequence.push(bag.next())
    for (let i = 1; i < sequence.length; i++) expect(sequence[i]).not.toBe(sequence[i - 1])
  })
})
