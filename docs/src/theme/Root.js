import React, { useEffect, useState, useRef } from 'react';

function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const docsbotRoot = () => document.getElementById('docsbotai-root');

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const scrollingUp = currentY < lastY.current;
        const pastThreshold = currentY > 300;

        // Show scroll-to-top when scrolling up and past threshold
        const show = scrollingUp && pastThreshold;
        setVisible(show);

        // Toggle DocsBot: crossfade with scroll-to-top
        const root = docsbotRoot();
        if (root) {
          root.style.transition = 'opacity 0.25s ease';
          root.style.opacity = show ? '0' : '1';
          root.style.pointerEvents = show ? 'none' : '';
        }

        lastY.current = currentY;
        ticking.current = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      className={`scroll-to-top-btn${visible ? ' visible' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Scroll to top"
    >
      ↑
    </button>
  );
}

export default function Root({ children }) {
  useEffect(() => {
    // DocsBot floating widget
    window.DocsBotAI = window.DocsBotAI || {};
    DocsBotAI.init = function (e) {
      return new Promise((t, r) => {
        var n = document.createElement('script');
        n.type = 'text/javascript';
        n.async = true;
        n.src = 'https://widget.docsbot.ai/chat.js';
        let o = document.getElementsByTagName('script')[0];
        o.parentNode.insertBefore(n, o);
        n.addEventListener('load', () => {
          let n;
          Promise.all([
            new Promise((t, r) => {
              window.DocsBotAI.mount(Object.assign({}, e)).then(t).catch(r);
            }),
            (n = function e(t) {
              return new Promise((e) => {
                if (document.querySelector(t)) return e(document.querySelector(t));
                let r = new MutationObserver((n) => {
                  if (document.querySelector(t))
                    return e(document.querySelector(t)), r.disconnect();
                });
                r.observe(document.body, { childList: true, subtree: true });
              });
            })('#docsbotai-root'),
          ])
            .then(() => t())
            .catch(r);
        });
        n.addEventListener('error', (e) => {
          r(e.message);
        });
      });
    };

    DocsBotAI.init({
      id: '4d18pTBbfBxEATUsxtR2/ZIk1foUAHecUacqL9nWy',
    });
  }, []);

  return (
    <>
      {children}
      <ScrollToTop />
    </>
  );
}
