'use strict';
// Media controls for any tab (the toolbar media button): what is playing, play/pause, and
// Picture-in-Picture on enter only (used when you switch away from a playing video).
// Scripts run in the page's frames from the browser process; they only read and toggle
// <video>/<audio> elements and return plain values.

const STATUS = `(() => {
  const m = [...document.querySelectorAll('video, audio')].filter(x => x.readyState > 0 || !x.paused);
  if (!m.length) return null;
  const playing = m.find(x => !x.paused && !x.ended);
  const x = playing || m[m.length - 1];
  const ms = navigator.mediaSession && navigator.mediaSession.metadata;
  return {
    playing: !!playing, video: x.tagName === 'VIDEO', time: x.currentTime || 0, duration: isFinite(x.duration) ? x.duration : 0,
    title: ms ? (ms.title || '') : '', artist: ms ? (ms.artist || '') : '', pip: !!document.pictureInPictureElement,
  };
})()`;

const TOGGLE = `(() => {
  const m = [...document.querySelectorAll('video, audio')].filter(x => x.readyState > 0 || !x.paused);
  const playing = m.filter(x => !x.paused && !x.ended);
  if (playing.length) { playing.forEach(x => x.pause()); return 'paused'; }
  const x = m[m.length - 1];
  if (!x) return 'none';
  const p = x.play(); if (p && p.catch) p.catch(() => {});
  return 'playing';
})()`;

const SEEK = s => `(() => { const x = [...document.querySelectorAll('video, audio')].find(v => !v.paused) || document.querySelector('video, audio'); if (!x) return false; x.currentTime = Math.max(0, x.currentTime + (${Number(s) || 0})); return true; })()`;

// Enter PiP only when a video is actually playing and none is out already.
const PIP_ENTER = String.raw`(async () => {
  try {
    if (document.pictureInPictureElement) return 'already';
    const v = [...document.querySelectorAll('video')].filter(x => !x.paused && !x.ended && x.readyState > 1)
      .sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0];
    if (!v) return 'none';
    if (v.disablePictureInPicture) { v.disablePictureInPicture = false; v.removeAttribute('disablepictureinpicture'); }
    await v.requestPictureInPicture();
    return 'entered';
  } catch (e) { return 'error:' + (e && e.message || e); }
})()`;
const PIP_EXIT = `(async () => { try { if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'exited'; } return 'none'; } catch (e) { return 'error'; } })()`;

function frames(wc) {
  if (!wc || wc.isDestroyed()) return [];
  return [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter(f => f !== wc.mainFrame)];
}

/** First non-null answer from the page or its frames. */
async function inFrames(wc, code, gesture = false, accept = r => r !== null && r !== undefined && r !== 'none') {
  for (const f of frames(wc)) {
    try { const r = await f.executeJavaScript(code, gesture); if (accept(r)) return r; } catch { /* frame gone */ }
  }
  return null;
}

module.exports = {
  status: wc => inFrames(wc, STATUS),
  toggle: wc => inFrames(wc, TOGGLE, true),
  seek: (wc, s) => inFrames(wc, SEEK(s), true, r => r === true),
  pipEnter: wc => inFrames(wc, PIP_ENTER, true, r => r === 'entered' || r === 'already'),
  pipExit: wc => inFrames(wc, PIP_EXIT, true, r => r === 'exited'),
  STATUS, TOGGLE, PIP_ENTER,
};
