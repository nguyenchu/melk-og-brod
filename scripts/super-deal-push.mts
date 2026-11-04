import { configureWebPush } from './super-deal-web-push.mts';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { selectSuperDeals } from '../lib/super-deals.ts';
import type { MenyProduct } from '../lib/types.ts';

const db = new DatabaseSync(process.env.MATKUPP_PUSH_DB ?? 'push.sqlite');
db.exec(`
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS subscribers (token TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, reserved_at INTEGER NOT NULL);
`);

const web = configureWebPush(db);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CATALOG_AGE_MS = 6 * 60 * 60 * 1000;

async function send() {
  const path = process.argv[3];
  if (!path) throw new Error('Mangler sti til products.json');
  const { computed_at, products } = JSON.parse(await readFile(path, 'utf8')) as {
    computed_at: string;
    products: MenyProduct[];
  };
  const now = Date.now();
  const age = now - Date.parse(computed_at);
  if (!(age >= 0 && age < MAX_CATALOG_AGE_MS)) return;
  const deals = selectSuperDeals(products, now);
  const registered = db.prepare('SELECT token FROM subscribers').all() as { token: string }[];
  const wasSent = db.prepare('SELECT 1 FROM campaigns WHERE id = ?');
  const deal = deals.find(({ campaign }) => !wasSent.get(campaign));
  if (!deal || (!registered.length && !web.hasSubscribers())) return;

  // Reserve before calling Expo so retries after an ambiguous response cannot
  // trigger duplicate pushes. A failed batch still counts toward the weekly limit.
  const reservation = db
    .prepare(
      `
    INSERT OR IGNORE INTO campaigns (id, reserved_at)
    SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE reserved_at > ?)
  `,
    )
    .run(deal.campaign, now, now - WEEK_MS);
  if (!reservation.changes) return;

  const { product, discount, saved, ends } = deal;
  const body = `${product.name} hos ${product.chain} · ${discount} % rabatt · spar ${(saved / 100).toLocaleString('nb-NO')} kr`;
  const ttl = Math.floor(Math.min(24 * 60 * 60, (ends - now) / 1000));
  const results = await Promise.allSettled([sendExpo(registered, body, ttl), web.send(body, ttl)]);
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, 'En eller flere varselkanaler feilet');
}

async function sendExpo(registered: { token: string }[], body: string, ttl: number) {
  const stillRegistered = db.prepare('SELECT 1 FROM subscribers WHERE token = ?');
  const remove = db.prepare('DELETE FROM subscribers WHERE token = ?');
  let failures = 0;
  for (let i = 0; i < registered.length; i += 100) {
    const batch = registered.slice(i, i + 100).filter(({ token }) => stillRegistered.get(token));
    if (!batch.length) continue;
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        batch.map(({ token }) => ({
          to: token,
          title: 'Kjempetilbud i Matkupp',
          body,
          data: { kind: 'super-deals' },
          channelId: 'super-deals',
          ttl,
        })),
      ),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Expo svarte HTTP ${response.status}`);
    const { data } = await response.json();
    if (!Array.isArray(data) || data.length !== batch.length)
      throw new Error('Uventet svar fra Expo');
    data.forEach((ticket, index) => {
      if (ticket.details?.error === 'DeviceNotRegistered') remove.run(batch[index].token);
      else if (ticket.status !== 'ok') failures++;
    });
  }
  if (failures) throw new Error(`Expo avviste ${failures} varsler`);
}

function listen() {
  const register = db.prepare('INSERT OR IGNORE INTO subscribers (token) VALUES (?)');
  const remove = db.prepare('DELETE FROM subscribers WHERE token = ?');
  createServer((req, res) => {
    if (req.url === '/api/push/web') {
      web.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    const token = req.headers.authorization?.match(
      /^Bearer ((?:Expo|Exponent)PushToken\[[\w-]{1,128}\])$/,
    )?.[1];
    if (req.url !== '/api/push/subscription') res.writeHead(404);
    else if (!token) res.writeHead(401);
    else if (req.method === 'PUT') {
      register.run(token);
      res.writeHead(204);
    } else if (req.method === 'DELETE') {
      remove.run(token);
      res.writeHead(204);
    } else res.writeHead(405, { Allow: 'PUT, DELETE' });
    res.end();
  }).listen(8734, '127.0.0.1');
}

if (process.argv[2] === 'send') await send();
else if (process.argv[2] === 'listen') listen();
else throw new Error('Bruk listen eller send');
