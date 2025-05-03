const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

// Helper function to parse diff hunks and extract changed line numbers
function parseDiffHunks(patch) {
  if (!patch) return [];

  const changedLines = [];
  const lines = patch.split('\n');
  let currentLineNumber = 0;

  for (const line of lines) {
    // Skip diff headers
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+),(\d+)/);
      if (match) {
        currentLineNumber = parseInt(match[1], 10);
      }
      continue;
    }

    // Only track added lines (lines starting with +)
    if (line.startsWith('+') && !line.startsWith('+++')) {
      changedLines.push(currentLineNumber);
    }

    // Increment line number for non-diff lines and added lines
    if (!line.startsWith('-') || line.startsWith('+')) {
      currentLineNumber++;
    }
  }

  return changedLines;
}

// Helper function to check if a file has only been renamed
function isRenamedOnly(file) {
  // If there's a previous filename and no patch, it's a pure rename
  return file.previous_filename && !file.patch;
}

// Helper function to check if a file should be analyzed
function shouldAnalyzeFile(file, coverageData) {
  // Skip renamed files
  if (isRenamedOnly(file)) {
    core.info(`Skipping renamed file: ${file.filename} (previously ${file.previous_filename})`);
    return false;
  }

  // Skip files not in coverage data
  if (!coverageData[file.filename]) {
    // core.info(`Skipping file not in coverage data: ${file.filename}`);
    return false;
  }

  return true;
}

// Read coverage data
function read(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

// Get details on changed files
async function determineChangedFiles({context, octokit}) {
  if (context.eventName === 'pull_request') {
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.issue.number
    });
    return files;
  } else {
    // For push events, compare with the default branch
    const { data: compare } = await octokit.rest.repos.compareCommits({
      owner: context.repo.owner,
      repo: context.repo.repo,
      base: context.payload.repository.default_branch,
      head: context.sha
    });
    return compare.files;
  }
}

function calculateTotalMetrics(coverageData) {
  const totalFiles = Object.entries(coverageData).length;
  let totalRelevantLines = 0;
  let totalCoveredLines = 0;

  for (const fileCoverage of Object.values(coverageData)) {
    for (const coverage of fileCoverage) {
      if (coverage === null) continue;
      totalRelevantLines++;
      if (coverage > 0) totalCoveredLines++;
    }
  }

  return {totalFiles, totalRelevantLines, totalCoveredLines};
}

// Process each changed file and calculate the lines that have changed
function analyzeCoverageForLines(filePath, fileCoverage, changedLineNumbers) {
  let totalChangedLines = changedLineNumbers.length;
  let relevantChangedLines = 0;
  let coveredChangedLines = 0;
  const annotations = [];
  let currentAnnotation = null;
  let currentEndLine = null;

  for (const lineNumber of changedLineNumbers) {
    const coverageIndex = lineNumber - 1;
    if (coverageIndex < 0 || coverageIndex >= fileCoverage.length) continue;
    const coverage = fileCoverage[coverageIndex];
    if (coverage === null) continue;

    relevantChangedLines++;
    if (coverage > 0) coveredChangedLines++;

    if (coverage === 0) {
      if (!currentAnnotation) {
        currentAnnotation = {
          path: filePath,
          start_line: lineNumber,
          end_line: lineNumber,
          annotation_level: 'warning',
          message: 'This line has no test coverage'
        };
        currentEndLine = lineNumber;
      } else if (lineNumber === currentEndLine + 1) {
        currentEndLine = lineNumber;
        currentAnnotation.end_line = lineNumber;
      } else {
        annotations.push(currentAnnotation);
        currentAnnotation = {
          path: filePath,
          start_line: lineNumber,
          end_line: lineNumber,
          annotation_level: 'warning',
          message: 'This line has no test coverage'
        };
        currentEndLine = lineNumber;
      }
    }
  }

  if (currentAnnotation) {
    annotations.push(currentAnnotation);
  }

  return { totalChangedLines, relevantChangedLines, coveredChangedLines, annotations };
}

function processFile(file, coverageData) {
  if (!shouldAnalyzeFile(file, coverageData)) {
    return { skipped: true, filename: file.filename };
  }

  const filePath = file.filename;
  const fileCoverage = coverageData[filePath];
  const changedLineNumbers = parseDiffHunks(file.patch);

  if (changedLineNumbers.length === 0) {
    return { skipped: false, totalChangedLines: 0, relevantChangedLines: 0, coveredChangedLines: 0, annotations: [] };
  }

  const { totalChangedLines, relevantChangedLines, coveredChangedLines, annotations } =
    analyzeCoverageForLines(filePath, fileCoverage, changedLineNumbers);

  return { skipped: false, totalChangedLines, relevantChangedLines, coveredChangedLines, annotations };
}

function process({changedFiles, coverageData}) {
  let totalChangedLines = 0; // total count of changed lines
  let relevantChangedLines = 0; // count of changed lines that might be executed as part of the test suite (e.g. ignore specs, comments)
  let coveredChangedLines = 0; // count of changed lines that were executed
  const annotations = [];
  const skippedFiles = [];

  for (const file of changedFiles) {
    const result = processFile(file, coverageData);
    if (result.skipped) {
      skippedFiles.push(result.filename);
      continue;
    }
    totalChangedLines += result.totalChangedLines;
    relevantChangedLines += result.relevantChangedLines;
    coveredChangedLines += result.coveredChangedLines;
    annotations.push(...result.annotations);
  }

  return { totalChangedLines, relevantChangedLines, coveredChangedLines, annotations, skippedFiles };
}

function determineChangedLines(changedFiles) {
  const output = {};
  changedFiles.map(({filename, patch}) => {
    const changedLineNumbers = parseDiffHunks(patch);
    output[filename] = changedLineNumbers;
  });
  return output;
}

function calculateCoverage(coveredLines, relevantLines) {
  return relevantLines > 0
    ? Math.round((coveredLines / relevantLines) * 100)
    : 100;
}

function summarize({totalFiles, totalRelevantLines, totalCoveredLines, coveragePercentage, coveredChangedLines, totalChangedLines, relevantChangedLines, skippedFiles, changedLines}) {
  const title = `Coverage for changed lines: ${coveragePercentage}%`;
  const summary = `A total of ${totalChangedLines} lines haved changed in ${Object.keys(changedLines).length} files, of which ${relevantChangedLines} are relevant and ${coveredChangedLines} were executed.`;

  const totalCoveragePercent = calculateCoverage(totalCoveredLines, totalRelevantLines);
  let details = `${totalFiles} files in total.\n\n${totalRelevantLines} relevant lines, ${totalCoveredLines} lines covered and ${totalCoveredLines-totalRelevantLines} lines missed. (${totalCoveragePercent}%)`;
  if (skippedFiles.length > 0) {
    details += `\n\nSkipped ${skippedFiles.length} files not in coverage data:\n${skippedFiles.map(line => `- \`${line}\``).join('\n')}`;
  }
  if (Object.keys(changedLines).length > 0) {
    details += '\n\nChanged lines:';
    for(const [file, lines] of Object.entries(changedLines)) {
      details += `\n- \`${file}\`: lines ${compactLineNumbers(lines)}`;
    }
  }
  return {title, summary, details};
}

function passed({coveragePercentage, coverageThreshold}) {
  return coveragePercentage >= coverageThreshold;
}

// Create check run
async function createCheck({github, octokit, success, title, summary, details, annotations}) {
  const head_sha = determineCommitSha(github);
  core.info(`Adding check status to ${head_sha}`);
  return octokit.rest.checks.create({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    name: 'Code coverage',
    head_sha,
    status: 'completed',
    conclusion: success ? 'success' : 'failure',
    output: {
      title,
      summary,
      text: details,
      annotations: annotations
    }
  });
}

function determineCommitSha(github) {
  // Note that GITHUB_SHA for this event is the last merge commit of the pull request merge branch.
  // If you want to get the commit ID for the last commit to the head branch of the pull request,
  // use github.event.pull_request.head.sha instead.
  if (github.context.eventName == 'pull_request') {
    return github.event.pull_request.head.sha;
  }
  return github.context.sha;
}

// turn [1, 2, 3, 5, 6] into "1-3, 5-6"
function compactLineNumbers(lineNumbers) {
  if (lineNumbers.length === 0) return '';
  const ranges = [];
  let start = lineNumbers[0];
  let end = start;

  for (let i = 1; i < lineNumbers.length; i++) {
    const curr = lineNumbers[i];
    if (curr === end + 1) {
      end = curr;
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = curr;
    }
  }

  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(', ');
}

async function run() {
  try {
    // Get inputs
    const coverageFile = core.getInput('coverage-file', { required: true });
    const coverageThreshold = parseInt(core.getInput('coverage-threshold', { required: true }), 10);
    const token = core.getInput('github-token', { required: true });
    const annotate = core.getInput('annotate', { required: true }) == 'true';

    // Initialize GitHub client
    const octokit = github.getOctokit(token);
    const context = github.context;
    core.debug(JSON.stringify({context}, "\n", 2));

    const coverageData = read(coverageFile);
    const changedFiles = await determineChangedFiles({context, octokit});
    core.debug(JSON.stringify({changedFiles}, "\n", 2));

    const changedLines = determineChangedLines(changedFiles);
    const {totalFiles, totalRelevantLines, totalCoveredLines} = calculateTotalMetrics(coverageData);
    const {totalChangedLines, relevantChangedLines, coveredChangedLines, annotations, skippedFiles} = process({changedFiles, coverageData});
    core.debug(JSON.stringify({totalChangedLines, relevantChangedLines, coveredChangedLines, annotations, skippedFiles}, "\n", 2));

    const coveragePercentage = calculateCoverage(coveredChangedLines, relevantChangedLines);

    const {title, summary, details} = summarize({totalFiles, totalRelevantLines, totalCoveredLines, coveragePercentage, coveredChangedLines, relevantChangedLines, totalChangedLines, skippedFiles, changedLines});
    core.info([title, summary, details].join('\n\n'));

    const success = passed({coveragePercentage, coverageThreshold});
    if (annotate) await createCheck({github, octokit, success, title, summary, details, annotations});

    // Set outputs
    core.setOutput('coverage-percentage', coveragePercentage);
    core.setOutput('total-lines', totalChangedLines);
    core.setOutput('relevant-lines', relevantChangedLines);
    core.setOutput('covered-lines', coveredChangedLines);
    core.setOutput('skipped-files', skippedFiles.join(','));

    // Fail if coverage is below threshold
    if (!success) {
      core.setFailed(`Code coverage (${coveragePercentage}%) is below the required threshold (${coverageThreshold}%)`);
    }

  } catch (error) {
    console.error(error); // eslint-disable-line no-console

    // Fail the action with the original error message
    core.setFailed(error.message);
  }
}

module.exports = {read, determineChangedFiles, determineChangedLines, determineCommitSha, process, calculateCoverage, summarize, passed, createCheck, compactLineNumbers, run}
