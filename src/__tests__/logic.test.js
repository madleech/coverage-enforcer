const logic = require("../logic")

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

// Mock the required modules
jest.mock('@actions/core');
jest.mock('@actions/github');

// mock "fs" package
const readFileSyncMock = jest.spyOn(fs, 'readFileSync').mockImplementation()

describe('Coverage Annotator', () => {
  let mockOctokit;
  let mockContext;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock octokit
    mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn(),
        },
        repos: {
          compareCommits: jest.fn(),
        },
        checks: {
          create: jest.fn(),
        },
      },
    };

    // Setup mock context
    mockContext = {
      repo: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      sha: 'merge-sha',
      issue: {
        number: 123,
      },
      eventName: 'pull_request',
      payload: {
        pull_request: {
          head: {
            sha: "head-sha"
          }
        }
      }
    };

    // Setup core.getInput mock
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'coverage-file':
          return 'coverage.json';
        case 'coverage-threshold':
          return '80';
        case 'github-token':
          return 'test-token';
        case 'annotate':
          return 'true';
        default:
          return '';
      }
    });

    // Setup github.getOctokit mock
    github.getOctokit.mockReturnValue(mockOctokit);
    github.context = mockContext;
  });


  describe('read', () => {
    it('reads coverage data', () => {
      const path = 'coverage.json';
      const coverageData = {
        'src/file1.js': [1, 0, null, 1, 0, 1, 1, 1, 1, 1], // 10 lines, with lines 2 and 5 uncovered
      };
      readFileSyncMock.mockReturnValue(JSON.stringify(coverageData));

      const result = logic.read(path);
      expect(result).toEqual(coverageData);
      expect(fs.readFileSync).toHaveBeenCalledWith(path, 'utf8');

    })
  })

  describe('determineChangedFiles', () => {
    it('returns details of changed files for a PR', async () => {
      // Mock pull request files response
      const mockFiles = [
        { filename: 'src/file1.js', patch: 'patch1' },
        { filename: 'src/file2.js', patch: 'patch2' }
      ];
      mockOctokit.rest.pulls.listFiles.mockResolvedValue({ data: mockFiles });

      // Set context to pull request
      mockContext.eventName = 'pull_request';

      const result = await logic.determineChangedFiles({ context: mockContext, octokit: mockOctokit });

      // Verify the correct API was called with right parameters
      expect(mockOctokit.rest.pulls.listFiles).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123
      });

      // Verify the result
      expect(result).toEqual(mockFiles);
    });

    it('returns details of changed files for a push', async () => {
      // Mock compare commits response
      const mockFiles = [
        { filename: 'src/file1.js', patch: 'patch1' },
        { filename: 'src/file2.js', patch: 'patch2' }
      ];
      mockOctokit.rest.repos.compareCommits.mockResolvedValue({
        data: { files: mockFiles }
      });

      // Set context to push event
      mockContext.eventName = 'push';
      mockContext.payload = {
        repository: {
          default_branch: 'main'
        }
      };

      const result = await logic.determineChangedFiles({ context: mockContext, octokit: mockOctokit });

      // Verify the correct API was called with right parameters
      expect(mockOctokit.rest.repos.compareCommits).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        base: 'main',
        head: 'merge-sha'
      });

      // Verify the result
      expect(result).toEqual(mockFiles);
    });
  })

  describe('determineChangedLines', () => {
    it('calculated changed line numbers', () => {
      const diff = [
        {
          filename: 'src/file1.js',
          patch: '@@ -6,7 +6,8 @@ module LiveSession\n' +
            '       class Available < API::Action\n' +
            '         include Deps[\n' +
            '           :logger,\n' +
            '-          live_session_repo: "repositories.live_session"\n' +
            '+          live_session_repo: "repositories.live_session",\n' +
            '+          live_session_event_repo: "repositories.live_session_event"\n' +
            '         ]\n' +
            ' \n' +
            '         contract do'
        }
      ];

      const expected = {
        'src/file1.js': [9, 10]
      }

      expect(logic.determineChangedLines(diff)).toEqual(expected);
    })
  })

  describe('compactLineNumbers', () => {
    it('generates ranges from line numbers', () => {
      const input = [1, 2, 3, 4, 8, 10, 11, 12, 14, 15];
      const expected = '1-4, 8, 10-12, 14-15';
      expect(logic.compactLineNumbers(input)).toEqual(expected);
    })
  })

  describe('determineCommitSha', () => {
    it('finds SHA for pull request events', () => {
      mockContext.eventName = 'pull_request';
      mockContext.payload.pull_request.head.sha = 'abc1234';

      expect(logic.determineCommitSha(github)).toEqual('abc1234');
    })

    it('finds SHA for commits', () => {
      mockContext.eventName = 'commit';
      mockContext.sha = 'abc1234';

      expect(logic.determineCommitSha(github)).toEqual('abc1234');
    })
  })

  describe('analyzeCoverageForLines', () => {
    it('finds changes', () => {
      const filePath = 'slices/clinic/mailers/order_confirmation_mailer.rb';
      const fileCoverage = [
        null, null, 1,    null, 1,    1,    1,    1,
        null, 1,    1,    1,    null, 1,    null, 1,
        null, 1,    30,   30,   null, null, null, null,
        1,    18,   null, null, 18,   null, 9,    null,
        9,    null, null, 18,   null, null, 1,    null,
        null, null, null, null, null, null, null
      ];
      const changedLineNumbers = [
          1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11,
        12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
        23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
        34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
        45, 46, 47
      ];

      const result = logic.analyzeCoverageForLines(filePath, fileCoverage, changedLineNumbers);

      console.log({result});
    })

    it('finds changes for simple example', () => {
      const filePath = 'slices/clinic/mailers/order_confirmation_mailer.rb';
      const fileCoverage = [
        null, null, 1,    null, 1,    1,    1,    1,
        null, 1,    1,    1,    null, 1,    null, 1,
        null, 1,    30,   30,   null, null, null, null,
        1,    18,   null, null, 18,   null, 9,    null,
        9,    null, null, 18,   null, null, 1,    null,
        null, null, null, null, null, null, null
      ];
      const changedLineNumbers = [
          1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11,
        12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
        23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
        34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
        45, 46, 47
      ];

      const result = logic.analyzeCoverageForLines(filePath, fileCoverage, changedLineNumbers);

      console.log({result});
    })
  })

  it('should process pull request changes and create annotations for specific changed lines', async () => {
    // Mock coverage data
    const coverageData = {
      'src/file1.js': [1, 0, null, 1, 0, 1, 1, 1, 1, 1], // 10 lines, with lines 2 and 5 uncovered
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(coverageData));

    // Mock pull request files with specific line changes
    mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [
        {
          filename: 'src/file1.js',
          patch: `@@ -1,5 +1,5 @@
+1
+2
+3
+4
+5
@@ -6,5 +6,5 @@
+6
+7
+8
+9
+10`,
        },
      ],
    });

    // Import and run the action
    logic.run()

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify check run creation
    expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      name: 'Code coverage',
      head_sha: 'head-sha',
      status: 'completed',
      conclusion: 'failure', // Should fail as coverage is below 80%
      output: expect.objectContaining({
        title: 'Coverage for changed lines: 78%',
        summary: expect.stringContaining('lines haved changed'),
        annotations: expect.arrayContaining([
          expect.objectContaining({
            path: 'src/file1.js',
            start_line: 2,
            end_line: 2,
            annotation_level: 'warning',
            message: 'This line has no test coverage',
          }),
          expect.objectContaining({
            path: 'src/file1.js',
            start_line: 5,
            end_line: 5,
            annotation_level: 'warning',
            message: 'This line has no test coverage',
          }),
        ]),
      }),
    });
  });

  it('should handle push events with specific line changes', async () => {
    // Change context to push event
    mockContext.eventName = 'push';
    mockContext.payload = {
      repository: {
        default_branch: 'main',
      },
    };

    // Mock coverage data
    const coverageData = {
      'src/file1.js': [1, 1, null, 0, 1], // 5 lines, with line 4 uncovered
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(coverageData));

    // Mock compare commits response with specific line changes
    mockOctokit.rest.repos.compareCommits.mockResolvedValue({
      data: {
        files: [
          {
            filename: 'src/file1.js',
            patch: `@@ -1,5 +1,5 @@
+1
+2
+3
+4
+5`,
          },
        ],
      },
    });

    // Import and run the action
    logic.run()

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify check run creation with correct line annotations
    expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      name: 'Code coverage',
      head_sha: 'merge-sha',
      status: 'completed',
      conclusion: 'failure',
      output: expect.objectContaining({
        annotations: expect.arrayContaining([
          expect.objectContaining({
            path: 'src/file1.js',
            start_line: 4,
            end_line: 4,
            annotation_level: 'warning',
            message: 'This line has no test coverage',
          }),
        ]),
      }),
    });
  });

  it('should handle empty patches', async () => {
    // Mock coverage data
    const coverageData = {
      'src/file1.js': [1, 1, 1],
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(coverageData));

    // Mock pull request files with no changes
    mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [
        {
          filename: 'src/file1.js',
          patch: null,
        },
      ],
    });

    // Import and run the action
    logic.run()

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify check run creation with no annotations
    expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      name: 'Code coverage',
      head_sha: 'head-sha',
      status: 'completed',
      conclusion: 'success',
      output: expect.objectContaining({
        annotations: [],
      }),
    });
  });

  it('should ignore renamed files', async () => {
    // Mock coverage data
    const coverageData = {
      'src/new-name.js': [1, 0, 1],
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(coverageData));

    // Mock pull request files with a renamed file
    mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [
        {
          filename: 'src/new-name.js',
          previous_filename: 'src/old-name.js',
          patch: null, // No patch indicates pure rename
        },
        {
          filename: 'src/changed.js',
          patch: `@@ -1,3 +1,3 @@
+1
+2
+3`,
        },
      ],
    });

    // Import and run the action
    logic.run()

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify check run creation with no annotations for renamed file
    expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      name: 'Code coverage',
      head_sha: 'head-sha',
      status: 'completed',
      conclusion: 'success',
      output: expect.objectContaining({
        annotations: [],
      }),
    });

    // Verify that core.info was called for the renamed file
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Skipping renamed file: src/new-name.js')
    );
  });

  it('should handle renamed files with content changes', async () => {
    // Mock coverage data
    const coverageData = {
      'src/new-name.js': [1, 0, 1],
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(coverageData));

    // Mock pull request files with a renamed file that also has content changes
    mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [
        {
          filename: 'src/new-name.js',
          previous_filename: 'src/old-name.js',
          patch: `@@ -1,3 +1,3 @@
+1
+2
+3`,
        },
      ],
    });

    // Import and run the action
    logic.run()

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify check run creation with annotations for the changed content
    expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      name: 'Code coverage',
      head_sha: 'head-sha',
      status: 'completed',
      conclusion: 'failure',
      output: expect.objectContaining({
        annotations: expect.arrayContaining([
          expect.objectContaining({
            path: 'src/new-name.js',
            start_line: 2,
            end_line: 2,
            annotation_level: 'warning',
            message: 'This line has no test coverage',
          }),
        ]),
      }),
    });
  });

  it('should skip files not in coverage data', async () => {
    // Mock coverage data with only test files
    const coverageData = {
      'src/test.js': [1, 1, 1],
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(coverageData));

    // Mock pull request files with both test and non-test files
    mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [
        {
          filename: 'src/test.js',
          patch: `@@ -1,3 +1,3 @@
+1
+2
+3`,
        },
        {
          filename: 'README.md',
          patch: `@@ -1,3 +1,3 @@
+1
+2
+3`,
        },
      ],
    });

    // Import and run the action
    logic.run()

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify check run creation with summary of skipped files
    expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      name: 'Code coverage',
      head_sha: 'head-sha',
      status: 'completed',
      conclusion: 'success',
      output: expect.objectContaining({
        title: 'Coverage for changed lines: 100%',
        summary: 'A total of 3 lines haved changed in 2 files, of which 3 are relevant and 3 were executed.',
        text: expect.stringContaining('Skipped 1 files not in coverage data:\n- `README.md`'),
        annotations: [],
      }),
    });
  });

  it('logs error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Simulate a failure when reading the coverage file
    readFileSyncMock.mockImplementation(() => {
      throw new Error('Test error');
    });

    // Execute the action
    await logic.run();

    // Expect the error to have been logged via core.setFailed
    expect(core.setFailed).toHaveBeenCalledWith('Test error');
    expect(console.error).toHaveBeenCalled(); // eslint-disable-line no-console
  })
});
