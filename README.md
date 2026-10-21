# Meckano Assistant (`meckano-dashboard`)

A local web dashboard and Playwright automation engine for automating monthly attendance and hours reporting on [Meckano](https://app.meckano.co.il), built to run both on **Android (Termux)** and standard desktop environments.

## Features

- **21st–20th Payroll Cycle Calendar**: Interactive Hebrew (RTL) monthly grid and agenda list view.
- **Per-Day Status Customization**: Configure individual days as regular work (`10:00–19:00`), full vacation (`חופש`), half-day vacation (`חצי יום חופש`), sick leave (`מחלה`), or day off.
- **Smart Holiday & Chol HaMoed Handling**: Automatically detects full holidays (`חג`) and weekends while filling standard workdays (including `חול המועד`).
- **Dry Run & Live Execution**: Stream real-time step-by-step browser automation logs over Server-Sent Events (SSE) and capture a full-page verification screenshot upon completion.
- **Termux / Android Ready**: Includes workarounds for Playwright on Android (`PLAYWRIGHT_BROWSERS_PATH=0` + system `chromium-browser`), Meckano's SVG `#email` selector collision, RTL month navigation arrows, and jQuery mask inputs.

## Quick Start

1. Copy `.env.example` to `~/.meckano.env` (or configure directly via the web UI):
   ```bash
   cp .env.example ~/.meckano.env
   chmod 600 ~/.meckano.env
   ```
2. Start the dashboard server:
   ```bash
   ./start.sh
   # or: node server.js
   ```
3. Open `http://localhost:3333` in your browser.
