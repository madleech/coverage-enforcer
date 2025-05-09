const File = require("../file")

describe('File', () => {
  it('handles file not part of test suite', () => {
    const instance = new File({name: "foo.js", changedLines: [1, 2, 3], coverageData: []});

    expect(instance.changedLinesCount).toEqual(3);
    expect(instance.partOfTestSuite).toEqual(false);
    expect(instance.annotations).toEqual([]);
  })

  it('handles file part of test suite', () => {
    const instance = new File({
      name: "foo.js",
      skipped: false,
      changedLines: [1, 2, 3],
      coverageData: [1, 0, null, 1, 0, 1, 1, 1, 1, 1], // 10 lines, with lines 2 and 5 uncovered
    });

    expect(instance.changedLinesCount).toEqual(3);
    expect(instance.partOfTestSuite).toEqual(true);
    expect(instance.skipped).toEqual(false);
    expect(instance.executableLines).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(instance.executableLinesCount).toEqual(9);
    expect(instance.executedLines).toEqual([1, 4, 6, 7, 8, 9, 10]);
    expect(instance.executedLinesCount).toEqual(7);
    expect(instance.missedLines).toEqual([2, 5]);
    expect(instance.missedLinesCount).toEqual(2);
    expect(instance.relevantLines).toEqual([1, 2]);
    expect(instance.relevantLinesCount).toEqual(2);
    expect(instance.relevantMissedLines).toEqual([2]);
    expect(instance.relevantMissedLinesCount).toEqual(1);
    expect(instance.relevantMissedLineRanges).toEqual([{"start": 2, "end": 2, "formatted": "2"}])
    expect(instance.changedUnexecutedLines).toEqual([2, 3])
    expect(instance.changedUnexecutedLineRanges).toEqual([{"start": 2, "end": 2, "formatted": "2"}])
    expect(instance.wholeFileUnexecuted).toEqual(false);
    expect(instance.changedLinesCoverageData).toEqual([1, 0, null, -1, -1, -1, -1, -1, -1, -1]);
    expect(instance.annotations).toEqual([
      {
        path: 'foo.js',
        start_line: 2,
        end_line: 2,
        annotation_level: 'warning',
        message: 'Line 2 has no coverage'
      }
    ]);
  })

  it('handles file with multiple missing sections', () => {
    const instance = new File({
      name: "foo.js",
      changedLines: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      coverageData: [1, 0, null, 1, 0, 0, 1, 1, 1, 1],
    });
    expect(instance.wholeFileUnexecuted).toEqual(false);
    expect(instance.annotations).toEqual([
      {
        path: 'foo.js',
        start_line: 2,
        end_line: 2,
        annotation_level: 'warning',
        message: 'Line 2 has no coverage'
      },
      {
        path: 'foo.js',
        start_line: 5,
        end_line: 6,
        annotation_level: 'warning',
        message: 'Lines 5-6 have no coverage'
      }
    ]);
  })

  it('handles file with no coverage', () => {
    const instance = new File({
      name: "foo.js",
      changedLines: [1, 2, 3, 4],
      coverageData: [0, 0, null, 0],
    });
    expect(instance.wholeFileUnexecuted).toEqual(true);
    expect(instance.annotations).toEqual([
      {
        path: 'foo.js',
        start_line: 1,
        end_line: 4,
        annotation_level: 'warning',
        message: 'File has no coverage'
      }
    ]);
  })

  it('handles file outside of test suite', () => {
    const instance = new File({
      name: "README.md",
      changedLines: [1, 2, 3, 4],
      coverageData: [],
    });
    expect(instance.skipped).toEqual(true);
  })

  it('skips over comments etc in ranges', () => {
    const instance = new File({
      name: "foo.js",
      changedLines: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      coverageData: [1, 0, null, 0, 0, 0, 1, 1, 1, 1],
    });
    expect(instance.annotations).toEqual([
      {
        path: 'foo.js',
        start_line: 2,
        end_line: 6,
        annotation_level: 'warning',
        message: 'Lines 2-6 have no coverage'
      }
    ]);
  })

  it('handles dangling nulls in ranges', () => {
    // when generating ranges, we want to ignore dangling nulls as these are unexecutable lines
    // like comments or closing language constructs.
    const instance = new File({
      name: "foo.js",
      changedLines: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      coverageData: [1, 0, null, 0, 0, null, null, 1, 1, 1],
    });
    expect(instance.annotations).toEqual([
      {
        path: 'foo.js',
        start_line: 2,
        end_line: 5,
        annotation_level: 'warning',
        message: 'Lines 2-5 have no coverage'
      }
    ])
  })
})
