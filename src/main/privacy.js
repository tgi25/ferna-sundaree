'use strict';
// Privacy protections applied by the browser process:
//   • tracking parameters removed from page addresses before they load (utm_*, fbclid, gclid …)
//   • Global Privacy Control: "Sec-GPC: 1" on every request (and navigator.globalPrivacyControl
//     in pages, via src/preload/privacy-gpc.js)
//   • WebRTC limited to the public interface, so a page cannot read your local/VPN-hidden IPs
//   • third-party cookies blocked by Chromium itself (startup switch; see main.js)
//   • fingerprinting noise (src/preload/privacy-fp.js)

// Parameters that only identify a click or campaign; removing them never changes the page.
const EXACT = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'igshid', 'igsh',
  'mc_eid', 'mc_cid', '_hsenc', '_hsmi', '__hstc', '__hssc', '__hsfp', 'hsCtaTracking', 'mkt_tok', 'vero_id', 'vero_conv', 'wickedid',
  'oly_anon_id', 'oly_enc_id', 'rb_clickid', 's_cid', 'ml_subscriber', 'ml_subscriber_hash', 'epik', 'ScCid', '_openstat', 'srsltid_tracking',
  'si_click', 'ref_src', 'ref_url', '__s', 'ss_campaign_id', 'trk_contact', 'trk_msg', 'trk_module', 'trk_sid', 'gad_source',
]);
const PREFIXES = ['utm_', 'pk_campaign', 'pk_kwd', 'mtm_', 'hsa_', 'stm_'];
// Sites where some of these names are real parameters (keep them there).
const KEEP_ON = [/(^|\.)google\.[a-z.]+$/i, /(^|\.)twitter\.com$/i, /(^|\.)x\.com$/i];

/** Address without tracking parameters (unchanged if there were none). */
function stripTracking(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (!/^https?:$/.test(u.protocol) || !u.search) return url;
  if (KEEP_ON.some(re => re.test(u.hostname))) return url;
  let changed = false;
  for (const k of [...u.searchParams.keys()]) {
    const lk = k.toLowerCase();
    if (EXACT.has(k) || EXACT.has(lk) || PREFIXES.some(p => lk.startsWith(p))) { u.searchParams.delete(k); changed = true; }
  }
  if (!changed) return url;
  let out = u.toString();
  if (!u.searchParams.toString()) out = out.replace('?', '').replace(/\?(?=#|$)/, '');
  return out;
}

/** Apply per-page protections to a web page's contents. */
function protectContents(wc, settings) {
  try {
    wc.setWebRTCIPHandlingPolicy(settings.webrtcProtection === false ? 'default' : 'default_public_interface_only');
  } catch { /* not supported */ }
}

module.exports = { stripTracking, protectContents, EXACT, PREFIXES };
