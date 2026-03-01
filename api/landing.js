/**
 * Vercel serverless: CRO / landing page audit.
 * GET or POST ?url=... or { url: "..." }
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; ClaudeAds-CRO/1.0; +https://github.com/Frederikhs11061/claudeadtool)';

function parseHtml(html) {
  const strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const getMeta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = html.match(re);
    return m ? m[1] : null;
  };
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const viewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
  const desc = getMeta('description') || getMeta('og:description');
  const ogImage = getMeta('og:image');
  const ogTitle = getMeta('og:title');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  const wordCount = strip(body).split(/\s+/).filter(Boolean).length;
  const formCount = (body.match(/<form[^>]*>/gi) || []).length;
  const buttons = (body.match(/<button[^>]*>|type=["'](?:submit|button)["']/gi) || []).length;
  const links = (body.match(/<a[^>]+href\s*=/gi) || []).length;
  const hasCta = /(buy|order|sign up|subscribe|start|get started|book|kontakt|tilmeld|køb|bestil)/i.test(body);
  const hasPhone = /[\d\s\-+]{8,}/.test(body) || /tel:/i.test(html);
  const hasSchema = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);

  return {
    title: title ? strip(title[1]) : null,
    h1: h1 ? strip(h1[1]) : null,
    metaDescription: desc,
    viewport,
    ogImage,
    ogTitle,
    wordCount,
    formCount,
    buttons,
    links,
    hasCta,
    hasPhone,
    hasSchema,
  };
}

function runChecks(data) {
  const checks = [];
  const ok = (name, status, message, value) => checks.push({ name, status, message, value });

  const t = (data.title || '').length;
  if (t === 0) ok('title', 'fail', 'Mangler titel', null);
  else if (t < 30) ok('title', 'warn', 'Titel under 30 tegn', data.title);
  else if (t > 60) ok('title', 'warn', 'Titel over 60 tegn', data.title);
  else ok('title', 'pass', 'Titel OK', data.title);

  const d = (data.metaDescription || '').length;
  if (d === 0) ok('meta_description', 'fail', 'Mangler meta beskrivelse', null);
  else if (d < 120) ok('meta_description', 'warn', 'Beskrivelse under 120 tegn', data.metaDescription?.slice(0, 80) + '…');
  else if (d > 160) ok('meta_description', 'warn', 'Beskrivelse over 160 tegn', data.metaDescription?.slice(0, 80) + '…');
  else ok('meta_description', 'pass', 'Meta beskrivelse OK', data.metaDescription?.slice(0, 80) + '…');

  if (!data.h1) ok('h1', 'fail', 'Mangler H1', null);
  else ok('h1', 'pass', 'H1 fundet', data.h1);

  if (!data.viewport) ok('viewport', 'fail', 'Mangler viewport (mobile)', null);
  else ok('viewport', 'pass', 'Viewport OK (mobil-venlig)', null);

  if (data.wordCount < 100) ok('word_count', 'warn', 'Få ord på siden', data.wordCount);
  else ok('word_count', 'pass', 'Indhold tilstrækkeligt', data.wordCount);

  if (!data.hasCta && data.formCount === 0 && data.buttons < 2)
    ok('cta', 'warn', 'Svag eller manglende call-to-action', null);
  else ok('cta', 'pass', 'CTA eller formular fundet', null);

  if (data.formCount > 0) ok('form', 'pass', `${data.formCount} formular(er)`, data.formCount);
  else ok('form', 'info', 'Ingen formularer', 0);

  if (data.ogImage || data.ogTitle) ok('opengraph', 'pass', 'Open Graph til deling', data.ogImage || data.ogTitle);
  else ok('opengraph', 'warn', 'Manglende Open Graph (fb/linkedin)', null);

  if (data.hasSchema) ok('schema', 'pass', 'Struktureret data (schema)', null);
  else ok('schema', 'info', 'Ingen schema markup', null);

  if (data.hasPhone) ok('phone', 'pass', 'Telefon/kontakt fundet', null);
  else ok('phone', 'info', 'Ingen telefonnummer', null);

  return checks;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = req.method === 'POST' && req.body?.url
    ? req.body.url
    : req.query?.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Angiv url (query ?url=... eller body { "url": "..." })' });
  }

  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;

  try {
    const resp = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      return res.status(200).json({
        url: target,
        error: `HTTP ${resp.status}`,
        checks: [],
      });
    }
    const html = await resp.text();
    const data = parseHtml(html);
    const checks = runChecks(data);
    return res.status(200).json({
      url: target,
      error: null,
      data: { ...data },
      checks,
    });
  } catch (e) {
    return res.status(200).json({
      url: target,
      error: e.message || 'Kunne ikke hente URL',
      checks: [],
    });
  }
}
