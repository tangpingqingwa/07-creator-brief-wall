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
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
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

  return formatCanonicalHttps(parsed);
}

/**
 * 302 target for a later click hop. Never adds query parameters. Re-cleans
 * leftover tracking if a dirty URL slipped into storage.
 */
export function outboundBriefUrl(stored: string): string {
  return canonicalizeBriefUrl(stored);
}
