import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chromium } from 'playwright';
import { addedNoticeMatches, planAddMemberDialog } from '../src/automation/addMemberDialog.js';

const dialogHtml = `<!doctype html>
<meta charset="utf-8">
<body style="margin:0">
  <div id="pane-side" style="width:420px;height:800px">Sample group</div>
  <div id="shell" style="position:absolute;left:0;top:0;width:1100px;height:800px">
    <button id="decoy" style="position:absolute;right:16px;bottom:16px;width:48px;height:48px">decoy</button>
    <div id="card" style="position:absolute;left:340px;top:70px;width:400px;height:520px;background:#fff">
      <div style="height:48px;line-height:48px;padding-left:40px">Add member</div>
      <input placeholder="Search name, number or @username" style="display:block;width:340px;height:36px;margin:0 16px">
      <div style="margin:16px">
        <span id="phone">+91 96521 99180</span><button id="phone-x" style="width:16px;height:16px;margin-left:4px">x</button>
        <span id="shaik" style="margin-left:24px">shaik</span><button id="shaik-x" style="width:16px;height:16px;margin-left:4px">x</button>
      </div>
      <div style="margin-left:16px">Contacts</div>
      <div style="padding:10px 16px">+91 90145 37403</div>
      <div id="other-row" style="padding:10px 16px">+91 96521 99180</div>
      <button id="confirm" style="position:absolute;right:16px;bottom:16px;width:48px;height:48px">confirm</button>
    </div>
  </div>
</body>`;

describe('membership notice', () => {
  it('accepts only the named person, not an older you-added line', () => {
    assert.equal(addedNoticeMatches('You added shaik', 'shaik'), true);
    assert.equal(addedNoticeMatches('You added adepu sukumar', 'shaik'), false);
    assert.equal(addedNoticeMatches('You added Shaik Jumlesha', 'shaik'), false);
  });
});

describe('add member dialog', () => {
  it('clears the extra contact and presses the confirm button inside the card', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    try {
      await page.setContent(dialogHtml);
      const both = await page.evaluate(planAddMemberDialog, 'shaik');
      const phoneX = await page.locator('#phone-x').boundingBox();
      const otherRow = await page.locator('#other-row').boundingBox();
      const confirm = await page.locator('#confirm').boundingBox();
      const decoy = await page.locator('#decoy').boundingBox();
      assert.equal(both.open, true);
      assert.equal(both.confirm, null);
      assert.equal(both.removes.length, 1);
      assert.ok(inside(both.removes[0], phoneX));
      assert.equal(inside(both.removes[0], otherRow), false);

      await page.locator('#phone').evaluate((node) => node.remove());
      await page.locator('#phone-x').evaluate((node) => node.remove());
      const onlyShaik = await page.evaluate(planAddMemberDialog, 'shaik');
      assert.equal(onlyShaik.removes.length, 0);
      assert.ok(onlyShaik.confirm);
      assert.ok(inside(onlyShaik.confirm, confirm));
      assert.equal(inside(onlyShaik.confirm, decoy), false);
    } finally {
      await browser.close();
    }
  });
});

function inside(point, box) {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}
