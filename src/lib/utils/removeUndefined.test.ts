import { removeUndefined } from './removeUndefined'

describe('removeUndefined()', () => {
  test('should return an object with undefined keys removed', () => {
    expect(removeUndefined({ a: 1, b: undefined, c: 3 })).toEqual({ a: 1, c: 3 })
  })

  test('should return the same object if no undefined values', () => {
    expect(removeUndefined({ a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2, c: 3 })
  })

  test('should return an empty object if given an empty object', () => {
    expect(removeUndefined({})).toEqual({})
  })
})
