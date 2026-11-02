#!/usr/bin/env node
/**
 * BFK print agent (D50): runs on the computer next to the kitchen's receipt
 * printer, asks the app for queued ticket print jobs and sends them to the
 * printer (ESC/POS over the network, port 9100). Node 18+, no dependency.
 *
 *   APP_URL=https://your-app  API_KEY=bfk_pk_…  API_SECRET=bfk_sk_…  \
 *   PRINTER_HOST=192.168.100.242  PRINTER_PORT=9100  node scripts/print-agent.mjs
 *
 * The API keys come from /admin/settings (Revenue API card); the printer's
 * IP is printed on its self-test page. POLL_SECONDS (default 5) sets the
 * polling interval. Leave it running (a service, a scheduled task at logon…).
 */
import net from 'node:net'

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback
  if (value === undefined || value === '') {
    console.error(`Missing ${name}`)
    process.exit(1)
  }
  return value
}
const APP_URL = env('APP_URL').replace(/\/+$/, '')
const API_KEY = env('API_KEY')
const API_SECRET = env('API_SECRET')
const PRINTER_HOST = env('PRINTER_HOST')
const PRINTER_PORT = Number(env('PRINTER_PORT', '9100'))
const POLL_MS = Number(env('POLL_SECONDS', '5')) * 1000
const headers = { 'X-Api-Key': API_KEY, 'X-Api-Secret': API_SECRET, 'Accept': 'application/json' }

function sendToPrinter(bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: PRINTER_HOST, port: PRINTER_PORT })
    socket.setTimeout(10_000)
    socket.on('timeout', () => socket.destroy(new Error('printer timeout')))
    socket.on('error', reject)
    socket.on('connect', () => socket.end(bytes, resolve))
  })
}

async function ack(id, status, error) {
  await fetch(`${APP_URL}/api/v1/print-jobs/${id}/ack`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, error: error ?? null }),
  })
}

async function tick() {
  const response = await fetch(`${APP_URL}/api/v1/print-jobs/next`, { headers })
  if (response.status === 204) return
  if (!response.ok) {
    console.error(`${new Date().toISOString()} app answered ${response.status}`)
    return
  }
  const job = await response.json()
  const bytes = Buffer.from(job.escpos, 'base64')
  try {
    await sendToPrinter(bytes)
    await ack(job.id, 'done')
    console.log(`${new Date().toISOString()} job ${job.id}: ${job.ticketsCount} tickets printed`)
  } catch (error) {
    await ack(job.id, 'failed', String(error?.message ?? error))
    console.error(`${new Date().toISOString()} job ${job.id} failed: ${error?.message ?? error}`)
  }
}

console.log(`BFK print agent: ${APP_URL} → ${PRINTER_HOST}:${PRINTER_PORT}, every ${POLL_MS / 1000}s`)
for (;;) {
  try {
    await tick()
  } catch (error) {
    console.error(`${new Date().toISOString()} ${error?.message ?? error}`)
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS))
}
