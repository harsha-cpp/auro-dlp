// Web Crypto SHA-256 helper (used to hash file contents in browser before send to agent)
export async function sha256Hex(buffer) {
  const buf = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
