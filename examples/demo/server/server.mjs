// Tiny in-memory app used by the demo suite. No dependencies.
// State is per server process, so every `playwright test` run starts fresh.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4173);
const REGRESSION = process.env.DEMO_REGRESSION === '1';

/** @type {Map<string, { displayName: string }>} */
const accounts = new Map([['alice', { displayName: 'Alice' }]]);
/** @type {Map<string, string>} session token -> account */
const sessions = new Map();
let dashboardWarm = false;
let searchCalls = 0;

const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function sessionAccount(req) {
  const match = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie ?? '');
  return match ? sessions.get(match[1]) : undefined;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (status, body, type = 'text/html') => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };

  if (url.pathname === '/health') return send(200, 'ok', 'text/plain');

  if (url.pathname === '/') {
    return send(200, page('Demo', '<h1>FlakeScope demo app</h1><a href="/profile">Profile</a>'));
  }

  if (url.pathname === '/login' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    const user = form.get('user') ?? '';
    if (!accounts.has(user)) return send(401, page('Login', '<p>Unknown user</p>'));
    const token = randomBytes(16).toString('hex');
    sessions.set(token, user);
    res.writeHead(303, { location: '/profile', 'set-cookie': `session=${token}; Path=/; HttpOnly` });
    return res.end();
  }

  if (url.pathname === '/login') {
    return send(
      200,
      page(
        'Login',
        `<form method="post" action="/login"><label>User <input name="user"></label><button>Sign in</button></form>`,
      ),
    );
  }

  if (url.pathname === '/profile') {
    const user = sessionAccount(req);
    if (!user) return send(401, page('Profile', '<p>Not signed in</p>'));
    const account = accounts.get(user);
    if (req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      account.displayName = form.get('displayName') ?? account.displayName;
      res.writeHead(303, { location: '/profile' });
      return res.end();
    }
    return send(
      200,
      page(
        'Profile',
        `<p>Display name: <span data-testid="display-name">${account.displayName}</span></p>
         <form method="post" action="/profile">
           <label>Display name <input name="displayName"></label>
           <button>Save</button>
         </form>`,
      ),
    );
  }

  // Simulates a cold cache: the very first request is slow, later ones are fast.
  if (url.pathname === '/dashboard') {
    const delay = dashboardWarm ? 50 : 8000;
    dashboardWarm = true;
    await new Promise((r) => setTimeout(r, delay));
    return send(200, page('Dashboard', '<h1 data-testid="dashboard">Dashboard ready</h1>'));
  }

  // The first call returns results unsorted; every later call is sorted.
  if (url.pathname === '/api/search') {
    searchCalls++;
    const items = ['apple', 'banana', 'cherry'];
    return send(200, JSON.stringify(searchCalls === 1 ? [...items].reverse() : items), 'application/json');
  }

  if (url.pathname === '/search') {
    return send(
      200,
      page(
        'Search',
        `<ul data-testid="results"></ul>
         <script>
           fetch('/api/search').then(r => r.json()).then(items => {
             document.querySelector('[data-testid=results]').innerHTML =
               items.map(i => '<li>' + i + '</li>').join('');
           });
         </script>`,
      ),
    );
  }

  if (url.pathname === '/api/cart/total') {
    const prices = [1999, 500, 250];
    const total = prices.reduce((a, b) => a + b, 0);
    // DEMO_REGRESSION=1 introduces a real bug: the last item is dropped.
    const shown = REGRESSION ? total - prices[prices.length - 1] : total;
    return send(200, JSON.stringify({ totalCents: shown }), 'application/json');
  }

  send(404, page('Not found', '<p>Not found</p>'));
});

server.listen(PORT, () => console.log(`demo server on http://localhost:${PORT}`));
