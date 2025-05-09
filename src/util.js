// turn [1, 2, 3, 5, 6] into "1-3, 5-6"
function compactLineNumbers(lineNumbers) {
  if (lineNumbers.length === 0) return [];
  const ranges = [];
  let start = lineNumbers[0];
  let end = start;

  for (let i = 1; i < lineNumbers.length; i++) {
    const curr = lineNumbers[i];
    if (curr === end + 1) {
      end = curr;
    } else {
      ranges.push({
        start,
        end,
        formatted: start === end ? `${start}` : `${start}-${end}`
      });
      start = end = curr;
    }
  }

  ranges.push({
    start,
    end,
    formatted: start === end ? `${start}` : `${start}-${end}`
  });
  return ranges;
}

// turn [1, 2, 3, 5, 6] into "1-3, 5-6"
// states:
//   0 = searching for start
//   1 = waiting to find end
function compactCountsToLineNumbers(counts) {
  if (counts.length === 0) return [];
  const ranges = [];
  let start = null;
  let next_start = null;
  let end = null;
  const WAITING_FOR_START = 0;
  const WAITING_FOR_END = 1;
  let mode = WAITING_FOR_START;

  const startingFilterFunction = (count) => (count === 0);
  const endingFilterFunction = (count) => (count === 0);
  const nextStartingFilterFunction = (count) => (count > 0);
  const excludedLineFilterFunction = (count) => (count === -1);

  const addToRange = (start, end) => {
    start ++;
    end ++;
    ranges.push({
      start,
      end,
      formatted: start === end ? `${start}` : `${start}-${end}`
    })
  }

  for (let i = 0; i < counts.length; i++) {
    let count = counts[i];
    switch(mode) {
      case WAITING_FOR_START:
        // find starting point
        if (startingFilterFunction(count)) {
          start = i;
          mode = WAITING_FOR_END;
        }
        break;

      case WAITING_FOR_END:
        // find next ending point
        //   1: scan ahead, basically looking for the next starting point, OR an excluded line
        //   2: then scan backwards, looking for the last non-null
        //   3: ending point is there
        //   4: start scanning from next starting point
        next_start = i;
        while ((!nextStartingFilterFunction(counts[next_start]) && !excludedLineFilterFunction(counts[next_start])) && next_start < counts.length) {
          next_start++;
        }
        // we are now in theory either at the end of the counts, or at the next starting point
        // scan backwards looking for last non-null
        end = next_start;
        while (!endingFilterFunction(counts[end])) {
          end--;
        }
        // add range
        addToRange(start, end);
        // update starting location
        i = next_start - 1;
        mode = WAITING_FOR_START;
        break;
    }
  }

  // tidy up end
  if (mode == WAITING_FOR_END) {
    end = counts.length;
    addToRange(start, end)
  }
  return ranges;
}

function sum(items) {
  let sum = 0;
  items.forEach(item => sum += item);
  return sum;
}

function formatPercent(percentage, dp = 1) {
  const scaler = 10**dp;
  return `${Math.round(percentage * scaler) / scaler}%`;
}

module.exports = {compactLineNumbers, compactCountsToLineNumbers, sum, formatPercent}
