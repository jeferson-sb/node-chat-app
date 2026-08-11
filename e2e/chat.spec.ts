import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end characterization test for the chat flow, run against real
 * server + client dev servers (see playwright.config.ts) via a real
 * browser. Covers: signing up, picking a room, seeing another participant
 * join, exchanging messages, and being notified when someone disconnects.
 *
 * Names are suffixed with the test's worker index, and emails with a
 * random UUID, so concurrent Playwright workers (and repeated runs against
 * the same persistent Postgres - accounts have no in-memory fallback, see
 * docs/adr/2026-08-09-authentication.md) don't collide on username-in-use
 * checks or "email already registered".
 */

const signUpAndJoinRoom = async (
  page: Page,
  name: string,
  room: string,
): Promise<void> => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Sign Up' }).click();
  await page.getByPlaceholder('Your name').fill(name);
  await page
    .getByPlaceholder('you@example.com')
    .fill(`${name}-${crypto.randomUUID()}@example.com`);
  await page.getByPlaceholder('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/room');
  await page.getByPlaceholder(/e\.g Math, Travel, Academy/).fill(room);
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page).toHaveURL(`/chat/${room}`);
};

test('a user can sign up, join a room, and see the welcome message', async ({
  page,
}, testInfo) => {
  const name = `alice-${testInfo.workerIndex}`;
  const room = `general-${testInfo.workerIndex}`;
  await signUpAndJoinRoom(page, name, room);

  await expect(
    page.getByText(`Hello ${name}, Welcome to the chat!`),
  ).toBeVisible();
  await expect(
    page.locator('.chat__sidebar').getByText(name, { exact: true }),
  ).toBeVisible();
});

test('two users can exchange messages in the same room', async ({
  browser,
}, testInfo) => {
  const room = `general-${testInfo.workerIndex}`;
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await signUpAndJoinRoom(alicePage, `alice-${testInfo.workerIndex}`, room);
  await signUpAndJoinRoom(bobPage, `bob-${testInfo.workerIndex}`, room);

  await expect(
    alicePage.getByText(`bob-${testInfo.workerIndex} has joined the chat!`),
  ).toBeVisible();

  await bobPage.getByPlaceholder('Type your message ...').fill('hi alice');
  await bobPage.getByRole('button', { name: 'Send' }).click();

  await expect(alicePage.getByText('hi alice')).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test('the room is notified when a participant disconnects', async ({
  browser,
}, testInfo) => {
  const room = `general-${testInfo.workerIndex}`;
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await signUpAndJoinRoom(alicePage, `alice-${testInfo.workerIndex}`, room);
  await signUpAndJoinRoom(bobPage, `bob-${testInfo.workerIndex}`, room);
  await expect(
    alicePage.getByText(`bob-${testInfo.workerIndex} has joined the chat!`),
  ).toBeVisible();

  await bobContext.close();

  await expect(
    alicePage.getByText(`bob-${testInfo.workerIndex} has left the chat!`),
  ).toBeVisible();

  await aliceContext.close();
});
