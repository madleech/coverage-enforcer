# Coverage Enforcer

A GitHub Action that annotates pull requests with code coverage information for changed lines. It helps maintain code quality by highlighting lines that have been changed but lack test coverage.

## Motivation

I strive for 100% coverage. However often when working on legacy codebases, the existing levels of coverage leave much to be desired. I have found the lowest-friction way to improve coverage on these codebases is to set a very high coverage target for all _new_ code. By providng line-by-line coverage feedback, we can provide instant feedback in pull requests of committed changes that lack test coverage.

The most crucial difference between line-by-line coverage feedback on modified lines, versus coverage feedback on entire files, is that it allows you to make small, targeted fixes in legacy code, without being penalised for missing test coverage in the rest of the file.

## Features

- Annotates pull requests, flagging lines that have changed but are not executed by the test suite.
- Calculates coverage percentage for changed lines.
- Fails the check if total coverage for changed lines is below the configured threshold.
- Works with both pull requests and direct pushes to branches.

## Example

**Check summary** – showing details on the files that were changed, whether they were part of the test suite, the number of lines that were changed, and the resulting coverage of those changed lines:
![Check summary](https://github.com/madleech/coverage-enforcer/blob/master/doc/check-summary.png?raw=true)

**Annotation** – highlighting an unreachable code block:
![Check summary](https://github.com/madleech/coverage-enforcer/blob/master/doc/annotation.png?raw=true)

## Usage

To use in a Github workflow, run your tests as normal, then add the following step:
```yaml
    - uses: madleech/coverage-enforcer
      with:
        coverage-threshold: 100
```

This will read in `coverage.json` with the following format:
```json
{
  "test.rb": [null, null, 1, 1, 0, null]
}
```

To convert your test coverage to the required format, use `madleech/coverage-converter-simplecov`.

## Permissions Required

This check requires the following permissions:

* `checks: write` – To add check details to the PR
* `contents: read` – To compare two commits
* `pull-requests: read` – To list files in the PR

## Inputs

### `coverage-file`

**Required** Path to the JSON file containing coverage data. The file should be a JSON object where:
- Keys are file paths
- Values are arrays of execution counts for each line
  - `0` = line not covered
  - `>0` = line covered
  - `null` = line ignored (comments, blank lines)

Defaults to `coverage.json`.

### `coverage-threshold`

**Required** Minimum coverage percentage required for changed lines. Default: `90`

### `github-token`

**Required** GitHub token for API access. Typically `${{ secrets.GITHUB_TOKEN }}`
