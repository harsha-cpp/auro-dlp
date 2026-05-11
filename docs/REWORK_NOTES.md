# AURO-DLP Rework Notes (v1.0)

This document captures the architectural decisions for the v1.0 rework,
executed in a focused 1-2 day push using parallel AI subagents.

## Goals (v1.0)

A real, working, cross-platform DLP product:

- Gmail interception works correctly (no Gmail layout glitches)
- Real ONNX ML model running locally in the Go agent (English + Hindi PHI/PII)
- PDF/DOCX/XLSX parsing for attachments
- Override flow that actually verifies (no more "any 6 digits")
- Agent ↔ Server data plane wired (incidents flow, heartbeats flow, SIEM forwards)
- Dashboard shows live incidents, all pages work, RBAC management, override approve button
- Policy editor with YAML validation
- All 11 BLOCKER bugs fixed
- Runs on macOS + Linux (Go cross-compiles, extension is OS-agnostic)

## Deferred to v1.1

- mTLS between components (loopback HTTP retained for v1.0)
- Native messaging (HTTP loopback works)
- macOS code signing / installers / .deb/.rpm packaging
- Tamper hardening
- Audit log encryption (HMAC chain stays, encryption added later)
- Policy server port from Node → Go (planned but not in this scope)

## Architecture

```
┌─ Browser Extension (MV3, Chrome)
│  Gmail interception, shadow-DOM modal, MAIN-world XHR backstop
│
├─ auro-agent (Go binary)
│  Local HTTP server on 127.0.0.1:7443
│  Detection: regex + dict + ONNX (hugot)
│  Parsers: PDF/DOCX/XLSX/text/HTML/RTF/ZIP
│  Forwards incidents + heartbeats to policy server
│
├─ policy-server (Node.js + Express + SQLite)
│  Ed25519 signed policies
│  JWT + RBAC
│  Override mint/verify
│  SIEM forward (Splunk HEC / syslog / webhook)
│  SSE stream for live dashboard updates
│
└─ admin-dashboard (React + Vite + Tailwind)
   Incidents, policies, fleet, audit, settings
```

## Key technical decisions

### Detection
- **Score fusion**: `risk = max(regex_max_confidence, ml_score, dict_density)` — no double-counting
- **Hard-block list**: Aadhaar + PAN + CCN + SSN + ABHA
- **ML model**: `hiteshwadhwani/pii-model-indicv2` quantized INT8 (~280 MB), downloaded on first run

### File parsers (all pure-Go where possible)
- PDF: `pdfcpu/pdfcpu` v0.11+
- DOCX: manual zip + xml parsing (~80 LOC)
- XLSX: `xuri/excelize/v2`
- PPTX: manual zip + xml parsing
- Email (.eml): `emersion/go-message`
- Archives: `mholt/archives`
- Images: shell out to `tesseract`

### Encrypted attachments
- **Policy**: BLOCK by default. "Can't inspect = can't allow."

### Limits (DoS protection)
- Max input file: 100 MiB
- Max decompressed: 500 MiB
- Max archive depth: 3
- Per-file timeout: 30s
- Inspect body cap: 1 MiB

### ML inference
- `github.com/knights-analytics/hugot` v0.7.2 (build with `-tags ORT`)
- ONNX Runtime shared lib downloaded alongside model
- Fallback: if ML fails, gracefully degrade to regex+dict only

### Override flow (real verification)
1. Operator clicks "Mint Override" in dashboard on incident detail
2. Server generates 6-digit code, stores SHA256 hash + TTL (2 min)
3. Operator reads code to doctor verbally
4. Doctor enters code in extension modal
5. Extension → agent `/v1/override` with `{incident_id, totp, reason}`
6. Agent → server `/admin/override/verify` (rate-limited, 3 attempts)
7. Server verifies, marks consumed, returns signed approval
8. Agent allows the send

### Cross-OS
- Go agent cross-compiles for darwin/amd64, darwin/arm64, linux/amd64, linux/arm64, windows/amd64
- Extension is platform-agnostic (Chrome MV3)
- Policy server runs anywhere Node 20+ runs

## What was found broken in the baseline

See `docs/BUGS_FIXED.md` for the full inventory (85 findings, 11 BLOCKERs).
Top critical:

1. Modal never rendered (closed shadow root return discarded)
2. Override accepted any 6-digit string
3. Agent never sent incidents/heartbeats to server
4. 7 dashboard endpoints didn't exist
5. JWT fallback `'dev-secret'` hardcoded
6. All agent-facing endpoints unauthenticated
7. Default admin password not rotated
8. Audit log mislabeled "encrypted" (plaintext)
9. Tamper protection was TOFU
10. Detector dictionary was double-counted in risk score
11. Hard-block list had only Aadhaar (not PAN/CCN/SSN/ABHA)
