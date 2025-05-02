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
    core.info(`Skipping file not in coverage data: ${file.filename}`);
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

function calculateCoverage({coveredChangedLines, relevantChangedLines}) {
  return relevantChangedLines > 0
    ? Math.round((coveredChangedLines / relevantChangedLines) * 100)
    : 100;
}

function summarize({coveragePercentage, coveredChangedLines, totalChangedLines, relevantChangedLines, skippedFiles}) {
  const summary = `Coverage for changed lines: ${coveragePercentage}% (${coveredChangedLines}/${relevantChangedLines})`;

  let details = `A total of ${totalChangedLines} lines haved changed, of which ${relevantChangedLines} are relevant and ${coveredChangedLines} were executed`;
  if (skippedFiles.length > 0) {
    details += `\n\nSkipped ${skippedFiles.length} files not in coverage data:\n${skippedFiles.map(line => `- ${line}`).join('\n')}`;
  }
  return {summary, details};
}

function passed({coveragePercentage, coverageThreshold}) {
  return coveragePercentage >= coverageThreshold;
}

// Create check run
async function createCheck({context, octokit, success, summary, details, annotations}) {
  return octokit.rest.checks.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    name: 'Code Coverage',
    head_sha: context.sha,
    status: 'completed',
    conclusion: success ? 'success' : 'failure',
    output: {
      title: 'Code Coverage Report',
      summary,
      text: details,
      annotations: annotations
    }
  });
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

    const coverageData = read(coverageFile);
    const changedFiles = await determineChangedFiles({context, octokit});

    const {totalChangedLines, relevantChangedLines, coveredChangedLines, annotations, skippedFiles} = process({changedFiles, coverageData});
    core.debug(JSON.stringify({totalChangedLines, relevantChangedLines, coveredChangedLines, annotations, skippedFiles}));

    const coveragePercentage = calculateCoverage({coveredChangedLines, relevantChangedLines});
    const {summary, details} = summarize({coveragePercentage, coveredChangedLines, relevantChangedLines, totalChangedLines, skippedFiles});
    core.info([summary, details].join('\n\n'));

    const success = passed({coveragePercentage, coverageThreshold});
    if (annotate) await createCheck({context, octokit, success, summary, details, annotations});
    
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
    core.setFailed(error.message);
  }
}

module.exports = {read, determineChangedFiles, determineChangedLines, process, calculateCoverage, summarize, passed, createCheck, run}
