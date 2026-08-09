import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end characterization test for the chat flow, run against real
 * server + client dev servers (see playwright.config.ts) via a real
 * browser. Covers: joining a room, seeing another participant join,
 * exchanging messages, and being notified when someone disconnects.
 *
 * Usernames and rooms are suffixed with the test's worker index so that
 * concurrent Playwright workers sharing the same server process (and its
 * in-memory user/room maps) don't collide with each other.
 */

const join = async (page: Page, username: string, room: string) => {
  await page.goto('/')
  await page.getByPlaceholder('Your nickname').fill(username)
  await page.getByPlaceholder(/e\.g Math, Travel, Academy/).fill(room)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page).toHaveURL(`/chat/${username}/${room}`)
}

test('a user can join a room and see the welcome message', async ({
  page,
}, testInfo) => {
  const username = `alice-${testInfo.workerIndex}`
  const room = `general-${testInfo.workerIndex}`
  await join(page, username, room)

  await expect(
    page.getByText(`Hello ${username}, Welcome to the chat!`),
  ).toBeVisible()
  await expect(
    page.locator('.chat__sidebar').getByText(username, { exact: true }),
  ).toBeVisible()
})

test('two users can exchange messages in the same room', async ({
  browser,
}, testInfo) => {
  const room = `general-${testInfo.workerIndex}`
  const aliceContext = await browser.newContext()
  const bobContext = await browser.newContext()
  const alicePage = await aliceContext.newPage()
  const bobPage = await bobContext.newPage()

  await join(alicePage, `alice-${testInfo.workerIndex}`, room)
  await join(bobPage, `bob-${testInfo.workerIndex}`, room)

  await expect(
    alicePage.getByText(`bob-${testInfo.workerIndex} has joined the chat!`),
  ).toBeVisible()

  await bobPage.getByPlaceholder('Type your message ...').fill('hi alice')
  await bobPage.getByRole('button', { name: 'Send' }).click()

  await expect(alicePage.getByText('hi alice')).toBeVisible()

  await aliceContext.close()
  await bobContext.close()
})

test('the room is notified when a participant disconnects', async ({
  browser,
}, testInfo) => {
  const room = `general-${testInfo.workerIndex}`
  const aliceContext = await browser.newContext()
  const bobContext = await browser.newContext()
  const alicePage = await aliceContext.newPage()
  const bobPage = await bobContext.newPage()

  await join(alicePage, `alice-${testInfo.workerIndex}`, room)
  await join(bobPage, `bob-${testInfo.workerIndex}`, room)
  await expect(
    alicePage.getByText(`bob-${testInfo.workerIndex} has joined the chat!`),
  ).toBeVisible()

  await bobContext.close()

  await expect(
    alicePage.getByText(`bob-${testInfo.workerIndex} has left the chat!`),
  ).toBeVisible()

  await aliceContext.close()
})

