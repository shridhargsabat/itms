// ITMS theme pre-paint init (Wave 2-C: external file so the deployed
// Content-Security-Policy `script-src 'self'` holds with zero inline scripts).
// Render-blocking by design: applies the saved theme before first paint.
      // Apply the saved theme before first paint (prevents dark/light flash).
      // (The meta theme-color tag sits ABOVE this script: the script queries
      // it during parse, so it must already exist.)
      (function () {
        try {
          var m = localStorage.getItem('itms_theme') || 'light';
          // Unknown strings fall through to the light branch (same as missing).
          var known = ['paper', 'console', 'bold', 'shell', 'terminal', 'clarity', 'clarity-dark', 'ledgerly', 'ledgerly-light', 'light', 'dark', 'system'];
          if (known.indexOf(m) === -1) m = 'light';
          var d = document.documentElement;
          var c = '#ffffff';
          if (m === 'paper') {
            d.classList.add('theme-paper');
            c = '#f6f5f1';
          } else if (m === 'console') {
            d.classList.add('dark', 'theme-console');
            c = '#09090b';
          } else if (m === 'bold') {
            d.classList.add('dark', 'theme-bold');
            c = '#0d0716';
          } else if (m === 'shell') {
            d.classList.add('theme-shell');
            c = '#ffffff';
          } else if (m === 'terminal') {
            d.classList.add('dark', 'theme-terminal');
            c = '#0a0f0d';
          } else if (m === 'clarity') {
            d.classList.add('theme-clarity');
            c = '#f6f7f9';
          } else if (m === 'clarity-dark') {
            d.classList.add('dark', 'theme-clarity-dark');
            c = '#0b0d10';
          } else if (m === 'ledgerly') {
            d.classList.add('dark', 'ledgerly-dark');
            c = '#141311';
          } else if (m === 'ledgerly-light') {
            d.classList.add('ledgerly-light'); // light only — never .dark
            c = '#f6f5f1';
          } else {
            var dark =
              m === 'dark' ||
              (m === 'system' &&
                window.matchMedia('(prefers-color-scheme: dark)').matches);
            if (dark) d.classList.add('dark');
            c = dark ? '#020617' : '#ffffff';
          }
          // PWA chrome follows the theme from the first paint (same mapping
          // as THEME_REGISTRY.themeColor; React re-affirms on mount).
          var meta = document.querySelector('meta[name="theme-color"]');
          if (meta) meta.setAttribute('content', c);
        } catch (e) {}
      })();
