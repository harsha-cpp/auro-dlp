# AURO-DLP

Hospital Gmail DLP — prevents PHI/PII exfiltration from Google Workspace.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Hospital Network                          │
│                                                                  │
│  ┌──────────┐    HTTP     ┌──────────────┐    HTTP    ┌───────┐ │
│  │  Chrome  │◄──loopback──►  Go Agent    │◄──────────►│Policy │ │
│  │Extension │    :7443    │  (detection) │   :8443    │Server │ │
│  └──────────┘             └──────────────┘            └───┬───┘ │
│       │                         │                         │     │
│       │ Gmail compose           │ ONNX + regex            │     │
│       │ intercept               │ scoring                 │     │
│       ▼                         ▼                         ▼     │
│  Block/Warn/Allow        Local audit log         ┌────────────┐ │
│                                                  │  Admin UI  │ │
│                                                  │   :5173    │ │
│                                                  └────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Path | Tech |
|---|---|---|
| Browser extension (MV3) | `browser-extension/` | Chrome MV3, content script |
| Endpoint agent | `endpoint-agent/` | Go 1.22, ONNX inference |
| Policy server | `policy-server/` | Node.js, Express, SQLite |
| Admin dashboard | `admin-dashboard/` | React, Vite |

## Quickstart

```bash
make dev
```

This will:
1. Create a stub ML model (regex-only mode)
2. Start the policy server on `:8443`
3. Start the dashboard on `:5173`
4. Start the agent on `:7443`

Login: `admin@hospital.local` / `change-me`

### Prerequisites

- Node.js 20+
- Go 1.22+
- tesseract (optional, for OCR)

### Full model (optional)

```bash
make fetch-model          # Downloads + quantizes indicv2 (~280MB)
make fetch-model-fallback # Smaller fallback (~70MB)
```


## Detection

Supports: Aadhaar (Verhoeff), PAN, ABHA, MRN, CCN (Luhn), SSN, Indian mobile,
clinical narrative NER, ICD codes, drug names.

## Evaluation

```bash
make eval
```

Runs the synthetic corpus (~215 samples) through the agent and reports precision/recall.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Detection Rules](docs/DETECTION.md)
- [API Contract](docs/API.md)
- [Rework Notes](docs/REWORK_NOTES.md)

## License

Proprietary — internal hospital use. See `LICENSE`.
