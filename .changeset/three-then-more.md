---
"@deevy/web": minor
---

**The sign-in page shows three buttons, then "More ways to sign in".** With four providers or fewer every button shows as before. Past that, the first three in your order (`DEEVY_SIGN_IN_ORDER`, else GitHub, Google, Microsoft) are in view and the rest open in place beneath, your own IdP last among them — list `oidc` early in `DEEVY_SIGN_IN_ORDER` to keep it in view. The provider a browser signed in with last comes first, marked "Last used". Buttons now read "Continue with GitHub" and so on, and Microsoft, Slack, Linear and Atlassian wear their own marks. Somebody who signs in through a provider that did not confirm their address (Linear, Atlassian, or Microsoft without the verified-email claims) is now told to ask for an invitation, since an approved email domain cannot let them in.
