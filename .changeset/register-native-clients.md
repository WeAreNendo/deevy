---
"@deevy/core": patch
---

An MCP client that registers itself without saying what kind of app it is can now be called back on the Human's own machine. deevy took such a client for a web app and refused its `http://127.0.0.1` or `http://localhost` callback, which turned away VS Code, the MCP Inspector and anything built on the MCP SDK. A client whose callbacks are on the Human's machine, or an app's own scheme, is registered as the native app it is; a callback naming any other host over plain http is still refused.
