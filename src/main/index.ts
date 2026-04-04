import { app, shell, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { checkInstallStatus, runInstall, InstallProgress } from './installer'
import { sendMessage, startGateway, stopGateway, isGatewayRunning } from './hermes'
import {
  getClaw3dStatus,
  setupClaw3d,
  startDevServer,
  stopDevServer,
  startAdapter,
  stopAdapter,
  startAll as startClaw3dAll,
  stopAll as stopClaw3d,
  getClaw3dLogs,
  setClaw3dPort,
  getClaw3dPort,
  setClaw3dWsUrl,
  getClaw3dWsUrl,
  Claw3dSetupProgress
} from './claw3d'
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getCredentialPool,
  setCredentialPool
} from './config'
import { listSessions, getSessionMessages, searchSessions } from './sessions'
import { listModels, addModel, removeModel, updateModel } from './models'
import { listProfiles, createProfile, deleteProfile, setActiveProfile } from './profiles'
import { readMemory, addMemoryEntry, updateMemoryEntry, removeMemoryEntry, writeUserProfile } from './memory'
import { readSoul, writeSoul, resetSoul } from './soul'
import { getToolsets, setToolsetEnabled } from './tools'
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill
} from './skills'

let mainWindow: BrowserWindow | null = null
let currentChatAbort: (() => void) | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupIPC(): void {
  // Installation
  ipcMain.handle('check-install', () => {
    return checkInstallStatus()
  })

  ipcMain.handle('start-install', async (event) => {
    try {
      await runInstall((progress: InstallProgress) => {
        event.sender.send('install-progress', progress)
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Configuration (profile-aware)
  ipcMain.handle('get-env', (_event, profile?: string) => readEnv(profile))

  ipcMain.handle('set-env', (_event, key: string, value: string, profile?: string) => {
    setEnvValue(key, value, profile)
    return true
  })

  ipcMain.handle('get-config', (_event, key: string, profile?: string) =>
    getConfigValue(key, profile)
  )

  ipcMain.handle('set-config', (_event, key: string, value: string, profile?: string) => {
    setConfigValue(key, value, profile)
    return true
  })

  ipcMain.handle('get-hermes-home', (_event, profile?: string) => getHermesHome(profile))

  ipcMain.handle('get-model-config', (_event, profile?: string) => getModelConfig(profile))

  ipcMain.handle(
    'set-model-config',
    (_event, provider: string, model: string, baseUrl: string, profile?: string) => {
      setModelConfig(provider, model, baseUrl, profile)
      return true
    }
  )

  // Chat
  ipcMain.handle(
    'send-message',
    async (event, message: string, profile?: string, resumeSessionId?: string) => {
      return new Promise<{ response: string; sessionId?: string }>(async (resolve, reject) => {
        if (currentChatAbort) {
          currentChatAbort()
        }

        let fullResponse = ''

        const handle = await sendMessage(
          message,
          {
            onChunk: (chunk) => {
              fullResponse += chunk
              event.sender.send('chat-chunk', chunk)
            },
            onDone: (sessionId) => {
              currentChatAbort = null
              event.sender.send('chat-done', sessionId || '')
              resolve({ response: fullResponse, sessionId })
            },
            onError: (error) => {
              currentChatAbort = null
              event.sender.send('chat-error', error)
              reject(new Error(error))
            },
            onToolProgress: (tool) => {
              event.sender.send('chat-tool-progress', tool)
            },
            onUsage: (usage) => {
              event.sender.send('chat-usage', usage)
            }
          },
          profile,
          resumeSessionId
        )

        currentChatAbort = handle.abort
      })
    }
  )

  ipcMain.handle('abort-chat', () => {
    if (currentChatAbort) {
      currentChatAbort()
      currentChatAbort = null
    }
  })

  // Gateway
  ipcMain.handle('start-gateway', () => startGateway())
  ipcMain.handle('stop-gateway', () => {
    stopGateway()
    return true
  })
  ipcMain.handle('gateway-status', () => isGatewayRunning())

  // Sessions
  ipcMain.handle('list-sessions', (_event, limit?: number, offset?: number) => {
    return listSessions(limit, offset)
  })

  ipcMain.handle('get-session-messages', (_event, sessionId: string) => {
    return getSessionMessages(sessionId)
  })

  // Profiles
  ipcMain.handle('list-profiles', () => listProfiles())
  ipcMain.handle('create-profile', (_event, name: string, clone: boolean) =>
    createProfile(name, clone)
  )
  ipcMain.handle('delete-profile', (_event, name: string) => deleteProfile(name))
  ipcMain.handle('set-active-profile', (_event, name: string) => {
    setActiveProfile(name)
    return true
  })

  // Memory
  ipcMain.handle('read-memory', (_event, profile?: string) => readMemory(profile))
  ipcMain.handle('add-memory-entry', (_event, content: string, profile?: string) =>
    addMemoryEntry(content, profile)
  )
  ipcMain.handle('update-memory-entry', (_event, index: number, content: string, profile?: string) =>
    updateMemoryEntry(index, content, profile)
  )
  ipcMain.handle('remove-memory-entry', (_event, index: number, profile?: string) =>
    removeMemoryEntry(index, profile)
  )
  ipcMain.handle('write-user-profile', (_event, content: string, profile?: string) =>
    writeUserProfile(content, profile)
  )

  // Soul
  ipcMain.handle('read-soul', (_event, profile?: string) => readSoul(profile))
  ipcMain.handle('write-soul', (_event, content: string, profile?: string) => {
    return writeSoul(content, profile)
  })
  ipcMain.handle('reset-soul', (_event, profile?: string) => resetSoul(profile))

  // Tools
  ipcMain.handle('get-toolsets', (_event, profile?: string) => getToolsets(profile))
  ipcMain.handle(
    'set-toolset-enabled',
    (_event, key: string, enabled: boolean, profile?: string) => {
      return setToolsetEnabled(key, enabled, profile)
    }
  )

  // Skills
  ipcMain.handle('list-installed-skills', (_event, profile?: string) =>
    listInstalledSkills(profile)
  )
  ipcMain.handle('list-bundled-skills', () => listBundledSkills())
  ipcMain.handle('get-skill-content', (_event, skillPath: string) => getSkillContent(skillPath))
  ipcMain.handle('install-skill', (_event, identifier: string, profile?: string) =>
    installSkill(identifier, profile)
  )
  ipcMain.handle('uninstall-skill', (_event, name: string, profile?: string) =>
    uninstallSkill(name, profile)
  )

  // Session search
  ipcMain.handle('search-sessions', (_event, query: string, limit?: number) =>
    searchSessions(query, limit)
  )

  // Credential Pool
  ipcMain.handle('get-credential-pool', () => getCredentialPool())
  ipcMain.handle('set-credential-pool', (_event, provider: string, entries: Array<{ key: string; label: string }>) => {
    setCredentialPool(provider, entries)
    return true
  })

  // Models
  ipcMain.handle('list-models', () => listModels())
  ipcMain.handle('add-model', (_event, name: string, provider: string, model: string, baseUrl: string) =>
    addModel(name, provider, model, baseUrl)
  )
  ipcMain.handle('remove-model', (_event, id: string) => removeModel(id))
  ipcMain.handle('update-model', (_event, id: string, fields: Record<string, string>) =>
    updateModel(id, fields)
  )

  // Claw3D
  ipcMain.handle('claw3d-status', () => getClaw3dStatus())

  ipcMain.handle('claw3d-setup', async (event) => {
    try {
      await setupClaw3d((progress: Claw3dSetupProgress) => {
        event.sender.send('claw3d-setup-progress', progress)
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('claw3d-get-port', () => getClaw3dPort())
  ipcMain.handle('claw3d-set-port', (_event, port: number) => {
    setClaw3dPort(port)
    return true
  })
  ipcMain.handle('claw3d-get-ws-url', () => getClaw3dWsUrl())
  ipcMain.handle('claw3d-set-ws-url', (_event, url: string) => {
    setClaw3dWsUrl(url)
    return true
  })

  ipcMain.handle('claw3d-start-all', () => startClaw3dAll())
  ipcMain.handle('claw3d-stop-all', () => {
    stopClaw3d()
    return true
  })
  ipcMain.handle('claw3d-get-logs', () => getClaw3dLogs())

  ipcMain.handle('claw3d-start-dev', () => startDevServer())
  ipcMain.handle('claw3d-stop-dev', () => {
    stopDevServer()
    return true
  })
  ipcMain.handle('claw3d-start-adapter', () => startAdapter())
  ipcMain.handle('claw3d-stop-adapter', () => {
    stopAdapter()
    return true
  })

  // Shell
  ipcMain.handle('open-external', (_event, url: string) => {
    shell.openExternal(url)
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'Chat',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: (): void => {
            mainWindow?.webContents.send('menu-new-chat')
          }
        },
        { type: 'separator' },
        {
          label: 'Search Sessions',
          accelerator: 'CmdOrCtrl+K',
          click: (): void => {
            mainWindow?.webContents.send('menu-search-sessions')
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(is.dev
          ? [
              { type: 'separator' as const },
              { role: 'reload' as const },
              { role: 'toggleDevTools' as const }
            ]
          : [])
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Hermes Agent on GitHub',
          click: (): void => {
            shell.openExternal('https://github.com/fathah/Hermes-Agent')
          }
        },
        {
          label: 'Report an Issue',
          click: (): void => {
            shell.openExternal('https://github.com/fathah/Hermes-Agent/issues')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function setupUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-download-progress', {
      percent: Math.round(progress.percent)
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-error', err.message)
  })

  // IPC handlers for update actions
  ipcMain.handle('check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return result?.updateInfo?.version || null
    } catch {
      return null
    }
  })

  ipcMain.handle('download-update', () => {
    autoUpdater.downloadUpdate()
    return true
  })

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('get-app-version', () => app.getVersion())

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 5000)
}

app.whenReady().then(() => {
  app.name = 'Hermes'
  electronApp.setAppUserModelId('com.nousresearch.hermes')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  buildMenu()
  setupIPC()
  createWindow()
  setupUpdater()

  // Auto-start gateway (includes API server) for fast chat
  // Small delay to let the app window load first
  setTimeout(() => {
    if (!isGatewayRunning()) {
      startGateway()
    }
  }, 2000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopGateway()
  stopClaw3d()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
