import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createRuntimeFromEnvironment, startApplicationServer } from './index.ts'

const execFileAsync = promisify(execFile)

interface CLIOptions {
  host: string
  port: number
  open: boolean
}

async function main(): Promise<void> {
  const cli = parseCLI(process.argv.slice(2))
  const server = await startApplicationServer({
    runtime: createRuntimeFromEnvironment(),
    host: cli.host,
    port: cli.port,
    webRoot: resolve('apps/web/dist'),
  })
  console.info(`kotik-researcher is running at ${server.url}`)

  if (cli.open) {
    openBrowser(server.url).catch((error: unknown) => {
      console.error('Could not open the browser:', error)
    })
  }

  const shutdown = async () => {
    await server.close()
    process.exitCode = 0
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

export function parseCLI(arguments_: string[]): CLIOptions {
  const options: CLIOptions = { host: '127.0.0.1', port: 8080, open: true }
  for (const argument of arguments_) {
    const [name, value] = argument.split('=', 2)
    if (name === '--host' && value) {
      options.host = value
    } else if (name === '--port' && value && Number.isInteger(Number(value))) {
      options.port = Number(value)
    } else if (name === '--open' && (value === 'true' || value === 'false')) {
      options.open = value === 'true'
    } else {
      throw new Error(`Unknown or invalid argument: ${argument}`)
    }
  }
  if (options.port < 0 || options.port > 65_535) {
    throw new Error(`Port must be between 0 and 65535: ${options.port}`)
  }
  return options
}

async function openBrowser(url: string): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('open', [url])
  } else if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', url])
  } else {
    await execFileAsync('xdg-open', [url])
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
