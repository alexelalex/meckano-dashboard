// meckano-dashboard/engine.js
// Robust Playwright automation engine for Meckano attendance reporting in Termux

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '0';
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (_) {
  ({ chromium } = require('/data/data/com.termux/files/home/playwright-termux/node_modules/playwright-core'));
}

const TERMUX_CHROMIUM = '/data/data/com.termux/files/usr/bin/chromium-browser';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || (fs.existsSync(TERMUX_CHROMIUM) ? TERMUX_CHROMIUM : undefined);
const SCREENSHOT_DOWNLOAD = '/sdcard/Download/meckano_report.png';
const SCREENSHOT_LOCAL = path.join(__dirname, 'public', 'latest_report.png');

async function runMeckanoReport({
  email,
  password,
  cycleOffset = -1, // -1: Previous cycle, 0: Current cycle
  daysConfig = {},   // Map of date string or day number -> { status, checkIn, checkOut }
  defaultCheckIn = '10:00',
  defaultCheckOut = '19:00',
  dryRun = false,
  onLog = console.log
}) {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  onLog(`[1/6] Launching Chromium browser...`);
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    onLog(`[2/6] Navigating to Meckano login...`);
    await page.goto('https://app.meckano.co.il/login.php', { waitUntil: 'networkidle', timeout: 30000 });

    onLog(`Entering credentials...`);
    // CRITICAL: Must use input#email to avoid collision with SVG <symbol id="email">
    await page.fill('input#email', email);
    await page.fill('input#password', password);
    await page.click('input.login');

    await page.waitForTimeout(3000);

    // Check for login errors
    const errorEl = await page.$('.loginNotification:visible, .input-error');
    if (errorEl) {
      const errText = await page.locator('.loginNotification').innerText().catch(() => '');
      if (errText && errText.trim()) {
        throw new Error(`Login failed: ${errText.trim()}`);
      }
    }

    // Check for 2FA / OTP code
    const otpInput = await page.$('.otp-number-input, #verificationCodeSMS');
    if (otpInput && await otpInput.isVisible()) {
      throw new Error('2FA / SMS verification code is required by Meckano. Please complete 2FA in the browser.');
    }

    await page.waitForURL(url => !url.pathname.includes('login.php'), { timeout: 15000 }).catch(() => {});
    onLog(`Logged in successfully! Current page: ${page.url()}`);

    onLog(`[3/6] Navigating to Monthly Employee Report...`);
    await page.evaluate(() => {
      if (window.Application && window.Application.menu && typeof window.Application.menu.openEmployeeMonthlyReport === 'function') {
        window.Application.menu.openEmployeeMonthlyReport();
      } else {
        const el = document.getElementById('li-monthly-employee-report') ||
                   document.querySelector('#li-monthly-employee-report, a.employeeReport');
        if (el) el.click();
      }
    });
    await page.waitForTimeout(3500);

    // Month Cycle Navigation
    if (cycleOffset === -1) {
      onLog(`[4/6] Switching to previous payroll month...`);
      // In Meckano RTL layout: img.arrowRightImg is "חודש אחורה" (Previous month)
      const arrowRight = page.locator('img.arrowRightImg, .arrowRightImg').first();
      if (await arrowRight.isVisible()) {
        await arrowRight.click();
        await page.waitForTimeout(4000);
      } else {
        onLog(`Warning: Previous month arrow not found, trying router navigation...`);
        await page.evaluate(() => {
          const now = new Date();
          let prevM = now.getMonth();
          let prevY = now.getFullYear();
          if (prevM === 0) { prevM = 12; prevY--; }
          if (window.Application && typeof window.Application.datesForWorkMonth === 'function' && window.Application.router) {
            const dates = window.Application.datesForWorkMonth(prevM, prevY, '-');
            if (dates && dates.start && dates.end) {
              window.Application.router.navigate(`report/${dates.start}/${dates.end}`, true);
            }
          }
        });
        await page.waitForTimeout(4000);
      }
    } else {
      onLog(`[4/6] Staying on current payroll month.`);
    }

    const currentRange = await page.evaluate(() => {
      const el = document.querySelector('div.report-month-selector-button, div.date-selection, span.date-text');
      return el ? el.innerText.replace(/\s+/g, ' ').trim() : 'Active Month';
    });
    onLog(`Selected report period: ${currentRange}`);

    onLog(`Opening Quick Edit ("עריכה מהירה")...`);
    await page.evaluate(() => {
      const quickEdit = document.querySelector('a.free-reporting, button.free-reporting, [class*="free-reporting"]');
      if (quickEdit) quickEdit.click();
    });
    await page.waitForTimeout(2500);
    await page.waitForSelector('table.hours-report, .hours-report', { timeout: 15000 });

    onLog(`[5/6] Applying schedule and vacation rules to table rows...`);
    const applyResult = await page.evaluate(({ daysConfig, defaultCheckIn, defaultCheckOut }) => {
      const rows = Array.from(document.querySelectorAll('table.hours-report tr, .hours-report tr'));
      const $ = window.jQuery;

      let workCount = 0;
      let fullVacCount = 0;
      let halfVacCount = 0;
      let sickCount = 0;
      let offCount = 0;
      const details = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dayText = (row.querySelector('td:first-child')?.innerText || row.innerText || '').trim();
        const dateEl = row.querySelector('.dateText, .date, td:nth-child(2)');
        const dateStr = dateEl ? dateEl.innerText.trim() : '';

        // Extract day number (e.g. "20" from "20/09/2026")
        const dateMatch = dateStr.match(/(\d{1,2})[\/\.-](\d{1,2})/);
        const dayNum = dateMatch ? parseInt(dateMatch[1], 10) : null;
        const monthNum = dateMatch ? parseInt(dateMatch[2], 10) : null;
        const keyDay = dayNum !== null ? String(dayNum) : null;
        const keyFull = dateMatch ? `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}` : null;

        // Match weekend day letter (ו or ש) right after the date, or explicit weekend names
        const isWeekend = /(?:\d{1,2}[\/\.-]\d{1,2}(?:[\/\.-]\d{2,4})?\s+[וש](?:\s|$))|שישי|שבת|Fri|Sat/i.test(dayText);
        // Match full holiday ("חג") but not "ערב חג" or "חול המועד"
        const isHoliday = /(?:^|\s)חג(?:\s|$)/.test(dayText) && !/ערב חג|חול המועד/.test(dayText);

        const inInput = row.querySelector('input.checkIn, .checkIn input, input[name*="checkIn"]');
        const outInput = row.querySelector('input.checkOut, .checkOut input, input[name*="checkOut"]');
        const select = row.querySelector('select.select-box, select[name*="absence"], select');

        if (!inInput || !outInput) continue;

        // Check custom status from daysConfig: matches YYYY-MM-DD, DD/MM, or dayNum
        let conf = null;
        if (daysConfig) {
          conf = daysConfig[keyFull] || daysConfig[keyDay];
          if (!conf && dateMatch) {
            // Check YYYY-MM-DD formats
            for (const k of Object.keys(daysConfig)) {
              if (k.includes(`${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`) ||
                  k.endsWith(`-${dateMatch[1].padStart(2, '0')}`)) {
                conf = daysConfig[k];
                break;
              }
            }
          }
        }

        const status = (isWeekend || isHoliday) ? 'off' : (conf ? conf.status : 'work');

        if (status === 'vacation') {
          // Full Vacation: Clear hours, set "חופש" / "חופשה"
          $(row).find('input.checkIn').val('').trigger('input').trigger('change').trigger('blur');
          $(row).find('input.checkOut').val('').trigger('input').trigger('change').trigger('blur');

          if (select) {
            const options = Array.from(select.options);
            const target = options.find(o => o.text.includes('חופשה') || o.text.includes('חופש') || o.text.toLowerCase().includes('vacation'));
            if (target) {
              select.value = target.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          fullVacCount++;
          details.push({ date: dateStr, day: dayText, status: 'חופש' });
        } else if (status === 'half_vacation') {
          // Half-Day Vacation: Clear hours, set "חצי יום חופש"
          $(row).find('input.checkIn').val('').trigger('input').trigger('change').trigger('blur');
          $(row).find('input.checkOut').val('').trigger('input').trigger('change').trigger('blur');

          if (select) {
            const options = Array.from(select.options);
            let target = options.find(o => o.text.includes('חצי יום חופש') || o.text.includes('חצי חופש') || o.text.includes('חצי יום'));
            if (!target) {
              target = options.find(o => o.text.includes('חופש') || o.text.includes('חופשה'));
            }
            if (target) {
              select.value = target.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          halfVacCount++;
          details.push({ date: dateStr, day: dayText, status: 'חצי יום חופש' });
        } else if (status === 'sick') {
          // Sick Day: Clear hours, set "מחלה"
          $(row).find('input.checkIn').val('').trigger('input').trigger('change').trigger('blur');
          $(row).find('input.checkOut').val('').trigger('input').trigger('change').trigger('blur');

          if (select) {
            const options = Array.from(select.options);
            const target = options.find(o => o.text.includes('מחלה') || o.text.toLowerCase().includes('sick'));
            if (target) {
              select.value = target.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          sickCount++;
          details.push({ date: dateStr, day: dayText, status: 'מחלה' });
        } else if (status === 'work') {
          // Standard Work Day: Fill 10:00 - 19:00, clear absence
          const inVal = (conf && conf.checkIn) || defaultCheckIn || '10:00';
          const outVal = (conf && conf.checkOut) || defaultCheckOut || '19:00';

          inInput.value = inVal;
          inInput.dispatchEvent(new Event('input', { bubbles: true }));
          inInput.dispatchEvent(new Event('change', { bubbles: true }));

          outInput.value = outVal;
          outInput.dispatchEvent(new Event('input', { bubbles: true }));
          outInput.dispatchEvent(new Event('change', { bubbles: true }));

          if (select && select.value !== '0') {
            select.value = '0';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          workCount++;
          details.push({ date: dateStr, day: dayText, status: `עבודה (${inVal}-${outVal})` });
        } else if (status === 'off') {
          // Day off or weekend: clear hours and set absence to '0'
          if (!isWeekend && !isHoliday) {
            $(row).find('input.checkIn').val('').trigger('input').trigger('change').trigger('blur');
            $(row).find('input.checkOut').val('').trigger('input').trigger('change').trigger('blur');
            if (select && select.value !== '0') {
              select.value = '0';
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          offCount++;
        }
      }

      return { workCount, fullVacCount, halfVacCount, sickCount, offCount, details };
    }, { daysConfig, defaultCheckIn, defaultCheckOut });

    onLog(`Results calculated:`);
    onLog(`- Work days: ${applyResult.workCount}`);
    onLog(`- Full Vacation days: ${applyResult.fullVacCount}`);
    onLog(`- Half Vacation days: ${applyResult.halfVacCount}`);
    onLog(`- Sick days: ${applyResult.sickCount}`);

    if (dryRun) {
      onLog(`[6/6] Dry run mode enabled: skipping submission.`);
    } else {
      onLog(`[6/6] Submitting changes to Meckano...`);
      const submitBtn = page.locator('button.update-freeReporting, button.btn-update, button:has-text("עדכון")').first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        onLog(`Submitted! Waiting for Meckano to finish saving...`);
        // Wait for the Quick Edit modal / "המערכת מעדכנת את הדיווחים" overlay to close
        await page.waitForFunction(() => {
          const modal = document.querySelector('table.hours-report, .hours-report');
          const bodyText = document.body ? document.body.innerText : '';
          const isUpdating = bodyText.includes('המערכת מעדכנת את הדיווחים');
          const modalVisible = modal && modal.offsetParent !== null;
          return !isUpdating && !modalVisible;
        }, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
        onLog(`✅ Changes successfully saved in Meckano!`);
      } else {
        onLog(`⚠️ Submit button not found automatically. Fields remain filled.`);
      }
    }

    // Capture confirmation screenshot
    onLog(`Capturing screenshot...`);
    try {
      await page.screenshot({ path: SCREENSHOT_DOWNLOAD, fullPage: true });
      onLog(`📸 Saved to ${SCREENSHOT_DOWNLOAD}`);
    } catch (e) {
      onLog(`Note: Couldn't write to /sdcard/Download: ${e.message}`);
    }

    try {
      await page.screenshot({ path: SCREENSHOT_LOCAL, fullPage: true });
      onLog(`📸 Saved local copy to ${SCREENSHOT_LOCAL}`);
    } catch (e) {}

    return {
      success: true,
      period: currentRange,
      dryRun,
      stats: applyResult
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  runMeckanoReport,
  SCREENSHOT_DOWNLOAD,
  SCREENSHOT_LOCAL
};
