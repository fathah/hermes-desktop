import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { HERMES_HOME } from './installer'

/** Resolve profile-specific paths. 'default' or undefined → ~/.hermes */
function profilePaths(profile?: string): { envFile: string; configFile: string; home: string } {
  const home =
    profile && profile !== 'default'
      ? join(HERMES_HOME, 'profiles', profile)
      : HERMES_HOME
  return {
    home,
    envFile: join(home, '.env'),
    configFile: join(home, 'config.yaml')
  }
}

export function readEnv(profile?: string): Record<string, string> {
  const { envFile } = profilePaths(profile)
  if (!existsSync(envFile)) return {}

  const content = readFileSync(envFile, 'utf-8')
  const result: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue

    const eqIndex = trimmed.indexOf('=')
    const key = trimmed.substring(0, eqIndex).trim()
    let value = trimmed.substring(eqIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (value) result[key] = value
  }

  return result
}

export function setEnvValue(key: string, value: string, profile?: string): void {
  const { envFile } = profilePaths(profile)
  if (!existsSync(envFile)) {
    writeFileSync(envFile, `${key}=${value}\n`)
    return
  }

  const content = readFileSync(envFile, 'utf-8')
  const lines = content.split('\n')
  let found = false

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.match(new RegExp(`^#?\\s*${key}\\s*=`))) {
      lines[i] = `${key}=${value}`
      found = true
      break
    }
  }

  if (!found) {
    lines.push(`${key}=${value}`)
  }

  writeFileSync(envFile, lines.join('\n'))
}

export function getConfigValue(key: string, profile?: string): string | null {
  const { configFile } = profilePaths(profile)
  if (!existsSync(configFile)) return null

  const content = readFileSync(configFile, 'utf-8')
  const regex = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)["']?`, 'm')
  const match = content.match(regex)
  return match ? match[1].trim() : null
}

export function setConfigValue(key: string, value: string, profile?: string): void {
  const { configFile } = profilePaths(profile)
  if (!existsSync(configFile)) return

  let content = readFileSync(configFile, 'utf-8')
  const regex = new RegExp(`^(\\s*#?\\s*${key}:\\s*)["']?[^"'\\n#]*["']?`, 'm')

  if (regex.test(content)) {
    content = content.replace(regex, `$1"${value}"`)
  }

  writeFileSync(configFile, content)
}

export function getModelConfig(profile?: string): { provider: string; model: string; baseUrl: string } {
  const { configFile } = profilePaths(profile)
  const defaults = { provider: 'auto', model: '', baseUrl: '' }
  if (!existsSync(configFile)) return defaults

  const content = readFileSync(configFile, 'utf-8')

  const providerMatch = content.match(/^\s*provider:\s*["']?([^"'\n#]+)["']?/m)
  const modelMatch = content.match(/^\s*default:\s*["']?([^"'\n#]+)["']?/m)
  const baseUrlMatch = content.match(/^\s*base_url:\s*["']?([^"'\n#]+)["']?/m)

  return {
    provider: providerMatch ? providerMatch[1].trim() : defaults.provider,
    model: modelMatch ? modelMatch[1].trim() : defaults.model,
    baseUrl: baseUrlMatch ? baseUrlMatch[1].trim() : defaults.baseUrl
  }
}

export function setModelConfig(provider: string, model: string, baseUrl: string, profile?: string): void {
  const { configFile } = profilePaths(profile)
  if (!existsSync(configFile)) return

  let content = readFileSync(configFile, 'utf-8')

  const providerRegex = /^(\s*#?\s*provider:\s*)["']?[^"'\n#]*["']?/m
  if (providerRegex.test(content)) {
    content = content.replace(providerRegex, `$1"${provider}"`)
  }

  const modelRegex = /^(\s*#?\s*default:\s*)["']?[^"'\n#]*["']?/m
  if (modelRegex.test(content)) {
    content = content.replace(modelRegex, `$1"${model}"`)
  }

  const baseUrlRegex = /^(\s*#?\s*base_url:\s*)["']?[^"'\n#]*["']?/m
  if (baseUrlRegex.test(content)) {
    content = content.replace(baseUrlRegex, `$1"${baseUrl}"`)
  }

  // Disable smart_model_routing
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*enabled:\s*(true|false)/.test(lines[i]) && i > 0 && /smart_model_routing/.test(lines[i - 1])) {
      lines[i] = lines[i].replace(/(enabled:\s*)(true|false)/, '$1false')
    }
  }
  content = lines.join('\n')

  // Enable streaming
  const streamingRegex = /^(\s*streaming:\s*)(\S+)/m
  if (streamingRegex.test(content)) {
    content = content.replace(streamingRegex, '$1true')
  }

  writeFileSync(configFile, content)
}

export function getHermesHome(profile?: string): string {
  return profilePaths(profile).home
}

// ── Credential Pool (auth.json) ──────────────────────────

function authFilePath(): string {
  return join(HERMES_HOME, 'auth.json')
}

interface CredentialEntry {
  key: string
  label: string
}

function readAuthStore(): Record<string, unknown> {
  try {
    const p = authFilePath()
    if (!existsSync(p)) return {}
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function writeAuthStore(store: Record<string, unknown>): void {
  writeFileSync(authFilePath(), JSON.stringify(store, null, 2), 'utf-8')
}

export function getCredentialPool(): Record<string, CredentialEntry[]> {
  const store = readAuthStore()
  const pool = store.credential_pool
  if (!pool || typeof pool !== 'object') return {}
  return pool as Record<string, CredentialEntry[]>
}

export function setCredentialPool(provider: string, entries: CredentialEntry[]): void {
  const store = readAuthStore()
  if (!store.credential_pool || typeof store.credential_pool !== 'object') {
    store.credential_pool = {}
  }
  ;(store.credential_pool as Record<string, CredentialEntry[]>)[provider] = entries
  writeAuthStore(store)
}
