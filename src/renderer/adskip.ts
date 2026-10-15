/**
 * In-page YouTube ad skipper, injected into youtube webviews via
 * webview.executeJavaScript (see WebTab). Serialized with .toString(),
 * so the body must stay plain dependency-free JavaScript — no imports,
 * no TypeScript syntax, no closures over module scope.
 *
 * Strategy (same idea uBlock uses for YT, minus the extension host):
 * network blocking can't see video ads (same pipes as content), so let
 * the ad "play" and instantly seek past it + click every skip/close
 * control + hide the ad chrome with CSS. Ads resolve in well under a
 * second and nothing is network-blocked, so the anti-adblock wall stays
 * quiet.
 */
export function youtubeSkipper(): void {
  const w = window as unknown as Record<string, unknown>
  if (w.__ubSkipper) {
    return
  }
  w.__ubSkipper = true

  const AD_CSS = [
    '#player-ads',
    '#masthead-ad',
    'ytd-ad-slot-renderer',
    '.ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    '.ytp-ad-player-overlay',
    '.ytp-ad-text-overlay',
    '.ytp-ad-message-container',
    '.ytp-ad-skip-button-slot',
    '.ytp-ad-preview-container'
  ].join(', ')

  const el = document.createElement('style')
  el.setAttribute('data-ub', 'adskip')
  el.textContent = AD_CSS + '{display:none !important;}'
  const root = document.head || document.documentElement
  if (root) {
    root.appendChild(el)
  }

  const SKIP_BUTTONS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container button'
  ]

  function skipOnce(): void {
    let player: Element | null = null
    let video: HTMLVideoElement | null = null
    try {
      player = document.querySelector('#movie_player')
      video = document.querySelector('video.html5-main-video')
    } catch (e) {
      return
    }
    if (!player || !video) {
      return
    }
    for (const sel of SKIP_BUTTONS) {
      let btn: Element | null = null
      try {
        btn = player.querySelector(sel) || document.querySelector(sel)
      } catch (e) {
        btn = null
      }
      if (btn && btn instanceof HTMLElement) {
        try {
          btn.click()
        } catch (e) {
          /* keep trying the rest */
        }
      }
    }
    let adShowing = false
    try {
      adShowing = player.classList.contains('ad-showing')
    } catch (e) {
      adShowing = false
    }
    if (adShowing) {
      try {
        video.muted = true
      } catch (e) {
        /* ignore */
      }
      try {
        video.playbackRate = 16
      } catch (e) {
        /* ignore */
      }
      try {
        const dur = video.duration
        if (isFinite(dur) && dur > 0 && isFinite(video.currentTime)) {
          if (dur - video.currentTime > 0.3) {
            video.currentTime = dur - 0.05
          }
        }
      } catch (e) {
        /* ignore */
      }
    }
  }

  try {
    new MutationObserver(skipOnce).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    })
  } catch (e) {
    /* observer unsupported — interval below still covers it */
  }
  setInterval(skipOnce, 500)
  skipOnce()
}
