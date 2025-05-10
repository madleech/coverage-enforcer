const util = require('./util')

class File {
  constructor({name, skipped, changedLines, coverageData}) {
    this.name = name;
    this.changedLines = changedLines;
    this.coverageData = coverageData || []; // array of executable counts, index = 0 -> line 1
    this.skipped = skipped || this.coverageData.length == 0;
  }

  get changedLinesCount() {
    return this.changedLines.length;
  }

  get partOfTestSuite() {
    return this.coverageData.length > 0;
  }

  get lineCount() {
    return this.coverageData.length;
  }

  get changedLinesCoverageData() {
    // set count for any line that isn't changed to -1
    const executionCounts = [];
    for (let index = 0; index < this.coverageData.length; index++) {
      const lineNumber = index + 1;
      let count = this.coverageData[index];
      let changed = this.changedLines.indexOf(lineNumber) !== -1;
      executionCounts.push(changed ? count : -1);
    }
    return executionCounts;
  }

  // return line numbers that are executable
  get executableLines() {
    const lineNumbers = [];
    for (let index = 0; index < this.coverageData.length; index++) {
      const lineNumber = index + 1;
      const count = this.coverageData[index];
      if (count !== null) {
        lineNumbers.push(lineNumber);
      }
    }
    return lineNumbers;
  }

  get executableLinesCount() {
    return this.executableLines.length;
  }

  // return line numbers that were executed during test suite
  get executedLines() {
    const lineNumbers = [];
    for (let index = 0; index < this.coverageData.length; index++) {
      const lineNumber = index + 1;
      const count = this.coverageData[index];
      if (count !== null && count > 0) {
        lineNumbers.push(lineNumber);
      }
    }
    return lineNumbers;
  }

  get executedLinesCount() {
    return this.executedLines.length;
  }

  // return line numbers that were not executed during test suite
  get missedLines() {
    const lineNumbers = [];
    for (let index = 0; index < this.coverageData.length; index++) {
      const lineNumber = index + 1;
      const count = this.coverageData[index];
      if (count === 0) {
        lineNumbers.push(lineNumber);
      }
    }
    return lineNumbers;
  }

  get missedLinesCount() {
    return this.missedLines.length;
  }

  // return lines that have been changed, and are part of the test suite
  get relevantLines() {
    return this.changedLines.filter(lineNumber => this.executableLines.includes(lineNumber));
  }

  get relevantLinesCount() {
    return this.relevantLines.length;
  }

  // line numbers that are changed, and were NOT executed
  get relevantMissedLines() {
    return this.changedLines.filter(lineNumber => this.missedLines.includes(lineNumber));
  }

  get relevantMissedLinesCount() {
    return this.relevantMissedLines.length;
  }

  // changed lines that aren't executed. Notably this includes ignored lines so that we can
  // generate more user-friendly line ranges
  get changedUnexecutedLines() {
    return this.changedLines.filter(lineNumber => !this.executedLines.includes(lineNumber));
  }

  // see note about about spanning nulls
  get changedUnexecutedLineRanges() {
    return util.compactCountsToLineNumbers(this.changedLinesCoverageData);
  }

  get coveragePercent() {
    return this.relevantLinesCount > 0
    ? (this.relevantExecutedLinesCount / this.relevantLinesCount) * 100
    : 100;
  }

  get relevantExecutedLinesCount() {
    return this.relevantLines.filter(lineNumber => this.executedLines.includes(lineNumber)).length;
  }

  // annotations should start and end on coverage=0 lines, but can span over nulls in the middle.
  // This reduces the number of annotations that we create, as otherwise every closing brace etc
  // results in a new annotation, which gets _very_ noisy very quickly!
  get annotations() {
    if (this.relevantMissedLinesCount == 0) return [];

    if (this.wholeFileUnexecuted)
      return [{
        path: this.name,
        start_line: 1,
        end_line: this.lineCount,
        annotation_level: 'warning',
        message: 'File has no coverage'
      }];

    return this.changedUnexecutedLineRanges.map((range) => {
      return {
        path: this.name,
        start_line: range.start,
        end_line: range.end,
        annotation_level: 'warning',
        message: range.start == range.end
          ? `Line ${range.formatted} has no coverage`
          : `Lines ${range.formatted} have no coverage`
      };
    });
  }

  get wholeFileUnexecuted() {
    return this.partOfTestSuite && this.executedLinesCount == 0;
  }
}

module.exports = File;
