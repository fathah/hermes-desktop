import { ChildProcess, spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import http from 'http'
import { HERMES_HOME, HERMES_REPO, HERMES_PYTHON, HERMES_SCRIPT, getEnhancedPath } from './installer'
import { getModelConfig, readEnv } from './config'

const API_URL = 'http://127.0.0.1:8642'

function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '')
    .replace(/\x1B\(B/g, '')
    .replace(/\r/g, '')
}

interface ChatHandle {
  abort: () => void
}

// ────────────────────────────────────────────────────
//  API Server health check
// ────────────────────────────────────────────────────

function isApiServerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${API_URL}/health`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

// ────────────────────────────────────────────────────
//  Ensure API server is enabled in config
// ────────────────────────────────────────────────────

function ensureApiServerConfig(): void {
  try {
    const configPath = join(HERMES_HOME, 'config.yaml')
    if (!existsSync(configPath)) return
    const content = readFileSync(configPath, 'utf-8')
    // If api_server is already configured, skip
    if (/api_server/i.test(content)) return
    // Append API server platform config
    const addition = `
# Desktop app API server (auto-configured)
platforms:
  api_server:
    enabled: true
    extra:
      port: 8642
      host: "127.0.0.1"
`
    const fs = require('fs')
    fs.appendFileSync(configPath, addition, 'utf-8')
  } catch {
    /* non-fatal */
  }
}

// ────────────────────────────────────────────────────
//  HTTP API streaming (fast path — no process spawn)
// ────────────────────────────────────────────────────

export interface ChatCallbacks {
  onChunk: (text: string) => void
  onDone: (sessionId?: string) => void
  onError: (error: string) => void
  onToolProgress?: (tool: string) => void
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void
}

function sendMessageViaApi(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string
): ChatHandle {
  const mc = getModelConfig(profile)
  const controller = new AbortController()

  const body = JSON.stringify({
    model: mc.model || 'hermes-agent',
    messages: [{ role: 'user', content: message }],
    stream: true
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (resumeSessionId) {
    headers['X-Hermes-Session-Id'] = resumeSessionId
  }

  let sessionId = resumeSessionId || ''
  let hasContent = false
  // Tool progress pattern: `emoji tool_name` or `emoji description`
  const toolProgressRe = /^`([^\s`]+)\s+([^`]+)`$/

  function processSseData(data: string): boolean {
    if (data === '[DONE]') {
      cb.onDone(sessionId || undefined)
      return true // signals done
    }
    try {
      const parsed = JSON.parse(data)
      const choice = parsed.choices?.[0]
      const delta = choice?.delta

      // Extract usage from final chunk
      if (parsed.usage && cb.onUsage) {
        cb.onUsage({
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0
        })
      }

      if (delta?.content) {
        const content = delta.content.trim()
        // Detect tool progress lines: `🔍 search_web`
        const match = toolProgressRe.exec(content)
        if (match && cb.onToolProgress) {
          cb.onToolProgress(`${match[1]} ${match[2]}`)
        } else {
          hasContent = true
          cb.onChunk(delta.content)
        }
      }
    } catch {
      /* malformed chunk — skip */
    }
    return false
  }

  const req = http.request(
    `${API_URL}/v1/chat/completions`,
    {
      method: 'POST',
      headers,
      signal: controller.signal
    },
    (res) => {
      const sid = res.headers['x-hermes-session-id']
      if (sid && typeof sid === 'string') sessionId = sid

      if (res.statusCode !== 200) {
        let errBody = ''
        res.on('data', (d) => { errBody += d.toString() })
        res.on('end', () => {
          try {
            const err = JSON.parse(errBody)
            cb.onError(err.error?.message || `API error ${res.statusCode}`)
          } catch {
            cb.onError(`API server returned ${res.statusCode}`)
          }
        })
        return
      }

      let buffer = ''

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue
            if (processSseData(line.slice(6))) return
          }
        }
      })

      res.on('end', () => {
        if (buffer.trim()) {
          for (const line of buffer.split('\n')) {
            if (!line.startsWith('data: ')) continue
            if (processSseData(line.slice(6))) return
          }
        }
        if (hasContent) cb.onDone(sessionId || undefined)
      })

      res.on('error', (err) => cb.onError(`Stream error: ${err.message}`))
    }
  )

  req.on('error', (err) => {
    if (err.name === 'AbortError') return
    cb.onError(`API request failed: ${err.message}`)
  })

  req.write(body)
  req.end()

  return {
    abort: () => {
      controller.abort()
    }
  }
}

// ────────────────────────────────────────────────────
//  CLI fallback (slow path — spawns process)
// ────────────────────────────────────────────────────

const NOISE_PATTERNS = [
  /^[╭╰│╮╯─┌┐└┘┤├┬┴┼]/,
  /⚕\s*Hermes/
]

function sendMessageViaCli(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string
): ChatHandle {
  const mc = getModelConfig(profile)
  const profileEnv = readEnv(profile)

  const args = [HERMES_SCRIPT]
  if (profile && profile !== 'default') {
    args.push('-p', profile)
  }
  args.push('chat', '-q', message, '-Q', '--source', 'desktop')

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId)
  }

  if (mc.model) {
    args.push('-m', mc.model)
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME: HERMES_HOME,
    PYTHONUNBUFFERED: '1'
  }

  const PROVIDER_KEY_MAP: Record<string, string> = {
    custom: 'OPENAI_API_KEY',
    lmstudio: '', ollama: '', vllm: '', llamacpp: ''
  }

  const isCustomEndpoint = mc.provider in PROVIDER_KEY_MAP
  if (isCustomEndpoint && mc.baseUrl) {
    env.HERMES_INFERENCE_PROVIDER = 'custom'
    env.OPENAI_BASE_URL = mc.baseUrl.replace(/\/+$/, '')
    const keyEnvVar = PROVIDER_KEY_MAP[mc.provider]
    const resolvedKey = keyEnvVar ? (profileEnv[keyEnvVar] || env[keyEnvVar] || '') : 'no-key-required'
    env.OPENAI_API_KEY = resolvedKey || 'no-key-required'
    delete env.OPENROUTER_API_KEY
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_TOKEN
    delete env.OPENROUTER_BASE_URL
  }

  const proc = spawn(HERMES_PYTHON, args, {
    cwd: HERMES_REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let hasOutput = false
  let capturedSessionId = ''
  let outputBuffer = ''

  function processOutput(raw: Buffer): void {
    const text = stripAnsi(raw.toString())
    outputBuffer += text

    const sidMatch = outputBuffer.match(/session_id:\s*(\S+)/)
    if (sidMatch) capturedSessionId = sidMatch[1]

    const cleaned = text.replace(/session_id:\s*\S+\n?/g, '')
    const lines = cleaned.split('\n')
    const result: string[] = []
    for (const line of lines) {
      const t = line.trim()
      if (t && NOISE_PATTERNS.some((p) => p.test(t))) continue
      result.push(line)
    }

    const output = result.join('\n')
    if (output) {
      hasOutput = true
      cb.onChunk(output)
    }
  }

  proc.stdout?.on('data', processOutput)

  proc.stderr?.on('data', (data: Buffer) => {
    const text = stripAnsi(data.toString())
    if (text.trim() && !text.includes('UserWarning') && !text.includes('FutureWarning')) {
      if (/❌|⚠️|Error|Traceback/.test(text)) {
        hasOutput = true
        cb.onChunk(text)
      }
    }
  })

  proc.on('close', (code) => {
    if (code === 0 || hasOutput) {
      cb.onDone(capturedSessionId || undefined)
    } else {
      cb.onError(`Hermes exited with code ${code}`)
    }
  })

  proc.on('error', (err) => {
    cb.onError(err.message)
  })

  return {
    abort: () => {
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
      }, 3000)
    }
  }
}

// ────────────────────────────────────────────────────
//  Public API: auto-routes to HTTP API or CLI fallback
// ────────────────────────────────────────────────────

let apiServerAvailable: boolean | null = null // cached after first check

export async function sendMessage(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string
): Promise<ChatHandle> {
  ensureInitialized()
  // Check API server availability (cache the result, re-check periodically)
  if (apiServerAvailable === null || apiServerAvailable === false) {
    apiServerAvailable = await isApiServerReady()
  }

  if (apiServerAvailable) {
    return sendMessageViaApi(message, cb, profile, resumeSessionId)
  }

  // Fallback to CLI
  return sendMessageViaCli(message, cb, profile, resumeSessionId)
}

// Lazy init — called on first sendMessage or gateway start
let _initialized = false
function ensureInitialized(): void {
  if (_initialized) return
  _initialized = true
  ensureApiServerConfig()
  setInterval(async () => {
    apiServerAvailable = await isApiServerReady()
  }, 15000)
}

// ────────────────────────────────────────────────────
//  Gateway management
// ────────────────────────────────────────────────────

let gatewayProcess: ChildProcess | null = null

export function startGateway(): boolean {
  ensureInitialized()
  if (gatewayProcess && !gatewayProcess.killed) return false

  gatewayProcess = spawn(HERMES_PYTHON, [HERMES_SCRIPT, 'gateway'], {
    cwd: HERMES_REPO,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
      HERMES_HOME: HERMES_HOME,
      API_SERVER_ENABLED: 'true' // Ensure API server starts with gateway
    },
    stdio: 'ignore',
    detached: true
  })

  gatewayProcess.unref()

  gatewayProcess.on('close', () => {
    gatewayProcess = null
    apiServerAvailable = false
  })

  // Wait a bit then check if API server came up
  setTimeout(async () => {
    apiServerAvailable = await isApiServerReady()
  }, 3000)

  return true
}

export function stopGateway(): void {
  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill('SIGTERM')
    gatewayProcess = null
  }
  const pidFile = join(HERMES_HOME, 'gateway.pid')
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10)
      if (!isNaN(pid)) process.kill(pid, 'SIGTERM')
    } catch {
      // already dead
    }
  }
  apiServerAvailable = false
}

export function isGatewayRunning(): boolean {
  if (gatewayProcess && !gatewayProcess.killed) return true
  const pidFile = join(HERMES_HOME, 'gateway.pid')
  if (!existsSync(pidFile)) return false
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10)
    if (isNaN(pid)) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function isApiReady(): boolean {
  return apiServerAvailable === true
}
