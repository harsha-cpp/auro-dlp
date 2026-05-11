# AURO-DLP — Detection Reference

## 1. Hybrid Strategy

A document is scored by combining three signals, each weighted by the active policy:

```
risk = clamp01(
    0.50 * regex_signal
  + 0.30 * ner_signal
  + 0.20 * ml_signal
  + context_bonus
)
```

`context_bonus` adds up to +0.20 when (a) attachment filename matches `.*lab.*|.*report.*|.*Rx.*|.*scan.*`, (b) compose recipient domain is non-hospital, or (c) message contains explicit medical terminology adjacent to a personal identifier.

Verdicts:

| risk | Default verdict |
|---|---|
| `< 0.30` | ALLOW |
| `0.30 – 0.65` | WARN (user must acknowledge) |
| `≥ 0.65` | BLOCK (admin override only) |

Operators tune thresholds and weights in `configs/policy.yaml` (signed and pushed by the policy server).

## 2. Regex Catalog (India + International)

| ID | Description | Pattern (Go syntax, see `internal/detector/patterns.go`) |
|---|---|---|
| `IN.AADHAAR` | Aadhaar (12-digit, optional spaces) — must pass Verhoeff | `\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b` |
| `IN.PAN` | PAN | `\b[A-Z]{5}[0-9]{4}[A-Z]\b` |
| `IN.MOBILE` | Indian mobile | `\b(?:\+?91[\s-]?)?[6-9]\d{9}\b` |
| `IN.ABHA` | Ayushman Bharat Health Account ID | `\b\d{2}-\d{4}-\d{4}-\d{4}\b` |
| `MED.MRN` | Medical Record Number (configurable per-hospital prefix) | `\b(?:MRN|MR#|Med\.?Rec)[\s:#-]*([A-Z0-9-]{6,20})\b` |
| `MED.ICD10` | ICD-10 code | `\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?\b` |
| `MED.ICD11` | ICD-11 stem | `\b[0-9A-HJ-NP-Z]{2,4}(?:\.[A-Z0-9]{1,4})?\b` (low precision; combined with ICD context) |
| `MED.RX` | Prescription Rx pattern | `(?i)\bRx\b[:\s]|\b(tab|cap|syr|inj)\.?\s+[A-Z][a-z]+\s+\d+\s?(mg|mcg|ml|iu)\b` |
| `INS.POLICY` | Insurance policy id (generic) | `\b(POL|INS|PLCY)[-#:]?\s*([A-Z0-9]{6,16})\b` |
| `US.SSN` | US SSN | `\b(?!000|666)[0-8]\d{2}-(?!00)\d{2}-(?!0000)\d{4}\b` |
| `INT.EMAIL` | Email | RFC-5322 simplified |
| `INT.CCN` | Credit card (Luhn-validated) | 13–19 digits, validated downstream |
| `MED.LAB` | Lab report header tokens | `(?i)\b(CBC|HbA1c|TSH|LFT|KFT|ECG|HIV|HBsAg|HCV|RT-PCR|Troponin)\b` |
| `MED.RAD` | Radiology header tokens | `(?i)\b(MRI|CT scan|X-?ray|USG|Mammogram|PET-?CT|Ultrasound)\b` |
| `MED.DIAG` | Diagnosis adjacency | `(?i)\b(diagnosis|impression|finding|provisional)\b\s*:` |

All regex matches are post-validated:

- **Aadhaar** runs the Verhoeff checksum (`internal/detector/verhoeff.go`) — drops 99 % of false positives from generic 12-digit numbers like phone-with-country-code.
- **PAN** must satisfy positional category code (4th char ∈ {P,F,C,H,A,T,B,L,J,G}).
- **CCN** runs Luhn.
- **Mobile** rejects numbers that are also valid Aadhaar prefixes.

## 3. Hospital Keyword Dictionary

`configs/dictionaries/hospital.txt` ships with ~600 Indian-context terms. Categories:

- Departments (Cardiology, Oncology, Nephrology, …)
- Procedures (Angioplasty, Chemotherapy, Dialysis, …)
- Drug names (Atorvastatin, Metformin, Amlodipine, …)
- Symptom phrasings (chest pain, dyspnea, hematuria, …)
- Indian provider terminology (OPD, IPD, MLC, MRD, BHT, …)

A document gets a dictionary hit count `D`. Used as a context multiplier:

```
context_bonus += min(D / 10, 0.10)
```

## 4. NER (Named Entity Recognition)

The agent embeds an ONNX-runtime model (`models/ner-en-hi.onnx`, ~25 MB) trained on:

- CoNLL-2003 + custom hospital corpus (English).
- IIIT-H Indian-name corpus for `PERSON`.

Entities considered "patient-identifying" when colocated within 80 chars of a regex match: `PERSON`, `DATE` (DOB pattern), `LOCATION`, `ORG` (insurance/hospital), `ID`.

If the ONNX model is missing (e.g. air-gapped lab build), the agent falls back to a deterministic name-list match against `configs/dictionaries/in-names.txt`. The shipped model and fallback are interchangeable behind the `Recognizer` interface.

## 5. ML Sensitivity Scorer

`internal/detector/classifier.go` runs an XGBoost model serialized as JSON. Features:

- Doc-level: token count, ICD count, drug count, name count, digit-density, entropy.
- Doc-class: TF-IDF top-k cosine to known PHI doc templates (lab report, discharge summary, Rx, radiology report).

Output: `ml_signal ∈ [0,1]`.

The scaffolded build ships a stub model that returns 0.5 for any doc that contains ≥ 2 hospital-dictionary tokens and ≥ 1 regex hit. Replace `models/sensitivity.json` with your trained model.

## 6. File-type Routing

| Type | Parser | Notes |
|---|---|---|
| `text/plain`, body | direct | UTF-8 normalized |
| `application/pdf` | `unipdf` text + `pdfcpu` raster → tesseract | Both passes; OCR only if extracted text < 200 chars (probable scanned PDF). |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `unioffice` | Reads paragraphs + tables. |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `excelize` | Iterates all sheets/cells. |
| `image/png`, `jpg`, `tiff` | `gosseract` (eng+hin) | DPI auto-bumped to 300. |
| `application/zip` | `archive/zip` recursive | Bounded depth (3) and size (100 MB unzipped). |
| `application/rtf` | regex stripper | RTF control words removed before scan. |

## 7. Sample Output

Agent response to `POST /v1/inspect`:

```json
{
  "incident_id": "01HXAB...",
  "verdict": "BLOCK",
  "risk": 0.78,
  "matches": [
    { "rule_id": "IN.AADHAAR", "count": 2, "first_offset": 142 },
    { "rule_id": "MED.MRN",    "count": 1, "first_offset": 60  },
    { "rule_id": "MED.ICD10",  "count": 1, "first_offset": 217 }
  ],
  "categories": ["PHI", "PII-IN"],
  "context": { "dictionary_hits": 4, "ml_signal": 0.62 },
  "policy_version": "2026-05-01-r3"
}
```

The verdict alone is shown to the user; `matches[].first_offset` is logged locally for security forensics but never sent to the central server.
