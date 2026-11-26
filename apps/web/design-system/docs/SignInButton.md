`Continue with <label>`, dressed as its provider: GitHub's dark button with the Octocat (light on a dark page), Google's and Microsoft's own light and dark themes with their four-colour marks. A single sign-on (`provider="oidc"` or any id deevy has no brand for) borrows nothing and is deevy's outline button with a key. These are the one place a screen shows colours that are not deevy's; the marks are decoration, so the button's name stays the sentence. `lastUsed` pins a "Last used" pill to its corner as the button's description; that button goes first. Full-width, stacked with a 12px gap in a `max-w-sm` column under the "Sign in" title. A deployment offers at most four.

```tsx
<SignInButton provider="github" label="GitHub" lastUsed />
<SignInButton provider="google" label="Google" />
```
