import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const agentsDir = join(root, '.opencode/agents')
const skillsDir = join(root, '.opencode/skills')
const commandsDir = join(root, '.opencode/commands')
const errors = []

const allowedModels = new Set([
  'kimi-for-coding/k3',
  'deepseek/deepseek-v4-pro',
  'opencode-go/deepseek-v4-flash',
  'openai/gpt-5.6-sol'
])

function frontmatter(path) {
  const text = readFileSync(path, 'utf8')
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    errors.push(`${path}: missing YAML frontmatter`)
    return ''
  }
  return match[1]
}

const agentFiles = readdirSync(agentsDir)
  .filter((name) => name.endsWith('.md'))
  .sort()
const agentNames = new Set(agentFiles.map((name) => name.slice(0, -3)))
agentNames.add('explore')

for (const file of agentFiles) {
  const path = join(agentsDir, file)
  const fm = frontmatter(path)
  const model = fm.match(/^model:\s*(\S+)/m)?.[1]
  const mode = fm.match(/^mode:\s*(\S+)/m)?.[1]
  if (!model) errors.push(`${file}: model is required; otherwise K3 is inherited`)
  else if (!allowedModels.has(model)) errors.push(`${file}: unsupported model ${model}`)
  if (!mode) errors.push(`${file}: mode is required`)

  const taskBlock = fm.match(/^ {2}task:\n((?: {4}.*\n?)*)/m)?.[1] ?? ''
  for (const [, target] of taskBlock.matchAll(/^ {4}([^"*][^:]*):\s*allow$/gm)) {
    if (!agentNames.has(target)) errors.push(`${file}: task target ${target} does not exist`)
  }
}

const reviewer = frontmatter(join(agentsDir, 'reviewer.md'))
if (!/^model:\s*openai\/gpt-5\.6-sol$/m.test(reviewer)) {
  errors.push('reviewer.md: reviewer must use openai/gpt-5.6-sol')
}
if (!/^variant:\s*medium$/m.test(reviewer)) {
  errors.push('reviewer.md: reviewer must use variant medium')
}

const deepImplementer = frontmatter(join(agentsDir, 'implementer-deep.md'))
if (!/^model:\s*kimi-for-coding\/k3$/m.test(deepImplementer)) {
  errors.push('implementer-deep.md: deep implementer must use kimi-for-coding/k3')
}
if (!/^ {4}explore:\s*allow$/m.test(deepImplementer)) {
  errors.push('implementer-deep.md: deep implementer must allow explore')
}
if (/^ {4}technical-consultant:\s*allow$/m.test(deepImplementer)) {
  errors.push('implementer-deep.md: must not call technical-consultant')
}

const refactorAnalyst = frontmatter(join(agentsDir, 'refactor-analyst.md'))
if (!/^model:\s*openai\/gpt-5\.6-sol$/m.test(refactorAnalyst)) {
  errors.push('refactor-analyst.md: must use openai/gpt-5.6-sol')
}
if (!/^variant:\s*medium$/m.test(refactorAnalyst)) {
  errors.push('refactor-analyst.md: must use variant medium')
}
if (!/^ {2}edit:\s*deny$/m.test(refactorAnalyst)) {
  errors.push('refactor-analyst.md: must be read-only')
}

const config = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'))
for (const [name, value] of Object.entries(config.agent ?? {})) {
  if (name !== 'explore' && value.model) {
    errors.push(`opencode.json: model for ${name} must live in its subagent frontmatter`)
  }
}

const skillNames = new Set(
  readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory())
)
for (const name of skillNames) {
  const path = join(skillsDir, name, 'SKILL.md')
  const fm = frontmatter(path)
  const declared = fm.match(/^name:\s*(\S+)/m)?.[1]
  if (declared !== name) errors.push(`${path}: name must match directory (${name})`)
}

for (const file of readdirSync(commandsDir).filter((name) => name.endsWith('.md'))) {
  const text = readFileSync(join(commandsDir, file), 'utf8')
  const skill = text.match(/скилл\s+([a-z0-9-]+)/i)?.[1]
  if (skill && !skillNames.has(skill)) errors.push(`${file}: missing skill ${skill}`)
}

const orchestratorText = readFileSync(join(agentsDir, 'orchestrator.md'), 'utf8')
const approveText = readFileSync(join(skillsDir, 'kotik-approve', 'SKILL.md'), 'utf8')
const proposalTemplate = readFileSync(join(root, 'specs/templates/proposal.md'), 'utf8')
for (const required of ['implementer-deep', 'refactor-analyst', 'kotik-refactor']) {
  if (!orchestratorText.includes(required)) {
    errors.push(`orchestrator.md: missing routing reference ${required}`)
  }
}
if (!approveText.includes('implementer-deep')) {
  errors.push('kotik-approve: missing deep implementation dispatch')
}
if (!proposalTemplate.includes('Implementation: <standard | deep>')) {
  errors.push('proposal template: missing Implementation routing field')
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`)
  process.exitCode = 1
} else {
  console.log(`Agent system OK: ${agentFiles.length} agents, ${skillNames.size} skills`)
}
