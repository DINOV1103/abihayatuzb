/* =====================================
   META CONVERSIONS API — /api/capi

   index.html dagi ABH_TRACK har bir hodisani shu yerga ham yuboradi.
   Biz uni Meta'ga serverdan, brauzerdagi Pixel bilan bir xil event_id
   bilan jo'natamiz — Meta ikkalasini bitta hodisa deb sanaydi.

   Token kodda YO'Q. Vercel → Project → Settings → Environment Variables:
     META_CAPI_TOKEN = Events Manager'dan olingan access token
   (ixtiyoriy) META_PIXEL_ID — standart: 1669087454197560
===================================== */

const PIXEL_ID = process.env.META_PIXEL_ID || '1669087454197560';
const API_VERSION = 'v23.0';

const ALLOWED = new Set([
  'PageView', 'ViewContent', 'Lead', 'Contact',
  'AudioReview', 'PatientPhone', 'WheelPrize'
]);

const HASH = /^[a-f0-9]{64}$/;

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function hashed(v) {
  return typeof v === 'string' && HASH.test(v) ? [v] : undefined;
}

function cleanCustom(c) {
  const out = {};
  if (!c || typeof c !== 'object') return out;
  for (const k of Object.keys(c).slice(0, 10)) {
    const v = c[k];
    if (typeof v === 'string') out[k.slice(0, 40)] = v.slice(0, 200);
    else if (typeof v === 'number' && isFinite(v)) out[k.slice(0, 40)] = v;
  }
  return out;
}

function sameSite(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const from = String(req.headers.origin || req.headers.referer || '');
  if (!from) return true;
  try { return new URL(from).host === host; } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const token = process.env.META_CAPI_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'META_CAPI_TOKEN yo‘q' });
  if (!sameSite(req)) return res.status(403).json({ ok: false });

  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (e) { b = null; }
  }
  if (!b || typeof b !== 'object') return res.status(400).json({ ok: false });

  const name = str(b.event_name, 40);
  const id = str(b.event_id, 100);
  if (!ALLOWED.has(name) || !id) return res.status(400).json({ ok: false });

  const u = b.user || {};
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || '';

  const user_data = {
    client_ip_address: ip || undefined,
    client_user_agent: str(req.headers['user-agent'], 500) || undefined,
    fbp: str(b.fbp, 200) || undefined,
    fbc: str(b.fbc, 600) || undefined,
    ph: hashed(u.ph),
    fn: hashed(u.fn),
    country: hashed(u.country),
    external_id: hashed(u.external_id)
  };

  const payload = {
    data: [{
      event_name: name,
      event_id: id,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: str(b.event_source_url, 1000) || undefined,
      user_data,
      custom_data: cleanCustom(b.custom_data)
    }]
  };

  const test = str(b.test_event_code, 40);
  if (/^[A-Za-z0-9_-]{3,40}$/.test(test)) payload.test_event_code = test;

  try {
    const r = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('CAPI xato:', JSON.stringify(j.error || j));
      return res.status(502).json({ ok: false });
    }
    return res.status(200).json({ ok: true, received: j.events_received || 0 });
  } catch (e) {
    console.error('CAPI tarmoq xatosi:', e && e.message);
    return res.status(502).json({ ok: false });
  }
};
