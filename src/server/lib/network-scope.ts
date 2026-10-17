import { isIP } from 'node:net';

const PRIVATE_NAME_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal', '.localdomain'];

function isPrivateIpv4(address: string): boolean {
  const [first = 0, second = 0] = address.split('.').map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    // 100.64.0.0/10: carrier-grade NAT, which Tailscale and similar overlays use.
    (first === 100 && second >= 64 && second <= 127)
  );
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::1') return true;
  const mappedIpv4 = value.startsWith('::ffff:') ? value.slice(7) : '';
  if (isIP(mappedIpv4) === 4) return isPrivateIpv4(mappedIpv4);
  return /^f[cd]/.test(value);
}

/**
 * True for hosts reachable only on a home or private network: loopback, RFC 1918, CGNAT and
 * unique-local addresses, single-label names and private-use DNS suffixes. Public names are
 * false, so they keep requiring HTTPS.
 */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  const version = isIP(host);
  if (version === 4) return isPrivateIpv4(host);
  if (version === 6) return isPrivateIpv6(host);
  if (host === 'localhost' || !host.includes('.')) return true;
  return PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
