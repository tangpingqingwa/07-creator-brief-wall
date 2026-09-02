/** SPEC §7 — clean brief URLs before persist and before redirect. No network. */

export type UrlErrorCode =
  | "invalid_url"
  | "chat_link_forbidden"
  | "nsfw_forbidden"
  | "shortener_forbidden";

export class UrlError extends Error {
  readonly httpStatus = 400;

  constructor(
    readonly code: UrlErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "UrlError";
  }
}

/** Exact tracking / affiliate keys. `utm_*` and `ref_` are prefix-matched. */
export const TRACKING_QUERY_KEYS: readonly string[] = [
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_eid",
  "ref",
  "affiliate",
  "aff",
  "irclickid",
];

const TRACKING_KEY_SET = new Set(TRACKING_QUERY_KEYS);

/** Chat / invite hosts. Subdomains match. Slack / Discord also use path rules. */
export const CHAT_HOSTS: readonly string[] = [
  "t.me",
  "telegram.me",
  "telegram.org",
  "telegram.dog",
  "wa.me",
  "whatsapp.com",
  "discord.gg",
  "discordapp.com",
  "m.me",
  "messenger.com",
  "signal.me",
  "signal.group",
  "signal.link",
  "signal.org",
  "join.slack.com",
];

/** Known shorteners are rejected. Do not resolve or replace in v1. */
export const SHORTENER_HOSTS: readonly string[] = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "tiny.cc",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "cutt.ly",
  "rebrand.ly",
  "rb.gy",
  "lnkd.in",
  "db.tt",
  "shorturl.at",
];

/** Adult hosts. Subdomains match. Path keywords are checked separately. */
export const NSFW_HOSTS: readonly string[] = [
  "pornhub.com",
  "pornhub.org",
  "pornhubpremium.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "onlyfans.com",
  "fansly.com",
  "chaturbate.com",
  "stripchat.com",
  "manyvids.com",
  "youporn.com",
  "redtube.com",
  "brazzers.com",
  "spankbang.com",
  "adultfriendfinder.com",
];

const NSFW_PATH_SEGMENTS = new Set([
  "porn",
  "porno",
  "xxx",
  "nsfw",
  "onlyfans",
  "fansly",
  "hentai",
]);

function hostMatches(host: string, listed: string): boolean {
  return host === listed || host.endsWith(`.${listed}`);
}

function hostMatchesAny(host: string, listed: readonly string[]): boolean {
  return listed.some((candidate) => hostMatches(host, candidate));
}

function hostnameOf(parsed: URL): string {
  return parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .replace(/^\.+/, "");
}

export function isTrackingQueryKey(key: string): boolean {
  const lowered = key.toLowerCase();
  if (lowered.startsWith("utm_")) return true;
  if (lowered.startsWith("ref_")) return true;
  return TRACKING_KEY_SET.has(lowered);
}

export function isShortenerHost(host: string): boolean {
  return hostMatchesAny(hostnameOfHost(host), SHORTENER_HOSTS);
}

export function isChatHost(host: string): boolean {
  return hostMatchesAny(hostnameOfHost(host), CHAT_HOSTS);
}

export function isNsfwHost(host: string): boolean {
  return hostMatchesAny(hostnameOfHost(host), NSFW_HOSTS);
}

function hostnameOfHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .replace(/^\.+/, "");
}

const URL_SCHEME_RE = /^([a-z][a-z\d+.-]*):/i;
const RAW_URL_CONTROL_RE = /[\p{C}\p{Z}]/u;

function looksLikeBareAuthority(value: string): boolean {
  if (!value || value.startsWith("/") || value.startsWith("?") || value.startsWith("#")) {
    return false;
  }

  const authority = value.split(/[\/?#]/, 1)[0] ?? "";
  if (!authority) return false;

  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket < 2) return false;
    const suffix = authority.slice(closingBracket + 1);
    return suffix === "" || /^:\d+$/.test(suffix);
  }

  const portSeparator = authority.lastIndexOf(":");
  const host = portSeparator === -1 ? authority : authority.slice(0, portSeparator);
  const port = portSeparator === -1 ? "" : authority.slice(portSeparator + 1);
  if (portSeparator !== -1 && !/^\d+$/.test(port)) return false;

  // A bare input is intentionally conservative: a dotted authority is
  // distinguishable from a relative path or a typoed scheme such as
  // `https//example.com`. Public/private checks happen after URL parsing.
  return host.includes(".") && !host.startsWith(".") && !host.endsWith(".");
}

/**
 * Form inputs commonly omit the scheme for a public brief domain. Treat that
 * shorthand as HTTPS while preserving an explicitly supplied scheme so HTTP
 * and non-web protocols still fail closed in parseAbsoluteUrl.
 */
export function normalizeBriefUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (RAW_URL_CONTROL_RE.test(trimmed) || trimmed.includes("\\")) return trimmed;
  if (trimmed.startsWith("///")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return trimmed;

  const scheme = trimmed.match(URL_SCHEME_RE);
  if (scheme) {
    const rest = trimmed.slice(scheme[0].length);
    const host = scheme[1].toLowerCase();
    const looksLikeHostPort =
      host.includes(".") &&
      /^\d+(?:[/?#]|$)/.test(rest);
    if (!looksLikeHostPort) return trimmed;
  }

  return looksLikeBareAuthority(trimmed) ? `https://${trimmed}` : trimmed;
}

export function isChatUrl(parsed: URL): boolean {
  const host = hostnameOf(parsed);
  if (hostMatchesAny(host, CHAT_HOSTS) || host === "discord.com") {
    return true;
  }
  const path = parsed.pathname.toLowerCase();
  if (host === "slack.com" || host.endsWith(".slack.com")) {
    return (
      path.startsWith("/invite") ||
      path.startsWith("/shared_invite") ||
      path.startsWith("/join") ||
      path.includes("/ssb/redirect")
    );
  }
  return false;
}

export function isNsfwUrl(parsed: URL): boolean {
  const host = hostnameOf(parsed);
  if (hostMatchesAny(host, NSFW_HOSTS)) {
    return true;
  }
  const segments = parsed.pathname.toLowerCase().split("/").filter(Boolean);
  return segments.some((segment) => NSFW_PATH_SEGMENTS.has(segment));
}

function parseAbsoluteUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new UrlError("invalid_url", "brief URL is required");
  }
  if (
    RAW_URL_CONTROL_RE.test(trimmed) ||
    trimmed.includes("\\") ||
    trimmed.startsWith("///") ||
    (trimmed.startsWith("/") && !trimmed.startsWith("//"))
  ) {
    throw new UrlError("invalid_url", "brief URL is malformed");
  }

  const explicitScheme = trimmed.match(URL_SCHEME_RE);
  if (explicitScheme) {
    const rest = trimmed.slice(explicitScheme[0].length);
    if (rest.startsWith("///")) {
      throw new UrlError("invalid_url", "brief URL authority is malformed");
    }
    if (
      explicitScheme[1].toLowerCase() === "https" &&
      !rest.startsWith("//")
    ) {
      throw new UrlError("invalid_url", "brief URL must include an authority");
    }
  }

  const candidate = normalizeBriefUrlInput(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new UrlError("invalid_url", "brief URL is not a valid URL");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol === "javascript:" || protocol === "data:") {
    throw new UrlError("invalid_url", "brief URL must be https");
  }
  if (protocol !== "https:") {
    throw new UrlError("invalid_url", "brief URL must be https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new UrlError("invalid_url", "brief URL must not include credentials");
  }
  return parsed;
}

function ipv4Octets(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets as [number, number, number, number];
}

function isPublicIpv4(host: string): boolean {
  const octets = ipv4Octets(host);
  if (!octets) return false;
  const [first, second, third] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function parseIpv6Words(host: string): number[] | null {
  const halves = host.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const words: number[] = [];
    for (const group of half.split(":")) {
      if (group.includes(".")) {
        const octets = ipv4Octets(group);
        if (!octets || words.length > 6) return null;
        words.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      words.push(Number.parseInt(group, 16));
    }
    return words;
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves.length === 2 ? halves[1] : "");
  if (!left || !right) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const zeroWords = 8 - left.length - right.length;
  if (zeroWords < 1) return null;
  return [...left, ...Array.from({ length: zeroWords }, () => 0), ...right];
}

function isPublicIpv6(host: string): boolean {
  const words = parseIpv6Words(host);
  if (!words) return false;

  const allZero = words.every((word) => word === 0);
  const loopback =
    words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  if (allZero || loopback) return false;

  const first = words[0];
  if (
    (first & 0xfe00) === 0xfc00 || // fc00::/7, unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10, link local
    (first & 0xff00) === 0xff00 // ff00::/8, multicast
  ) {
    return false;
  }

  const mappedIpv4 =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mappedIpv4) {
    const firstOctet = words[6] >> 8;
    const secondOctet = words[6] & 0xff;
    const thirdOctet = words[7] >> 8;
    const fourthOctet = words[7] & 0xff;
    return isPublicIpv4(
      `${firstOctet}.${secondOctet}.${thirdOctet}.${fourthOctet}`,
    );
  }

  return true;
}

function isPlausibleDnsHostname(host: string): boolean {
  if (!host.includes(".") || host.includes(":")) return false;
  if (host.length > 253) return false;
  return host.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

function isPublicBriefDestination(parsed: URL): boolean {
  const rawHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !rawHost ||
    rawHost.startsWith(".") ||
    rawHost.endsWith(".") ||
    rawHost === "localhost" ||
    rawHost.endsWith(".localhost") ||
    rawHost.endsWith(".local") ||
    rawHost.endsWith(".test") ||
    rawHost.endsWith(".invalid") ||
    rawHost.endsWith(".example") ||
    rawHost.endsWith(".internal")
  ) {
    return false;
  }

  if (rawHost.includes(":")) return isPublicIpv6(rawHost);
  const ipv4 = ipv4Octets(rawHost);
  if (ipv4) return isPublicIpv4(rawHost);
  return isPlausibleDnsHostname(rawHost);
}

function stripTrackingQuery(parsed: URL): URLSearchParams {
  const kept = new URLSearchParams();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!isTrackingQueryKey(key)) {
      kept.append(key, value);
    }
  }
  return kept;
}

/**
 * Format https URL: lowercase host, no :443, no trailing slash on path,
 * tracking query stripped. Path and non-tracker query stay.
 */
export function formatCanonicalHttps(parsed: URL): string {
  const host = hostnameOf(parsed);
  if (!host) {
    throw new UrlError("invalid_url", "brief URL host is required");
  }
  const port = parsed.port && parsed.port !== "443" ? `:${parsed.port}` : "";
  let path = parsed.pathname;
  if (path.length > 1) {
    path = path.replace(/\/+$/, "");
  }
  if (path === "/") {
    path = "";
  }
  const query = stripTrackingQuery(parsed).toString();
  const hostForUrl = host.includes(":") ? `[${host}]` : host;
  return `https://${hostForUrl}${port}${path}${query ? `?${query}` : ""}`;
}

/** Origin + path identity so two briefs on one host do not share a bid. */
export function briefUrlKey(canonical: string): string {
  const parsed = parseAbsoluteUrl(canonical);
  const formatted = formatCanonicalHttps(parsed);
  const cut = formatted.indexOf("?");
  return cut === -1 ? formatted : formatted.slice(0, cut);
}

/**
 * Require https, strip tracking (and a tracker-only query), reject
 * chat / NSFW / shorteners / credentials. Store and redirect this URL only.
 */
export function canonicalizeBriefUrl(raw: string): string {
  const parsed = parseAbsoluteUrl(raw);
  const host = hostnameOf(parsed);

  if (!host) {
    throw new UrlError("invalid_url", "brief URL host is required");
  }
  if (isShortenerHost(host)) {
    throw new UrlError(
      "shortener_forbidden",
      "URL shorteners are not allowed",
    );
  }
  if (isChatUrl(parsed)) {
    throw new UrlError(
      "chat_link_forbidden",
      "chat and invite links are not allowed",
    );
  }
  if (isNsfwUrl(parsed)) {
    throw new UrlError(
      "nsfw_forbidden",
      "adult / NSFW brief URLs are not allowed",
    );
  }
  if (!isPublicBriefDestination(parsed)) {
    throw new UrlError(
      "invalid_url",
      "brief URL must point to a public destination",
    );
  }

  return formatCanonicalHttps(parsed);
}

/**
 * 302 target for a later click hop. Never adds query parameters. Re-cleans
 * leftover tracking if a dirty URL slipped into storage.
 */
export function outboundBriefUrl(stored: string): string {
  return canonicalizeBriefUrl(stored);
}
