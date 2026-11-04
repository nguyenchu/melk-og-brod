import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import webPush from 'web-push';

const {
  MATKUPP_VAPID_PUBLIC_KEY: publicKey,
  MATKUPP_VAPID_PRIVATE_KEY: privateKey,
  MATKUPP_VAPID_SUBJECT: subject,
} = process.env;
const origin = process.env.MATKUPP_WEB_ORIGIN;
const enabled = Boolean(publicKey && privateKey && subject && origin);
if (publicKey && privateKey && subject) webPush.setVapidDetails(subject, publicKey, privateKey);

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

function parseSubscription(value: unknown): Subscription | null {
  if (!value || typeof value !== 'object') return null;
  const { endpoint, keys } = value as Partial<Subscription>;
  // Accept only Chrome's push service. Never make requests to caller-selected hosts.
  if (
    typeof endpoint !== 'string' ||
    !/^https:\/\/fcm\.googleapis\.com\/fcm\/send\/[\w:-]{1,512}$/.test(endpoint) ||
    typeof keys?.p256dh !== 'string' ||
    !/^[\w-]{87}$/.test(keys.p256dh) ||
    typeof keys?.auth !== 'string' ||
    !/^[\w-]{22}$/.test(keys.auth)
  )
    return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function configureWebPush(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS web_subscribers (
    endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL
  )`);
  const register = db.prepare('INSERT OR REPLACE INTO web_subscribers VALUES (?, ?)');
  const remove = db.prepare('DELETE FROM web_subscribers WHERE endpoint = ? AND subscription = ?');
  const select = db.prepare('SELECT subscription FROM web_subscribers');

  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      if (!enabled) return res.writeHead(404).end();
      if (req.method === 'GET') {
        return res
          .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          .end(JSON.stringify({ publicKey }));
      }
      if (req.method !== 'PUT' && req.method !== 'DELETE') {
        return res.writeHead(405, { Allow: 'GET, PUT, DELETE' }).end();
      }
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json')
        return res.writeHead(403).end();

      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048) return res.writeHead(413).end();
      }
      let subscription: Subscription | null;
      try {
        subscription = parseSubscription(JSON.parse(body));
      } catch {
        return res.writeHead(400).end();
      }
      if (!subscription) return res.writeHead(400).end();
      const serialized = JSON.stringify(subscription);
      if (req.method === 'PUT') register.run(subscription.endpoint, serialized);
      else remove.run(subscription.endpoint, serialized);
      return res.writeHead(204).end();
    },
    hasSubscribers() {
      return enabled && Boolean(select.get());
    },
    async send(body: string, ttl: number) {
      if (!enabled) return;
      let failures = 0;
      for (const row of select.all()) {
        const serialized = String(row.subscription);
        const subscription = JSON.parse(serialized) as Subscription;
        try {
          await webPush.sendNotification(subscription, JSON.stringify({ body }), {
            TTL: ttl,
            timeout: 5_000,
          });
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) remove.run(subscription.endpoint, serialized);
          else failures++;
        }
      }
      if (failures) throw new Error(`Web Push avviste ${failures} varsler`);
    },
  };
}
