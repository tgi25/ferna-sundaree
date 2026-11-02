'use strict';
// YouTube ad handling, in two layers:
//
// 1. SHIELD (main world, document start; lives in src/preload/yt-shield.js): removes the ad
//    schedule from the player data before the player reads it — the "json-prune" technique
//    uBlock Origin uses. Covers the inline ytInitialPlayerResponse, JSON.parse (XHR and
//    text bodies) and Response.json() (fetch). No ads are requested if none are scheduled.
// 2. WATCH (isolated world, after load): hides ad slots, banners and promoted cards, and if
//    an ad still reaches the player (YouTube changes formats often, and some ads are
//    stitched into the video server-side), mutes it, clicks Skip and jumps to its end.
//    It also removes YouTube's "ad blockers are not allowed" dialog and resumes playback.
//
// Neither layer has a channel to the browser.

/** Runs in an isolated world after the page loads. */
const WATCH = String.raw`(() => {
  if (window.__fernaYT) return;
  window.__fernaYT = { skipped: 0, hidden: 0 };
  const CSS = [
    'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-banner-promo-renderer', '#masthead-ad',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-display-ad-renderer',
    'ytd-companion-slot-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', '#player-ads',
    'ytd-action-companion-ad-renderer', 'ytd-statement-banner-renderer', 'ytd-search-pyv-renderer',
    '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot', '.ytp-featured-product', 'ytd-merch-shelf-renderer',
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)', 'ytd-reel-video-renderer:has(.ytd-ad-slot-renderer)',
    'ytm-promoted-sparkles-web-renderer', 'ad-slot-renderer', 'ytm-companion-ad-renderer',
  ].join(',') + '{display:none!important}';
  const style = document.createElement('style');
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button, button[id^="skip-button"]';
  let mutedByUs = null;
  function tick() {
    const player = document.querySelector('.html5-video-player');
    const video = player && player.querySelector('video');
    if (player && video && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
      if (mutedByUs === null) { mutedByUs = video.muted; video.muted = true; }
      const b = document.querySelector(SKIP);
      if (b) { b.click(); window.__fernaYT.skipped++; }
      if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
        try { video.currentTime = video.duration; window.__fernaYT.skipped++; } catch (e) { /* not seekable yet */ }
      }
      try { video.playbackRate = 16; } catch (e) { /* ignore */ }
    } else if (mutedByUs !== null && video) {
      video.muted = mutedByUs; mutedByUs = null;
      if (video.playbackRate > 2) video.playbackRate = 1;
    }
    // "Ad blockers are not allowed on YouTube": remove the dialog and resume.
    const enf = document.querySelector('ytd-enforcement-message-view-model');
    if (enf) {
      const dlg = enf.closest('tp-yt-paper-dialog') || enf;
      dlg.remove();
      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(x => x.remove());
      if (video && video.paused) video.play().catch(() => {});
      window.__fernaYT.hidden++;
    }
  }
  new MutationObserver(tick).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  setInterval(tick, 500);
  tick();
})();`;

const WORLD = 7787;
const isYouTubeHost = (host, extra = '') => /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(host || '') || (!!extra && host === extra);

module.exports = { WATCH, WORLD, isYouTubeHost };
