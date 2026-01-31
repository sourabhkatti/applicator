/**
 * Cookie Consent Auto-Dismisser
 * Automatically detects and dismisses cookie consent popups
 */
(function() {
  'use strict';

  // Guard against double injection
  if (window.__peeboCookieDismisser) {
    return;
  }
  window.__peeboCookieDismisser = true;

  // Common cookie popup patterns
  const COOKIE_PATTERNS = {
    // Button text patterns to ACCEPT (case-insensitive)
    acceptTexts: [
      'accept all', 'accept cookies', 'allow all', 'allow cookies',
      'i accept', 'i agree', 'agree', 'agree all', 'got it', 'ok',
      'consent', 'continue', 'dismiss', 'close', 'accept & close',
      'yes, i agree', 'accept and continue', 'allow all cookies'
    ],

    // Button text patterns to AVOID clicking
    rejectTexts: [
      'reject', 'decline', 'deny', 'opt out', 'refuse',
      'manage', 'settings', 'preferences', 'customize'
    ],

    // Container selectors for cookie popups
    containerSelectors: [
      // Generic patterns
      '[class*="cookie"][class*="consent"]',
      '[class*="cookie"][class*="banner"]',
      '[class*="cookie"][class*="notice"]',
      '[class*="cookie"][class*="popup"]',
      '[class*="cookie"][class*="modal"]',
      '[id*="cookie"][id*="consent"]',
      '[id*="cookie"][id*="banner"]',
      '[id*="cookie"][id*="notice"]',
      '[class*="gdpr"]',
      '[id*="gdpr"]',
      '[class*="consent"][class*="banner"]',
      '[class*="privacy"][class*="banner"]',

      // Specific frameworks
      '#onetrust-consent-sdk',
      '#onetrust-banner-sdk',
      '.onetrust-pc-dark-filter',
      '#truste-consent-track',
      '.trustarc-banner',
      '#CybotCookiebotDialog',
      '.cky-consent-container',
      '#cookie-law-info-bar',
      '.cc-window',

      // SourcePoint consent manager
      '[id*="sp_message"]',
      '[class*="sp_message"]',
      '.message-container',
      '[title*="SP Consent"]',
      '[aria-label*="SP Consent"]',
      '[class*="sp-cc"]',
      '#sp-cc',
      '.cookie-consent',
      '#cookie-notice',
      '#cookie-banner',
      '.js-cookie-consent',
      '[data-testid="cookie-policy-banner"]',
      '[data-cookieconsent]',

      // Role-based
      '[role="dialog"][aria-label*="cookie" i]',
      '[role="dialog"][aria-label*="consent" i]',
      '[role="alertdialog"][aria-label*="cookie" i]',

      // More generic patterns for bottom banners
      '[class*="notice-bar"]',
      '[class*="notification-bar"]',
      '[class*="bottom-banner"]',
      '[class*="footer-banner"]',
      '[class*="consent-bar"]',
      '[class*="privacy-notice"]',
      '[class*="legal-notice"]',
      '[id*="consent"]',
      '[id*="privacy-notice"]',
      '[id*="legal-banner"]'
    ],

    // Button selectors within containers
    buttonSelectors: [
      'button',
      '[role="button"]',
      'a[class*="button"]',
      'a[class*="btn"]',
      'div[class*="button"]',
      'span[class*="button"]',
      'input[type="submit"]',
      'input[type="button"]'
    ]
  };

  /**
   * Check if element is visible
   */
  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           parseFloat(style.opacity) > 0 &&
           rect.width > 0 &&
           rect.height > 0;
  }

  /**
   * Check if text matches accept patterns
   */
  function isAcceptButton(text) {
    const lowerText = text.toLowerCase().trim();
    return COOKIE_PATTERNS.acceptTexts.some(pattern => lowerText.includes(pattern));
  }

  /**
   * Check if text matches reject patterns (to avoid)
   */
  function isRejectButton(text) {
    const lowerText = text.toLowerCase().trim();
    return COOKIE_PATTERNS.rejectTexts.some(pattern => lowerText.includes(pattern));
  }

  /**
   * Try to find and click the accept button
   */
  function dismissCookiePopup() {
    // Find potential cookie consent containers
    let cookieContainers = [];
    for (const selector of COOKIE_PATTERNS.containerSelectors) {
      try {
        const containers = document.querySelectorAll(selector);
        containers.forEach(container => {
          if (isVisible(container) && !cookieContainers.includes(container)) {
            cookieContainers.push(container);
          }
        });
      } catch (e) {
        // Invalid selector, skip
      }
    }

    if (cookieContainers.length === 0) {
      return false;
    }

    console.log('[Peebo Cookie] Found', cookieContainers.length, 'potential cookie containers');

    // Look for accept buttons within these containers
    for (const container of cookieContainers) {
      // First try to find buttons with accept text
      for (const btnSelector of COOKIE_PATTERNS.buttonSelectors) {
        try {
          const buttons = container.querySelectorAll(btnSelector);

          for (const button of buttons) {
            if (!isVisible(button)) continue;

            const text = (button.innerText || button.textContent ||
                         button.getAttribute('aria-label') ||
                         button.getAttribute('title') || '').trim();

            // Skip reject/manage buttons
            if (isRejectButton(text)) {
              continue;
            }

            // Check if it's an accept button
            if (isAcceptButton(text)) {
              console.log('[Peebo Cookie] Clicking accept button:', text.substring(0, 40));

              try {
                button.click();
                return true;
              } catch (e) {
                console.warn('[Peebo Cookie] Click failed:', e);
              }
            }
          }
        } catch (e) {
          // Selector error, skip
        }
      }

      // If no accept button found by text, try common ID/class patterns
      const acceptSelectors = [
        '#onetrust-accept-btn-handler',
        '.onetrust-close-btn-handler',
        '#accept-all-cookies',
        '.accept-cookies',
        '#CybotCookiebotDialogBodyButtonAccept',
        'button[data-cookiefirst-action="accept"]',
        '.cc-accept',
        '.cc-dismiss',
        '.cookie-consent-accept',
        '#cookie-accept',
        '.js-accept-cookies',
        '[data-action="accept"]',
        // SourcePoint consent manager buttons
        '.sp_choice_type_11',
        '.sp_choice_type_ACCEPT_ALL',
        'button[title="Accept All"]',
        'button[title="Accept all"]',
        'button[title="Accept"]',
        '.message-component.message-button'
      ];

      for (const sel of acceptSelectors) {
        try {
          const btn = container.querySelector(sel) || document.querySelector(sel);
          if (btn && isVisible(btn)) {
            console.log('[Peebo Cookie] Clicking accept button by selector:', sel);
            btn.click();
            return true;
          }
        } catch (e) {
          // Selector error, skip
        }
      }
    }

    // Aggressive fallback - look for fixed/sticky bottom elements with cookie text
    const potentialBanners = document.querySelectorAll('div, section, aside, footer, [role="banner"], [role="alert"], [role="alertdialog"]');
    for (const el of potentialBanners) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      // Check if element is fixed/sticky at bottom of viewport
      const isBottomFixed = (style.position === 'fixed' || style.position === 'sticky') &&
                            rect.bottom > window.innerHeight - 200 &&
                            rect.height > 50 && rect.height < 400;

      if (!isBottomFixed || !isVisible(el)) continue;

      // Check if it contains cookie-related text
      const text = (el.innerText || '').toLowerCase();
      const hasCookieText = text.includes('cookie') || text.includes('privacy') ||
                            text.includes('consent') || text.includes('gdpr') ||
                            text.includes('personalized') || text.includes('advertising');

      if (!hasCookieText) continue;

      console.log('[Peebo Cookie] Found bottom fixed banner with cookie text');

      // Find and click OK/Accept button
      const buttons = el.querySelectorAll('button, a[class*="btn"], [role="button"]');
      for (const btn of buttons) {
        const btnText = (btn.innerText || btn.textContent || '').toLowerCase().trim();
        if (btnText === 'ok' || btnText === 'accept' || btnText === 'accept all' ||
            btnText === 'i agree' || btnText === 'agree' || btnText === 'got it') {
          console.log('[Peebo Cookie] Clicking fallback button:', btnText);
          btn.click();
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Set up MutationObserver to watch for popups appearing dynamically
   */
  let observerTimeout = null;
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      // Debounce
      if (observerTimeout) clearTimeout(observerTimeout);
      observerTimeout = setTimeout(() => {
        dismissCookiePopup();
      }, 300);
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    return observer;
  }

  /**
   * Initialize the dismisser
   */
  function init() {
    // Initial check
    setTimeout(dismissCookiePopup, 500);

    // Check after DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(dismissCookiePopup, 500);
        setupObserver();
      });
    } else {
      setupObserver();
    }

    // Check after full load
    window.addEventListener('load', () => {
      setTimeout(dismissCookiePopup, 1000);
    });

    // Additional delayed checks for late-loading popups
    setTimeout(dismissCookiePopup, 2000);
    setTimeout(dismissCookiePopup, 4000);
  }

  init();
})();
