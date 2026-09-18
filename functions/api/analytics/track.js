/**
 * Endpoint: POST /api/analytics/track
 * Receives analytics events, validates, filters bots, anonymizes IP, and stores into Cloudflare D1.
 */

// Bot detection patterns
const BOT_REGEX = /(googlebot|bingbot|yandex|baiduspider|ahrefsbot|semrushbot|dotbot|mj12bot|facebookexternalhit|twitterbot|slackbot|discordbot|bytespider|gptbot|claudebot|curl|wget|python-requests|headlesschrome|slurp)/i;

// Whitelisted event names
const ALLOWED_EVENTS = new Set([
  'page_view',
  'scroll_25',
  'scroll_50',
  'scroll_75',
  'scroll_100',
  'click_zalo',
  'click_phone',
  'click_signup',
  'play_audio',
  'play_video',
  'custom'
]);

// Memory rate limit cache (per isolate)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_EVENTS_PER_WINDOW = 80;

// Simple SHA-256 hash helper for anonymizing IP
async function hashString(str) {
  if (!str) return 'anonymous';
  const encoder = new TextEncoder();
  const data = encoder.encode(str + '_dts_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

// Helper to sanitize and trim text
function sanitize(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.trim().substring(0, maxLen);
}

// Fallback D1 REST execution if env.DB is not directly bound
async function executeD1Query(context, sql, params = []) {
  if (context.env && context.env.DB) {
    return await context.env.DB.prepare(sql).bind(...params).run();
  }

  // Fallback if environment variables are provided
  if (context.env && context.env.CF_ACCOUNT_ID && context.env.CF_AUTH_KEY) {
    const accountId = context.env.CF_ACCOUNT_ID;
    const authEmail = context.env.CF_AUTH_EMAIL || 'van17071999@gmail.com';
    const authKey = context.env.CF_AUTH_KEY;
    const dbId = context.env.CF_D1_ID || 'f6a8a2d5-0ea6-45d5-b938-c3659701c135';

    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: {
        'X-Auth-Email': authEmail,
        'X-Auth-Key': authKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql, params })
    });
    return await res.json();
  }

  throw new Error('Cloudflare D1 Database binding is not configured.');
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

export async function onRequestPost(context) {
  const request = context.request;

  try {
    const ua = request.headers.get('user-agent') || '';

    // 1. Tự động loại bot
    if (BOT_REGEX.test(ua)) {
      return new Response(JSON.stringify({ success: true, filtered: 'bot' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Anonymize IP & Rate Limit
    const rawIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '127.0.0.1';
    const ipHash = await hashString(rawIp);

    const now = Date.now();
    const clientRecord = rateLimitMap.get(ipHash) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

    if (now > clientRecord.resetTime) {
      clientRecord.count = 1;
      clientRecord.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
      clientRecord.count++;
      if (clientRecord.count > MAX_EVENTS_PER_WINDOW) {
        return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    rateLimitMap.set(ipHash, clientRecord);

    // 3. Parse JSON Body
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. Validate Event Name
    const eventName = sanitize(payload.event_name, 50);
    if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
      return new Response(JSON.stringify({ success: false, error: 'Unsupported event' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Sanitize Fields
    const visitorId = sanitize(payload.visitor_id, 64) || 'v_unknown';
    const sessionId = sanitize(payload.session_id, 64) || 's_unknown';
    const path = sanitize(payload.path, 255) || '/';
    const referrer = sanitize(payload.referrer, 500);
    const source = sanitize(payload.source, 100) || 'Direct';
    const medium = sanitize(payload.medium, 50) || '(none)';
    const campaign = sanitize(payload.campaign, 100);
    const device = sanitize(payload.device, 20) || 'Desktop';
    const browser = sanitize(payload.browser, 30) || 'Other';

    // 6. Insert into D1 Database
    const sql = `
      INSERT INTO analytics_events 
      (visitor_id, session_id, event_name, path, referrer, source, medium, campaign, device, browser, ip_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);
    `;

    await executeD1Query(context, sql, [
      visitorId,
      sessionId,
      eventName,
      path,
      referrer,
      source,
      medium,
      campaign,
      device,
      browser,
      ipHash
    ]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
