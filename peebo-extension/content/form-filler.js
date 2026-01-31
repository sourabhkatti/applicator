/**
 * Peebo Form Filler Content Script
 * Handles DOM extraction and form filling for job applications
 * Compatible with React/Vue controlled inputs
 */
(function() {
  'use strict';

  // Guard against double-injection
  if (window.__peeboFormFillerLoaded) {
    console.log('[Peebo] Form filler already loaded');
    return;
  }
  window.__peeboFormFillerLoaded = true;

  console.log('[Peebo] Form filler loaded on:', window.location.href);

  // Track document readiness
  let documentReady = document.readyState === 'complete' || document.readyState === 'interactive';

  if (!documentReady) {
    document.addEventListener('DOMContentLoaded', () => {
      documentReady = true;
    });
  }

  // Interactive element selectors
  const INTERACTIVE_SELECTORS = [
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'button',
    'a[href]',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
    'input[type="submit"]',
    'input[type="button"]',
    'label[for]'
  ];

  // Element index map for click/focus operations
  let elementIndexMap = new Map();

  // Message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Peebo] Received message:', message.type);

    switch (message.type) {
      case 'extract_dom_content':
        extractDOMContent(message.params || {})
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'click_element':
        sendResponse(clickElement(message.params));
        return false;

      case 'focus_element':
        sendResponse(focusElement(message.params));
        return false;

      case 'type_text_js':
        sendResponse(typeTextJS(message.params));
        return false;

      case 'scroll':
        sendResponse(performScroll(message.params));
        return false;

      case 'hover_element':
        sendResponse(hoverElement(message.params));
        return false;

      case 'ping':
        sendResponse({ success: true, pong: true, ready: documentReady });
        return false;

      default:
        sendResponse({ received: true });
        return false;
    }
  });

  // ============================================
  // Visibility Helpers
  // ============================================

  function isVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }

    return true;
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  // ============================================
  // DOM Extraction
  // ============================================

  async function extractDOMContent(params) {
    const includeInteractiveOnly = params.includeInteractiveOnly ?? true;

    // Rebuild element index map
    buildElementIndexMap();

    const elements = [];
    let index = 1;

    for (const [idx, element] of elementIndexMap) {
      const rect = element.getBoundingClientRect();
      const tagName = element.tagName.toLowerCase();

      // Get accessible name
      const name = getAccessibleName(element);

      // Get element type/role
      const role = element.getAttribute('role') || getImplicitRole(element);

      // Get value for inputs
      let value = '';
      if (tagName === 'input' || tagName === 'textarea') {
        value = element.value || '';
      } else if (tagName === 'select') {
        value = element.options[element.selectedIndex]?.text || '';
      }

      // Get placeholder
      const placeholder = element.placeholder || '';

      // Check states
      const isRequired = element.required || element.getAttribute('aria-required') === 'true';
      const isDisabled = element.disabled || element.getAttribute('aria-disabled') === 'true';
      const isChecked = element.checked || element.getAttribute('aria-checked') === 'true';

      elements.push({
        index: idx,
        tag: tagName,
        type: element.type || null,
        role: role,
        name: name,
        value: value,
        placeholder: placeholder,
        required: isRequired,
        disabled: isDisabled,
        checked: isChecked,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          centerX: Math.round(rect.x + rect.width / 2),
          centerY: Math.round(rect.y + rect.height / 2)
        },
        inViewport: isInViewport(element)
      });
    }

    // Get page info
    const pageInfo = {
      url: window.location.href,
      title: document.title,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight
    };

    return {
      elements,
      pageInfo,
      elementCount: elements.length
    };
  }

  function buildElementIndexMap() {
    elementIndexMap.clear();

    const allInteractive = document.querySelectorAll(INTERACTIVE_SELECTORS.join(', '));
    let index = 1;

    for (const el of allInteractive) {
      if (!isVisible(el) || el.disabled) continue;
      elementIndexMap.set(index, el);
      index++;
    }

    return index - 1;
  }

  function getAccessibleName(element) {
    // aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const names = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      if (names.length) return names.join(' ');
    }

    // Associated label
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) return label.textContent.trim();
    }

    // Parent label
    const parentLabel = element.closest('label');
    if (parentLabel) {
      let text = parentLabel.textContent.trim();
      // Remove element's own text
      const ownText = (element.textContent || element.value || '').trim();
      if (ownText) text = text.replace(ownText, '').trim();
      if (text) return text;
    }

    // alt, title, placeholder
    const alt = element.getAttribute('alt');
    if (alt) return alt.trim();

    const title = element.getAttribute('title');
    if (title) return title.trim();

    const placeholder = element.placeholder;
    if (placeholder) return placeholder.trim();

    // Inner text (for buttons, links)
    const innerText = element.textContent || element.innerText;
    if (innerText && innerText.length < 100) {
      return innerText.trim();
    }

    return '';
  }

  function getImplicitRole(element) {
    const tag = element.tagName.toLowerCase();
    const type = (element.type || '').toLowerCase();

    const roles = {
      'a': element.hasAttribute('href') ? 'link' : null,
      'button': 'button',
      'input': {
        'checkbox': 'checkbox',
        'radio': 'radio',
        'submit': 'button',
        'button': 'button',
        'text': 'textbox',
        'password': 'textbox',
        'email': 'textbox',
        'tel': 'textbox',
        'url': 'textbox',
        'search': 'searchbox',
        'number': 'spinbutton'
      }[type] || 'textbox',
      'select': 'combobox',
      'textarea': 'textbox',
      'img': 'img'
    };

    return roles[tag] || null;
  }

  // ============================================
  // Click Element
  // ============================================

  function clickElement(params) {
    const { index, selector } = params || {};

    let element = null;

    if (index !== undefined) {
      buildElementIndexMap();
      element = elementIndexMap.get(index);
    } else if (selector) {
      element = document.querySelector(selector);
    }

    if (!element) {
      return { success: false, error: `Element not found: index=${index}, selector=${selector}` };
    }

    try {
      // Scroll into view if needed
      if (!isInViewport(element)) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Focus first
      element.focus();

      // Dispatch mouse events for full compatibility
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;

      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // Focus Element
  // ============================================

  function focusElement(params) {
    const { index, selector } = params || {};

    let element = null;

    if (index !== undefined) {
      buildElementIndexMap();
      element = elementIndexMap.get(index);
    } else if (selector) {
      element = document.querySelector(selector);
    }

    if (!element) {
      return { success: false, error: 'Element not found' };
    }

    try {
      if (!isInViewport(element)) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      element.focus();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // Type Text (React/Vue Compatible)
  // ============================================

  function typeTextJS(params) {
    const { index, selector, text } = params || {};

    if (!text) {
      return { success: false, error: 'No text provided' };
    }

    let element = null;

    if (index !== undefined) {
      buildElementIndexMap();
      element = elementIndexMap.get(index);
    } else if (selector) {
      element = document.querySelector(selector);
    }

    if (!element) {
      return { success: false, error: 'Element not found' };
    }

    try {
      // Scroll into view
      if (!isInViewport(element)) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Focus the element
      element.focus();

      // Clear existing content
      // Use native value setter to bypass React controlled inputs
      const descriptor = Object.getOwnPropertyDescriptor(
        element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      );

      if (descriptor && descriptor.set) {
        // Clear first
        descriptor.set.call(element, '');
        element.dispatchEvent(new Event('input', { bubbles: true }));

        // Then set new value
        descriptor.set.call(element, text);
      } else {
        // Fallback
        element.value = text;
      }

      // Dispatch events for framework reactivity
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      // Also dispatch keyboard events for good measure
      for (const char of text) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      }

      // Blur to trigger validation
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // Scroll
  // ============================================

  function performScroll(params) {
    const { direction, amount, pages } = params || {};
    const scrollAmount = amount || 500;
    const pageCount = pages || 1;

    try {
      let deltaY = 0;

      if (direction === 'up') {
        deltaY = -scrollAmount * pageCount;
      } else if (direction === 'down') {
        deltaY = scrollAmount * pageCount;
      }

      window.scrollBy({
        top: deltaY,
        behavior: 'smooth'
      });

      return { success: true, scrollY: window.scrollY + deltaY };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // Hover Element
  // ============================================

  function hoverElement(params) {
    const { index, selector } = params || {};

    let element = null;

    if (index !== undefined) {
      buildElementIndexMap();
      element = elementIndexMap.get(index);
    } else if (selector) {
      element = document.querySelector(selector);
    }

    if (!element) {
      return { success: false, error: 'Element not found' };
    }

    try {
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;

      element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }));
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
      element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

})();
