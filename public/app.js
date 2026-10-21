// meckano-dashboard/public/app.js

document.addEventListener('DOMContentLoaded', () => {
  // State
  let currentOffset = -1; // Default to previous month report (most common use case)
  let currentDays = [];
  let config = {};
  let selectedDay = null;

  // DOM Elements
  const btnToggleSettings = document.getElementById('btnToggleSettings');
  const settingsCard = document.getElementById('settingsCard');
  const settingsForm = document.getElementById('settingsForm');
  const inputEmail = document.getElementById('inputEmail');
  const inputPassword = document.getElementById('inputPassword');
  const btnTogglePass = document.getElementById('btnTogglePass');
  const inputDefaultIn = document.getElementById('inputDefaultIn');
  const inputDefaultOut = document.getElementById('inputDefaultOut');
  const envStatusBadge = document.getElementById('envStatusBadge');
  const saveStatusText = document.getElementById('saveStatusText');

  const btnPrevCycle = document.getElementById('btnPrevCycle');
  const btnNextCycle = document.getElementById('btnNextCycle');
  const cyclePeriodLabel = document.getElementById('cyclePeriodLabel');
  const cycleStatusBadge = document.getElementById('cycleStatusBadge');

  const statWorkCount = document.getElementById('statWorkCount');
  const statVacCount = document.getElementById('statVacCount');
  const statHalfVacCount = document.getElementById('statHalfVacCount');
  const statSickCount = document.getElementById('statSickCount');

  const calendarGrid = document.getElementById('calendarGrid');
  const calendarList = document.getElementById('calendarList');
  const weekdaysGrid = document.getElementById('weekdaysGrid');
  const btnViewGrid = document.getElementById('btnViewGrid');
  const btnViewList = document.getElementById('btnViewList');

  const btnDryRun = document.getElementById('btnDryRun');
  const btnSubmitMeckano = document.getElementById('btnSubmitMeckano');

  const screenshotImg = document.getElementById('screenshotImg');
  const noScreenshotMsg = document.getElementById('noScreenshotMsg');
  const btnRefreshScreenshot = document.getElementById('btnRefreshScreenshot');

  // Day Modal Elements
  const dayModal = document.getElementById('dayModal');
  const modalDateTitle = document.getElementById('modalDateTitle');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const statusOptBtns = document.querySelectorAll('.status-opt-btn');
  const customHoursRow = document.getElementById('customHoursRow');
  const modalCheckIn = document.getElementById('modalCheckIn');
  const modalCheckOut = document.getElementById('modalCheckOut');
  const btnSaveDayChange = document.getElementById('btnSaveDayChange');

  // Progress Modal Elements
  const progressModal = document.getElementById('progressModal');
  const progressTitle = document.getElementById('progressTitle');
  const terminalLogs = document.getElementById('terminalLogs');
  const progressFooter = document.getElementById('progressFooter');
  const btnDismissProgress = document.getElementById('btnDismissProgress');
  const btnCloseProgress = document.getElementById('btnCloseProgress');

  // 1. Fetch Config
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      config = await res.json();
      inputEmail.value = config.email || '';
      inputDefaultIn.value = config.defaultIn || '10:00';
      inputDefaultOut.value = config.defaultOut || '19:00';

      if (config.hasPassword) {
        envStatusBadge.textContent = 'סיסמה שמורה ✓';
        envStatusBadge.style.color = '#34d399';
        inputPassword.placeholder = 'סיסמה שמורה (השאר ריק כדי לא לשנות)';
      } else {
        envStatusBadge.textContent = 'דרושה סיסמה ⚠️';
        envStatusBadge.style.color = '#f87171';
        settingsCard.classList.remove('collapsed');
      }
    } catch (err) {
      console.error('Error loading config:', err);
      envStatusBadge.textContent = 'שגיאת טעינה';
    }
  }

  // 2. Save Config
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveStatusText.textContent = 'שומר...';
    try {
      const payload = {
        email: inputEmail.value.trim(),
        defaultIn: inputDefaultIn.value,
        defaultOut: inputDefaultOut.value
      };
      if (inputPassword.value.trim()) {
        payload.password = inputPassword.value.trim();
      }

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        saveStatusText.textContent = 'נשמר בהצלחה! ✓';
        inputPassword.value = '';
        await loadConfig();
        setTimeout(() => { saveStatusText.textContent = ''; }, 3000);
      } else {
        saveStatusText.textContent = `שגיאה: ${data.error}`;
      }
    } catch (err) {
      saveStatusText.textContent = 'שגיאה ברשת';
    }
  });

  // Toggle Settings Collapse
  btnToggleSettings.addEventListener('click', () => {
    settingsCard.classList.toggle('collapsed');
  });

  // Toggle Password Visibility
  btnTogglePass.addEventListener('click', () => {
    inputPassword.type = inputPassword.type === 'password' ? 'text' : 'password';
  });

  // 3. Load Calendar Days
  async function loadCalendar(offset) {
    currentOffset = offset;
    calendarGrid.innerHTML = '<div class="loading-spinner">טוען ימים...</div>';

    // Update cycle nav buttons styling
    btnPrevCycle.classList.toggle('active', offset === -1);
    btnNextCycle.classList.toggle('active', offset === 0);

    try {
      const res = await fetch(`/api/calendar?offset=${offset}`);
      const data = await res.json();
      currentDays = data.days;
      cyclePeriodLabel.textContent = data.periodLabel;
      cycleStatusBadge.textContent = offset === -1 ? 'מחזור קודם (מוכן לדיווח)' : 'מחזור נוכחי';

      renderCalendar();
      updateStats();
    } catch (err) {
      console.error('Error loading calendar:', err);
      calendarGrid.innerHTML = '<div class="loading-spinner">שגיאה בטעינת לוח הימים</div>';
    }
  }

  // View Switcher Handlers
  btnViewGrid.addEventListener('click', () => {
    btnViewGrid.classList.add('active');
    btnViewList.classList.remove('active');
    weekdaysGrid.style.display = 'grid';
    calendarGrid.style.display = 'grid';
    calendarList.style.display = 'none';
  });

  btnViewList.addEventListener('click', () => {
    btnViewList.classList.add('active');
    btnViewGrid.classList.remove('active');
    weekdaysGrid.style.display = 'none';
    calendarGrid.style.display = 'none';
    calendarList.style.display = 'flex';
  });

  // 4. Render Calendar (both Grid and List views)
  function renderCalendar() {
    calendarGrid.innerHTML = '';
    calendarList.innerHTML = '';
    if (!currentDays || currentDays.length === 0) return;

    // First day of cycle offset in week (0 is Sunday, 6 is Saturday)
    const firstDayOfWeek = currentDays[0].dayOfWeek;
    for (let i = 0; i < firstDayOfWeek; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'day-tile empty-slot';
      calendarGrid.appendChild(emptyCell);
    }

    currentDays.forEach((day, index) => {
      const statusMeta = getStatusMeta(day);

      // --- 1. Compact Grid Tile (Zero Overflow) ---
      const tile = document.createElement('div');
      tile.className = `day-tile status-${day.status}`;
      tile.dataset.index = index;

      const header = document.createElement('div');
      header.className = 'day-header-mini';
      header.innerHTML = `
        <span class="day-num">${day.dayNum}</span>
        <span class="day-date-mini">${day.displayDate}</span>
      `;

      const pill = document.createElement('div');
      pill.className = 'day-status-pill';
      pill.innerHTML = `<span class="pill-icon">${statusMeta.icon}</span><span class="pill-text"> ${statusMeta.shortLabel}</span>`;

      tile.appendChild(header);
      tile.appendChild(pill);

      tile.addEventListener('click', () => {
        openDayModal(day, index);
      });

      calendarGrid.appendChild(tile);

      // --- 2. Detailed List Row (Agenda View) ---
      const listRow = document.createElement('div');
      listRow.className = `list-day-row status-${day.status}`;
      listRow.dataset.index = index;
      listRow.innerHTML = `
        <div class="list-day-info">
          <span class="list-day-date">${day.displayDate} &bull; ${day.dayNameHe}</span>
          <span class="list-day-sub">${day.isWeekend ? 'סוף שבוע' : 'יום עבודה'}</span>
        </div>
        <div class="list-day-status">
          <span class="list-status-badge status-${day.status}">
            ${statusMeta.icon} ${statusMeta.fullLabel}
          </span>
          <span class="list-edit-icon">✏️</span>
        </div>
      `;
      listRow.addEventListener('click', () => {
        openDayModal(day, index);
      });
      calendarList.appendChild(listRow);
    });
  }

  function getStatusMeta(day) {
    switch (day.status) {
      case 'work':
        return {
          icon: '💼',
          shortLabel: `${(day.checkIn || '10:00').slice(0, 2)}-${(day.checkOut || '19:00').slice(0, 2)}`,
          fullLabel: `${day.checkIn || '10:00'} - ${day.checkOut || '19:00'}`
        };
      case 'vacation':
        return { icon: '🏖️', shortLabel: 'חופש', fullLabel: 'יום חופש מלא' };
      case 'half_vacation':
        return { icon: '🌗', shortLabel: 'חצי', fullLabel: 'חצי יום חופש' };
      case 'sick':
        return { icon: '🤒', shortLabel: 'מחלה', fullLabel: 'יום מחלה' };
      case 'off':
        return { icon: '⚪', shortLabel: day.isWeekend ? 'סופ״ש' : 'חופשי', fullLabel: day.isWeekend ? 'סוף שבוע' : 'יום חופשי' };
      default:
        return { icon: '⚪', shortLabel: day.status, fullLabel: day.status };
    }
  }

  // 5. Update Stats
  function updateStats() {
    let work = 0, vac = 0, half = 0, sick = 0;
    currentDays.forEach(d => {
      if (d.status === 'work') work++;
      else if (d.status === 'vacation') vac++;
      else if (d.status === 'half_vacation') half++;
      else if (d.status === 'sick') sick++;
    });

    statWorkCount.textContent = work;
    statVacCount.textContent = vac;
    statHalfVacCount.textContent = half;
    statSickCount.textContent = sick;
  }

  // Cycle navigation click listeners
  btnPrevCycle.addEventListener('click', () => loadCalendar(-1));
  btnNextCycle.addEventListener('click', () => loadCalendar(0));

  // 6. Day Modal Logic
  let modalTempStatus = 'work';

  function openDayModal(day, index) {
    selectedDay = { ...day, index };
    modalTempStatus = day.status;

    modalDateTitle.textContent = `${day.dayNameHe} | ${day.displayDate}/${day.year}`;
    modalCheckIn.value = day.checkIn || inputDefaultIn.value || '10:00';
    modalCheckOut.value = day.checkOut || inputDefaultOut.value || '19:00';

    updateModalSelectedStatus(modalTempStatus);
    dayModal.style.display = 'flex';
  }

  function updateModalSelectedStatus(status) {
    modalTempStatus = status;
    statusOptBtns.forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.status === status);
    });
    customHoursRow.style.display = status === 'work' ? 'flex' : 'none';
  }

  statusOptBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      updateModalSelectedStatus(btn.dataset.status);
    });
  });

  btnSaveDayChange.addEventListener('click', () => {
    if (!selectedDay) return;
    const day = currentDays[selectedDay.index];
    day.status = modalTempStatus;
    if (modalTempStatus === 'work') {
      day.checkIn = modalCheckIn.value;
      day.checkOut = modalCheckOut.value;
    }
    renderCalendar();
    updateStats();
    closeDayModal();
  });

  function closeDayModal() {
    dayModal.style.display = 'none';
    selectedDay = null;
  }

  btnCloseModal.addEventListener('click', closeDayModal);
  dayModal.addEventListener('click', (e) => {
    if (e.target === dayModal) closeDayModal();
  });

  // 7. Run Automation Report
  async function startReportRun(dryRun = false) {
    if (!config.hasPassword && !inputPassword.value.trim()) {
      alert('נא להזין סיסמה בהגדרות כדי להתחבר ל-Meckano.');
      settingsCard.classList.remove('collapsed');
      inputPassword.focus();
      return;
    }

    // Prepare daysConfig map
    const daysConfig = {};
    const vacationDaysList = [];
    const halfVacationDaysList = [];
    const sickDaysList = [];

    currentDays.forEach(d => {
      daysConfig[d.dateStr] = {
        status: d.status,
        checkIn: d.checkIn,
        checkOut: d.checkOut
      };
      daysConfig[d.displayDate] = daysConfig[d.dateStr];
      daysConfig[String(d.dayNum)] = daysConfig[d.dateStr];

      if (d.status === 'vacation') vacationDaysList.push(d.dayNum);
      if (d.status === 'half_vacation') halfVacationDaysList.push(d.dayNum);
      if (d.status === 'sick') sickDaysList.push(d.dayNum);
    });

    // Automatically sync vacation days to ~/.meckano.env for persistence
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vacationDays: vacationDaysList.join(','),
        halfVacationDays: halfVacationDaysList.join(','),
        sickDays: sickDaysList.join(',')
      })
    }).catch(() => {});

    // Open progress modal
    resetProgressUI(dryRun);
    progressModal.style.display = 'flex';

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycleOffset: currentOffset,
          dryRun,
          daysConfig,
          defaultIn: inputDefaultIn.value,
          defaultOut: inputDefaultOut.value
        })
      });

      const data = await res.json();
      if (!data.success) {
        appendLog(`❌ שגיאה: ${data.error}`, 'log-error');
        progressTitle.textContent = 'שגיאה בהרצה';
        progressFooter.style.display = 'block';
        return;
      }

      // Connect to SSE stream
      connectEventStream();
    } catch (err) {
      appendLog(`❌ שגיאת תקשורת: ${err.message}`, 'log-error');
      progressTitle.textContent = 'שגיאה בתקשורת';
      progressFooter.style.display = 'block';
    }
  }

  function resetProgressUI(dryRun) {
    progressTitle.textContent = dryRun ? 'בדיקת דיווח (Dry Run)...' : 'מריץ דיווח ב-Meckano...';
    terminalLogs.innerHTML = '';
    progressFooter.style.display = 'none';
    btnCloseProgress.style.display = 'none';

    for (let i = 1; i <= 6; i++) {
      const el = document.getElementById(`step${i}`);
      el.className = 'step-item';
      el.querySelector('.step-bullet').textContent = i;
    }
  }

  function setStepActive(stepNum) {
    for (let i = 1; i < stepNum; i++) {
      const el = document.getElementById(`step${i}`);
      el.className = 'step-item completed';
      el.querySelector('.step-bullet').textContent = '✓';
    }
    const current = document.getElementById(`step${stepNum}`);
    if (current) current.className = 'step-item active';
  }

  function appendLog(msg, type = '') {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = msg;
    terminalLogs.appendChild(line);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  function connectEventStream() {
    let evtSource = new EventSource('/api/stream');

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.logs && data.logs.length > 0) {
          data.logs.forEach(log => {
            let cls = '';
            if (log.includes('❌') || log.includes('Error') || log.includes('failed')) cls = 'log-error';
            else if (log.includes('🎉') || log.includes('✅') || log.includes('Saved')) cls = 'log-success';
            else if (log.includes('⚠️')) cls = 'log-warn';

            appendLog(log, cls);

            // Step highlights based on message keywords
            if (log.includes('[1/6]')) setStepActive(1);
            else if (log.includes('[2/6]')) setStepActive(2);
            else if (log.includes('[3/6]')) setStepActive(3);
            else if (log.includes('[4/6]')) setStepActive(4);
            else if (log.includes('[5/6]')) setStepActive(5);
            else if (log.includes('[6/6]')) setStepActive(6);
          });
        }

        if (data.status === 'completed') {
          evtSource.close();
          setStepActive(7); // complete all
          progressTitle.textContent = 'הדיווח הושלם בהצלחה! 🎉';
          progressFooter.style.display = 'block';
          btnCloseProgress.style.display = 'block';
          refreshScreenshot();
        } else if (data.status === 'error') {
          evtSource.close();
          progressTitle.textContent = 'אירעה שגיאה בדיווח ❌';
          progressFooter.style.display = 'block';
          btnCloseProgress.style.display = 'block';
        }
      } catch (e) {
        console.error('Error parsing SSE data', e);
      }
    };

    evtSource.onerror = () => {
      evtSource.close();
      // Fallback: poll job-status once
      setTimeout(checkJobStatus, 2000);
    };
  }

  async function checkJobStatus() {
    try {
      const res = await fetch('/api/job-status');
      const data = await res.json();
      if (data.status === 'completed' || data.status === 'error') {
        progressFooter.style.display = 'block';
        btnCloseProgress.style.display = 'block';
        if (data.status === 'completed') {
          setStepActive(7);
          progressTitle.textContent = 'הדיווח הושלם בהצלחה! 🎉';
          refreshScreenshot();
        }
      }
    } catch (_) {}
  }

  btnDismissProgress.addEventListener('click', () => {
    progressModal.style.display = 'none';
  });
  btnCloseProgress.addEventListener('click', () => {
    progressModal.style.display = 'none';
  });

  btnSubmitMeckano.addEventListener('click', () => startReportRun(false));
  btnDryRun.addEventListener('click', () => startReportRun(true));

  // 8. Screenshot refresh
  function refreshScreenshot() {
    screenshotImg.src = `/api/screenshot?t=${Date.now()}`;
    screenshotImg.style.display = 'block';
    noScreenshotMsg.style.display = 'none';
  }

  btnRefreshScreenshot.addEventListener('click', refreshScreenshot);

  // Initialize
  loadConfig();
  loadCalendar(-1);
});
