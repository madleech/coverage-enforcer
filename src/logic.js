const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const File = require('./file');
const util = require('./util');

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

function mapToFiles({coverageData, changedFiles}) {
  return changedFiles.map((file) => {
    const skipped = isRenamedOnly(file);
    const changedLineNumbers = parseDiffHunks(file.patch);
    return new File({
      name: file.filename,
      skipped,
      changedLines: changedLineNumbers,
      coverageData: coverageData[file.filename]
    })
  })
}

function mapToAnnotations(files) {
  const annotations = []
  files.forEach(file => annotations.push(...file.annotations));
  return annotations;
}

function calculateCoverage(files) {
  const relevantLines = util.sum(files.map(file => file.relevantLinesCount));
  const relevantExecutedLines = util.sum(files.map(file => file.relevantExecutedLinesCount));
  return relevantLines > 0
    ? (relevantExecutedLines / relevantLines) * 100
    : 100;
}

// Calculate total coverage across all files in the coverage data
function calculateTotalCoverageMetrics(coverageData) {
  let totalExecutableLines = 0;
  let totalExecutedLines = 0;
  const totalFiles = Object.keys(coverageData).length;

  for (const filePath in coverageData) {
    const lineCounts = coverageData[filePath];
    for (const count of lineCounts) {
      // null means line is not executable (comments, blank lines)
      if (count !== null) {
        totalExecutableLines++;
        // count > 0 means line was executed
        if (count > 0) {
          totalExecutedLines++;
        }
      }
    }
  }

  const coveragePercentage = totalExecutableLines > 0
    ? (totalExecutedLines / totalExecutableLines) * 100
    : 100;

  return {
    coveragePercentage: util.roundToPrecision(coveragePercentage, 3),
    totalExecutableLines,
    totalExecutedLines,
    TotalMissedLines: totalExecutableLines - totalExecutedLines,
    totalFiles
  }
}

function calculateChangedLinesCount(files) {
  return util.sum(files.map(file => file.changedLinesCount));
}

// generate summary for attaching to check.
//
// title = shown next to check. Very short summary.
// summary = shown at top of job.
// details = shown in body of job, contains full details of job
function summarize({files, relevantFiles, coveragePercentage, totalCoverageMetrics}) {
  const totalRelevantChangedLines = util.sum(relevantFiles.map(file => file.relevantLinesCount));

  const title = `Coverage for changed lines: ${util.formatPercent(coveragePercentage)}`;
  const summary = `Based on ${totalRelevantChangedLines} lines changed in ${relevantFiles.length} files.`;
  let details = [
    "| File | Skipped | Changed Lines | Changed Unexecuted Lines | Coverage |",
    "|:-----|:-------:|---------------|--------------------------|---------:|",
  ];
  files.forEach(file => {
    if (file.skipped) {
      details.push(
        `| ${file.name} | ✓ | ${file.changedLinesCount} | - | - |`
      )
    } else {
      details.push(
        `| ${file.name} | - | ${file.changedLinesCount} | ${file.relevantMissedLinesCount} | ${util.formatPercent(file.coveragePercent)} |`
      )
    }
  });

  // add in overall test suite metrics:
  //   - total lines executed
  //   - total lines not executed
  //   - total lines in suite
  //   - total files in suite
  details.push(...["", "## Overall test suite metrics", ""]);
  details.push("| Metric | Value |");
  details.push("|:-------|------:|");
  details.push(`| Executed lines | ${totalCoverageMetrics.totalExecutedLines} |`);
  details.push(`| Missed lines | ${totalCoverageMetrics.TotalMissedLines} |`);
  details.push(`| Total lines | ${totalCoverageMetrics.totalExecutableLines} |`);
  details.push(`| Total files | ${totalCoverageMetrics.totalFiles} |`);
  details.push(`| Total coverage | ${util.formatPercent(totalCoverageMetrics.coveragePercentage, 2)} |`);

  return {title, summary, details: details.join('\n')}
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
    return github.context.payload.pull_request.head.sha;
  }
  return github.context.sha;
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
    // core.debug(JSON.stringify({context}, "\n", 2));

    const coverageData = read(coverageFile);
    const changedFiles = await determineChangedFiles({context, octokit});
    const files = mapToFiles({coverageData, changedFiles});
    const relevantFiles = files.filter(file => !file.skipped);
    // core.debug(JSON.stringify({files}, "\n", 2));

    const annotations = mapToAnnotations(relevantFiles);
    const coveragePercentage = calculateCoverage(relevantFiles);
    const totalCoverageMetrics = calculateTotalCoverageMetrics(coverageData);
    const changedLinesCount = calculateChangedLinesCount(relevantFiles);
    const {title, summary, details} = summarize({files, relevantFiles, coveragePercentage, totalCoverageMetrics});
    core.debug(JSON.stringify({annotations}, "\n", 2));
    core.info([title, summary, details].join('\n\n'));

    const success = passed({coveragePercentage, coverageThreshold});
    if (annotate) await createCheck({github, octokit, success, title, summary, details, annotations});

    // Set outputs
    core.setOutput('coverage-percentage', coveragePercentage);
    core.setOutput('total-coverage-percentage', totalCoverageMetrics.coveragePercentage);
    core.setOutput('total-executable-lines', totalCoverageMetrics.totalExecutableLines);
    core.setOutput('total-executed-lines', totalCoverageMetrics.totalExecutedLines);
    core.setOutput('total-missed-lines', totalCoverageMetrics.TotalMissedLines);
    core.setOutput('total-files', totalCoverageMetrics.totalFiles);
    core.setOutput('changed-lines', changedLinesCount);

    // Fail if coverage is below threshold
    if (!success) {
      core.setFailed(`Code coverage (${util.formatPercent(coveragePercentage)}) is below the required threshold (${coverageThreshold}%)`);
    }

  } catch (error) {
    console.error(error); // eslint-disable-line no-console

    // Fail the action with the original error message
    core.setFailed(error.message);
  }
}

module.exports = {read, determineChangedFiles, determineCommitSha, calculateCoverage, calculateTotalCoverageMetrics, summarize, passed, createCheck, run}
