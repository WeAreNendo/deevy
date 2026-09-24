# Screens

Every screen of the SPA, taken from a seeded local instance by `vp run web#screens`
(`apps/web/scripts/screens.ts`): the Google Chrome installed on the machine, headless, driven over the
DevTools protocol, signed in through the development sign-in stub. Desktop shots are 1280×800, `*-dark` the
same in the dark theme, `*-phone` 390×844. A screen of one Run, one Gate, one record or one Socket is found
through the API at the moment of capture.

To regenerate: build (`vp run -r build`), start the `seeded` launch configuration — every identity in it is at
example.com, whatever the checkout's `.env` says — and run

```bash
DEEVY_SCREENS_URL=http://localhost:3020 DEEVY_ADMIN_EMAIL=ada@example.com vp run web#screens
```

`DEEVY_SCREENS_ONLY=gate,inbox-phone` takes some shots alone; `DEEVY_SCREENS_DEBUG=1` prints what each page
said at capture. Regenerate at a milestone, not per commit: the set is about 1.8 MB each time. The set was
last taken when the Sockets milestone closed, on 2026-09-24.
