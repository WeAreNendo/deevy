---
title: Sign-in providers
description: Register the OAuth apps your team signs in to deevy with, from GitHub and Google to your own OpenID Connect identity provider, and decide who may join.
sidebar:
  order: 5
---

deevy keeps no passwords. Your team signs in with a provider you register an OAuth app with, and deevy
offers each provider whose client ID and secret you've set: any of them, all of them, or as few as one.

| Provider               | Variables                                                                                             | Callback ends in |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------- |
| GitHub                 | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                                                            | `github`         |
| Google                 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                            | `google`         |
| Microsoft Entra ID     | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, optionally `MICROSOFT_TENANT_ID`                    | `microsoft`      |
| GitLab                 | `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`, optionally `GITLAB_ISSUER`                                | `gitlab`         |
| Linear                 | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`                                                            | `linear`         |
| Slack                  | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`                                                              | `slack`          |
| Atlassian              | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`                                                      | `atlassian`      |
| Your identity provider | `DEEVY_OIDC_ISSUER`, `DEEVY_OIDC_CLIENT_ID`, `DEEVY_OIDC_CLIENT_SECRET`, optionally `DEEVY_OIDC_NAME` | `oidc`           |

## The callback URL

Every provider sends the browser back to the same shape of address:

```text
${BETTER_AUTH_URL}/api/auth/callback/<provider>
```

So with `BETTER_AUTH_URL=https://deevy.example.com`, GitHub's is
`https://deevy.example.com/api/auth/callback/github`, and your identity provider's is
`https://deevy.example.com/api/auth/callback/oidc`, whatever the provider is called. Under a path, the
path is part of it: `https://example.com/deevy/api/auth/callback/github`.

The callback and `BETTER_AUTH_URL` change together. Change one without the other and the provider refuses
the sign-in, or deevy signs you in on an address nobody visits.

## How the sign-in page offers them

The sign-in page shows a **Continue with …** button for each provider you configured, in this order:
GitHub, Google, Microsoft, GitLab, Linear, Slack, Atlassian, then your own identity provider. A provider
deevy couldn't set up gets no button, so every button on the page is one that can start a sign-in; see
[Your own identity provider](#your-own-identity-provider) for the one way that happens.

- To change the order, set `DEEVY_SIGN_IN_ORDER` to the providers to put first, comma-separated, such as
  `oidc,github`. The rest follow in the usual order.
- With four providers or fewer, every button shows. With more, the first three show and the rest wait
  behind **More ways to sign in**, your identity provider last among them. Name `oidc` in
  `DEEVY_SIGN_IN_ORDER` if your team should see it without looking.
- Each browser remembers which provider it signed in with last, offers that one first and marks it
  **Last used**.

## GitHub

1. Create an OAuth App, under your own [Developer settings](https://github.com/settings/developers) or an
   organization's.
2. Set its **Homepage URL** to `BETTER_AUTH_URL` and its **Authorization callback URL** to
   `${BETTER_AUTH_URL}/api/auth/callback/github`.
3. Generate a client secret, and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

deevy asks GitHub for `read:org` as well as the profile, so that a GitHub organization rule can see who
belongs to it. An organization that restricts OAuth App access has to approve your App before such a rule
can see its members; until then the rule admits nobody, and an invitation still works.

An OAuth App holds one callback URL, so a deevy reachable at two addresses needs an App for each, or one
address to sign in on.

This OAuth App is only for signing in. A GitHub Socket is a GitHub App of its own; see
[GitHub](/tools/github/).

## Google

1. In a Google Cloud project, create an OAuth client ID of type **Web application** under APIs & Services ›
   Credentials. Leave the consent screen's scopes at email and profile.
2. Add `${BETTER_AUTH_URL}/api/auth/callback/google` as an **Authorized redirect URI**.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

deevy doesn't limit Google sign-in to one Google Workspace domain. Anyone with a Google account can sign
in, and stays outside your Workspace until a rule or an invitation lets them in. To let your company's
domain in, add an **Email domain** rule; see [Who may join](#who-may-join).

## Microsoft

1. Register an application under Microsoft Entra ID › App registrations.
2. Add a **Web** redirect URI, `${BETTER_AUTH_URL}/api/auth/callback/microsoft`, and give the
   application a client secret.
3. Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
4. Set `MICROSOFT_TENANT_ID` to say whose accounts it takes: `common`, the default, for work, school and
   personal accounts; `organizations` for work and school accounts only; or your directory's ID for your
   own organization only.
5. Under the registration's **Token configuration**, add the optional ID token claims
   `verified_primary_email` and `verified_secondary_email`.

Step 5 matters: Microsoft's email claim is whatever the directory says, so deevy counts a Microsoft
address as verified only when one of those claims vouches for it. Without them, Microsoft sign-in still
works, but only by invitation; see [Which addresses count](#which-addresses-count).

## GitLab

1. Create an application under **User settings › Applications** on gitlab.com or on your own GitLab.
   Mark it **Confidential**, and give it the scopes `read_user` and `read_api`.
2. Set its **Redirect URI** to `${BETTER_AUTH_URL}/api/auth/callback/gitlab`.
3. Set `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET`.
4. For a self-managed GitLab, set `GITLAB_ISSUER` to its address, such as `https://gitlab.example.com`.
   It defaults to `https://gitlab.com`.

`read_api` is the only GitLab scope that lists the groups someone belongs to, which a GitLab group rule
needs. deevy only asks for those groups when such a rule exists and no email domain matched, but the scope
is on the application, so every GitLab sign-in grants it. If you'd rather it were never granted, leave
GitLab sign-in unconfigured.

## Linear

1. Create an OAuth application under Linear › Settings › API › OAuth applications. deevy asks for `read`,
   the narrowest scope Linear has.
2. Add `${BETTER_AUTH_URL}/api/auth/callback/linear` as its callback URL.
3. Set `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET`.

Linear never says whether an address is verified, so a Linear sign-in joins by invitation only. This
application is separate from the one a [Linear Socket](/tools/linear/) uses: that one acts as deevy, this
one as the Human signing in.

## Slack

This is Sign in with Slack, which is OpenID Connect.

1. Create a Slack app. Under **OAuth & Permissions**, add `${BETTER_AUTH_URL}/api/auth/callback/slack` as a
   redirect URL, and the user scopes `openid`, `email` and `profile`.
2. Set `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.

Slack says when an address is verified, so an email domain rule admits a Slack sign-in. This app is
separate from the one a [Slack Socket](/tools/slack/) uses.

## Atlassian

1. Create an app in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/),
   with the User identity API's `read:me` permission and nothing else.
2. Set its callback URL to `${BETTER_AUTH_URL}/api/auth/callback/atlassian`.
3. Set `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`.

Atlassian never says whether an address is verified, so an Atlassian sign-in joins by invitation only.

## Your own identity provider

Anything that speaks OpenID Connect works: Okta, Microsoft Entra ID, Keycloak, Authentik and others. deevy
offers one such provider.

1. Create a client in your identity provider, with the redirect URI
   `${BETTER_AUTH_URL}/api/auth/callback/oidc`.
2. Set `DEEVY_OIDC_ISSUER` to the address your provider publishes `/.well-known/openid-configuration`
   under, such as `https://acme.okta.com`, `https://login.microsoftonline.com/<directory-id>/v2.0`, or a
   Keycloak or Authentik realm's URL with its path.
3. Set `DEEVY_OIDC_CLIENT_ID` and `DEEVY_OIDC_CLIENT_SECRET`. All three are needed: without the issuer,
   deevy has nothing to discover the rest from.
4. Optionally, set `DEEVY_OIDC_NAME` to what your team calls it, such as `Acme SSO`. The button then says
   **Continue with Acme SSO** rather than **Continue with Single sign-on**. The callback stays `…/oidc`.

deevy asks for `openid`, `profile` and `email` only, uses PKCE, and verifies the ID token, so the discovery
document must name an issuer and a `jwks_uri`.

deevy reads the discovery document **once, when it starts**. If your provider can't be reached at that
moment, deevy skips it with a line in its log, and the sign-in page offers the other providers without it.
Its button comes back when deevy starts again: restart deevy, or, on Cloudflare Workers, deploy it again. Because the sign-in page waits for that read, an issuer that hangs delays every button on it, not
only its own. Point `DEEVY_OIDC_ISSUER` at something reachable, or leave it unset.

## Which addresses count

A sign-in's email address only counts for something when the provider says it verified it. A verified
address can be `DEEVY_ADMIN_EMAIL`, can match an **Email domain** rule, and lets a Human sign in with a
second provider later. An unverified one still signs in, but only by invitation, because the invitation's
link is the proof.

| Provider               | Verified when                                                        |
| ---------------------- | -------------------------------------------------------------------- |
| GitHub, Google         | Always                                                               |
| GitLab                 | The account's address has been confirmed                             |
| Slack                  | Slack says so                                                        |
| Microsoft              | One of the optional claims in [Microsoft](#microsoft) step 5 says so |
| Your identity provider | Its ID token carries `email_verified`                                |
| Linear, Atlassian      | Never: they join by invitation only                                  |

Without this, anybody could put your address on an account at a provider that doesn't check, and be let
in as you.

### Signing in with more than one provider

A Human who signs in with one provider and later with another, on the same address, stays one Member:
the second sign-in joins onto the first. deevy only does this when the second provider verified the
address. When it didn't, the sign-in is refused with `account_not_linked`, and the Human keeps using the
provider they started with.

Some identity providers, Microsoft Entra ID among them, send no `email_verified` claim. Offer such a
provider on its own, or configure it to send the claim, so nobody is stuck on one provider.

## Who may join

Signing in proves who somebody is; joining the Workspace is up to its admins. Both ways in are under
**Settings › General**.

**A rule** lets in everyone who matches it, now and later. Under **Who may join**, choose **Add rule**,
then what to match on:

- **Email domain**, such as `example.com`: anyone whose verified address is at that domain.
- **GitHub organization**, by its login, such as `acme`: anyone who signs in with GitHub and belongs to it.
- **GitLab group**, by its path, such as `acme/platform`: anyone who signs in with GitLab and belongs to it.

deevy asks GitHub or GitLab itself who belongs, through the account somebody signed in with, so
**GitHub organization** is offered only when GitHub is one of your sign-in providers, and **GitLab group**
only when GitLab is. If you take a provider away later, its rules stay listed, each with a line saying it
lets nobody in until people can sign in here with that provider again. Remove them, or bring the provider
back.

Until there is a rule, the admin is the only one who can get in, apart from those they invite.

**An invitation** lets in one person. Under **Invited**, choose **Invite someone**, give their **Email**
and **Role**, and choose **Create invitation**. deevy shows the link once, and emails it to them as well
when [a sender is set up](/self-hosting/email/). They have seven days to sign in with that same address
and accept it; a forwarded link lets nobody else in. One address has one live invitation at a time: to
send another, revoke it first.

## Several deevys, one set of apps

If you run several deevy deployments, say one per team, they can share one set of sign-in apps through a
relay instead of each registering its own. Every app's callback is the relay's, and the relay sends each
browser back to the deevy that started the sign-in. It only redirects: each deevy still exchanges its own
code, so each still holds the client IDs and secrets.

Any deevy can be the relay; its relay lives at `${BETTER_AUTH_URL}/relay`.

1. Generate one shared secret, with `openssl rand -base64 32`.
2. On the deevy that is the relay, set `DEEVY_SIGN_IN_RELAY_SECRET` to it, and
   `DEEVY_SIGN_IN_RELAY_ALLOW` to the addresses it may send a sign-in back to: comma-separated URL
   prefixes, each with at least a `/` after the host, such as
   `https://team-a.example.com/,https://team-b.example.com/`.
3. On each deevy that signs in through it, set `DEEVY_SIGN_IN_RELAY_SECRET` to the same secret,
   `DEEVY_SIGN_IN_RELAY_URL` to the relay's address, such as `https://deevy.example.com/relay`, and the
   same provider client IDs and secrets.
4. Register each app's callback as `${DEEVY_SIGN_IN_RELAY_URL}/callback/<provider>`, such as
   `https://deevy.example.com/relay/callback/github`.

The relay can sign its own team in through itself, too: give it `DEEVY_SIGN_IN_RELAY_URL` as well.

Your own identity provider and a self-managed GitLab are never relayed. Their callbacks stay each deevy's
own, as above.
