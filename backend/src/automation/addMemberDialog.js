export function addedNoticeMatches(text, name) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return false;
  const added = value.match(/^you added\s+(.+)$/i);
  return Boolean(added && added[1].trim().toLowerCase() === wanted);
}

export function planAddMemberDialog(wanted) {
  const target = String(wanted || '').trim().toLowerCase();
  const card = findAddMemberCard();
  if (!card) return { open: false, confirm: null, removes: [], select: null, close: null };
  const cardRect = card.getBoundingClientRect();
  const texts = visibleTexts(card);
  const contactsLabel = texts.find((item) => /^contacts$/i.test(item.value));
  const contactsTop = contactsLabel ? contactsLabel.rect.top : cardRect.top + 180;
  const search = card.querySelector('input, textarea, [contenteditable="true"]');
  const searchBottom = search ? search.getBoundingClientRect().bottom : cardRect.top + 80;
  const chips = texts.filter((item) => (
    item.rect.top >= searchBottom - 6
    && item.rect.bottom <= contactsTop + 8
    && item.value.length >= 2
    && item.value.length <= 40
    && !/^add member$/i.test(item.value)
    && !/^contacts$/i.test(item.value)
    && !/^x$/i.test(item.value)
  ));
  const removes = chips
    .filter((chip) => !sameContact(chip.value, target))
    .map((chip) => ({
      x: chip.rect.right + 14,
      y: chip.rect.top + chip.rect.height / 2,
    }));
  const hasTarget = chips.some((chip) => sameContact(chip.value, target));
  const listRow = texts
    .filter((item) => item.rect.top > contactsTop + 4 && sameContact(item.value, target))
    .sort((a, b) => b.rect.top - a.rect.top)[0];
  const select = hasTarget || !listRow
    ? null
    : { x: listRow.rect.left + listRow.rect.width / 2, y: listRow.rect.top + listRow.rect.height / 2 };
  const onlyTarget = hasTarget && removes.length === 0;
  const title = texts.find((item) => /^add member$/i.test(item.value));
  return {
    open: true,
    confirm: onlyTarget ? confirmPoint(card, cardRect) : null,
    removes,
    select,
    close: {
      x: Math.max(cardRect.left + 16, (title?.rect.left || cardRect.left + 34) - 18),
      y: cardRect.top + 28,
    },
  };

  function sameContact(value, name) {
    const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!name) return false;
    if (text === name) return true;
    const wantedDigits = name.replace(/\D/g, '');
    if (wantedDigits.length < 8) return false;
    return text.replace(/\D/g, '').endsWith(wantedDigits);
  }

  function findAddMemberCard() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let heading = null;
    while (node) {
      const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (/^add member$/i.test(value) && parent && !parent.closest('#pane-side')) {
        const rect = parent.getBoundingClientRect();
        if (rect.width >= 8 && rect.height >= 8) {
          heading = parent;
          break;
        }
      }
      node = walker.nextNode();
    }
    if (!heading) return null;
    let panel = heading.parentElement;
    while (panel && panel !== document.body) {
      const rect = panel.getBoundingClientRect();
      const hasSearch = Boolean(panel.querySelector('input, textarea, [contenteditable="true"]'));
      if (hasSearch && rect.width >= 260 && rect.width <= 560 && rect.height >= 280 && rect.height <= 760) return panel;
      panel = panel.parentElement;
    }
    return null;
  }

  function visibleTexts(root) {
    const texts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (!value || !parent || parent.closest('input, textarea, [contenteditable="true"]')) {
        node = walker.nextNode();
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width >= 4 && rect.height >= 4) texts.push({ value, rect });
      node = walker.nextNode();
    }
    return texts;
  }

  function confirmPoint(box, boxRect) {
    const cornerX = boxRect.right - 40;
    const cornerY = boxRect.bottom - 40;
    let best = null;
    for (const el of box.querySelectorAll('button, [role="button"], div, span')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 32 || rect.width > 76 || rect.height < 32 || rect.height > 76) continue;
      if (Math.abs(rect.width - rect.height) > 16) continue;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const distance = Math.hypot(x - cornerX, y - cornerY);
      if (distance > 48) continue;
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    return best ? { x: best.x, y: best.y } : { x: cornerX, y: cornerY };
  }
}
