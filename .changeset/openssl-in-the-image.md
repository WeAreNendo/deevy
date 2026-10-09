---
"@deevy/server": patch
---

**The server image runs on a rebuilt base with OpenSSL's October fixes** (`libssl3t64` 3.5.7-1~deb13u3), closing CVE-2026-75804 (a denial of service through QUIC flow control) and CVE-2026-84782 (an information disclosure through DTLS handshake retransmission). Nothing to change on your side: pull the new image.
