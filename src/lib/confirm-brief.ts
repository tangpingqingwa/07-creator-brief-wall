import type { Listing } from "./rank";
import { outboundBriefUrl } from "./urls";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Confirm sheet HTML. Terms + URL first. Leave is POST /r/:id. GET does not count. */
export function confirmBriefHtml(listing: Listing): string {
  const url = outboundBriefUrl(listing.briefUrl);
  const brand = escapeHtml(listing.brand);
  const terms = escapeHtml(listing.terms);
  const safeUrl = escapeHtml(url);
  const id = escapeHtml(listing.id);
  return `<main class="board confirm-board" data-page="confirm-brief" data-confirm-brief="" data-id="${id}" data-brand="${escapeHtml(listing.brand)}" data-bid="${listing.bidUsd}" data-clicks="${listing.clicks}"><p class="confirm-back"><a href="/">Back to the wall</a></p><article class="confirm-sheet confirm-before-leave" data-confirm-before-leave=""><p class="confirm-kicker">Confirm this brief</p><p class="confirm-uncounted" data-confirm-uncounted="">Opening this flyer has not counted a hop.</p><h1 class="confirm-brand">${brand}</h1><p class="confirm-terms">${terms}</p><p class="confirm-url" data-brief-url="${escapeHtml(url)}">${safeUrl}</p><form class="confirm-form" method="post" action="/r/${id}"><button class="confirm-leave" type="submit" data-leave-brief="">Leave to the brief</button></form><p class="confirm-facts"><span class="confirm-bid">$${listing.bidUsd}</span><span class="confirm-clicks" data-clicks="${listing.clicks}">${listing.clicks} public hops — not reach</span></p><p class="confirm-note">Rank is the bid. We do not add tracking. A hop counts only after you leave.</p></article></main>`;
}
