import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('SPA navigation preserves queued pages and consent without external browser dependencies', async () => {
  const source = readFileSync(new URL('../public/pixel.js', import.meta.url), 'utf8');
  const location = new URL('https://example.com/?utm_source=google&utm_campaign=roof&email=private@example.com');
  const listeners = new Map();
  const stored = new Map();
  const bodies = [];
  let release;
  const firstRequest = new Promise(resolve => { release = resolve; });
  const nativePush = (_state, _title, next) => { if (next) location.href = new URL(next, location.href).href; };
  const window = { history: { pushState: nativePush, replaceState: nativePush },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    dispatchEvent() {},
  };
  const context = { URL, location, navigator: { globalPrivacyControl: false }, crypto: { randomUUID },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    CustomEvent: class {}, window,
    document: { currentScript: { src: 'https://kit.example/pixel.js', dataset: { site: 'example' } }, referrer: 'https://search.test/', addEventListener() {} },
    fetch: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      if (bodies.length === 1) await firstRequest;
      return { ok: true, json: async () => ({ visitorSessionId: '44444444-4444-4444-8444-444444444444' }) };
    },
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  runInNewContext(source, context);
  const tracker = window.OpenAttribution.sites.example;
  assert.equal(window.history.pushState, nativePush);
  tracker.consent(true);
  window.history.pushState({}, '', '/services');
  window.history.replaceState({}, '', '/quote?token=private');
  window.history.replaceState({}, '', '#details');
  release(); await settle();
  assert.deepEqual(bodies.map(body => body.url), ['https://example.com/?utm_source=google&utm_campaign=roof', 'https://example.com/services', 'https://example.com/quote']);
  assert.equal(bodies[1].referrer, bodies[0].url);
  assert.equal(bodies[2].referrer, bodies[1].url);
  assert.equal(new Set(bodies.map(body => body.visitorId)).size, 1);
  // Public track() still ignores caller arguments; only internal snapshots may
  // supply a URL. A host callback must not bypass the browser sanitizer.
  tracker.track({ url: 'https://evil.test/?email=private@example.com', referrer: 'secret' });
  await settle();
  assert.equal(bodies[3].url, 'https://example.com/quote');
  assert.equal(bodies[3].referrer, 'https://search.test');
  location.hash = '#/reset/private-reset-token?utm_campaign=roof&email=private%40example.com';
  listeners.get('hashchange')({newURL:location.href});
  await settle();
  assert.equal(bodies[4].url,'https://example.com/quote#/reset/[redacted]?utm_campaign=roof');
  listeners.get('popstate')(); await settle();
  assert.equal(bodies.length,5);
  tracker.consent(false);
  assert.equal(window.history.pushState, nativePush);
  assert.equal(listeners.has('popstate'), false);
  assert.equal(listeners.has('hashchange'), false);
  window.history.pushState({}, '', '/denied'); await settle();
  assert.equal(bodies.length, 5);
});
