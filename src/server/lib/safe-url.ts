import { isIP } from 'node:net';

const CLOUD_METADATA_IPS = new Set([
  'fd00:ec2::254',
  'fd20:ce::254',
  '100.100.100.200',
  '168.63.129.16',
]);

export function blockedAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (CLOUD_METADATA_IPS.has(value)) return true;

  if (value.startsWith('::ffff:')) {
    const tail = value.slice(7);
    if (tail.includes('.')) return blockedAddress(tail);
    const parts = tail.split(':');
    if (parts.length === 2) {
      const high = parseInt(parts[0]!, 16);
      const low = parseInt(parts[1]!, 16);
      return blockedAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return true;
  }

  if (isIP(value) === 4) {
    const [firstOctet, secondOctet] = value.split('.').map(Number);
    return (
      firstOctet === 0 || (firstOctet === 169 && secondOctet === 254) || (firstOctet ?? 0) >= 224
    );
  }

  return value === '::' || /^fe[89ab]/.test(value) || value.startsWith('ff') || !isIP(value);
}

export function validateBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('Enter an HTTP or HTTPS base URL.');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter an HTTP or HTTPS base URL.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Use an HTTP(S) base URL without credentials, query parameters or a fragment.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    (isIP(hostname) && blockedAddress(hostname)) ||
    ['metadata.google.internal', 'instance-data.ec2.internal'].includes(hostname.toLowerCase())
  ) {
    throw new Error('Link-local, metadata and non-unicast addresses cannot be used.');
  }

  return url.toString().replace(/\/$/, '');
}
