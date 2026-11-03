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
    // An ad is playing only when the player says so AND shows ad controls; YouTube can leave
    // "ad-showing" on for a moment as the real video starts, and that video must not be skipped.
    const adUi = player && player.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-preview-container, .ytp-ad-text, .ytp-ad-badge, .ytp-ad-simple-ad-badge, .ytp-ad-duration-remaining, ' + SKIP);
    if (player && video && adUi && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
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
  // A video that stops by itself just after it starts (YouTube's player does this to some
  // ad-blocking browsers) is started again, as other browsers keep playing. Only a pause you
  // make on the video itself is kept: a click on the video or the play/pause button, or the
  // Space, K or media play/pause key. Clicking a video, Next or Previous starts a new video
  // and is not a pause.
  let userPauseAt = 0;
  const PAUSE_KEYS = new Set([' ', 'k', 'K', 'MediaPlayPause', 'MediaPause', 'Pause']);
  window.addEventListener('pointerdown', e => {
    if (!e.isTrusted || e.button !== 0) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && (t.closest('.ytp-play-button') || t.closest('.html5-video-container') || t instanceof HTMLVideoElement)) userPauseAt = Date.now();
  }, true);
  window.addEventListener('keydown', e => {
    if (!e.isTrusted || !PAUSE_KEYS.has(e.key)) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return; // typing in a box
    userPauseAt = Date.now();
  }, true);
  const userPaused = () => Date.now() - userPauseAt < 1200;
  const starts = new WeakMap(); // video → { at, resumes }
  const fresh = v => { const st = { at: Date.now(), resumes: 0 }; starts.set(v, st); return st; };
  // A new video: a new address loads in the element, or YouTube moved to another video.
  document.addEventListener('loadstart', e => { if (e.target instanceof HTMLVideoElement) fresh(e.target); }, true);
  document.addEventListener('yt-navigate-finish', () => { const v = document.querySelector('.html5-video-player video'); if (v) fresh(v); }, true);
  document.addEventListener('playing', e => {
    const v = e.target;
    if (v instanceof HTMLVideoElement && !starts.has(v)) { const st = fresh(v); st.at -= (v.currentTime || 0) * 1000; }
  }, true);
  function resume(v, player) {
    // Through YouTube's own button, so the player's state stays in step; else the video itself.
    const btn = player.querySelector('.ytp-play-button');
    const label = btn ? (btn.getAttribute('data-title-no-tooltip') || btn.getAttribute('aria-label') || btn.getAttribute('title') || '') : '';
    if (btn && /^play\b/i.test(label)) btn.click();
    setTimeout(() => { if (v.paused && !v.ended) { const pl = v.play(); if (pl && pl.catch) pl.catch(() => {}); } }, 150);
  }
  document.addEventListener('pause', e => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    const player = v.closest('.html5-video-player');
    if (!player || v.ended || player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) return;
    let st = starts.get(v);
    if (!st && (v.currentTime || 0) < 5) { st = fresh(v); st.at -= (v.currentTime || 0) * 1000; }
    if (!st || Date.now() - st.at > 15000 || st.resumes >= 6 || userPaused() || document.hidden) return;
    setTimeout(() => {
      if (!v.paused || v.ended || userPaused() || document.hidden) return;
      st.resumes++; window.__fernaYT.resumed = (window.__fernaYT.resumed || 0) + 1;
      resume(v, player);
    }, 200);
  }, true);

  new MutationObserver(tick).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  setInterval(tick, 500);
  tick();
})();`;

const WORLD = 7787;
const isYouTubeHost = (host, extra = '') => /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(host || '') || (!!extra && host === extra);

module.exports = { WATCH, WORLD, isYouTubeHost };
