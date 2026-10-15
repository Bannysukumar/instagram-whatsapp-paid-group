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

async function groupHeaderVisible(page, groupName) {
  if (!groupName) return false;
  return page.locator('#main header').getByText(groupName, { exact: false }).first().isVisible().catch(() => false);
}

async function clickExactText(page, pattern, { skipChatList = false, skipEditable = false } = {}) {
  const point = await page.evaluate(({ source, flags, skipSide, skipFields }) => {
    const expression = new RegExp(source, flags);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    let node = walker.nextNode();
    while (node) {
      const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (!expression.test(value) || !parent) {
        node = walker.nextNode();
        continue;
      }
      if (skipSide && parent.closest('#pane-side')) {
        node = walker.nextNode();
        continue;
      }
      if (skipFields && parent.closest('[contenteditable="true"], input, textarea')) {
        node = walker.nextNode();
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width >= 4 && rect.height >= 4) {
        hits.push({ area: rect.width * rect.height, parent });
      }
      node = walker.nextNode();
    }
    hits.sort((a, b) => a.area - b.area);
    const chosen = hits[0]?.parent;
    if (!chosen) return null;
    chosen.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.selectNodeContents(chosen);
    const rect = range.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, { source: pattern.source, flags: pattern.flags, skipSide: skipChatList, skipFields: skipEditable }).catch(() => null);
  if (!point) return false;
  await page.mouse.click(point.x, point.y).catch(() => {});
  return true;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function returnToChatList(page) {
  const side = page.locator('#pane-side');
  if (await side.isVisible().catch(() => false)) return true;
  await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  const ready = await side.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (ready) await dismissWhatsAppPopups(page);
  return ready;
}

async function searchAndOpenGroup(page, groupName) {
  if (!await returnToChatList(page)) return false;
  await page.keyboard.press('Escape').catch(() => {});
  const side = page.locator('#pane-side');
  const visible = side.getByText(groupName, { exact: true }).first();
  if (await visible.isVisible().catch(() => false)) {
    await visible.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (await groupHeaderVisible(page, groupName)) return true;
  }

  const chatSearch = page.getByRole('textbox', { name: /search or start a new chat/i }).first();
  const openedSearch = await chatSearch.click({ timeout: 8000 }).then(() => true).catch(() => false);
  if (!openedSearch) return false;
  await chatSearch.fill('').catch(() => {});
  await page.keyboard.type(groupName, { delay: 40 });
  await page.waitForTimeout(2500);
  const row = side.getByText(groupName, { exact: false }).first();
  const clicked = await row.click({ timeout: 8000 }).then(() => true).catch(() => false)
    || await clickExactText(page, new RegExp(`^${escapeRegExp(groupName)}$`, 'i'));
  await page.waitForTimeout(1500);
  await chatSearch.fill('').catch(() => {});
  return clicked && await groupHeaderVisible(page, groupName);
}

async function openGroup(page, { groupName, inviteLink }) {
  await dismissWhatsAppPopups(page);
  if (groupName && await searchAndOpenGroup(page, groupName)) return { opened: true };

  const code = inviteCodeFromLink(inviteLink);
  if (code) {
    await page.goto(`https://web.whatsapp.com/accept?code=${encodeURIComponent(code)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    }).catch(() => {});
    const deadline = Date.now() + 15000;
    let joinClicked = false;
    while (Date.now() < deadline) {
      if (await groupHeaderVisible(page, groupName)) return { opened: true };
      const join = page.getByRole('button', { name: /join group|join chat/i }).first();
      if (!joinClicked && await join.isVisible().catch(() => false)) {
        joinClicked = true;
        await join.click().catch(() => {});
      }
      await page.waitForTimeout(500);
    }
    if (!groupName && await page.locator('#main').first().isVisible().catch(() => false)) {
      return { opened: true };
    }
  }

  if (!groupName) return { opened: false, reason: 'group_name_missing' };
  if (await searchAndOpenGroup(page, groupName)) return { opened: true };
  return { opened: false, reason: 'group_not_opened' };
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
  const input = await openAddPanel(page, groupName);
  if (!input) {
    return { outcome: 'ui_unavailable', reason: 'add_control_missing', contact: { ...contact, ...verified } };
  }
  await pause(page, 1000);
  try {
    await input.click({ timeout: 8000 });
  } catch {
    return { outcome: 'ui_unavailable', reason: 'add_control_missing', contact: { ...contact, ...verified } };
  }
  const savedName = String(contactName || '').slice(0, 25);
  await page.keyboard.type(savedName || phone, { delay: 120 });
  await pause(page, 4000);

  const alreadyAdded = page.getByText(/already added to group/i).first();
  if (await alreadyAdded.isVisible().catch(() => false)) {
    return { outcome: 'added_confirmed', reason: 'already_in_group', contact: { ...contact, ...verified } };
  }

  if (await rateLimitVisible(page)) {
    return { outcome: 'rate_limited', reason: 'whatsapp_limit', contact: { ...contact, ...verified } };
  }

  const blocked = page.getByText(/couldn.t add|could not add|invite them privately|isn't on whatsapp|can't add|cannot add/i).first();
  if (await blocked.isVisible().catch(() => false)) {
    const sent = await sendPrivateInvite(page, contact, verified);
    if (sent) return sent;
  }

  const namePattern = new RegExp(escapeRegExp(savedName), 'i');
  let picked = await clickExactText(page, namePattern, { skipChatList: true, skipEditable: true });
  if (!picked) {
    const named = page.getByText(savedName, { exact: false }).first();
    picked = await named.isVisible().catch(() => false)
      ? await named.click({ timeout: 8000 }).then(() => true).catch(() => false)
      : false;
  }
  if (!picked) {
    await input.fill('').catch(() => {});
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    if (digits) await page.keyboard.type(digits, { delay: 120 });
    await pause(page, 3000);
    const byDigits = digits
      ? await clickExactText(page, new RegExp(digits), { skipChatList: true, skipEditable: true })
      : false;
    if (await alreadyAdded.isVisible().catch(() => false)) {
      return { outcome: 'added_confirmed', reason: 'already_in_group', contact: { ...contact, ...verified } };
    }
    if (!byDigits) {
      return { outcome: 'not_selectable', reason: 'number_not_recognized', contact: { ...contact, ...verified } };
    }
  }
  if (await alreadyAdded.isVisible().catch(() => false)) {
    return { outcome: 'added_confirmed', reason: 'already_in_group', contact: { ...contact, ...verified } };
  }
  await pause(page, 2000);
  const confirmed = await clickAddConfirm(page);
  if (!confirmed) {
    const sent = await sendPrivateInvite(page, contact, verified);
    if (sent) return sent;
    return { outcome: 'ui_unavailable', reason: 'add_control_missing', contact: { ...contact, ...verified } };
  }
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await confirmAddDialog(page)) await pause(page, 1500);
    const sent = await sendPrivateInvite(page, contact, verified);
    if (sent) return sent;
    if (await membershipNoticeVisible(page)) {
      return { outcome: 'added_confirmed', reason: 'whatsapp_added_notice', contact: { ...contact, ...verified } };
    }
    await pause(page, 500);
  }
  return { outcome: 'submitted_unconfirmed', reason: 'no_membership_callback', contact: { ...contact, ...verified } };
}

async function openAddPanel(page, groupName) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const infoOpen = await page.getByText(/^group info$/i).first().isVisible().catch(() => false);
    if (!infoOpen) {
      const title = page.locator('#main header').getByText(groupName, { exact: false }).first();
      if (await title.isVisible().catch(() => false)) {
        await title.click({ timeout: 8000 }).catch(() => {});
      } else {
        await page.locator('#main header').first().click({ timeout: 8000 }).catch(() => {});
      }
      await pause(page, 1500);
    }
    await dismissWhatsAppPopups(page);
    let clicked = await clickExactText(page, /^add member$/i, { skipChatList: true, skipEditable: true });
    if (!clicked) {
      const groupAdd = page.getByRole('button', { name: /^add$/i }).last();
      clicked = await groupAdd.click({ timeout: 4000 }).then(() => true).catch(() => false);
    }
    if (!clicked) clicked = await clickExactText(page, /^add$/i, { skipChatList: true, skipEditable: true });
    await pause(page, 2500);
    const byPlaceholder = page.getByPlaceholder(/search name or number|name or number/i).last();
    const byRole = page.getByRole('textbox', { name: /search name or number|search contacts/i }).last();
    if (await byPlaceholder.isVisible().catch(() => false)) return byPlaceholder;
    if (await byRole.isVisible().catch(() => false)) return byRole;
    await page.keyboard.press('Escape').catch(() => {});
    await pause(page, 1000);
  }
  return null;
}

async function sendPrivateInvite(page, contact, verified) {
  const refused = await page.getByText(/couldn.t add|could not add|invite them privately/i).first().isVisible().catch(() => false);
  if (!refused) return null;
  await pause(page, 1200);
  const invited = await clickPrivateInvite(page);
  if (!invited) {
    return { outcome: 'privacy_restricted', reason: 'privacy_restriction', contact: { ...contact, ...verified } };
  }
  await pause(page, 3000);
  const composerOpen = await page.getByText(/send invite to/i).first().isVisible().catch(() => false);
  if (!composerOpen) {
    return { outcome: 'submitted_unconfirmed', reason: 'private_invite_not_opened', contact: { ...contact, ...verified } };
  }
  const clickedSend = await confirmInviteSend(page);
  if (!clickedSend) {
    return { outcome: 'submitted_unconfirmed', reason: 'private_invite_not_sent', contact: { ...contact, ...verified } };
  }
  await pause(page, 3000);
  const stillOpen = await page.getByText(/send invite to/i).first().isVisible().catch(() => false);
  if (stillOpen) {
    return { outcome: 'submitted_unconfirmed', reason: 'private_invite_not_sent', contact: { ...contact, ...verified } };
  }
  return { outcome: 'invite_sent', reason: 'private_invite_sent', contact: { ...contact, ...verified } };
}

async function membershipNoticeVisible(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (/you added |already added to group/i.test(value) && parent && !parent.closest('#pane-side')) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width >= 4 && rect.height >= 4) return true;
      }
      node = walker.nextNode();
    }
    return false;
  }).catch(() => false);
}

async function clickPrivateInvite(page) {
  const byText = await clickExactText(page, /^invite to group$/i, { skipChatList: true, skipEditable: true });
  if (byText) return true;
  const button = page.getByRole('button', { name: /^invite to group$/i }).last();
  if (await button.isVisible().catch(() => false)) {
    return button.click({ timeout: 8000 }).then(() => true).catch(() => false);
  }
  return false;
}

async function confirmInviteSend(page) {
  const point = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let preview = null;
    let node = walker.nextNode();
    while (node) {
      const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/whatsapp group invite/i.test(value)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width >= 4 && rect.height >= 4 && !node.parentElement?.closest('#pane-side')) {
          preview = rect;
          break;
        }
      }
      node = walker.nextNode();
    }
    if (!preview) return null;
    const hits = [];
    for (const el of document.querySelectorAll('button, [role="button"], span[data-icon]')) {
      if (el.closest('#pane-side')) continue;
      const label = (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim();
      if (/^close$|^cancel$/i.test(label)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 28 || rect.height < 28 || rect.width > 80) continue;
      const besidePreview = rect.left >= preview.right - 20
        && Math.abs((rect.top + rect.bottom) / 2 - (preview.top + preview.bottom) / 2) < 70;
      if (!besidePreview) continue;
      const iconName = el.getAttribute('data-icon') || el.querySelector('[data-icon]')?.getAttribute('data-icon') || '';
      hits.push({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        send: /send/i.test(label) || /send/i.test(iconName) ? 1 : 0,
      });
    }
    hits.sort((a, b) => b.send - a.send);
    return hits[0] || null;
  }).catch(() => null);
  if (!point) return false;
  await page.mouse.click(point.x, point.y).catch(() => {});
  return true;
}

async function confirmAddDialog(page) {
  const point = await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const text = (dialog.innerText || '').replace(/\s+/g, ' ');
      if (!/add .+ to .+ group/i.test(text)) continue;
      for (const el of dialog.querySelectorAll('button, [role="button"]')) {
        const label = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (!/^add member$/i.test(label)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 16) continue;
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  }).catch(() => null);
  if (!point) return false;
  await page.mouse.click(point.x, point.y).catch(() => {});
  return true;
}

async function clickAddConfirm(page) {
  const point = await page.evaluate(() => {
    const hits = [];
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (el.closest('#pane-side')) continue;
      const label = (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim();
      const iconName = el.querySelector('[data-icon]')?.getAttribute('data-icon') || '';
      const rect = el.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      const isCheck = /check/i.test(iconName);
      const isAdd = /^add member$/i.test(label);
      if (isCheck || (isAdd && rect.width <= 180)) {
        hits.push({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          bottom: rect.bottom,
          check: isCheck ? 1 : 0,
        });
      }
    }
    hits.sort((a, b) => b.check - a.check || b.bottom - a.bottom);
    return hits[0] || null;
  }).catch(() => null);
  if (!point) return false;
  await page.mouse.click(point.x, point.y).catch(() => {});
  return true;
}
