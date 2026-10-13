import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { classifyLoginSignals } from './loginState.js';

async function readSignals(page) {
  return page.evaluate(() => {
    const hasChatList = Boolean(
      document.querySelector('#pane-side')
      || document.querySelector('[data-testid="chat-list"]')
      || document.querySelector('[aria-label="Chat list"]'),
    );
    const hasQr = Boolean(
      document.querySelector('[data-testid="qrcode"]')
      || document.querySelector('div[data-ref]')
      || document.querySelector('canvas'),
    );
    return { hasChatList, hasQr };
  });
}

async function centeredContinuePoint(page) {
  return page.evaluate(() => {
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^continue$/i.test(value)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const centered = x > window.innerWidth * 0.15 && x < window.innerWidth * 0.85
          && y > window.innerHeight * 0.15 && y < window.innerHeight * 0.92;
        if (centered && rect.width >= 4 && rect.height >= 4) {
          const target = node.parentElement?.closest('button, [role="button"], div') || node.parentElement;
          target?.click();
          hits.push({ x, y });
        }
      }
      node = walker.nextNode();
    }
    return hits[0] || null;
  }).catch(() => null);
}

export async function dismissWhatsAppPopups(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const point = await centeredContinuePoint(page);
    if (!point) return;
    await page.mouse.click(point.x, point.y).catch(() => {});
    await page.waitForTimeout(1000);
  }
}

export async function readPageLoginState(page) {
  return classifyLoginSignals(await readSignals(page));
}

export async function detectPageLoginState(page) {
  await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const deadline = Date.now() + 20000;
  let signals = { hasChatList: false, hasQr: false };
  while (Date.now() < deadline) {
    signals = await readSignals(page);
    const state = classifyLoginSignals(signals);
    if (state !== 'unknown') {
      if (state === 'authenticated') await dismissWhatsAppPopups(page);
      return state;
    }
    await page.waitForTimeout(500);
  }
  return classifyLoginSignals(signals);
}

export async function rateLimitVisible(page) {
  const notice = page.getByText(/try again later|too many attempts|too many people|can't add more|cannot add more|adding members too quickly/i).first();
  return notice.isVisible().catch(() => false);
}

export function inviteCodeFromLink(inviteLink) {
  try {
    const url = new URL(String(inviteLink || '').trim());
    if (url.protocol !== 'https:' || url.hostname !== 'chat.whatsapp.com') return '';
    const code = url.pathname.split('/').filter(Boolean)[0] || '';
    return /^[A-Za-z0-9]{10,}$/.test(code) ? code : '';
  } catch {
    return '';
  }
}

async function openGroup(page, { groupName, inviteLink }) {
  if (groupName) {
    const row = page.locator('#pane-side').getByText(groupName, { exact: true }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const header = page.locator('#main header').getByText(groupName, { exact: false }).first();
      if (await header.isVisible().catch(() => false)) return { opened: true };
    }
  }

  const code = inviteCodeFromLink(inviteLink);
  if (code) {
    await page.goto(`https://web.whatsapp.com/accept?code=${encodeURIComponent(code)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    }).catch(() => {});
    const deadline = Date.now() + 15000;
    let joinClicked = false;
    while (Date.now() < deadline) {
      if (await page.locator('#main').first().isVisible().catch(() => false)) return { opened: true };
      const join = page.getByRole('button', { name: /join group|join chat/i }).first();
      if (!joinClicked && await join.isVisible().catch(() => false)) {
        joinClicked = true;
        await join.click().catch(() => {});
      }
      await page.waitForTimeout(500);
    }
    return { opened: false, reason: 'group_not_opened' };
  }

  if (!groupName) return { opened: false, reason: 'group_name_missing' };

  const side = page.locator('#pane-side');
  try {
    await side.waitFor({ timeout: 10000 });
    const searchBox = side.locator('[contenteditable="true"]').first();
    await searchBox.click({ timeout: 8000 });
    await searchBox.fill('');
    await page.keyboard.type(groupName, { delay: 20 });
    await side.getByText(groupName, { exact: false }).first().click({ timeout: 8000 });
    return { opened: true };
  } catch {
    return { opened: false, reason: 'group_not_found' };
  }
}

async function pause(page, milliseconds) {
  await page.waitForTimeout(milliseconds);
}



async function saveContact(page, { name, phone }) {
  await pause(page, 1500);
  const direct = page.getByRole('button', { name: /^add contact$/i }).first();
  let opened = false;
  if (await direct.isVisible().catch(() => false)) {
    opened = await direct.click({ timeout: 8000 }).then(() => true).catch(() => false);
  }
  if (!opened) {
    const newChat = page.getByRole('button', { name: /new chat/i }).first();
    if (await newChat.isVisible().catch(() => false)) {
      const clicked = await newChat.click({ timeout: 8000 }).then(() => true).catch(() => false);
      if (clicked) {
        await pause(page, 1500);
        const item = page.getByText(/^new contact$/i).first();
        if (await item.isVisible().catch(() => false)) {
          await item.click({ timeout: 8000 }).catch(() => {});
          opened = true;
        }
      }
    }
  }
  if (!opened) return { saved: false, reason: 'add_contact_missing' };

  await pause(page, 2000);
  const firstName = page.getByRole('textbox', { name: /first name/i }).first();
  try {
    await firstName.waitFor({ timeout: 10000 });
  } catch {
    return { saved: false, reason: 'contact_form_missing' };
  }
  await firstName.fill(String(name || 'Member').slice(0, 25));
  await pause(page, 1200);

  const form = page.locator('div').filter({
    has: page.getByRole('textbox', { name: /first name/i }),
    hasText: 'Phone',
  }).last();
  const parsed = parsePhoneNumberFromString(phone);
  const nationalNumber = parsed?.nationalNumber || String(phone).replace(/^\+/, '');
  const countryName = parsed?.country
    ? new Intl.DisplayNames(['en'], { type: 'region' }).of(parsed.country)
    : '';
  const callingCode = parsed?.countryCallingCode || '';
  const countryAlreadySelected = callingCode
    ? await form.getByText(new RegExp(`\\+${callingCode}(?!\\d)`)).first().isVisible().catch(() => false)
    : false;
  if (countryName && !countryAlreadySelected) {
    const countryControl = form.getByRole('combobox').first();
    const countryLabel = form.getByText(/\+\d{1,3}/).first();
    let countryOpened = false;
    if (await countryControl.isVisible().catch(() => false)) {
      await countryControl.click();
      countryOpened = true;
    } else if (await countryLabel.isVisible().catch(() => false)) {
      await countryLabel.click();
      countryOpened = true;
    }
    if (countryOpened) {
      await pause(page, 1500);
      const countrySearch = page.getByPlaceholder(/search countr/i).first();
      if (await countrySearch.isVisible().catch(() => false)) {
        await countrySearch.fill('');
        await countrySearch.pressSequentially(countryName, { delay: 90 });
        await pause(page, 1800);
        const option = page.getByRole('option', { name: new RegExp(countryName, 'i') }).first();
        if (await option.isVisible().catch(() => false)) {
          await option.click();
          await pause(page, 1500);
        } else {
          await page.keyboard.press('Escape').catch(() => {});
          await pause(page, 800);
        }
      }
    }
  }

  const phoneBox = form.getByRole('textbox', { name: /^phone$|phone number|mobile/i }).first();
  const placeholder = form.getByPlaceholder(/phone|mobile/i).first();
  const tel = form.locator('input[type="tel"], input[inputmode="tel"]').last();
  const phoneField = await phoneBox.isVisible().catch(() => false)
    ? phoneBox
    : await placeholder.isVisible().catch(() => false)
      ? placeholder
      : await tel.isVisible().catch(() => false)
        ? tel
        : null;
  if (!phoneField) return { saved: false, reason: 'phone_field_missing' };
  await phoneField.click();
  await pause(page, 500);
  await phoneField.fill('');
  await phoneField.pressSequentially(nationalNumber, { delay: 120 });
  await pause(page, 2000);

  const alreadySaved = page.getByText(/already in your contacts/i).first();
  if (await alreadySaved.isVisible().catch(() => false)) {
    await pause(page, 1500);
    await page.keyboard.press('Escape').catch(() => {});
    await pause(page, 1500);
    return { saved: true, reason: 'already_in_contacts' };
  }

  const invalid = page.getByText(/enter a valid phone number|not on whatsapp|isn.t on whatsapp|invite them on your primary device/i).first();
  if (await invalid.isVisible().catch(() => false)) {
    return { saved: false, reason: 'contact_not_accepted' };
  }

  const sync = page.getByRole('switch', { name: /sync contact to phone/i }).first();
  if (await sync.isVisible().catch(() => false)) {
    const checked = await sync.getAttribute('aria-checked').catch(() => null);
    if (checked !== 'true') {
      await sync.click();
      await pause(page, 1000);
    }
  }

  const save = page.getByRole('button', { name: /save contact|^save$|^done$/i }).last();
  const check = page.locator('[data-icon="checkmark"], [data-icon="check"], [data-icon="wds-ic-check"]').last();
  if (await save.isVisible().catch(() => false)) {
    await save.click();
  } else if (await check.isVisible().catch(() => false)) {
    await check.click();
  } else {
    return { saved: false, reason: 'save_contact_missing' };
  }

  await pause(page, 4000);
  const errorText = page.getByText(/isn't on whatsapp|phone number is invalid|couldn't save|unable to save/i).first();
  if (await errorText.isVisible().catch(() => false)) {
    return { saved: false, reason: 'contact_not_accepted' };
  }
  return { saved: true, reason: 'save_clicked' };
}

async function verifyContactSaved(page, { name, phone }) {
  await page.keyboard.press('Escape').catch(() => {});
  await pause(page, 2000);
  const byRole = page.getByRole('textbox', { name: /search or start a new chat/i }).first();
  const byPlaceholder = page.getByPlaceholder(/search or start a new chat/i).first();
  const search = await byRole.isVisible().catch(() => false) ? byRole : byPlaceholder;
  if (!(await search.isVisible().catch(() => false))) {
    return { found: false, reason: 'contact_search_missing' };
  }

  async function lookFor(text) {
    await search.click();
    await pause(page, 800);
    await search.fill('');
    await search.pressSequentially(text, { delay: 110 });
    await pause(page, 4000);
    const empty = page.getByText(/no chats, contacts or messages found|no contacts found/i).first();
    if (await empty.isVisible().catch(() => false)) return false;
    const hit = page.locator('[role="listitem"], [role="row"], [role="gridcell"], [data-testid="cell-frame-container"]')
      .filter({ hasText: text })
      .first();
    return hit.isVisible().catch(() => false);
  }

  const byName = await lookFor(String(name || '').slice(0, 25));
  if (byName) {
    await page.keyboard.press('Escape').catch(() => {});
    await pause(page, 1000);
    return { found: true, reason: 'contact_visible' };
  }

  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  const byPhone = digits ? await lookFor(digits) : false;
  await page.keyboard.press('Escape').catch(() => {});
  await pause(page, 1000);
  if (byPhone) return { found: true, reason: 'contact_visible' };
  return { found: false, reason: 'contact_not_found_after_save' };
}

/**
 * One pass through WhatsApp Web: save the number with the normal Add contact
 * control, then one pass through the normal add-participant control.
 * If either control is missing or the number cannot be selected, this stops.
 * It does not send messages or repeat the attempt.
 */
export async function tryAddParticipant(page, { groupName, phone, inviteLink, contactName }) {
  await dismissWhatsAppPopups(page);
  const contact = await saveContact(page, { name: contactName, phone });
  if (!contact.saved) {
    return { outcome: 'not_selectable', reason: 'contact_not_saved', contact };
  }

  const verified = await verifyContactSaved(page, { name: contactName, phone });
  if (!verified.found) {
    return {
      outcome: 'not_selectable',
      reason: verified.reason,
      contact: { ...contact, verified: false, reason: verified.reason },
    };
  }

  await pause(page, 1500);
  if (await rateLimitVisible(page)) {
    return { outcome: 'rate_limited', reason: 'whatsapp_limit', contact: { ...contact, ...verified } };
  }
  const opened = await openGroup(page, { groupName, inviteLink });
  if (!opened.opened) {
    return { outcome: 'ui_unavailable', reason: opened.reason || 'group_not_found', contact: { ...contact, ...verified } };
  }

  await pause(page, 2000);
  await dismissWhatsAppPopups(page);
  await page.locator('#main header').first().click({ timeout: 8000 }).catch(() => {});
  await pause(page, 1500);
  await dismissWhatsAppPopups(page);

  const addButton = page.getByRole('button', { name: /add participant|add member|add members/i }).first();
  if (!(await addButton.isVisible().catch(() => false))) {
    return { outcome: 'ui_unavailable', reason: 'add_control_missing', contact: { ...contact, ...verified } };
  }
  const addClicked = await addButton.click({ timeout: 8000 }).then(() => true).catch(() => false);
  if (!addClicked) {
    await dismissWhatsAppPopups(page);
    const retried = await addButton.click({ timeout: 8000 }).then(() => true).catch(() => false);
    if (!retried) {
      return { outcome: 'ui_unavailable', reason: 'add_control_missing', contact: { ...contact, ...verified } };
    }
  }
  await pause(page, 2000);

  const dialog = page.locator('[role="dialog"]').last();
  const input = dialog.locator('[contenteditable="true"], input').first();
  try {
    await input.click({ timeout: 8000 });
  } catch {
    return { outcome: 'ui_unavailable', reason: 'add_control_missing', contact: { ...contact, ...verified } };
  }
  await page.keyboard.type(contactName || phone, { delay: 120 });
  await pause(page, 4000);

  if (await rateLimitVisible(page)) {
    return { outcome: 'rate_limited', reason: 'whatsapp_limit', contact: { ...contact, ...verified } };
  }

  const blocked = dialog.getByText(/no chats, contacts or messages found|no contacts found|no results|isn't on whatsapp|privacy|can't add|cannot add/i);
  if (await blocked.isVisible().catch(() => false)) {
    const text = (await blocked.innerText().catch(() => '')).toLowerCase();
    if (text.includes('privacy') || text.includes("can't") || text.includes('cannot') || text.includes("isn't")) {
      return { outcome: 'privacy_restricted', reason: 'privacy_restriction', contact: { ...contact, ...verified } };
    }
    return { outcome: 'not_selectable', reason: 'number_not_recognized', contact: { ...contact, ...verified } };
  }

  const named = dialog.getByText(contactName, { exact: false }).first();
  if (!(await named.isVisible().catch(() => false))) {
    return { outcome: 'not_selectable', reason: 'number_not_recognized', contact: { ...contact, ...verified } };
  }

  await pause(page, 1000);
  await named.click();
  await pause(page, 2000);
  const confirmIcon = dialog.locator('[data-icon="checkmark"], [data-icon="check"], [data-icon="wds-ic-check"]').last();
  const confirm = dialog.getByRole('button', { name: /add participant|add member|confirm|ok/i }).last();
  if (await confirmIcon.isVisible().catch(() => false)) {
    await confirmIcon.click();
  } else if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  } else {
    const roundConfirm = dialog.locator('button').last();
    if (await roundConfirm.isVisible().catch(() => false)) await roundConfirm.click();
  }
  await pause(page, 2000);
  const addMember = page.getByRole('button', { name: /^add member$/i }).last();
  try {
    await addMember.waitFor({ timeout: 8000 });
    await pause(page, 1000);
    await addMember.click();
    await pause(page, 3000);
  } catch {
    // The confirm dialog did not appear, so membership stays unconfirmed.
  }
  const added = page.getByText(/you added /i).first();
  if (await added.isVisible().catch(() => false)) {
    return { outcome: 'added_confirmed', reason: 'whatsapp_added_notice', contact: { ...contact, ...verified } };
  }
  return { outcome: 'submitted_unconfirmed', reason: 'no_membership_callback', contact: { ...contact, ...verified } };
}
