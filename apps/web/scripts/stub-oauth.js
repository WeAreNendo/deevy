/**
 * Every sign-in provider deevy offers, as far as a deevy under test can tell
 * (docs/plans/sign-in.md slice 2).
 *
 * Better Auth hardcodes GitHub's, Google's, Microsoft's, Linear's, Slack's and
 * Atlassian's endpoints and builds GitLab's and a generic OIDC provider's from
 * a configured issuer, so the only seam that covers all eight is the global
 * `fetch` they are called through.
 * `apps/server/src/index.ts` imports this file when `DEEVY_DEV_STUB_OAUTH=1`;
 * `apps/web/scripts/smoke-workers.ts` and `apps/agent/scripts/boot.ts` prepend
 * its source to a built bundle instead. Either way deevy itself — its routing,
 * its database, Better Auth's real OAuth dance — is the real one, and the
 * outside world is the only thing replaced.
 *
 * The sign-in under test says who it is in the OAuth `code`, which is the
 * email address. A provider would have handed that code out at the end of a
 * consent screen; here the caller hands it straight to the callback. A generic
 * OIDC sign-in also has an `id_token` nonce to bind, and the nonce is in the
 * authorization URL the caller skipped, so the code carries it after a `|`:
 * `ada@example.com|<nonce>` is the same sign-in, saying which authorization
 * request it belongs to.
 *
 * GitHub and Google are matched by host, because their endpoints are constants
 * in Better Auth. GitLab's and the OIDC provider's are wherever the operator's
 * issuer is, so those are matched by path — but never on a loopback host,
 * which is deevy itself and must answer for its own routes.
 *
 * Everything lives inside one function so the file declares nothing at module
 * scope: its source is prepended to a bundle whose own top-level names it
 * would otherwise collide with, and esbuild refuses the duplicate rather than
 * shadowing it — which is how `vp run agent#acceptance` catches this.
 */
(() => {
  const upstream = globalThis.fetch;

  /** The token this stub mints, and the email it carries back. */
  function tokenFor(email) {
    return `stub_${email}`;
  }

  function emailIn(value) {
    return (value ?? "").replace(/^stub_/, "");
  }

  /** What a code says: who is signing in, and the nonce their issuer must echo. */
  function codeIn(value) {
    const [email, nonce] = (value ?? "").split("|");
    return { email: email ?? "", nonce: nonce || null };
  }

  /** The bearer of a request, whatever the provider calls it. */
  function bearerEmail(request) {
    return emailIn(request.headers.get("authorization")?.split(" ")[1]);
  }

  /**
   * deevy's own origin is not a provider: loopback goes straight past. Every
   * form of it, not four literals — `127.0.0.2` and `0.0.0.0` are this machine
   * too, and a path-matched provider in front of deevy's own `.well-known`
   * routes would answer for the authorization server. A deevy reached on a LAN
   * address or a container name is still outside this test, which is why
   * `BETTER_AUTH_URL` in the `dev:stub` configuration is a loopback URL.
   */
  function isLoopback(host) {
    const bare = host.replace(/^\[/, "").replace(/\]$/, "");
    return (
      bare === "localhost" ||
      bare === "::1" ||
      bare === "::" ||
      bare === "0.0.0.0" ||
      bare.startsWith("127.")
    );
  }

  /**
   * An address the providers say they have not verified. A sign-in through the
   * stub is otherwise always verified, which is what let a linking rule that
   * turns on the claim look tested when nothing drove it (docs/plans/sign-in.md).
   */
  function isVerified(email) {
    return !email.includes("+unverified@");
  }

  /** The name a provider would show for an address, from its local part. */
  function nameFor(email) {
    const login = email.split("@")[0] ?? "";
    return { login, name: login.charAt(0).toUpperCase() + login.slice(1) };
  }

  // ------------------------------------------------------- the signing key

  /**
   * The `id_token` is the reason this file signs anything. A generic OIDC
   * provider is only usable to Better Auth when discovery hands back an issuer
   * and a `jwks_uri` it can build a key set from, and Google verifies its token
   * against Google's certificates; so the stub generates a key pair, serves the
   * JWKS at whichever certificate URL was asked for, and signs the token it
   * hands back from the token endpoint.
   *
   * `crypto.subtle` rather than `jose`: this file's source is prepended to a
   * built Worker bundle, and a dev-only dependency that has to work inside
   * workerd is a risk it does not need. Generated on first use rather than at
   * load, so importing the file stays synchronous on both runtimes.
   */
  const KEY_ID = "deevy-stub";
  let keyPair = null;

  function signingKey() {
    keyPair ??= (async () => {
      const pair = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      );
      const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
      return {
        privateKey: pair.privateKey,
        jwk: {
          kty: exported.kty,
          n: exported.n,
          e: exported.e,
          alg: "RS256",
          use: "sig",
          kid: KEY_ID,
        },
      };
    })();
    return keyPair;
  }

  function base64url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64urlText(text) {
    return base64url(new TextEncoder().encode(text));
  }

  /** An RS256 JWT with this stub's key, valid for the hour Google allows. */
  async function idToken(claims) {
    const { privateKey } = await signingKey();
    const now = Math.floor(Date.now() / 1000);
    const header = base64urlText(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID }));
    const payload = base64urlText(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
  }

  async function jwksResponse() {
    const { jwk } = await signingKey();
    return Response.json({ keys: [jwk] });
  }

  // ------------------------------------------------------- the token endpoint

  /** One half of a Basic credential, form-url-decoded per RFC 6749 §2.3.1. */
  function formDecode(value) {
    return new URLSearchParams(`v=${value}`).get("v") ?? "";
  }

  /**
   * What a token request said: the code, which is the sign-in's address and
   * its nonce, and the client id, which is the audience an `id_token` has to
   * name. Better Auth sends the pair in the body or as a Basic credential
   * depending on the provider, so both are read.
   */
  async function tokenRequest(request) {
    const params = new URLSearchParams(await request.text());
    let clientId = params.get("client_id") ?? "";
    const authorization = request.headers.get("authorization") ?? "";
    if (!clientId && /^Basic /i.test(authorization)) {
      const decoded = atob(authorization.replace(/^Basic +/i, ""));
      clientId = formDecode(decoded.slice(0, decoded.indexOf(":")));
    }
    return { ...codeIn(params.get("code")), clientId };
  }

  /**
   * Who the sign-in is, in the claims every OpenID issuer here agrees on. The
   * extra ones an OpenID Connect provider may send are asked for by name:
   * Google issues no `preferred_username`, and a stub that sends one would let
   * a slice read a claim that is not there in production.
   */
  function profileClaims(email, extras = false) {
    const { login, name } = nameFor(email);
    return {
      sub: email,
      email,
      email_verified: isVerified(email),
      name,
      given_name: name,
      // No picture: a host that does not resolve is a red line in every dev console.
      picture: null,
      ...(extras ? { preferred_username: login } : {}),
    };
  }

  /**
   * Those claims as an issuer signs them: bound to an issuer, an audience and
   * — when the caller said which authorization request this is — the nonce
   * Better Auth expects an OpenID Provider to echo back. `extras` adds the
   * claims only an OpenID Connect provider sends, which Google's token does
   * not carry.
   */
  function idTokenClaims({ email, clientId, nonce }, issuer, extras = false) {
    return {
      iss: issuer,
      aud: clientId,
      ...(nonce ? { nonce } : {}),
      ...profileClaims(email, extras),
    };
  }

  // ------------------------------------------------------- the providers

  /** The GitHub profile of whoever the code named. */
  function githubProfile(email) {
    const { login, name } = nameFor(email);
    return { id: email, login, node_id: login, name, email, avatar_url: null };
  }

  /**
   * The GitLab profile of whoever the code named. `state` decides the sign-in.
   *
   * There is no `email_verified` here, because there is none in GitLab's own
   * `/api/v4/user`: a confirmed address is `confirmed_at`, and a stub that
   * invents the OpenID Connect claim beside it hides the mapping deevy has to
   * do for a real GitLab (packages/core/src/auth.ts).
   */
  function gitlabProfile(email) {
    const { login, name } = nameFor(email);
    return {
      id: email,
      username: login,
      name,
      email,
      // GitLab's /api/v4/user has no `email_verified`; a confirmed address is
      // a `confirmed_at` stamp, and an unconfirmed one is null. Inventing the
      // claim here made every GitLab sign-in look verified to Better Auth,
      // which is not what production does (docs/plans/sign-in.md).
      confirmed_at: isVerified(email) ? "2020-01-01T00:00:00.000Z" : null,
      state: "active",
      locked: false,
      avatar_url: null,
      web_url: `https://gitlab.example/${login}`,
    };
  }

  /**
   * A stable id for whoever the code named, in the shape each provider hands
   * out: an account id is the provider's own, never the address, and the
   * identity resolver matches on it (packages/core/src/identities.ts).
   */
  function idFor(prefix, email) {
    return `${prefix}${nameFor(email)
      .login.replace(/[^a-z0-9]/gi, "")
      .toUpperCase()}`;
  }

  /** The tenant a stubbed Microsoft sign-in belongs to: a work tenant, not the consumer one. */
  const MICROSOFT_TENANT = "11111111-2222-4333-8444-555555555555";

  /**
   * Microsoft's id_token, as Entra issues it: no `email_verified` claim, and
   * the address counted as verified only through `verified_primary_email`,
   * which a tenant sends when its admin asks for it (docs/OPERATIONS.md).
   */
  function microsoftClaims({ email, clientId, nonce }) {
    const { name, login } = nameFor(email);
    return {
      iss: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/v2.0`,
      aud: clientId,
      tid: MICROSOFT_TENANT,
      oid: idFor("oid-", email),
      sub: idFor("sub-", email),
      ...(nonce ? { nonce } : {}),
      email,
      name,
      preferred_username: login,
      ...(isVerified(email) ? { verified_primary_email: [email] } : {}),
    };
  }

  /** Sign in with Slack's userInfo: OpenID claims, plus Slack's own user and team ids. */
  function slackProfile(email) {
    const { name } = nameFor(email);
    return {
      ok: true,
      sub: idFor("U", email),
      "https://slack.com/user_id": idFor("U", email),
      "https://slack.com/team_id": "T0STUB",
      email,
      email_verified: isVerified(email),
      name,
    };
  }

  const OIDC_DISCOVERY = "/.well-known/openid-configuration";

  /** The paths this stub answers on whatever host the operator's issuer is. */
  const OIDC_TOKEN = "/oauth2/token";
  const OIDC_USERINFO = "/oauth2/userinfo";
  const OIDC_JWKS = "/oauth2/jwks";

  /** An issuer, from a request to one of the paths derived from it. */
  function issuerOf(url, suffix) {
    return `${url.origin}${url.pathname.slice(0, -suffix.length)}`;
  }

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const host = url.hostname;
    const path = url.pathname;

    // GitHub: endpoints Better Auth hardcodes.
    if (host === "github.com" && path === "/login/oauth/access_token") {
      const { email } = await tokenRequest(request);
      return Response.json({
        access_token: tokenFor(email),
        token_type: "bearer",
        scope: "read:user,user:email,read:org",
      });
    }
    if (host === "api.github.com") {
      const email = bearerEmail(request);
      if (path === "/user") return Response.json(githubProfile(email));
      if (path === "/user/emails") {
        return Response.json([{ email, primary: true, verified: isVerified(email) }]);
      }
      if (path === "/user/orgs") return Response.json([]);
    }

    // Google: a token endpoint that hands back a signed id_token, and the
    // certificates Better Auth verifies it against. Google's profile is the
    // token's claims, so there is no userinfo call to answer.
    if (host === "oauth2.googleapis.com" && path === "/token") {
      const token = await tokenRequest(request);
      return Response.json({
        access_token: tokenFor(token.email),
        token_type: "bearer",
        expires_in: 3600,
        scope: "openid email profile",
        id_token: await idToken(idTokenClaims(token, "https://accounts.google.com")),
      });
    }
    if (host === "www.googleapis.com" && path === "/oauth2/v3/certs") return jwksResponse();

    // Microsoft Entra ID: a token endpoint and a key set per tenant path, and a
    // profile photo deevy never asks for.
    if (host === "login.microsoftonline.com") {
      if (path.endsWith("/oauth2/v2.0/token")) {
        const token = await tokenRequest(request);
        return Response.json({
          access_token: tokenFor(token.email),
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email User.Read",
          id_token: await idToken(microsoftClaims(token)),
        });
      }
      if (path.endsWith("/discovery/v2.0/keys")) return jwksResponse();
    }

    // Linear: an OAuth token, then the GraphQL viewer. Linear says nothing
    // about whether the address is verified, and Better Auth marks it not.
    if (host === "api.linear.app") {
      if (path === "/oauth/token") {
        const { email } = await tokenRequest(request);
        return Response.json({
          access_token: tokenFor(email),
          token_type: "Bearer",
          expires_in: 3600,
          scope: "read",
        });
      }
      if (path === "/graphql") {
        const email = bearerEmail(request);
        const { name } = nameFor(email);
        return Response.json({
          data: { viewer: { id: idFor("lin-", email), name, email, avatarUrl: null } },
        });
      }
    }

    // Sign in with Slack: OpenID Connect on Slack's own paths.
    if (host === "slack.com") {
      if (path === "/api/openid.connect.token") {
        const token = await tokenRequest(request);
        // Slack's id token carries its own user and team ids, and the team is
        // what a Slack Socket reads back before a sign-in counts for a click.
        const { sub, email, email_verified, name, ...slackIds } = slackProfile(token.email);
        return Response.json({
          ok: true,
          access_token: tokenFor(token.email),
          token_type: "Bearer",
          expires_in: 3600,
          id_token: await idToken({
            iss: "https://slack.com",
            aud: token.clientId,
            sub,
            email,
            email_verified,
            name,
            "https://slack.com/user_id": slackIds["https://slack.com/user_id"],
            "https://slack.com/team_id": slackIds["https://slack.com/team_id"],
          }),
        });
      }
      if (path === "/api/openid.connect.userInfo") {
        return Response.json(slackProfile(bearerEmail(request)));
      }
    }

    // Atlassian: an OAuth token, then `/me`, which says nothing about whether
    // the address is verified.
    if (host === "auth.atlassian.com" && path === "/oauth/token") {
      const { email } = await tokenRequest(request);
      return Response.json({
        access_token: tokenFor(email),
        token_type: "Bearer",
        expires_in: 3600,
        scope: "read:me",
      });
    }
    if (host === "api.atlassian.com" && path === "/me") {
      const email = bearerEmail(request);
      const { name, login } = nameFor(email);
      return Response.json({
        account_type: "atlassian",
        account_id: idFor("atl-", email),
        email,
        name,
        nickname: login,
        picture: null,
        account_status: "active",
      });
    }

    // GitLab and the generic OIDC provider live wherever the operator's issuer
    // is, so they are matched by path. Never on loopback: that is deevy.
    if (!isLoopback(host)) {
      // `endsWith`, not `===`: a self-hosted GitLab under a relative URL root
      // (`https://example.com/gitlab`) builds every endpoint under that prefix,
      // and an exact match sent the dev loop's request to the real network.
      if (path.endsWith("/oauth/token")) {
        const { email } = await tokenRequest(request);
        return Response.json({
          access_token: tokenFor(email),
          token_type: "bearer",
          expires_in: 3600,
          scope: "read_user read_api",
        });
      }
      if (path.endsWith("/api/v4/user")) return Response.json(gitlabProfile(bearerEmail(request)));
      if (path.endsWith("/api/v4/groups")) return Response.json([]);

      if (path.endsWith(OIDC_DISCOVERY)) {
        const issuer = issuerOf(url, OIDC_DISCOVERY);
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}${OIDC_TOKEN}`,
          userinfo_endpoint: `${issuer}${OIDC_USERINFO}`,
          jwks_uri: `${issuer}${OIDC_JWKS}`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          scopes_supported: ["openid", "profile", "email"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (path.endsWith(OIDC_TOKEN)) {
        const token = await tokenRequest(request);
        return Response.json({
          access_token: tokenFor(token.email),
          token_type: "bearer",
          expires_in: 3600,
          scope: "openid profile email",
          // An OpenID Connect provider is the one that may carry the extra
          // claims; Google's token above deliberately does not.
          id_token: await idToken(idTokenClaims(token, issuerOf(url, OIDC_TOKEN), true)),
        });
      }
      if (path.endsWith(OIDC_USERINFO)) {
        return Response.json(profileClaims(bearerEmail(request), true));
      }
      if (path.endsWith(OIDC_JWKS)) return jwksResponse();
    }

    return upstream(input, init);
  };
})();
