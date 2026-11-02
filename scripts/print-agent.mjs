#!/usr/bin/env node
/**
 * BFK print agent (D50): runs on the computer next to the kitchen's receipt
 * printer, asks the app for queued ticket print jobs and sends them to the
 * printer (ESC/POS over the network, port 9100). Node 18+, no dependency.
 *
 *   node scripts/print-agent.mjs            (reads scripts/print-agent.env)
 *   node scripts/print-agent.mjs my.env     (or any other settings file)
 *
 * The settings file holds one KEY=VALUE per line (see print-agent.env.example):
 * APP_URL, API_KEY, API_SECRET (from /admin/settings, Revenue API card),
 * PRINTER_HOST (printed on the printer's self-test page), PRINTER_PORT
 * (9100) and POLL_SECONDS (5). Environment variables override the file.
 * Leave it running (a service, a scheduled task at logon…).
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

// Settings file: the first argument, or print-agent.env next to this script.
const envFile = process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'print-agent.env')
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) process.env[key] = value
  }
}

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
