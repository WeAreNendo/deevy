/*
 * Brand marks for the sign-in buttons, and nothing else.
 *
 * - GitHub's, GitLab's, Linear's and Atlassian's marks are Simple Icons
 *   16.32.0 (`siGithub`, `siGitlab`, `siLinear`, `siAtlassian`; CC0-1.0,
 *   simpleicons.org), used as each brand's guidelines allow for naming a
 *   sign-in: github.com/logos, GitLab's trademark guidelines, linear.app's
 *   brand page and Atlassian's partner brand guidelines.
 * - Google's G is the four-colour mark from Google's "Sign in with Google"
 *   branding guidelines (developers.google.com/identity/branding-guidelines),
 *   which require it in its own colours on a sign-in button.
 * - Microsoft's four squares are the logo its identity platform's branding
 *   guidelines give for a "Sign in with Microsoft" button
 *   (learn.microsoft.com/entra/identity-platform/howto-add-branding-in-apps).
 * - Slack's hash is the logo slack.com serves (a.slack-edge.com, 2026-09-26),
 *   in its four colours, as Slack's "Sign in with Slack" button shows it.
 *
 * Adopted 2026-09-26. The marks are decoration: a button's name stays
 * "Continue with <provider>".
 */
import { useId, type ComponentProps } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function GitHubMark() {
  return (
    <svg
      data-mark="github"
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="currentColor"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg data-mark="google" aria-hidden="true" viewBox="0 0 48 48" className="size-5">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function GitLabMark() {
  return (
    <svg
      data-mark="gitlab"
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 text-(--brand-gitlab-mark)"
      fill="currentColor"
    >
      <path d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg data-mark="microsoft" aria-hidden="true" viewBox="0 0 21 21" className="size-5">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function LinearMark() {
  return (
    <svg
      data-mark="linear"
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 text-(--brand-linear-mark)"
      fill="currentColor"
    >
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  );
}

function SlackMark() {
  return (
    <svg data-mark="slack" aria-hidden="true" viewBox="0 0 54 54" className="size-5">
      <path
        fill="#E3066A"
        d="M11.379 33.9993C11.379 37.1358 8.84512 39.6507 5.7276 39.6507C2.61008 39.6507 0.0572205 37.1168 0.0572205 33.9993C0.0572205 30.8817 2.5911 28.3479 5.70862 28.3479H11.36V33.9993H11.379Z"
      />
      <path
        fill="#E3066A"
        d="M14.1962 33.9997C14.1962 30.8632 16.7301 28.3483 19.8476 28.3483C22.9651 28.3483 25.499 30.8822 25.499 33.9997V48.1353C25.499 51.2718 22.9651 53.7867 19.8476 53.7867C16.7301 53.7867 14.1962 51.2718 14.1962 48.1353V33.9997Z"
      />
      <path
        fill="#00B3FF"
        d="M19.8662 11.2673C16.7296 11.2673 14.2148 8.73347 14.2148 5.61594C14.2148 2.49842 16.7486 -0.0354538 19.8662 -0.0354538C22.9837 -0.0354538 25.5175 2.49842 25.5175 5.61594V11.2673H19.8662Z"
      />
      <path
        fill="#00B3FF"
        d="M19.8682 14.1334C23.0047 14.1334 25.5196 16.6673 25.5196 19.7848C25.5196 22.9023 22.9857 25.4362 19.8682 25.4362H5.67566C2.53916 25.4362 0.0242615 22.9023 0.0242615 19.7848C0.0242615 16.6673 2.55814 14.1334 5.67566 14.1334H19.8682Z"
      />
      <path
        fill="#41B658"
        d="M42.5323 19.7853C42.5323 16.6488 45.0662 14.1339 48.1837 14.1339C51.3012 14.1339 53.8351 16.6678 53.8351 19.7853C53.8351 22.9028 51.3012 25.4367 48.1837 25.4367H42.5323V19.7853Z"
      />
      <path
        fill="#41B658"
        d="M39.7126 19.7934C39.7126 22.9299 37.1787 25.4448 34.0612 25.4448C30.9436 25.4448 28.4098 22.911 28.4098 19.7934V5.61986C28.4098 2.48336 30.9436 -0.0315399 34.0612 -0.0315399C37.1787 -0.0315399 39.7126 2.48336 39.7126 5.61986V19.7934Z"
      />
      <path
        fill="#FCC003"
        d="M34.0376 42.482C37.1741 42.482 39.689 45.0158 39.689 48.1334C39.689 51.2509 37.1552 53.7848 34.0376 53.7848C30.9201 53.7848 28.3862 51.2509 28.3862 48.1334V42.482H34.0376Z"
      />
      <path
        fill="#FCC003"
        d="M34.0381 39.6507C30.9016 39.6507 28.3867 37.1168 28.3867 33.9993C28.3867 30.8818 30.9206 28.3479 34.0381 28.3479H48.2306C51.3671 28.3479 53.882 30.8818 53.882 33.9993C53.882 37.1168 51.3482 39.6507 48.2306 39.6507H34.0381Z"
      />
    </svg>
  );
}

function AtlassianMark() {
  return (
    <svg
      data-mark="atlassian"
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 text-(--brand-atlassian-mark)"
      fill="currentColor"
    >
      <path d="M7.12 11.084a.683.683 0 00-1.16.126L.075 22.974a.703.703 0 00.63 1.018h8.19a.678.678 0 00.63-.39c1.767-3.65.696-9.203-2.406-12.52zM11.434.386a15.515 15.515 0 00-.906 15.317l3.95 7.9a.703.703 0 00.628.388h8.19a.703.703 0 00.63-1.017L12.63.38a.664.664 0 00-1.196.006z" />
    </svg>
  );
}

/**
 * Each provider's button as its owner publishes one: GitHub's dark button,
 * light on a dark page; Google's and Microsoft's light and dark themes;
 * GitLab's charcoal with the orange tanuki; Slack's white and its aubergine.
 * Linear and Atlassian publish no sign-in button, so theirs is deevy's own
 * outline with the mark in the brand's colour. The colours are tokens in
 * `index.css` and appear on no other screen.
 */
const brands: Record<string, { mark: () => React.ReactElement; className: string }> = {
  github: {
    mark: GitHubMark,
    className:
      "border-(--brand-github) bg-(--brand-github) text-(--brand-github-foreground) hover:bg-(--brand-github)/90 hover:text-(--brand-github-foreground) dark:border-(--brand-github) dark:bg-(--brand-github) dark:hover:bg-(--brand-github)/90",
  },
  google: {
    mark: GoogleMark,
    className:
      "border-(--brand-google-border) bg-(--brand-google) text-(--brand-google-foreground) hover:bg-(--brand-google)/90 hover:text-(--brand-google-foreground) dark:border-(--brand-google-border) dark:bg-(--brand-google) dark:hover:bg-(--brand-google)/90",
  },
  microsoft: {
    mark: MicrosoftMark,
    className:
      "border-(--brand-microsoft-border) bg-(--brand-microsoft) text-(--brand-microsoft-foreground) hover:bg-(--brand-microsoft)/90 hover:text-(--brand-microsoft-foreground) dark:border-(--brand-microsoft-border) dark:bg-(--brand-microsoft) dark:hover:bg-(--brand-microsoft)/90",
  },
  gitlab: {
    mark: GitLabMark,
    className:
      "border-(--brand-gitlab-border) bg-(--brand-gitlab) text-(--brand-gitlab-foreground) hover:bg-(--brand-gitlab)/90 hover:text-(--brand-gitlab-foreground) dark:border-(--brand-gitlab-border) dark:bg-(--brand-gitlab) dark:hover:bg-(--brand-gitlab)/90",
  },
  linear: { mark: LinearMark, className: "" },
  slack: {
    mark: SlackMark,
    className:
      "border-(--brand-slack-border) bg-(--brand-slack) text-(--brand-slack-foreground) hover:bg-(--brand-slack)/90 hover:text-(--brand-slack-foreground) dark:border-(--brand-slack-border) dark:bg-(--brand-slack) dark:hover:bg-(--brand-slack)/90",
  },
  atlassian: { mark: AtlassianMark, className: "" },
};

/**
 * `Continue with <label>`, dressed as its provider where it is one deevy
 * knows. An OpenID Connect IdP could be anybody's, so it borrows no brand
 * and is deevy's own outline button with a key.
 *
 * `compact` is the half-width button behind "More ways to sign in": it shows
 * the provider's name alone and keeps the whole sentence as its name.
 * `lastUsed` pins a pill to its corner that says so, as the button's
 * description rather than a part of its name.
 */
export function SignInButton({
  provider,
  label,
  compact = false,
  lastUsed = false,
  className,
  ...props
}: { provider: string; label: string; compact?: boolean; lastUsed?: boolean } & Omit<
  ComponentProps<typeof Button>,
  "children"
>) {
  const brand = brands[provider];
  const Mark = brand?.mark;
  const pill = useId();
  return (
    <Button
      size="lg"
      variant="outline"
      data-brand={brand ? provider : undefined}
      aria-label={compact ? `Continue with ${label}` : undefined}
      aria-describedby={lastUsed ? pill : undefined}
      className={cn("relative w-full gap-3", compact && "gap-2", brand?.className, className)}
      {...props}
    >
      {Mark ? <Mark /> : <KeyRound aria-hidden className="size-5" />}
      {compact ? label : `Continue with ${label}`}
      {lastUsed ? (
        <span
          id={pill}
          aria-hidden
          className="absolute -top-2.5 right-2 rounded-full bg-primary px-2 text-xs/5 font-medium text-primary-foreground shadow-xs"
        >
          Last used
        </span>
      ) : null}
    </Button>
  );
}
