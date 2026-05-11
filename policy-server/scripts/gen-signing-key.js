// Generates an Ed25519 keypair for signing policy bundles.
// Run once at install time.
import crypto from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const keyPath = process.env.SIGNING_KEY_PATH || './certs/policy-ed25519.key';
const pubPath = process.env.SIGNING_PUB_PATH || './certs/policy-ed25519.pub.b64';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);

mkdirSync(dirname(keyPath), { recursive: true });
writeFileSync(keyPath, privPem, { mode: 0o600 });
writeFileSync(pubPath, pubRaw.toString('base64') + '\n');

console.log(`Wrote private key -> ${keyPath}`);
console.log(`Wrote public key  -> ${pubPath}`);
console.log('Embed the public key (base64, 32 bytes) in the agent build via configs/agent.yaml -> policy_public_key.');
