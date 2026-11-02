'use strict';
// Picture-in-Picture, as Google's Picture-in-Picture extension does it: pick the largest
// video that has data, pop it into Chromium's floating, always-on-top PiP window (with its
// own play/pause, seek and track controls), or bring it back if one is already out.
// Unlike the extension, a page's disablePictureInPicture is overridden: the user asked.

const TOGGLE = String.raw`(async () => {
  try {
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'exited'; }
    const vids = [...document.querySelectorAll('video')]
      .filter(v => v.readyState > 0 && v.offsetWidth * v.offsetHeight > 0)
      .sort((a, b) => (b.offsetWidth * b.offsetHeight + (b.paused ? 0 : 1e9)) - (a.offsetWidth * a.offsetHeight + (a.paused ? 0 : 1e9)));
    const v = vids[0];
    if (!v) return 'none';
    if (v.disablePictureInPicture) { v.disablePictureInPicture = false; v.removeAttribute('disablepictureinpicture'); }
    await v.requestPictureInPicture();
    return 'entered';
  } catch (e) { return 'error:' + (e && e.message || e); }
})()`;

const HAS_VIDEO = `[...document.querySelectorAll('video')].some(v => v.readyState > 0)`;

/** Toggle PiP in the page, trying the main frame first, then its frames (embedded players). */
async function toggle(wc) {
  if (!wc || wc.isDestroyed()) return 'none';
  const frames = [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter(f => f !== wc.mainFrame)];
  // If any frame already has a PiP window, close that one.
  for (const f of frames) {
    try { if (await f.executeJavaScript('!!document.pictureInPictureElement')) return await f.executeJavaScript(TOGGLE, true); } catch { /* frame gone */ }
  }
  let last = 'none';
  for (const f of frames) {
    try {
      const r = await f.executeJavaScript(TOGGLE, true);
      if (r === 'entered' || r === 'exited') return r;
      if (r !== 'none') last = r;
    } catch { /* cross-process frame gone or not ready */ }
  }
  return last;
}

module.exports = { TOGGLE, HAS_VIDEO, toggle };
