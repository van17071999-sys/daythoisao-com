/**
 * In-House Lightweight Analytics Tracker for daythoisao.com
 * Zero external dependencies (~3KB), non-blocking, Core Web Vitals friendly.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  var API_ENDPOINT = '/api/analytics/track';

  // Generate random UUIDv4 or random string
  function generateId(prefix) {
    var d = Date.now().toString(36);
    var r = Math.random().toString(36).substring(2, 9);
    return (prefix ? prefix + '_' : '') + d + '_' + r;
  }

  // 1. Anonymous Visitor ID (localStorage)
  function getVisitorId() {
    try {
      var vid = localStorage.getItem('_dts_vid');
      if (!vid) {
        vid = generateId('v');
        localStorage.setItem('_dts_vid', vid);
      }
      return vid;
    } catch (e) {
      return generateId('v_tmp');
    }
  }

  // 2. Session ID (sessionStorage with 30m timeout check)
  function getSessionId() {
    try {
      var now = Date.now();
      var sid = sessionStorage.getItem('_dts_sid');
      var lastActive = parseInt(sessionStorage.getItem('_dts_s_time') || '0', 10);
      var THIRTY_MINUTES = 30 * 60 * 1000;

      if (!sid || (now - lastActive > THIRTY_MINUTES)) {
        sid = generateId('s');
        sessionStorage.setItem('_dts_sid', sid);
      }
      sessionStorage.setItem('_dts_s_time', now.toString());
      return sid;
    } catch (e) {
      return generateId('s_tmp');
    }
  }

  // 3. Device Detection
  function detectDevice() {
    var ua = navigator.userAgent || '';
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
      return 'Tablet';
    }
    if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
      return 'Mobile';
    }
    return 'Desktop';
  }

  // 4. Browser Detection
  function detectBrowser() {
    var ua = navigator.userAgent || '';
    if (/Zalo/i.test(ua)) return 'Zalo';
    if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
    if (/Edg/i.test(ua)) return 'Edge';
    if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) return 'Chrome';
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
    if (/Firefox/i.test(ua)) return 'Firefox';
    if (/Opera|OPR/i.test(ua)) return 'Opera';
    return 'Other';
  }

  // 5. UTM & Referrer extraction
  function getTrafficSource() {
    var urlParams = new URLSearchParams(window.location.search);
    var utmSource = urlParams.get('utm_source');
    var utmMedium = urlParams.get('utm_medium');
    var utmCampaign = urlParams.get('utm_campaign');
    var ref = document.referrer || '';

    var source = utmSource;
    if (!source && ref) {
      try {
        var refHost = new URL(ref).hostname.toLowerCase();
        if (refHost.indexOf('google.') !== -1) source = 'Google';
        else if (refHost.indexOf('facebook.') !== -1 || refHost.indexOf('fb.me') !== -1) source = 'Facebook';
        else if (refHost.indexOf('youtube.') !== -1) source = 'YouTube';
        else if (refHost.indexOf('zalo.') !== -1 || refHost.indexOf('zalo.me') !== -1) source = 'Zalo';
        else if (refHost.indexOf('tiktok.') !== -1) source = 'TikTok';
        else if (refHost.indexOf('saotrucauco.com') !== -1) source = 'saotrucauco.com';
        else source = refHost;
      } catch (e) {
        source = 'Referral';
      }
    }
    if (!source) source = 'Direct';

    return {
      source: source,
      medium: utmMedium || (source === 'Direct' ? '(none)' : 'referral'),
      campaign: utmCampaign || ''
    };
  }

  // 6. Send Beacon or Keepalive Fetch
  function sendEvent(eventName, customData) {
    try {
      var traffic = getTrafficSource();
      var payload = {
        visitor_id: getVisitorId(),
        session_id: getSessionId(),
        event_name: eventName,
        path: window.location.pathname + window.location.search,
        referrer: document.referrer || '',
        source: traffic.source,
        medium: traffic.medium,
        campaign: traffic.campaign,
        device: detectDevice(),
        browser: detectBrowser(),
        timestamp: new Date().toISOString()
      };

      if (customData && typeof customData === 'object') {
        for (var k in customData) {
          if (Object.prototype.hasOwnProperty.call(customData, k)) {
            payload[k] = customData[k];
          }
        }
      }

      var body = JSON.stringify(payload);

      // Ưu tiên navigator.sendBeacon
      if (typeof navigator.sendBeacon === 'function') {
        var blob = new Blob([body], { type: 'application/json' });
        var sent = navigator.sendBeacon(API_ENDPOINT, blob);
        if (sent) return;
      }

      // Fallback sang fetch keepalive
      if (typeof fetch === 'function') {
        fetch(API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true
        }).catch(function () {});
      }
    } catch (err) {
      // Yên lặng bỏ qua lỗi, không làm gián đoạn trải nghiệm người dùng
    }
  }

  // Expose global track function if needed
  window.dtsTrack = sendEvent;

  // Initial tracking setup
  function initTracking() {
    // A. Pageview
    sendEvent('page_view');

    // B. Scroll Depth tracking (25%, 50%, 75%, 100%)
    var scrollMarks = { 25: false, 50: false, 75: false, 100: false };
    var scrollThrottle = false;

    function checkScroll() {
      if (scrollThrottle) return;
      scrollThrottle = true;
      setTimeout(function () {
        scrollThrottle = false;
        var h = document.documentElement;
        var b = document.body;
        var st = h.scrollTop || b.scrollTop;
        var sh = h.scrollHeight || b.scrollHeight;
        var ch = h.clientHeight;
        var scrollPercent = Math.round((st / (sh - ch)) * 100);

        [25, 50, 75, 100].forEach(function (mark) {
          if (scrollPercent >= mark && !scrollMarks[mark]) {
            scrollMarks[mark] = true;
            sendEvent('scroll_' + mark);
          }
        });
      }, 250);
    }

    window.addEventListener('scroll', checkScroll, { passive: true });

    // C. Click Event Delegations: Zalo, Phone, Signup
    document.addEventListener('click', function (e) {
      var target = e.target.closest('a, button, [data-track]');
      if (!target) return;

      var href = (target.getAttribute('href') || '').toLowerCase();
      var text = (target.textContent || '').toLowerCase();
      var idClass = ((target.id || '') + ' ' + (target.className || '')).toLowerCase();
      var customTrack = target.getAttribute('data-track');

      // Click Zalo
      if (customTrack === 'zalo' || href.indexOf('zalo.me') !== -1 || idClass.indexOf('zalo') !== -1) {
        sendEvent('click_zalo', { target_text: text.slice(0, 50), target_href: href.slice(0, 100) });
        return;
      }

      // Click Phone
      if (customTrack === 'phone' || href.indexOf('tel:') === 0 || idClass.indexOf('phone') !== -1 || text.indexOf('0374') !== -1) {
        sendEvent('click_phone', { target_text: text.slice(0, 50) });
        return;
      }

      // Click Signup / CTA
      if (
        customTrack === 'signup' ||
        href.indexOf('lop-hoc') !== -1 ||
        href.indexOf('dang-ky') !== -1 ||
        text.indexOf('đăng ký') !== -1 ||
        text.indexOf('bắt đầu học') !== -1
      ) {
        sendEvent('click_signup', { target_text: text.slice(0, 50), target_href: href.slice(0, 100) });
      }
    }, { capture: true, passive: true });

    // D. Audio / Video Play Tracking
    document.addEventListener('play', function (e) {
      if (!e.target) return;
      var tagName = (e.target.tagName || '').toLowerCase();
      if (tagName === 'audio') {
        sendEvent('play_audio', { src: (e.target.currentSrc || '').slice(-60) });
      } else if (tagName === 'video') {
        sendEvent('play_video', { src: (e.target.currentSrc || '').slice(-60) });
      }
    }, true);
  }

  // Khởi tạo sau khi trang đã tải (không block render)
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initTracking, 50);
  } else {
    window.addEventListener('DOMContentLoaded', initTracking);
  }
})();
