import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface RepoConfig {
  /** Where to clone from. `https` for anything the token authenticates. */
  url: string;
  /** The credential, held by the runtime and never by the session. */
  token?: string;
  /**
   * The user the token goes with. GitHub wants `x-access-token`, GitLab wants
   * `oauth2`, and the provider is what knows — so it comes with the credential
   * rather than being assumed here (ADR-0024).
   */
  username?: string;
  /** The branch a Run starts from. */
  baseBranch: string;
}

export interface Workspace {
  /** The directory the session runs in. */
  cwd: string;
  /** The repository it holds, or null when this runtime has none configured. */
  repo: RepoConfig | null;
  /** Runs git in this working directory, with the credential the session never sees. */
  git(args: string[]): Promise<string>;
  /** Removes the directory, whatever happened in it. */
  release(): Promise<void>;
}

/**
 * The credential, as arguments rather than as a URL.
 *
 * A token embedded in the remote URL is written into `.git/config`, where the
 * shell the session holds can read it. `http.extraHeader` passed with `-c` is
 * never persisted, so the working directory the session gets carries no
 * credential at all — which is the whole point of the supervisor owning git
 * (docs/plans/m4.md).
 */
export function authArgs(token: string | undefined, username = "x-access-token"): string[] {
  if (!token) return [];
  const basic = Buffer.from(`${username}:${token}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
}

export interface WorkspaceOptions {
  /** Where working directories are made. Defaults to the system temporary one. */
  root?: string;
  /** The repository to clone, or null for an empty directory. */
  repo?: RepoConfig | null;
  /** Names the directory after the Run, so two Runs cannot share one. */
  runId: string;
  /**
   * What `origin` points at once the clone is made: the supervisor's own git
   * proxy, so the session pushes to loopback and the credential stays here
   * (src/git-proxy.ts). Absent, `origin` is the remote itself, which is what a
   * runtime with no repository or no credential has anyway.
   */
  originUrl?: string;
}

/**
 * One working directory per Run: cloned before the session, removed after it,
 * whatever the outcome.
 *
 * A clone per Run is the honest default. It is the only arrangement in which
 * two Runs cannot see each other's half-finished work, and the cost is a clone
 * an operator can trade away by pointing `DEEVY_AGENT_WORKDIR` at a filesystem
 * that makes it cheap.
 */
export async function openWorkspace(options: WorkspaceOptions): Promise<Workspace> {
  const base = options.root ?? tmpdir();
  const cwd = await mkdtemp(join(base, `deevy-${options.runId.slice(0, 8)}-`));
  const repo = options.repo ?? null;
  const auth = authArgs(repo?.token, repo?.username);

  // `safe.directory` because the session owns this tree and the supervisor
  // does not: git refuses a repository owned by another user unless told, and
  // the supervisor is the one that has to read what the session left
  // (src/session-user.ts).
  const git = async (args: string[]): Promise<string> => {
    const { stdout } = await run("git", [
      ...auth,
      "-c",
      `safe.directory=${cwd}`,
      "-C",
      cwd,
      ...args,
    ]);
    return stdout.trim();
  };

  if (repo) {
    try {
      await run("git", [
        ...auth,
        "clone",
        "--depth",
        "1",
        "--branch",
        repo.baseBranch,
        repo.url,
        cwd,
      ]);
    } catch (error) {
      await rm(cwd, { recursive: true, force: true });
      // Naming the repository and the branch, and never the token: the message
      // ends up in an Activity a Human reads.
      throw new Error(
        `Could not clone ${repo.url} at ${repo.baseBranch}: ${redact(error, repo.token)}`,
      );
    }
  }

  // The clone was made with the credential; what the session inherits is a
  // loopback address, so a `git remote -v` in the session shows the supervisor
  // and a push reaches the world through it (docs/plans/agent-owns-git.md).
  if (repo && options.originUrl) await git(["remote", "set-url", "origin", options.originUrl]);

  return {
    cwd,
    repo,
    git,
    release: () => rm(cwd, { recursive: true, force: true }),
  };
}

/** Whatever git said, with the credential taken out of it. */
function redact(error: unknown, token: string | undefined): string {
  const said = error instanceof Error ? error.message : String(error);
  const withoutHeader = said.replace(
    /Authorization: Basic \S+/g,
    "Authorization: Basic <redacted>",
  );
  return token ? withoutHeader.replaceAll(token, "<redacted>") : withoutHeader;
}
