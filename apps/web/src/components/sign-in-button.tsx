/*
 * Brand marks for the sign-in buttons, and nothing else.
 *
 * - GitHub's and GitLab's marks are Simple Icons 16.32.0 (`siGithub`,
 *   `siGitlab`; CC0-1.0, simpleicons.org), used as each brand's guidelines
 *   allow for naming a sign-in: github.com/logos and GitLab's trademark
 *   guidelines.
 * - Google's G is the four-colour mark from Google's "Sign in with Google"
 *   branding guidelines (developers.google.com/identity/branding-guidelines),
 *   which require it in its own colours on a sign-in button.
 *
 * Adopted 2026-09-26. The marks are decoration: a button's name stays
 * "Sign in with <provider>".
 */
import type { ComponentProps } from "react";
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

/**
 * Each provider's button as its owner publishes one: GitHub's dark button,
 * light on a dark page; Google's light theme and dark theme with its
 * four-colour G; GitLab's charcoal with the orange tanuki. The colours are
 * tokens in `index.css` and appear on no other screen.
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
  gitlab: {
    mark: GitLabMark,
    className:
      "border-(--brand-gitlab-border) bg-(--brand-gitlab) text-(--brand-gitlab-foreground) hover:bg-(--brand-gitlab)/90 hover:text-(--brand-gitlab-foreground) dark:border-(--brand-gitlab-border) dark:bg-(--brand-gitlab) dark:hover:bg-(--brand-gitlab)/90",
  },
};

/**
 * `Sign in with <label>`, dressed as its provider where it is one deevy
 * knows. An OpenID Connect IdP could be anybody's, so it borrows no brand
 * and is deevy's own outline button with a key.
 */
export function SignInButton({
  provider,
  label,
  className,
  ...props
}: { provider: string; label: string } & Omit<ComponentProps<typeof Button>, "children">) {
  const brand = brands[provider];
  const Mark = brand?.mark;
  return (
    <Button
      size="lg"
      variant="outline"
      data-brand={brand ? provider : undefined}
      className={cn("w-full gap-3", brand?.className, className)}
      {...props}
    >
      {Mark ? <Mark /> : <KeyRound aria-hidden className="size-5" />}
      Sign in with {label}
    </Button>
  );
}
