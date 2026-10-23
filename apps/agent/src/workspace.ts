import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { refsFrom } from "./refs.ts";
import { handOver, type SessionUser } from "./session-user.ts";

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
  /**
   * The remote as the supervisor reaches it: the git proxy it opened for the
   * Run, or the repository itself where there is none, and null with no
   * repository. Fixed when the workspace is opened and never read back from
   * the clone, whose `origin` is the session's to point anywhere.
   */
  remote: string | null;
  /**
   * Runs git in this working directory, as the session's user and with no
   * credential the session could find, stopped when `signal` is.
   */
  git(args: string[], options?: { signal?: AbortSignal }): Promise<string>;
  /**
   * The refs `remote` holds now, as `git ls-remote` reads them, narrowed by
   * `patterns` the way its own are; none with no repository. Asked by a git
   * with no repository around it, so nothing in the clone — its `origin`, a
   * `url.*.insteadOf`, a remote named after the URL — has a say in the answer.
   */
  refs(patterns?: string[], options?: { signal?: AbortSignal }): Promise<Map<string, string>>;
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
  /**
   * Who the clone commits as: the Agent, by its name and deevy's address for
   * it. The session commits in the clone itself (ADR-0019), and git refuses a
   * commit with no identity, so it is set once here rather than left for
   * every session to find out.
   */
  author?: { name: string; email: string };
  /** The repository to clone, or null for an empty directory. */
  repo?: RepoConfig | null;
  /** Names the directory after the Run, so two Runs cannot share one. */
  runId: string;
  /**
   * What `origin` points at once the clone is made: the supervisor's own git
   * proxy, so the session pushes to loopback and the credential stays here
   * (src/git-proxy.ts). Absent, `origin` is the remote itself, which is what a
   * runtime with no repository or no credential has anyway. Either way it is
   * the workspace's `remote`, which stays put whatever `origin` says later.
   */
  originUrl?: string;
  /**
   * The user the session runs as, when the runtime can make it one
   * (src/session-user.ts). The clone is handed to it once it is made, and
   * every git command run in it afterwards — the supervisor's delivery and
   * its reading of what moved included — runs as that user, never as root.
   */
  user?: SessionUser;
}

/**
 * What every git the supervisor runs in a session's clone is told, ahead of
 * whatever the clone's own configuration says: no hooks, and no fsmonitor.
 * Not the boundary — that is the user it runs as — but a planted one cannot
 * make the supervisor wait on it either.
 */
const unplanted = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

/**
 * The environment that git runs with: enough to find git, and none of this
 * process's own. A command the clone's configuration names runs with it, so
 * the Agent's key and the git token are not in it, and neither is the
 * operator's or the image's git configuration, nor a terminal to ask on.
 */
function isolated(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
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

  const user = options.user ?? null;
  // Once the clone is made, it is the session's: its `.git/config` and its
  // hooks are whatever the session wrote, and git runs what they name — an
  // fsmonitor, a filter, a hook — as whoever runs git. So the supervisor's own
  // git in it runs as the session, with an environment that holds nothing of
  // this process's, and without the credential: `origin` is the git proxy,
  // which adds it on the way out (src/git-proxy.ts). Hooks and the fsmonitor
  // are turned off as well, so nothing the session planted can stall a push
  // the supervisor makes for it. A clone with no proxy in front of it keeps
  // the credential only where there is no session user to keep it from.
  //
  // There is no `safe.directory` either. The tree and the git reading it are
  // the same user, so git has nothing to refuse; were the supervisor ever to
  // run git as itself in a tree the session owns, git refusing it is the
  // right answer.
  const credential = !options.originUrl && !user ? auth : [];
  const git = async (args: string[], how: { signal?: AbortSignal } = {}): Promise<string> => {
    const { stdout } = await run("git", [...unplanted, ...credential, "-C", cwd, ...args], {
      env: isolated(),
      ...(user ? { uid: user.uid, gid: user.gid } : {}),
      ...(how.signal ? { signal: how.signal } : {}),
    });
    return stdout.trim();
  };
  // Where the supervisor reads the remote and pushes, named now: from the
  // moment the clone is handed over, its `origin` says whatever the session
  // last wrote there.
  const remote = repo ? (options.originUrl ?? repo.url) : null;
  // What the remote holds, asked from `/` rather than in the clone. In the
  // clone, git reads the clone's configuration before it reads the URL it was
  // given, and a `url.*.insteadOf` there sends even an explicit one somewhere
  // else. `/` has no repository and is not somewhere the session can make one,
  // so this git has no configuration but the environment's, which is none. As
  // the session's user, like every git here.
  const refs = async (
    patterns: string[] = [],
    how: { signal?: AbortSignal } = {},
  ): Promise<Map<string, string>> => {
    if (!remote) return new Map();
    const { stdout } = await run("git", [...credential, "ls-remote", remote, ...patterns], {
      cwd: "/",
      env: isolated(),
      ...(user ? { uid: user.uid, gid: user.gid } : {}),
      ...(how.signal ? { signal: how.signal } : {}),
    });
    return refsFrom(stdout);
  };
  // The supervisor's own, for the moments before the clone is anybody else's:
  // a fresh clone of the remote holds no hook and no configuration the remote
  // could have shipped, because git clones neither.
  const setUp = (args: string[]) => run("git", ["-C", cwd, ...args]);

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
  if (repo && options.originUrl) await setUp(["remote", "set-url", "origin", options.originUrl]);
  if (repo && options.author) {
    await setUp(["config", "--local", "user.name", options.author.name]);
    await setUp(["config", "--local", "user.email", options.author.email]);
  }
  if (user) await handOver(cwd, user);

  return {
    cwd,
    repo,
    remote,
    git,
    refs,
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
