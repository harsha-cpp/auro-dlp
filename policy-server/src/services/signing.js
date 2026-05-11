import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const keyPath = process.env.SIGNING_KEY_PATH || './certs/policy-ed25519.key';
const pubPath = process.env.SIGNING_PUB_PATH || './certs/policy-ed25519.pub.b64';

function loadKey() {
  if (!existsSync(keyPath)) throw new Error(`signing key missing at ${keyPath} (run npm run gen-keys)`);
  return crypto.createPrivateKey(readFileSync(keyPath));
}

export function signPolicy(yaml) {
  const k = loadKey();
  const sig = crypto.sign(null, Buffer.from(yaml, 'utf8'), k);
  return sig.toString('base64');
}

export function pubKeyB64() {
  if (!existsSync(pubPath)) return '';
  return readFileSync(pubPath, 'utf8').trim();
}
