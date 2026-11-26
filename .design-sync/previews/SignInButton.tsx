import { SignInButton } from "@deevy/design-system";

/**
 * The four a deployment may offer, in the brands' own buttons: GitHub's dark,
 * Google's and Microsoft's light, and a single sign-on that borrows no brand.
 */
export const Providers = () => (
  <div className="flex w-full max-w-sm flex-col gap-3">
    <SignInButton provider="github" label="GitHub" />
    <SignInButton provider="google" label="Google" />
    <SignInButton provider="microsoft" label="Microsoft" />
    <SignInButton provider="oidc" label="Acme SSO" />
  </div>
);

/** The one this browser used last comes first, with a pill that describes it. */
export const LastUsed = () => (
  <div className="flex w-full max-w-sm flex-col gap-3 pt-3">
    <SignInButton provider="google" label="Google" lastUsed />
    <SignInButton provider="github" label="GitHub" />
  </div>
);

/** The sign-in card as the signed-out page composes it. */
export const SignInCard = () => (
  <div className="flex w-full max-w-sm flex-col gap-6">
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-sm text-muted-foreground">
        Use an account your Workspace admin has approved.
      </p>
    </div>
    <div className="flex flex-col gap-3">
      <SignInButton provider="github" label="GitHub" lastUsed />
      <SignInButton provider="google" label="Google" />
      <SignInButton provider="oidc" label="Acme SSO" />
    </div>
  </div>
);
