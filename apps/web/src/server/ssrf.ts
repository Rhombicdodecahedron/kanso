// Keeps the proxy pointed at the public internet: no loopback, private, link-local or metadata
// addresses, checked on the resolved IPs. (A DNS answer changing between the check and the fetch
// is accepted as a residual risk for a single-user tool.)

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

export class BlockedUrlError extends Error {}

export interface UrlGuard {
  check(url: string): Promise<URL>;
}

export function isBlockedAddress(ip: string): boolean {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (v4) return blocked.check(v4, 'ipv4');
  return isIP(ip) === 6 ? blocked.check(ip, 'ipv6') : blocked.check(ip, 'ipv4');
}

export function createUrlGuard(resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): UrlGuard {
  return {
    async check(raw) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new BlockedUrlError('Not a URL');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError(`Scheme not allowed: ${url.protocol}`);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const ips = isIP(host) ? [host] : await resolve(host).catch(() => {
        throw new BlockedUrlError(`Cannot resolve ${host}`);
      });
      if (!ips.length || ips.some(isBlockedAddress)) throw new BlockedUrlError(`Address not allowed: ${host}`);
      return url;
    },
  };
}

/** For tests against local fixtures. */
export const allowAll: UrlGuard = { check: async (raw) => new URL(raw) };
