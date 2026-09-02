import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const desktop = process.argv.includes('--desktop')
const platformArgument = process.argv.find((argument) => argument.startsWith('--platform='))
const archArgument = process.argv.find((argument) => argument.startsWith('--arch='))
const targetPlatform = platformArgument?.slice('--platform='.length) ?? process.platform
const targetArch = archArgument?.slice('--arch='.length) ?? process.arch
const goArch = targetArch === 'x64' ? 'amd64' : targetArch
const executableName = targetPlatform === 'windows' || targetPlatform === 'win32'
  ? 'kotik-agent.exe'
  : 'kotik-agent'
const output = desktop ? join('apps', 'desktop', 'bin', executableName) : executableName
if (desktop) {
  const directory = join('apps', 'desktop', 'bin')
  mkdirSync(directory, { recursive: true })
  rmSync(join(directory, 'kotik-agent'), { force: true })
  rmSync(join(directory, 'kotik-agent.exe'), { force: true })
}
const result = spawnSync(
  'go',
  ['build', '-trimpath', '-ldflags=-s -w', '-o', output, './cmd/kotik-agent'],
  {
    env: {
      ...process.env,
      CGO_ENABLED: '0',
      GOOS: targetPlatform === 'win32' ? 'windows' : targetPlatform,
      GOARCH: goArch,
    },
    stdio: 'inherit',
  },
)

if (result.error) {
  throw result.error
}
process.exitCode = result.status ?? 1
