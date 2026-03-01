/**
 * Landing page audit API (Node.js - Vercel default).
 * Same logic as scripts/fetch_page.py + analyze_landing.py grading.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; ClaudeAds/1.1)';

function parseHtml(html) {
  const strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const descM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const wordCount = strip(body).split(/\s+/).filter(Boolean).length;
  const forms = body.match(/<form[^>]*>/gi) || [];
  const inputs = body.match(/<input[^>]+type=["'](?!hidden|submit|button)([^"']*)["']/gi) || [];
  const phone = /href=["']tel:/i.test(html);
  const schemas = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      if (data['@type']) schemas.push(data['@type']);
      for (const item of data['@graph'] || []) if (item['@type']) schemas.push(item['@type']);
    } catch (_) {}
  }
  return {
    content: { title: titleM ? strip(titleM[1]) : null, h1: h1M ? strip(h1M[1]) : null, meta_description: descM ? descM[1].trim() : null, word_count: wordCount },
    conversion: { cta_above_fold: false, form_present: forms.length > 0, form_fields: inputs.length, phone_number: phone },
    mobile: { viewport_meta: viewport, horizontal_scroll: false },
    schema: { types_found: schemas, product_schema: schemas.includes('Product'), faq_schema: schemas.includes('FAQPage'), service_schema: schemas.includes('Service') },
  };
}

function gradeLanding(data) {
  const g = {};
  g.G60_relevance = data.content.h1 ? 'PASS' : 'FAIL';
  const hasSchema = data.schema.product_schema || data.schema.faq_schema || data.schema.service_schema;
  g.G61_schema = hasSchema ? 'PASS' : 'FAIL';
  g.cta_above_fold = data.conversion.cta_above_fold ? 'PASS' : 'FAIL';
  g.mobile_responsive = data.mobile.viewport_meta ? 'PASS' : 'FAIL';
  if (data.conversion.form_present) {
    const f = data.conversion.form_fields;
    g.form_friction = f <= 5 ? 'PASS' : f <= 8 ? 'WARNING' : 'FAIL';
  }
  return g;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let url = req.query?.url || (req.body && req.body.url);
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Angiv url (?url=... eller body { "url": "..." })', checks: [], grades: {}, data: null });
  }
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      return res.status(200).json({ url, error: `HTTP ${resp.status}`, checks: [], grades: {}, data: null });
    }
    const html = await resp.text();
    const data = parseHtml(html);
    data.url = url;
    const grades = gradeLanding(data);
    const checks = Object.entries(grades).map(([name, grade]) => ({
      name,
      status: grade === 'PASS' ? 'pass' : grade === 'FAIL' ? 'fail' : 'warn',
      message: name,
      value: grade,
    }));
    return res.status(200).json({ url, error: null, data, grades, checks });
  } catch (e) {
    return res.status(200).json({ url, error: e.message || 'Kunne ikke hente URL', checks: [], grades: {}, data: null });
  }
}
