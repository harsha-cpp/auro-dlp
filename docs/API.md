# AURO-DLP — API Reference

## A. Endpoint Agent (loopback, mTLS)

Base URL: `https://127.0.0.1:7443/v1`

All requests require a client cert in the TLS handshake. Reject with 401 otherwise.

### `GET /healthz`
Liveness check.
```json
{ "status": "ok", "version": "1.0.0", "policy": "2026-05-01-r3" }
```

### `POST /inspect`
Body:
```json
{
  "source": "gmail.compose",
  "kind": "text|file|paste|drop",
  "url": "https://mail.google.com/...",
  "content": "string (UTF-8)",
  "files": [
    { "path": "C:\\Users\\u\\Desktop\\report.pdf", "sha256": "..." , "size": 102400 }
  ],
  "recipients": ["a@external.com"],
  "context": { "subject": "Re: ..." }
}
```
Response:
```json
{
  "incident_id": "01HXAB...",
  "verdict": "ALLOW|WARN|BLOCK",
  "risk": 0.78,
  "matches": [{ "rule_id": "IN.AADHAAR", "count": 2, "first_offset": 142 }],
  "categories": ["PHI","PII-IN"],
  "context": { "dictionary_hits": 4, "ml_signal": 0.62 },
  "policy_version": "2026-05-01-r3",
  "warning_message": "Aadhaar and MRN detected in the message body."
}
```

### `POST /override`
Body: `{ "incident_id": "...", "totp": "123456", "reason": "Cardiology consult" }`
Response: `{ "approved": true, "override_id": "..." }`

### `WS /stream`
Bidirectional WebSocket for low-latency paste/keystroke inspection. Same envelope as `/inspect`.

## B. Policy Server (WAN, mTLS or JWT)

Base URL: `https://policy.hospital.local:8443/api/v1`

### `GET /policies/current` (mTLS, agent)
Returns the active signed YAML bundle.
```
ETag: "2026-05-01-r3"
Content-Type: application/yaml; charset=utf-8
X-Signature: ed25519:base64(...)
```

### `POST /agents/enroll` (mTLS-bootstrap)
```json
{ "enrollment_token": "...", "csr_pem": "...", "tpm_quote": "..." }
```
Response:
```json
{ "client_cert_pem": "...", "ca_cert_pem": "...", "endpoint_id": "WS-CARDIO-04" }
```

### `POST /agents/heartbeat` (mTLS)
```json
{ "endpoint_id": "...", "version": "1.0.0", "policy": "2026-05-01-r3", "uptime_s": 12345, "ext_present": true }
```

### `POST /incidents` (mTLS)
Audit ingest. Server side-validates and forwards to SIEM.

### `GET /incidents?from=...&verdict=BLOCK` (JWT)
Operator listing.

### `POST /admin/override` (JWT, `security`/`admin`)
Mints a one-time TOTP for a specific incident. Returns:
```json
{ "totp": "654321", "expires_at": "..." }
```

### `GET /audit?endpoint_id=...` (JWT, `auditor`+)

### `POST /auth/login`
```json
{ "email": "...", "password": "..." }
```
Returns JWT (15 min) + refresh (7 d).

### `POST /policies` (JWT, `admin`/`security`)
Body: full YAML. Server signs, increments version, broadcasts via heartbeat ETag.

## C. Model Registry (unauthenticated in v1)

Base URL: `http://localhost:8443/api/v1/models`

### `GET /manifest`
Returns the current model manifest for agent bootstrap.
```json
{
  "model_id": "auro-pii-indicv2",
  "version": "0.1.0",
  "sha256": "<sha256 of model.onnx>",
  "size_bytes": 0,
  "files": {
    "model.onnx": "/api/v1/models/auro-pii-indicv2/0.1.0/model.onnx",
    "tokenizer.json": "/api/v1/models/auro-pii-indicv2/0.1.0/tokenizer.json",
    "config.json": "/api/v1/models/auro-pii-indicv2/0.1.0/config.json",
    "labels.json": "/api/v1/models/auro-pii-indicv2/0.1.0/labels.json"
  },
  "onnxruntime": {
    "darwin-arm64": "https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-osx-arm64-1.23.2.tgz",
    "linux-amd64": "https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-linux-x64-1.23.2.tgz"
  }
}
```

### `GET /:model_id/:version/:file`
Streams a model file. Allowed files: `model.onnx`, `tokenizer.json`, `config.json`, `labels.json`.

## D. Verdicts

| Code | Description |
|---|---|
| `ALLOW` | risk below WARN threshold |
| `WARN` | user must acknowledge with reason |
| `BLOCK` | only path is admin override |
| `BLOCK_NO_OVERRIDE` | hard block (e.g., Aadhaar exfil); override disabled by policy |
