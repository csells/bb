import { chromium, expect } from '@playwright/test';
import { readFile, unlink, mkdir, writeFile } from 'node:fs/promises';
const credentialPath = '/Users/admin/.rooms-history-owner-check.json';
const evidence = '/Users/admin/rooms-v2-evidence/history-owner-ui';
const checks = [];
const forbiddenWrites = [];
let browser;
let context;
let signedIn = false;
let origin;
await mkdir(evidence, { recursive: true });
try {
  const credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
  origin = credentials.origin;
  if (origin !== 'https://diary-butler-leone-heavy.trycloudflare.com') throw new Error('Unexpected staging origin');
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!['GET', 'HEAD'].includes(request.method()) && !['/api/auth/login', '/api/logout'].includes(path)) {
      forbiddenWrites.push(request.method() + ' ' + path);
      await route.abort();
    } else await route.continue();
  });
  await page.goto(origin);
  await page.getByLabel('Handle', {exact:true}).fill(credentials.handle);
  await page.getByLabel('Password', {exact:true}).fill(credentials.password);
  await page.getByRole('button', {name:'Sign in',exact:true}).click();
  await expect(page.getByLabel('Message the room')).toBeVisible();
  signedIn = true;
  const meResponse = await context.request.get(origin + '/api/me');
  expect(meResponse.status()).toBe(200);
  const me = await meResponse.json();
  expect(me.user.handle).toBe('csells');
  const room = me.rooms.find(room => room.name === 'Workshop');
  expect(room).toBeTruthy();
  await expect(page.getByRole('heading', {name:'Workshop',exact:true})).toBeVisible();
  checks.push('Fresh owner browser signed into actual Workshop');
  const snapshotResponse = await context.request.get(origin + '/api/rooms/' + room.id);
  expect(snapshotResponse.status()).toBe(200);
  const snapshot = await snapshotResponse.json();
  const failedDelivery = snapshot.deliveries.find(delivery => delivery.state === 'error' && delivery.error?.includes('Claude’s login expired during this attempt.'));
  expect(failedDelivery).toBeTruthy();
  const originalIndex = snapshot.messages.findIndex(message => message.id === failedDelivery.messageId);
  expect(originalIndex).toBeGreaterThanOrEqual(0);
  const subsequent = snapshot.messages.slice(originalIndex + 1);
  const latestAtlas = subsequent.findLast(message => message.kind === 'agent' && message.authorName === 'Atlas');
  const latestNova = subsequent.findLast(message => message.kind === 'agent' && message.authorName === 'Nova');
  expect(latestAtlas).toBeTruthy();
  expect(latestNova).toBeTruthy();
  const failure = page.locator('.failure-reply').filter({hasText:'Claude’s login expired during this attempt.'});
  const original = page.locator(`[data-message-id="${failedDelivery.messageId}"]`);
  const firstLater = page.locator(`[data-message-id="${subsequent[0].id}"]`);
  await expect(failure).toHaveCount(1);
  await expect(failure).toContainText('Nova couldn’t complete this request');
  await failure.scrollIntoViewIfNeeded();
  const originalBounds = await original.boundingBox();
  const failureBounds = await failure.boundingBox();
  const laterBounds = await firstLater.boundingBox();
  expect(originalBounds && failureBounds && laterBounds && originalBounds.y + originalBounds.height <= failureBounds.y && failureBounds.y + failureBounds.height <= laterBounds.y).toBeTruthy();
  await expect(failure.getByRole('button', {name:'Ask Nova again',exact:true})).toBeVisible();
  await expect(failure.getByRole('button', {name:'Inspect activity',exact:true})).toBeVisible();
  await page.screenshot({path:evidence+'/workshop-history.png',fullPage:true});
  checks.push('Historical Nova failure remains immediately after its original request and before newer conversation, with controls retained');
  for (const message of [latestAtlas, latestNova]) {
    const reply = page.locator(`[data-message-id="${message.id}"]`);
    await reply.scrollIntoViewIfNeeded();
    await expect(reply).toBeInViewport();
    const replyBounds = await reply.boundingBox();
    const historicalBounds = await failure.boundingBox();
    expect(replyBounds && historicalBounds && historicalBounds.y + historicalBounds.height <= replyBounds.y).toBeTruthy();
  }
  await page.locator('.conversation').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(failure).not.toBeInViewport();
  await expect(page.getByLabel('Message the room')).toHaveValue('');
  expect(forbiddenWrites).toEqual([]);
  await page.screenshot({path:evidence+'/workshop-latest.png',fullPage:true});
  checks.push('Newer Atlas and Nova replies follow the failure; scrolling to latest leaves the failure outside the viewport');
  checks.push('Composer untouched and no room mutation or message submission attempted');
  await page.getByLabel('Sign out', {exact:true}).click();
  await expect(page.getByRole('button', {name:'Sign in',exact:true})).toBeVisible();
  expect((await context.request.get(origin + '/api/me')).status()).toBe(401);
  signedIn = false;
  checks.push('Signed out with API401');
} finally {
  try {
    if (signedIn && context && origin) await context.request.post(origin + '/api/logout', {data:{}});
  } finally {
    await browser?.close();
    await unlink(credentialPath);
    await writeFile(evidence+'/checks.json', JSON.stringify({checks,forbiddenWrites,browserClosed:true,temporaryCredentialRemoved:true},null,2));
  }
}
for (const check of checks) console.log('PASS',check);
console.log('PASS browser closed and exact credential fixture removed');
