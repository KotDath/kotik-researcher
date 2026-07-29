/* eslint-disable no-console */
import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const ALLOW = ['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','LC_CTYPE','TERM','TMPDIR','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','XDG_SESSION_TYPE','DBUS_SESSION_BUS_ADDRESS']
const userDataDir = mkdtempSync(join(tmpdir(), 'kotik-hidden-proof-'))
const env = { NODE_ENV: 'test', E2E_USER_DATA_DIR: userDataDir }
for (const k of ALLOW) if (process.env[k]) env[k] = process.env[k]

const app = await electron.launch({ args: ['./out/main/index.mjs', '--e2e'], env })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.getByTestId('project-picker').waitFor()
await win.evaluate(async () => { await document.fonts.ready })
await win.setViewportSize({ width: 1280, height: 800 })
await win.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }' })

const hash = (b) => createHash('md5').update(b).digest('hex').slice(0, 10)
for (let i = 0; i < 6; i++) {
  const buf = await win.screenshot()
  console.log(`shot ${i}: ${buf.length} bytes, md5 ${hash(buf)}`)
  await new Promise((r) => setTimeout(r, 400))
}
await app.close()
