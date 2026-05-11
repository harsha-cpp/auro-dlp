# AURO-DLP — Deployment Guide

This guide walks through deploying AURO-DLP across a hospital network: a central policy server and admin dashboard, plus the browser extension and endpoint agent on every clinical workstation.

It is written for the hospital network administrator and assumes a Windows-on-AD environment with Google Workspace (Gmail) and either Chrome or Edge as the standard browsers. Linux endpoints are supported as a smaller secondary fleet.

## 1. Prerequisites

- Windows 10 22H2+ or Windows 11 endpoints, joined to AD or Azure AD.
- Chrome 120+ or Edge 120+ as the corporate-managed browser. Mozilla Firefox, Brave, Opera, Vivaldi, Tor and other Chromium forks must be blocked at the OS layer (see [§5.4 AppLocker](#54-block-alternate-browsers)).
- A Linux host with at least 4 vCPU / 8 GB RAM / 100 GB SSD for the policy server (or a Windows host running Node 20 LTS).
- An internal CA capable of issuing TLS server certificates and short-lived endpoint client certificates.
- TPM 2.0 on every endpoint (used to seal the per-endpoint enrollment key).
- A code-signing certificate (EV preferred) for the agent `.exe` and any MSI bundle.
- An SMTP relay or SIEM (Splunk, QRadar, Elastic, Sentinel) for incident forwarding — optional but strongly recommended.
- Tesseract 5 with `eng` and `hin` traineddata installed on every endpoint (the agent will skip OCR with a warning if it is missing).

## 2. High-level architecture

```
┌──────────────────────┐       Signed YAML        ┌──────────────────────┐
│  Admin Dashboard     │  ───────────────────►    │  Policy Server (Node)│
│  (React, Recharts)   │  ◄──────  REST/JWT       │  + SQLite/Postgres   │
└──────────────────────┘                          └──────────┬───────────┘
                                                             │ Ed25519-signed
                                                             ▼ policy bundles
                            mTLS                     ┌──────────────────────┐
       Gmail compose ───►   loopback   ────────►     │  Endpoint Agent (Go) │
   (Chrome MV3 ext.)        WS/REST 7443             │  detector + parser   │
                                                     │  + Tesseract OCR     │
                                                     └──────────────────────┘
```

Detailed component boundaries are in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## 3. Build artifacts

If you have not been handed a release bundle, build everything from source:

```bash
# Linux/macOS host
./scripts/build-all.sh all
```

This produces, under `dist/`:

| File | Purpose |
| --- | --- |
| `auro-agent.exe` | Windows endpoint agent (PE32+, signed in §6) |
| `auro-agent-linux-amd64` | Linux endpoint agent |
| `policy-server.tgz` | Policy server source + locked `node_modules` |
| `admin-dashboard-dist/` | Static React bundle for nginx |
| `auro-dlp-extension.zip` | Browser extension, ready to upload to the Chrome Web Store private listing |

Verify the agent SHA-256 matches the published value before deployment.

## 4. Install the policy server

### 4.1 Operating system prep

```bash
sudo useradd --system --no-create-home auro-policy
sudo install -d -m 0750 -o auro-policy -g auro-policy /var/lib/auro-policy-server
sudo install -d -m 0755 /opt/auro-policy-server
sudo install -d -m 0750 -o auro-policy /etc/auro-policy-server
```

### 4.2 Application files

```bash
sudo tar -xzf dist/policy-server.tgz -C /opt --strip-components=0
sudo cp -r dist/admin-dashboard-dist /opt/auro-policy-server/admin-dashboard/dist
sudo chown -R auro-policy:auro-policy /opt/auro-policy-server
```

### 4.3 Environment + secrets

`/etc/auro-policy-server/env` (mode 0640, owned by `auro-policy`):

```ini
NODE_ENV=production
PORT=8443
DB_PATH=/var/lib/auro-policy-server/auro.sqlite
JWT_SECRET=<openssl rand -hex 64>
SIGNING_KEY_PATH=/var/lib/auro-policy-server/signing.key
AUDIT_HMAC_KEY=<openssl rand -hex 32>
SIEM_MODE=splunk
SIEM_URL=https://splunk.hospital.local:8088/services/collector
SIEM_TOKEN=<HEC token>
```

Generate the policy-signing keypair on first boot:

```bash
sudo -u auro-policy node /opt/auro-policy-server/scripts/keygen.js
sudo -u auro-policy node /opt/auro-policy-server/src/db/seed.js
```

The seed script creates the default `admin@hospital.local` user with password `change-me` — change it immediately after first login.

### 4.4 Systemd unit + nginx

```bash
sudo cp deployment/policy-server/auro-policy-server.service /etc/systemd/system/
sudo cp deployment/policy-server/nginx.conf /etc/nginx/sites-available/auro-dlp
sudo ln -s ../sites-available/auro-dlp /etc/nginx/sites-enabled/auro-dlp
sudo systemctl daemon-reload
sudo systemctl enable --now auro-policy-server
sudo systemctl reload nginx
```

Issue server and agent-CA certificates and place them under `/etc/ssl/auro-dlp/` per the comments in `nginx.conf`.

Smoke-test:

```bash
curl -sk https://dlp.hospital.local/api/v1/healthz
# {"status":"ok","version":"1.0.0"}
```

## 5. Deploy the agent + extension to endpoints

### 5.1 Mint an enrollment token

In the dashboard, go to **Endpoints → Issue enrollment token**. Copy the resulting token; it is valid for 24 hours and binds to the next agent that uses it.

### 5.2 GPO software-installation package

Wrap `auro-agent.exe`, `install-agent.ps1` and `auro-agent.service` (Linux) into an MSI using the Wix template under `deployment/windows/wix/` (built separately). Distribute via Group Policy Software Installation under:

```
Computer Configuration → Policies → Software Settings → Software installation
```

### 5.3 Group Policy admin templates

Copy the ADMX into the central store:

```
\\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions\AURO-DLP.admx
\\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions\en-US\AURO-DLP.adml
```

Configure under **Computer Configuration → Administrative Templates → AURO-DLP**:

| Setting | Value |
| --- | --- |
| Policy server URL | `https://dlp.hospital.local` |
| Enrollment token | (per-OU token from §5.1) |
| Strict mode | Enabled |
| Block screen capture on Gmail compose | Enabled |
| Browser extension ID | (production extension ID) |

### 5.4 Block alternate browsers

Import `deployment/windows/AppLocker-block-alt-browsers.xml` under **Computer Configuration → Windows Settings → Security Settings → Application Control Policies → AppLocker**, then ensure the Application Identity service is set to **Automatic** (without it AppLocker is silently inert).

For environments that prefer Windows Defender Application Control (WDAC), produce equivalent rules with `New-CIPolicy -FilePath ...` and merge.

### 5.5 Force-install the browser extension

Apply `deployment/windows/chrome-policy.json` and `edge-policy.json` via GPO (or the registry keys written by `install-agent.ps1`). After the next group-policy refresh and a browser restart, Chrome and Edge will install the AURO-DLP extension as `force_installed` — users cannot disable or uninstall it.

The extension auto-updates from `https://dlp.hospital.local/extension/updates.xml`; sign updates with the same Web Store private key.

### 5.6 Linux endpoints

```bash
sudo cp dist/auro-agent-linux-amd64 ./auro-agent
sudo cp deployment/linux/auro-agent.service .
sudo ./deployment/linux/install-agent.sh https://dlp.hospital.local <enrollment-token>
```

## 6. Code signing

```powershell
.\scripts\sign-windows.ps1 -CertSubject "CN=Hospital IT, O=Hospital, C=IN"
```

This signs `auro-agent.exe` with a SHA-256 timestamp. The Windows installer refuses to deploy an unsigned binary unless `-SkipSignatureCheck` is passed (do not use this in production).

## 7. Post-deploy verification

From a freshly-imaged endpoint:

1. `Get-Service AuroAgent` reports `Running`.
2. `chrome://extensions` shows the AURO-DLP extension as installed by enterprise policy and **cannot be removed**.
3. `curl http://127.0.0.1:7443/v1/healthz` returns `{"status":"ok"}`.
4. Open Gmail → Compose → paste an Aadhaar-formatted number (e.g. `2345 6789 0123` — fake, but Verhoeff-valid). The send button is intercepted, a warning modal appears, the send is blocked.
5. The dashboard shows a new incident under **Incidents** within ~5 seconds.
6. `EventLog → Application` shows the audit event with HMAC chain hash.

## 8. Rollback

```powershell
# On a single endpoint
.\deployment\windows\uninstall-agent.ps1
```

For the whole fleet, push a GPO that removes the software-install assignment and clears the registry hive:

```
Computer Configuration → Preferences → Windows Settings → Registry → Delete
HKLM\SOFTWARE\Policies\AURO-DLP
HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist
HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist
```

The next GPO refresh removes the extension; the next reboot stops the service.

## 9. Day-2 operations

| Activity | Frequency | Owner |
| --- | --- | --- |
| Review high-risk incidents | Daily | Security ops |
| Rotate JWT secret + audit HMAC key | Quarterly | InfoSec |
| Re-sign extension + push update.xml | On version change | InfoSec |
| Reissue policy-signing keypair | Yearly | InfoSec (with audit) |
| Verify HMAC chain integrity | Monthly | Internal audit (read-only role) |
| DR drill: restore policy DB from backup | Bi-annually | Infra |

## 10. Compliance hooks

The system is configured out of the box to satisfy:

- **HIPAA §164.312(b)** — audit controls (HMAC-chained log).
- **HIPAA §164.312(c)(1)** — integrity (Ed25519-signed policies).
- **DPDPA 2023 §8** — purpose limitation (incidents store metadata only, no PHI).
- **ABDM HIPS-22** — minimum necessary disclosure.
- **SOC 2 CC7.2** — system-monitoring controls.

Map the dashboard's **Audit Log** export to your evidence-collection tooling for ISO 27001 A.12.4.

## 11. Support

- Logs (server): `journalctl -u auro-policy-server`
- Logs (agent, Windows): `Event Viewer → Application → Source: AuroAgent` and `%ProgramData%\AURO-DLP\logs\*.ndjson`
- Logs (agent, Linux): `journalctl -u auro-agent` and `/var/lib/auro-dlp/audit.log`
- Reset admin password (server console):

  ```bash
  sudo -u auro-policy node /opt/auro-policy-server/scripts/reset-password.js admin@hospital.local
  ```
