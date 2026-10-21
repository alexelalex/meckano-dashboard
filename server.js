// meckano-dashboard/server.js
// Local Node.js server for Meckano attendance management

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { runMeckanoReport, SCREENSHOT_DOWNLOAD, SCREENSHOT_LOCAL } = require('./engine');

const PORT = process.env.PORT || 3333;
const ENV_FILE = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.meckano.env');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Global job state for tracking progress & logs
let activeJob = null;

function loadEnv() {
  const env = {
    MECKANO_EMAIL: '',
    MECKANO_PASSWORD: '',
    MECKANO_VACATION_DAYS: '',
    MECKANO_HALF_VACATION_DAYS: '',
    MECKANO_SICK_DAYS: '',
    MECKANO_DEFAULT_IN: '10:00',
    MECKANO_DEFAULT_OUT: '19:00',
    MECKANO_CYCLE_TYPE: '21-20'
  };

  if (fs.existsSync(ENV_FILE)) {
    const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[key] = val;
      }
    }
  }
  return env;
}

function saveEnv(updates) {
  const current = loadEnv();
  const merged = { ...current, ...updates };

  const lines = [
    '# Meckano Configuration',
    `MECKANO_EMAIL=${merged.MECKANO_EMAIL || ''}`,
    `MECKANO_PASSWORD=${merged.MECKANO_PASSWORD || ''}`,
    `MECKANO_VACATION_DAYS=${merged.MECKANO_VACATION_DAYS || ''}`,
    `MECKANO_HALF_VACATION_DAYS=${merged.MECKANO_HALF_VACATION_DAYS || ''}`,
    `MECKANO_SICK_DAYS=${merged.MECKANO_SICK_DAYS || ''}`,
    `MECKANO_DEFAULT_IN=${merged.MECKANO_DEFAULT_IN || '10:00'}`,
    `MECKANO_DEFAULT_OUT=${merged.MECKANO_DEFAULT_OUT || '19:00'}`,
    `MECKANO_CYCLE_TYPE=${merged.MECKANO_CYCLE_TYPE || '21-20'}`
  ];

  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
  return merged;
}

function getCycleDates(offset = 0, cycleType = '21-20') {
  const now = new Date();
  const curDay = now.getDate();
  let baseMonth = now.getMonth(); // 0-11
  let baseYear = now.getFullYear();

  // For 21-20 cycle:
  // If today is on or after the 21st, current cycle (offset 0) ends next month on the 20th.
  // If today is before the 21st, current cycle ends this month on the 20th.
  let endMonth = (curDay >= 21) ? baseMonth + 1 : baseMonth;
  let endYear = baseYear;
  if (endMonth > 11) {
    endMonth -= 12;
    endYear++;
  }

  // Apply offset in months
  endMonth += offset;
  while (endMonth < 0) {
    endMonth += 12;
    endYear--;
  }
  while (endMonth > 11) {
    endMonth -= 12;
    endYear++;
  }

  let startMonth = endMonth - 1;
  let startYear = endYear;
  if (startMonth < 0) {
    startMonth = 11;
    startYear--;
  }

  // Start date: 21st of startMonth
  const startDate = new Date(startYear, startMonth, 21);
  // End date: 20th of endMonth
  const endDate = new Date(endYear, endMonth, 20);

  const days = [];
  const curr = new Date(startDate);

  const env = loadEnv();
  const vacDays = (env.MECKANO_VACATION_DAYS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  const halfVacDays = (env.MECKANO_HALF_VACATION_DAYS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  const sickDays = (env.MECKANO_SICK_DAYS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

  const dayNamesHe = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayShortHe = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

  while (curr <= endDate) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const displayDate = `${d}/${m}`;
    const dayNum = curr.getDate();
    const dayOfWeek = curr.getDay(); // 0 is Sun, 5 is Fri, 6 is Sat
    const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);

    let defaultStatus = isWeekend ? 'off' : 'work';
    if (halfVacDays.includes(dayNum)) {
      defaultStatus = 'half_vacation';
    } else if (vacDays.includes(dayNum)) {
      defaultStatus = 'vacation';
    } else if (sickDays.includes(dayNum)) {
      defaultStatus = 'sick';
    }

    days.push({
      dateStr,
      displayDate,
      dayNum,
      monthNum: curr.getMonth() + 1,
      year: y,
      dayOfWeek,
      dayNameHe: dayNamesHe[dayOfWeek],
      dayShortHe: dayShortHe[dayOfWeek],
      isWeekend,
      status: defaultStatus,
      checkIn: env.MECKANO_DEFAULT_IN || '10:00',
      checkOut: env.MECKANO_DEFAULT_OUT || '19:00'
    });

    curr.setDate(curr.getDate() + 1);
  }

  const pad = n => String(n).padStart(2, '0');
  const periodLabel = `${pad(startDate.getDate())}/${pad(startDate.getMonth() + 1)}/${startDate.getFullYear()} - ${pad(endDate.getDate())}/${pad(endDate.getMonth() + 1)}/${endDate.getFullYear()}`;

  return {
    offset,
    periodLabel,
    startDate: `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`,
    endDate: `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`,
    days
  };
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers for local requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API: Get Config ---
  if (pathname === '/api/config' && req.method === 'GET') {
    const env = loadEnv();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      email: env.MECKANO_EMAIL || '',
      hasPassword: Boolean(env.MECKANO_PASSWORD),
      vacationDays: env.MECKANO_VACATION_DAYS || '',
      halfVacationDays: env.MECKANO_HALF_VACATION_DAYS || '',
      sickDays: env.MECKANO_SICK_DAYS || '',
      defaultIn: env.MECKANO_DEFAULT_IN || '10:00',
      defaultOut: env.MECKANO_DEFAULT_OUT || '19:00',
      cycleType: env.MECKANO_CYCLE_TYPE || '21-20'
    }));
    return;
  }

  // --- API: Save Config ---
  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      const data = await readBody(req);
      const updates = {};
      if (data.email !== undefined) updates.MECKANO_EMAIL = data.email.trim();
      if (data.password !== undefined && data.password.trim() !== '') {
        updates.MECKANO_PASSWORD = data.password.trim();
      }
      if (data.vacationDays !== undefined) updates.MECKANO_VACATION_DAYS = data.vacationDays;
      if (data.halfVacationDays !== undefined) updates.MECKANO_HALF_VACATION_DAYS = data.halfVacationDays;
      if (data.sickDays !== undefined) updates.MECKANO_SICK_DAYS = data.sickDays;
      if (data.defaultIn !== undefined) updates.MECKANO_DEFAULT_IN = data.defaultIn;
      if (data.defaultOut !== undefined) updates.MECKANO_DEFAULT_OUT = data.defaultOut;

      saveEnv(updates);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Settings saved to ~/.meckano.env' }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // --- API: Get Calendar Days ---
  if (pathname === '/api/calendar' && req.method === 'GET') {
    const offset = parseInt(parsedUrl.query.offset || '-1', 10);
    const cycleData = getCycleDates(isNaN(offset) ? -1 : offset);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cycleData));
    return;
  }

  // --- API: Run Automation Job ---
  if (pathname === '/api/run' && req.method === 'POST') {
    if (activeJob && activeJob.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'A job is already running. Please wait.' }));
      return;
    }

    try {
      const data = await readBody(req);
      const env = loadEnv();
      const email = data.email || env.MECKANO_EMAIL;
      const password = data.password || env.MECKANO_PASSWORD;
      const cycleOffset = parseInt(data.cycleOffset !== undefined ? data.cycleOffset : -1, 10);
      const dryRun = Boolean(data.dryRun);
      const daysConfig = data.daysConfig || {};

      if (!email || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Email and password must be configured or provided.' }));
        return;
      }

      // Initialize job state
      activeJob = {
        id: Date.now(),
        status: 'running',
        startTime: new Date().toISOString(),
        logs: [],
        result: null,
        error: null
      };

      const log = (msg) => {
        const time = new Date().toLocaleTimeString();
        const entry = `[${time}] ${msg}`;
        activeJob.logs.push(entry);
        console.log(entry);
      };

      // Launch in background
      runMeckanoReport({
        email,
        password,
        cycleOffset,
        daysConfig,
        defaultCheckIn: data.defaultIn || env.MECKANO_DEFAULT_IN || '10:00',
        defaultCheckOut: data.defaultOut || env.MECKANO_DEFAULT_OUT || '19:00',
        dryRun,
        onLog: log
      }).then(result => {
        activeJob.status = 'completed';
        activeJob.result = result;
        log('🎉 Automation finished successfully!');
      }).catch(err => {
        activeJob.status = 'error';
        activeJob.error = err.message;
        log(`❌ Error: ${err.message}`);
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, jobId: activeJob.id, message: 'Automation started.' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // --- API: Job Status (Polling) ---
  if (pathname === '/api/job-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(activeJob || { status: 'idle', logs: [] }));
    return;
  }

  // --- API: Realtime SSE Stream ---
  if (pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 1000\n\n');

    let lastLogIndex = 0;
    const interval = setInterval(() => {
      if (!activeJob) {
        res.write(`data: ${JSON.stringify({ status: 'idle' })}\n\n`);
        return;
      }
      const newLogs = activeJob.logs.slice(lastLogIndex);
      lastLogIndex = activeJob.logs.length;

      res.write(`data: ${JSON.stringify({
        status: activeJob.status,
        logs: newLogs,
        result: activeJob.result,
        error: activeJob.error
      })}\n\n`);

      if (activeJob.status === 'completed' || activeJob.status === 'error') {
        clearInterval(interval);
        res.end();
      }
    }, 800);

    req.on('close', () => clearInterval(interval));
    return;
  }

  // --- API: Screenshot ---
  if (pathname === '/api/screenshot') {
    let filePath = SCREENSHOT_DOWNLOAD;
    if (!fs.existsSync(filePath)) {
      filePath = SCREENSHOT_LOCAL;
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Screenshot not found yet. Run the report first.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // --- Static Files ---
  let safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(`🚀 Meckano Dashboard Server running on port ${PORT}`);
  console.log(`📱 Local URL: http://localhost:${PORT}`);
  console.log(`===================================================`);
});
