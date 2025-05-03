# Coverage Enforcer

A GitHub Action that annotates pull requests with code coverage information for changed lines. It helps maintain code quality by highlighting lines that have been changed but lack test coverage.

## Motivation

I strive for 100% coverage in my codebases.

## Features

- Annotates pull requests with uncovered lines
- Groups sequential uncovered lines into single annotations
- Calculates coverage percentage for changed lines
- Fails the check if coverage is below the configured threshold
- Works with both pull requests and direct pushes to branches

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
