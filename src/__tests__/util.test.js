const util = require('../util')

describe('util', () => {
  describe('compactLineNumbers', () => {
    it('generates ranges from line numbers', () => {
      const input = [1, 2, 3, 4, 8, 10, 11, 12, 14, 15];
      const expected = [
        {start: 1, end: 4, formatted: '1-4'},
        {start: 8, end: 8, formatted: '8'},
        {start: 10, end: 12, formatted: '10-12'},
        {start: 14, end: 15, formatted: '14-15'}
      ];
      expect(util.compactLineNumbers(input)).toEqual(expected);
    })
  })

  describe('compactCountsToLineNumbers', () => {
    it('handles empties', () => {
      expect(util.compactCountsToLineNumbers([])).toEqual([])
    })
    it('compacts a simple example', () => {
      const input = [1, 2, 1, null, 0, 0, null, 0, 1]
      // starting f: ---------------^
      // next starting f: -------------------------^
      // end f:                                  ^--
      const expected = [
        {start: 5, end: 8, formatted: '5-8'}
      ]
      expect(util.compactCountsToLineNumbers(input)).toEqual(expected);
    })
    it('handles multiple ranges', () => {
      const input = [1, 0, null, 0, 1, 0, null, 0, 1]
      const expected = [
        {start: 2, end: 4, formatted: '2-4'},
        {start: 6, end: 8, formatted: '6-8'},
      ]
      expect(util.compactCountsToLineNumbers(input)).toEqual(expected);
    })
    it('handles range starting from start', () => {
      const input = [0, null, 0, null, 1]
      const expected = [
        {start: 1, end: 3, formatted: '1-3'}
      ]
      expect(util.compactCountsToLineNumbers(input)).toEqual(expected);
    })
    it('handles range spanning while file', () => {
      const input = [0, null, 0, null]
      const expected = [
        {start: 1, end: 3, formatted: '1-3'}
      ]
      expect(util.compactCountsToLineNumbers(input)).toEqual(expected);
    })
    it('handles range to very end', () => {
      const input = [1, 0, null, 0]
      const expected = [
        {start: 2, end: 4, formatted: '2-4'}
      ]
      expect(util.compactCountsToLineNumbers(input)).toEqual(expected);
    })
    it('handles excluded counts', () => {
      const input = [0, null, 0, null, -1, -1, 0, null, 1]
      const expected = [
        {start: 1, end: 3, formatted: '1-3'},
        {start: 7, end: 7, formatted: '7'}
      ]
      expect(util.compactCountsToLineNumbers(input)).toEqual(expected);
    })
  })
  describe('sum', () => {
    it('sums items', () => {
      expect(util.sum([1, 2, 3])).toEqual(6);
    })
    it('handles empty arrays', () => {
      expect(util.sum([])).toEqual(0);
    })
  })
  describe('formatPercent', () => {
    it('formats percents', () => {
      expect(util.formatPercent(12.34567)).toEqual("12.3%");
      expect(util.formatPercent(12.34567, 0)).toEqual("12%");
      expect(util.formatPercent(12.34567, 2)).toEqual("12.35%");
    })
  })
})
