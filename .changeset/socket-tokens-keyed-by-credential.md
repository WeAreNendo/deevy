---
"@deevy/sockets": patch
---

A Linear or GitHub Socket's cached token is now tied to the credential that minted it: Linear's to the client secret, GitHub's to the App's private key and API host. A Socket connected with another app's id and a wrong secret or key is refused, rather than reusing that app's token, and two GitHub Enterprise Servers that number an App the same no longer share one. Nothing to do on upgrade; each Socket mints a fresh token on its first call.
