const { execFileSync } = require("child_process");
const path = require("path");

// Cache: keyed by filePath, stores { info, timestamp }
const gitInfoCache = new Map();
const CACHE_TTL_MS = 5000;

// git availability (cached for process lifetime)
let gitAvailable = null;

function isGitAvailable() {
  if (gitAvailable !== null) return gitAvailable;
  try {
    execFileSync("git", ["--version"], {
      stdio: "pipe",
      timeout: 3000,
      windowsHide: true,
    });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

/**
 * Get comprehensive git info for a file.
 * Returns null if git is unavailable, file is not in a repo, or file is untracked.
 */
function getGitInfo(filePath) {
  if (!filePath) return null;
  if (!isGitAvailable()) return null;

  const cached = gitInfoCache.get(filePath);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.info;
  }

  const cwd = path.dirname(filePath);
  const execOpts = {
    cwd,
    stdio: "pipe",
    timeout: 5000,
    windowsHide: true,
    encoding: "utf-8",
  };

  try {
    // 1. Get repo root (confirms we're in a repo)
    const repoRoot = execFileSync(
      "git", ["rev-parse", "--show-toplevel"], execOpts
    ).trim();

    // 2. Check if file is tracked
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", relPath], {
        ...execOpts,
        cwd: repoRoot,
      });
    } catch {
      gitInfoCache.set(filePath, { info: null, timestamp: Date.now() });
      return null;
    }

    // 3. Branch name
    let branch;
    try {
      branch = execFileSync(
        "git", ["rev-parse", "--abbrev-ref", "HEAD"], execOpts
      ).trim();
    } catch {
      branch = "HEAD";
    }

    // 4. Short commit hash
    let commitHash;
    try {
      commitHash = execFileSync(
        "git", ["rev-parse", "--short", "HEAD"], execOpts
      ).trim();
    } catch {
      commitHash = "-------";
    }

    // 5. Commit count on current branch
    let commitCount = 0;
    try {
      const count = execFileSync(
        "git", ["rev-list", "--count", "HEAD"], execOpts
      ).trim();
      commitCount = parseInt(count, 10) || 0;
    } catch {
      commitCount = 0;
    }

    const info = {
      repoName: path.basename(repoRoot),
      branch,
      commitHash,
      commitCount,
      isTracked: true,
    };

    gitInfoCache.set(filePath, { info, timestamp: Date.now() });
    return info;
  } catch {
    gitInfoCache.set(filePath, { info: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Get the HEAD version of a file's content.
 */
function getGitFileContent(filePath) {
  if (!filePath) return null;
  if (!isGitAvailable()) return null;

  const cwd = path.dirname(filePath);
  const execOpts = {
    cwd,
    stdio: "pipe",
    timeout: 5000,
    windowsHide: true,
    encoding: "utf-8",
  };

  try {
    const repoRoot = execFileSync(
      "git", ["rev-parse", "--show-toplevel"], execOpts
    ).trim();
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    return execFileSync(
      "git", ["show", `HEAD:${relPath}`], { ...execOpts, cwd: repoRoot }
    );
  } catch {
    return null;
  }
}

function invalidateGitCache(filePath) {
  if (filePath) gitInfoCache.delete(filePath);
}

module.exports = {
  isGitAvailable,
  getGitInfo,
  getGitFileContent,
  invalidateGitCache,
};
