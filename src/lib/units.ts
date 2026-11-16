export const BYTES_PER_KILOBYTE = 1024
export const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE
export const BYTES_PER_GIGABYTE = BYTES_PER_MEGABYTE * BYTES_PER_KILOBYTE

export const PERCENT_SCALE = 100
export const TWO_DIGIT_WIDTH = 2
export const HALF_DIVISOR = 2
export const BOTH_SIDES = 2

const PARITY_DIVISOR = 2

export function isEven(value: number): boolean {
  return value % PARITY_DIVISOR === 0
}
