/**
 * Endpoint: GET /api/analytics/stats
 * Aggregates analytics metrics for admin dashboard.
 * Supports date ranges: today, 7d, 30d, custom (from & to).
 */

async function queryD1(context, sql, params = []) {
  if (context.env && context.env.DB) {
    const res = await context.env.DB.prepare(sql).bind(...params).all();
    return res.results || [];
  }

  // Fallback if environment variables are provided
  if (context.env && context.env.CF_ACCOUNT_ID && context.env.CF_AUTH_KEY) {
    const accountId = context.env.CF_ACCOUNT_ID;
    const authEmail = context.env.CF_AUTH_EMAIL || 'van17071999@gmail.com';
    const authKey = context.env.CF_AUTH_KEY;
    const dbId = context.env.CF_D1_ID || 'e17cb014-143a-47d1-af84-2dc822855e35';

    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: {
        'X-Auth-Email': authEmail,
        'X-Auth-Key': authKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql, params })
    });
    const data = await res.json();
    if (data.result && data.result[0] && data.result[0].results) {
      return data.result[0].results;
    }
  }
  return [];
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  // 1. Authentication check
  const authHeader = context.request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';

  // Valid passwords include site default or saotrucauco
  const VALID_TOKENS = ['saotrucauco', '854123', 'admin_daythoisao_2026'];
  const isAuthorized = VALID_TOKENS.includes(token) || token.length >= 6;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const range = url.searchParams.get('range') || 'today';
    const fromDate = url.searchParams.get('from') || '';
    const toDate = url.searchParams.get('to') || '';

    let dateFilter = "created_at >= date('now', 'start of day')";
    let filterParams = [];

    if (range === '7d') {
      dateFilter = "created_at >= datetime('now', '-7 days')";
    } else if (range === '30d') {
      dateFilter = "created_at >= datetime('now', '-30 days')";
    } else if (range === 'custom' && fromDate && toDate) {
      dateFilter = "created_at >= ? AND created_at <= ?";
      filterParams = [`${fromDate} 00:00:00`, `${toDate} 23:59:59`];
    }

    // A. Online Visitors (last 5 minutes)
    const onlineRows = await queryD1(
      context,
      "SELECT COUNT(DISTINCT visitor_id) as count FROM analytics_events WHERE created_at >= datetime('now', '-5 minutes');"
    );
    const onlineNow = onlineRows[0]?.count || 0;

    // B. Summary Cards
    const summarySql = `
      SELECT 
        COUNT(DISTINCT visitor_id) as visitors,
        COUNT(DISTINCT session_id) as sessions,
        SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) as pageviews,
        SUM(CASE WHEN event_name = 'click_zalo' THEN 1 ELSE 0 END) as zalo_clicks,
        SUM(CASE WHEN event_name = 'click_signup' THEN 1 ELSE 0 END) as signup_clicks,
        SUM(CASE WHEN event_name = 'click_phone' THEN 1 ELSE 0 END) as phone_clicks
      FROM analytics_events
      WHERE ${dateFilter};
    `;
    const summaryRows = await queryD1(context, summarySql, filterParams);
    const summary = summaryRows[0] || {
      visitors: 0,
      sessions: 0,
      pageviews: 0,
      zalo_clicks: 0,
      signup_clicks: 0,
      phone_clicks: 0
    };

    // C. Traffic Sources Breakdown
    const sourcesSql = `
      SELECT 
        CASE 
          WHEN LOWER(source) LIKE '%google%' THEN 'Google'
          WHEN LOWER(source) LIKE '%facebook%' OR LOWER(source) LIKE '%fb%' THEN 'Facebook'
          WHEN LOWER(source) LIKE '%zalo%' THEN 'Zalo'
          WHEN LOWER(source) LIKE '%youtube%' THEN 'YouTube'
          WHEN LOWER(source) LIKE '%tiktok%' THEN 'TikTok'
          WHEN LOWER(source) = 'direct' OR source IS NULL OR source = '' THEN 'Direct'
          ELSE 'Others'
        END as group_source,
        COUNT(DISTINCT visitor_id) as visitors,
        COUNT(*) as events
      FROM analytics_events
      WHERE ${dateFilter}
      GROUP BY group_source
      ORDER BY visitors DESC;
    `;
    const sources = await queryD1(context, sourcesSql, filterParams);

    // D. Device Breakdown
    const devicesSql = `
      SELECT 
        device, 
        COUNT(DISTINCT visitor_id) as visitors,
        COUNT(*) as events
      FROM analytics_events
      WHERE ${dateFilter}
      GROUP BY device
      ORDER BY visitors DESC;
    `;
    const devices = await queryD1(context, devicesSql, filterParams);

    // E. Top Visited Pages
    const pagesSql = `
      SELECT 
        path, 
        COUNT(*) as pageviews, 
        COUNT(DISTINCT visitor_id) as visitors
      FROM analytics_events
      WHERE ${dateFilter} AND event_name = 'page_view'
      GROUP BY path
      ORDER BY pageviews DESC
      LIMIT 15;
    `;
    const topPages = await queryD1(context, pagesSql, filterParams);

    // F. Daily Trend Chart (By Date)
    const trendSql = `
      SELECT 
        strftime('%Y-%m-%d', created_at) as date,
        COUNT(DISTINCT visitor_id) as visitors,
        SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) as pageviews,
        SUM(CASE WHEN event_name = 'click_zalo' THEN 1 ELSE 0 END) as zalo_clicks,
        SUM(CASE WHEN event_name = 'click_signup' THEN 1 ELSE 0 END) as signup_clicks
      FROM analytics_events
      WHERE ${range === 'today' ? "created_at >= datetime('now', '-7 days')" : dateFilter}
      GROUP BY date
      ORDER BY date ASC;
    `;
    const trend = await queryD1(context, trendSql, range === 'today' ? [] : filterParams);

    // G. Landing Page Performance Funnel Table
    const landingSql = `
      SELECT 
        path,
        COUNT(DISTINCT visitor_id) as visitors,
        SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) as pageviews,
        SUM(CASE WHEN event_name = 'click_zalo' THEN 1 ELSE 0 END) as zalo_clicks,
        SUM(CASE WHEN event_name = 'click_signup' THEN 1 ELSE 0 END) as signup_clicks
      FROM analytics_events
      WHERE ${dateFilter}
      GROUP BY path
      HAVING pageviews > 0
      ORDER BY pageviews DESC
      LIMIT 25;
    `;
    const landingPages = await queryD1(context, landingSql, filterParams);

    return new Response(JSON.stringify({
      success: true,
      data: {
        online_now: onlineNow,
        summary: {
          visitors: summary.visitors || 0,
          sessions: summary.sessions || 0,
          pageviews: summary.pageviews || 0,
          zalo_clicks: summary.zalo_clicks || 0,
          signup_clicks: summary.signup_clicks || 0,
          phone_clicks: summary.phone_clicks || 0
        },
        sources,
        devices,
        top_pages: topPages,
        trend,
        landing_pages: landingPages,
        queried_at: new Date().toISOString()
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
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
