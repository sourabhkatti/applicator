/**
 * Key Mapper for CDP Input.dispatchKeyEvent
 *
 * Maps characters to the correct WindowsVirtualKeyCode and modifiers
 * for use with Chrome DevTools Protocol.
 */

const KeyMapper = {
  // Map characters to [virtualKeyCode, modifiers]
  // modifiers: 1=Alt, 2=Ctrl, 4=Meta/Command, 8=Shift

  getCharMap: function() {
    if (this._charMap) return this._charMap;

    const map = new Map();
    const SHIFT = 8;

    // Numbers 0-9
    for (let i = 0; i <= 9; i++) {
      map.set(String(i), { code: 48 + i, modifiers: 0 });
    }

    // Letters a-z and A-Z
    for (let i = 65; i <= 90; i++) {
      const char = String.fromCharCode(i);
      const lower = char.toLowerCase();
      map.set(lower, { code: i, modifiers: 0 });      // a-z
      map.set(char, { code: i, modifiers: SHIFT });   // A-Z
    }

    // Common special chars
    const special = {
      ' ': { code: 32, modifiers: 0 },
      '\n': { code: 13, modifiers: 0 },
      '\r': { code: 13, modifiers: 0 },
      '\t': { code: 9, modifiers: 0 },
      '!': { code: 49, modifiers: SHIFT },  // Shift + 1
      '@': { code: 50, modifiers: SHIFT },  // Shift + 2
      '#': { code: 51, modifiers: SHIFT },  // Shift + 3
      '$': { code: 52, modifiers: SHIFT },  // Shift + 4
      '%': { code: 53, modifiers: SHIFT },  // Shift + 5
      '^': { code: 54, modifiers: SHIFT },  // Shift + 6
      '&': { code: 55, modifiers: SHIFT },  // Shift + 7
      '*': { code: 56, modifiers: SHIFT },  // Shift + 8
      '(': { code: 57, modifiers: SHIFT },  // Shift + 9
      ')': { code: 48, modifiers: SHIFT },  // Shift + 0
      '-': { code: 189, modifiers: 0 },
      '_': { code: 189, modifiers: SHIFT },
      '=': { code: 187, modifiers: 0 },
      '+': { code: 187, modifiers: SHIFT },
      '[': { code: 219, modifiers: 0 },
      '{': { code: 219, modifiers: SHIFT },
      ']': { code: 221, modifiers: 0 },
      '}': { code: 221, modifiers: SHIFT },
      '\\': { code: 220, modifiers: 0 },
      '|': { code: 220, modifiers: SHIFT },
      ';': { code: 186, modifiers: 0 },
      ':': { code: 186, modifiers: SHIFT },
      "'": { code: 222, modifiers: 0 },
      '"': { code: 222, modifiers: SHIFT },
      ',': { code: 188, modifiers: 0 },
      '<': { code: 188, modifiers: SHIFT },
      '.': { code: 190, modifiers: 0 },
      '>': { code: 190, modifiers: SHIFT },
      '/': { code: 191, modifiers: 0 },
      '?': { code: 191, modifiers: SHIFT },
      '`': { code: 192, modifiers: 0 },
      '~': { code: 192, modifiers: SHIFT },
    };

    for (const [char, def] of Object.entries(special)) {
      map.set(char, def);
    }

    this._charMap = map;
    return map;
  },

  getParamsForChar: function(char) {
    const map = this.getCharMap();
    const def = map.get(char);

    if (!def) {
      // Fallback for unknown chars
      console.warn(`[KeyMapper] Unknown char: ${char}, using fallback`);
      const upper = char.toUpperCase();
      if (map.has(upper)) {
        return map.get(upper);
      }
      return { code: 0, modifiers: 0, text: char };
    }

    return {
      windowsVirtualKeyCode: def.code,
      modifiers: def.modifiers,
      text: char,
      unmodifiedText: char.toLowerCase(),
      key: char,
      nativeVirtualKeyCode: def.code,
      autoRepeat: false,
      isKeypad: false,
      isSystemKey: false
    };
  }
};

// Export for global usage (importScripts in service worker)
self.KeyMapper = KeyMapper;
