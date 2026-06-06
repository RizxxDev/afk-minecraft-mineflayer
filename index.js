const fs = require('fs')
const net = require('net')
const path = require('path')
const mineflayer = require('mineflayer')
const { SocksClient } = require('socks')

const configPath = path.join(__dirname, 'config.json')
const exampleConfigPath = path.join(__dirname, 'config.example.json')
const config = loadConfig()
const sessions = config.accounts.map(createSession)

let shuttingDown = false

sessions.forEach((session) => {
  session.connectTimer = setTimeout(() => connect(session), session.account.connectDelayMs)
})

function loadConfig () {
  const file = fs.existsSync(configPath) ? configPath : exampleConfigPath
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const commandsAfterSpawn = Array.isArray(parsed.commandsAfterSpawn) ? parsed.commandsAfterSpawn : []
  const connectStaggerMs = Number(parsed.connectStaggerMs || 5000)
  const host = parsed.host || 'localhost'
  const accounts = normalizeAccounts(parsed, commandsAfterSpawn, connectStaggerMs, host)

  return {
    host,
    port: Number(parsed.port || 25565),
    version: parsed.version === undefined ? false : parsed.version,
    connectStaggerMs,
    reconnect: {
      enabled: parsed.reconnect?.enabled !== false,
      minDelayMs: Number(parsed.reconnect?.minDelayMs || 5000),
      maxDelayMs: Number(parsed.reconnect?.maxDelayMs || 60000),
      backoffFactor: Number(parsed.reconnect?.backoffFactor || 1.6)
    },
    networkOptimization: {
      enabled: parsed.networkOptimization?.enabled !== false,
      viewDistance: parsed.networkOptimization?.viewDistance ?? 2,
      checkTimeoutIntervalMs: Number(parsed.networkOptimization?.checkTimeoutIntervalMs || 90000),
      chat: parsed.networkOptimization?.chat || 'enabled',
      colorsEnabled: parsed.networkOptimization?.colorsEnabled === true,
      hideSkinParts: parsed.networkOptimization?.hideSkinParts !== false
    },
    afk: {
      enabled: parsed.afk?.enabled !== false,
      intervalMs: Number(parsed.afk?.intervalMs || 45000),
      lookAround: parsed.afk?.lookAround !== false,
      swingArm: parsed.afk?.swingArm !== false,
      jump: parsed.afk?.jump === true
    },
    shardAfkGuard: {
      enabled: parsed.shardAfkGuard?.enabled !== false,
      checkAfterSpawnMs: Number(parsed.shardAfkGuard?.checkAfterSpawnMs || 30000),
      afkCommand: parsed.shardAfkGuard?.afkCommand || '/afk',
      guiWaitMs: Number(parsed.shardAfkGuard?.guiWaitMs || 10000),
      clickSlot: parsed.shardAfkGuard?.clickSlot === null ? null : Number(parsed.shardAfkGuard?.clickSlot ?? 0),
      itemNames: Array.isArray(parsed.shardAfkGuard?.itemNames)
        ? parsed.shardAfkGuard.itemNames
        : ['AFK 1', 'AfK 1']
    },
    booster: {
      enabled: parsed.booster?.enabled !== false,
      useAfterSpawnMs: Number(parsed.booster?.useAfterSpawnMs || 12000),
      itemNames: Array.isArray(parsed.booster?.itemNames)
        ? parsed.booster.itemNames
        : ['SHARD BOOSTER'],
      consumeTimeoutMs: Number(parsed.booster?.consumeTimeoutMs || 8000)
    },
    repeatingCommands: Array.isArray(parsed.repeatingCommands) ? parsed.repeatingCommands : [],
    discordWebhook: {
      enabled: parsed.discordWebhook?.enabled === true,
      url: parsed.discordWebhook?.url || '',
      username: parsed.discordWebhook?.username || 'Minecraft AFK Bot'
    },
    accounts
  }
}

function normalizeAccounts (parsed, defaultCommandsAfterSpawn, connectStaggerMs, host) {
  const rawAccounts = Array.isArray(parsed.accounts) && parsed.accounts.length > 0
    ? parsed.accounts
    : [{
        username: parsed.username || 'AFKBot',
        auth: parsed.auth || 'offline',
        profilesFolder: parsed.profilesFolder || './auth-cache',
        commandsAfterSpawn: defaultCommandsAfterSpawn
      }]

  return rawAccounts.map((account, index) => ({
    username: account.username || `AFKBot${index + 1}`,
    auth: account.auth || parsed.auth || 'offline',
    profilesFolder: account.profilesFolder || `./auth-cache/${account.username || `account-${index + 1}`}`,
    connectDelayMs: Number(account.connectDelayMs ?? (index * connectStaggerMs)),
    commandsAfterSpawn: Array.isArray(account.commandsAfterSpawn)
      ? account.commandsAfterSpawn
      : defaultCommandsAfterSpawn,
    proxy: normalizeProxy(account.proxy, host)
  }))
}

function normalizeProxy (proxy, serverHost) {
  if (!proxy || proxy.enabled !== true) return null

  const proxyHost = String(proxy.host || '').trim()
  const port = Number(proxy.port || 0)
  const type = normalizeProxyType(proxy.type || proxy.protocol || 5)
  if (!proxyHost || !port || !type) return null

  return {
    host: proxyHost,
    port,
    type,
    userId: proxy.username || proxy.userId || '',
    password: proxy.password || '',
    fakeHost: proxy.fakeHost === false ? false : (proxy.fakeHost || serverHost)
  }
}

function normalizeProxyType (type) {
  const value = String(type).toLowerCase().replace('socks', '')
  if (value === 'http' || value === 'https' || value === 'connect') return 'http'
  if (value === '4') return 4
  if (value === '5') return 5
  return null
}

function createSession (account, index) {
  return {
    account,
    index,
    bot: null,
    afkTimer: null,
    repeatingCommandTimers: [],
    reconnectTimer: null,
    connectTimer: null,
    initialShardCountdownTimer: null,
    afkGuiTimer: null,
    boosterTimer: null,
    boosterUsed: false,
    lastShardCountdownAt: 0,
    shardAfkGuardDone: false,
    pendingAfkGuiClick: false,
    reconnectAttempt: 0,
    hasSpawnedOnce: false,
    shouldReportReconnect: false
  }
}

function connect (session) {
  clearTimeout(session.reconnectTimer)
  clearTimeout(session.connectTimer)
  session.reconnectTimer = null
  session.connectTimer = null

  sessionLog(session, `Connecting to ${config.host}:${config.port} as ${session.account.username} (${session.account.auth})`)

  session.bot = mineflayer.createBot(createBotOptions(session))
  attachBotEvents(session)
}

function createBotOptions (session) {
  const options = {
    username: session.account.username,
    auth: session.account.auth,
    version: config.version,
    profilesFolder: path.resolve(__dirname, session.account.profilesFolder),
    keepAlive: true,
    checkTimeoutInterval: config.networkOptimization.checkTimeoutIntervalMs,
    viewDistance: config.networkOptimization.viewDistance,
    chat: config.networkOptimization.chat,
    colorsEnabled: config.networkOptimization.colorsEnabled,
    skinParts: getSkinPartsSetting(),
    respawn: true
  }

  if (session.account.proxy) {
    sessionLog(session, `Using ${formatProxyType(session.account.proxy.type)} proxy ${formatProxy(session.account.proxy)}.`)
    options.connect = createProxyConnector(session.account.proxy)
    if (session.account.proxy.fakeHost) options.fakeHost = session.account.proxy.fakeHost
    return options
  }

  options.host = config.host
  options.port = config.port
  return options
}

function createProxyConnector (proxy) {
  if (proxy.type === 'http') return createHttpProxyConnector(proxy)
  return createSocksProxyConnector(proxy)
}

function createSocksProxyConnector (proxy) {
  return (client) => {
    SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: proxy.type,
        userId: proxy.userId || undefined,
        password: proxy.password || undefined
      },
      command: 'connect',
      destination: {
        host: config.host,
        port: config.port
      }
    }, (err, info) => {
      if (err) {
        client.emit('error', err)
        return
      }

      client.setSocket(info.socket)
      client.emit('connect')
    })
  }
}

function createHttpProxyConnector (proxy) {
  return (client) => {
    const socket = net.connect(proxy.port, proxy.host)
    const onError = (err) => client.emit('error', err)

    socket.once('error', onError)
    socket.once('connect', () => {
      const headers = [
        `CONNECT ${config.host}:${config.port} HTTP/1.1`,
        `Host: ${config.host}:${config.port}`,
        'Proxy-Connection: Keep-Alive'
      ]

      if (proxy.userId || proxy.password) {
        const auth = Buffer.from(`${proxy.userId}:${proxy.password}`).toString('base64')
        headers.push(`Proxy-Authorization: Basic ${auth}`)
      }

      socket.write(`${headers.join('\r\n')}\r\n\r\n`)
    })

    let response = ''
    const onData = (chunk) => {
      response += chunk.toString('latin1')
      const headerEnd = response.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      socket.removeListener('data', onData)
      socket.removeListener('error', onError)

      const statusLine = response.slice(0, response.indexOf('\r\n'))
      if (!/^HTTP\/\d(?:\.\d)?\s+2\d\d\b/.test(statusLine)) {
        socket.destroy()
        client.emit('error', new Error(`HTTP proxy CONNECT failed: ${statusLine}`))
        return
      }

      client.setSocket(socket)
      client.emit('connect')
    }

    socket.on('data', onData)
  }
}

function formatProxyType (type) {
  return type === 'http' ? 'HTTP CONNECT' : `SOCKS${type}`
}

function formatProxy (proxy) {
  const auth = proxy.userId ? `${proxy.userId}:******@` : ''
  return `${auth}${proxy.host}:${proxy.port}`
}

function attachBotEvents (session) {
  const bot = session.bot

  bot.once('login', () => {
    sessionLog(session, 'Logged in.')
    session.reconnectAttempt = 0
  })

  bot.once('spawn', () => {
    sessionLog(session, 'Spawned. AFK loop is active.')
    applyNetworkOptimization(session)
    if (session.shouldReportReconnect) {
      sendStatusWebhook(session, 'Reconnected', `Bot ${session.account.username} reconnected to ${config.host}:${config.port}.`)
        .catch((err) => sessionLog(session, `Webhook failed: ${err.message || err}`))
      session.shouldReportReconnect = false
    }
    session.hasSpawnedOnce = true
    runCommandsAfterSpawn(session)
    startRepeatingCommands(session)
    startAfkLoop(session)
    scheduleInitialShardCountdownCheck(session)
    scheduleBoosterUse(session)
  })

  bot.on('message', (message) => {
    const text = message.toString().trim()
    if (text) sessionLog(session, `[CHAT] ${text}`)
    handleShardCountdown(session, text)
    handleShardMessage(session, text).catch((err) => sessionLog(session, `Webhook failed: ${err.message || err}`))
  })

  bot.on('windowOpen', (window) => {
    handleAfkWindow(session, window).catch((err) => sessionLog(session, `AFK GUI click failed: ${err.message || err}`))
  })

  bot.on('kicked', (reason) => {
    sessionLog(session, `Kicked: ${formatReason(reason)}`)
  })

  bot.on('error', (err) => {
    sessionLog(session, `Error: ${err.message || err}`)
  })

  bot.once('end', (reason) => {
    const disconnectReason = reason || 'socketClosed'
    sessionLog(session, `Disconnected: ${disconnectReason}`)
    if (!shuttingDown && session.hasSpawnedOnce) {
      session.shouldReportReconnect = true
      sendStatusWebhook(session, 'Disconnected', `Bot ${session.account.username} disconnected from ${config.host}:${config.port}. Reason: ${disconnectReason}`)
        .catch((err) => sessionLog(session, `Webhook failed: ${err.message || err}`))
    }
    stopAfkLoop(session)
    stopRepeatingCommands(session)
    stopShardAfkGuard(session)
    stopBoosterUse(session)
    session.bot = null
    scheduleReconnect(session)
  })

  bot.on('death', () => {
    sessionLog(session, 'Bot died. Mineflayer will respawn automatically when the server allows it.')
  })
}

function applyNetworkOptimization (session) {
  if (!config.networkOptimization.enabled || !session.bot?.setSettings) return

  session.bot.setSettings({
    viewDistance: config.networkOptimization.viewDistance,
    chat: config.networkOptimization.chat,
    colorsEnabled: config.networkOptimization.colorsEnabled,
    skinParts: getSkinPartsSetting(),
    enableServerListing: false
  })
  sessionLog(session, `Network optimization active: viewDistance=${config.networkOptimization.viewDistance}, timeout=${config.networkOptimization.checkTimeoutIntervalMs}ms.`)
}

function getSkinPartsSetting () {
  const visible = !config.networkOptimization.hideSkinParts
  return {
    showCape: visible,
    showJacket: visible,
    showLeftSleeve: visible,
    showRightSleeve: visible,
    showLeftPants: visible,
    showRightPants: visible,
    showHat: visible
  }
}

function startAfkLoop (session) {
  stopAfkLoop(session)

  if (!config.afk.enabled) {
    sessionLog(session, 'AFK actions are disabled in config.')
    return
  }

  session.afkTimer = setInterval(() => {
    if (!session.bot || !session.bot.entity) return
    doAfkAction(session).catch((err) => sessionLog(session, `AFK action failed: ${err.message || err}`))
  }, config.afk.intervalMs)

  doAfkAction(session).catch((err) => sessionLog(session, `AFK action failed: ${err.message || err}`))
}

function stopAfkLoop (session) {
  if (session.afkTimer) clearInterval(session.afkTimer)
  session.afkTimer = null
}

async function doAfkAction (session) {
  const bot = session.bot
  if (!bot || !bot.entity) return

  if (config.afk.lookAround) {
    const yaw = Math.random() * Math.PI * 2
    const pitch = (Math.random() - 0.5) * 0.4
    await bot.look(yaw, pitch, true)
  }

  if (config.afk.swingArm) {
    bot.swingArm('right')
  }

  if (config.afk.jump) {
    bot.setControlState('jump', true)
    setTimeout(() => {
      if (session.bot) session.bot.setControlState('jump', false)
    }, 350)
  }
}

function runCommandsAfterSpawn (session) {
  session.account.commandsAfterSpawn.forEach((command, index) => {
    const cleanCommand = String(command || '').trim()
    if (!cleanCommand) return

    setTimeout(() => {
      if (!session.bot) return
      sendCommand(session, cleanCommand, 'Running command after spawn')
    }, 2500 + (index * 2500))
  })
}

function scheduleBoosterUse (session) {
  if (!config.booster.enabled || session.boosterUsed || config.booster.useAfterSpawnMs < 1000) return

  clearTimeout(session.boosterTimer)
  session.boosterTimer = setTimeout(() => {
    session.boosterTimer = null
    useShardBoosterIfPresent(session).catch((err) => sessionLog(session, `Shard booster use failed: ${err.message || err}`))
  }, config.booster.useAfterSpawnMs)
}

function stopBoosterUse (session) {
  clearTimeout(session.boosterTimer)
  session.boosterTimer = null
}

async function useShardBoosterIfPresent (session) {
  if (!session.bot || session.boosterUsed) return

  const booster = findInventoryItemByNames(session.bot, config.booster.itemNames)
  if (!booster) {
    sessionLog(session, 'Shard booster not found in inventory.')
    return
  }

  session.boosterUsed = true
  sessionLog(session, `Using shard booster from slot ${booster.slot}.`)
  await session.bot.equip(booster, 'hand')
  await consumeHeldItem(session)
  sessionLog(session, 'Shard booster activated.')
}

function findInventoryItemByNames (bot, itemNames) {
  const needles = itemNames.map((name) => String(name).toLowerCase())

  return bot.inventory.items().find((item) => {
    const labels = getItemLabels(item).map((label) => label.toLowerCase())
    return labels.some((label) => needles.some((needle) => label.includes(needle)))
  })
}

async function consumeHeldItem (session) {
  try {
    await withTimeout(session.bot.consume(), config.booster.consumeTimeoutMs, 'consume timed out')
  } catch (err) {
    sessionLog(session, `Consume did not complete (${err.message || err}); trying activateItem fallback.`)
    session.bot.activateItem()
    await sleep(1500)
    session.bot.deactivateItem()
  }
}

function withTimeout (promise, timeoutMs, message) {
  let timer = null

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startRepeatingCommands (session) {
  stopRepeatingCommands(session)

  for (const entry of config.repeatingCommands) {
    const command = String(entry.command || '').trim()
    const intervalMs = Number(entry.intervalMs || 0)
    const initialDelayMs = Number(entry.initialDelayMs || intervalMs)

    if (!command || intervalMs < 1000) continue

    const run = () => sendCommand(session, command, 'Running repeating command')
    const initialTimer = setTimeout(() => {
      run()
      const intervalTimer = setInterval(run, intervalMs)
      session.repeatingCommandTimers.push(intervalTimer)
    }, initialDelayMs)

    session.repeatingCommandTimers.push(initialTimer)
    sessionLog(session, `Scheduled repeating command ${redactCommand(normalizeCommand(command))} every ${Math.round(intervalMs / 1000)}s.`)
  }
}

function stopRepeatingCommands (session) {
  for (const timer of session.repeatingCommandTimers) {
    clearTimeout(timer)
    clearInterval(timer)
  }

  session.repeatingCommandTimers = []
}

function sendCommand (session, command, label) {
  if (!session.bot) return
  const message = normalizeCommand(command)
  sessionLog(session, `${label}: ${redactCommand(message)}`)
  session.bot.chat(message)
}

function normalizeCommand (command) {
  const cleanCommand = String(command || '').trim()
  return cleanCommand.startsWith('/') ? cleanCommand : `/${cleanCommand}`
}

function redactCommand (message) {
  if (/^\/(?:login|register|l)\b/i.test(message)) {
    const [command] = message.split(/\s+/, 1)
    return `${command} ******`
  }

  return message
}

async function handleShardMessage (session, text) {
  const match = text.match(/\bYour\s+shards:\s*([\d,]+)/i)
  if (!match) return

  const shards = match[1].replace(/,/g, '')
  await sendShardWebhook(session, shards)
}

function handleShardCountdown (session, text) {
  if (session.shardAfkGuardDone) return

  if (!/\bNext\s+shard\s+in\s+\d+\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b/i.test(text)) {
    return
  }

  session.lastShardCountdownAt = Date.now()
  clearTimeout(session.initialShardCountdownTimer)
  session.initialShardCountdownTimer = null
  session.shardAfkGuardDone = true
  sessionLog(session, 'Shard countdown detected.')
}

function scheduleInitialShardCountdownCheck (session) {
  if (
    !config.shardAfkGuard.enabled ||
    session.shardAfkGuardDone ||
    config.shardAfkGuard.checkAfterSpawnMs < 1000
  ) return

  clearTimeout(session.initialShardCountdownTimer)
  const startedAt = Date.now()

  session.initialShardCountdownTimer = setTimeout(() => {
    session.initialShardCountdownTimer = null
    if (session.lastShardCountdownAt >= startedAt || session.shardAfkGuardDone) return
    session.shardAfkGuardDone = true
    enterAfkArea(session, 'No shard countdown detected after spawn, opening AFK GUI')
  }, config.shardAfkGuard.checkAfterSpawnMs)
}

function enterAfkArea (session, label) {
  if (!session.bot) return

  session.pendingAfkGuiClick = true
  clearTimeout(session.afkGuiTimer)
  session.afkGuiTimer = setTimeout(() => {
    if (session.pendingAfkGuiClick) {
      session.pendingAfkGuiClick = false
      sessionLog(session, 'AFK GUI did not open before timeout.')
    }
  }, config.shardAfkGuard.guiWaitMs)

  sendCommand(session, config.shardAfkGuard.afkCommand, label)
}

async function handleAfkWindow (session, window) {
  if (!session.pendingAfkGuiClick || !session.bot) return

  const slot = findAfkClickSlot(window)
  if (slot === null) {
    sessionLog(session, 'AFK GUI opened, but target item was not found.')
    return
  }

  clearTimeout(session.afkGuiTimer)
  session.afkGuiTimer = null
  session.pendingAfkGuiClick = false
  sessionLog(session, `Clicking AFK GUI slot ${slot}.`)
  await session.bot.clickWindow(slot, 0, 0)
}

function findAfkClickSlot (window) {
  const namedSlot = findSlotByItemName(window)
  if (namedSlot !== null) return namedSlot

  if (Number.isInteger(config.shardAfkGuard.clickSlot)) {
    return config.shardAfkGuard.clickSlot
  }

  return null
}

function findSlotByItemName (window) {
  const itemNames = config.shardAfkGuard.itemNames.map((name) => String(name).toLowerCase())
  const inventoryStart = window.inventoryStart || window.slots.length

  for (let slot = 0; slot < inventoryStart; slot++) {
    const item = window.slots[slot]
    if (!item) continue

    const labels = getItemLabels(item).map((label) => label.toLowerCase())
    if (labels.some((label) => itemNames.some((name) => label.includes(name)))) {
      return slot
    }
  }

  return null
}

function getItemLabels (item) {
  const labels = [item.displayName, item.name, item.customName].filter(Boolean).map(String)
  const displayName = item.nbt?.value?.display?.value?.Name?.value
  const lore = item.nbt?.value?.display?.value?.Lore?.value?.value

  if (displayName) labels.push(stripMinecraftJsonText(displayName))
  if (Array.isArray(lore)) {
    for (const line of lore) labels.push(stripMinecraftJsonText(line))
  }

  return labels.filter(Boolean)
}

function stripMinecraftJsonText (value) {
  const text = String(value)
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'string') return parsed
    if (parsed.text) return String(parsed.text)
    if (Array.isArray(parsed.extra)) return parsed.extra.map((part) => part.text || '').join('')
  } catch {
    return text.replace(/§[0-9A-FK-OR]/gi, '')
  }

  return text.replace(/§[0-9A-FK-OR]/gi, '')
}

function stopShardAfkGuard (session) {
  clearTimeout(session.initialShardCountdownTimer)
  clearTimeout(session.afkGuiTimer)
  session.initialShardCountdownTimer = null
  session.afkGuiTimer = null
  session.pendingAfkGuiClick = false
}

async function sendShardWebhook (session, shards) {
  await sendDiscordWebhook(`Shards ${session.account.username}: ${shards}`)
  sessionLog(session, `Sent shards count to Discord: ${shards}`)
}

async function sendStatusWebhook (session, title, details) {
  await sendDiscordWebhook(`**${title}**\n${details}`)
  sessionLog(session, `Sent ${title.toLowerCase()} status to Discord.`)
}

async function sendDiscordWebhook (content) {
  if (!config.discordWebhook.enabled || !config.discordWebhook.url) return

  const payload = {
    username: config.discordWebhook.username,
    content
  }

  const response = await fetch(config.discordWebhook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '')
    throw new Error(`Discord responded ${response.status}${responseText ? `: ${responseText}` : ''}`)
  }
}

function scheduleReconnect (session) {
  if (shuttingDown || !config.reconnect.enabled) return

  session.reconnectAttempt += 1
  const delay = Math.min(
    config.reconnect.maxDelayMs,
    Math.round(config.reconnect.minDelayMs * Math.pow(config.reconnect.backoffFactor, session.reconnectAttempt - 1))
  )

  sessionLog(session, `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${session.reconnectAttempt}).`)
  session.reconnectTimer = setTimeout(() => connect(session), delay)
}

function formatReason (reason) {
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function sessionLog (session, message) {
  log(`[${session.account.username}] ${message}`)
}

function log (message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function shutdown () {
  if (shuttingDown) return
  shuttingDown = true

  for (const session of sessions) {
    stopAfkLoop(session)
    stopRepeatingCommands(session)
    stopShardAfkGuard(session)
    clearTimeout(session.reconnectTimer)
    clearTimeout(session.connectTimer)

    if (session.bot) {
      sessionLog(session, 'Stopping bot...')
      session.bot.quit('Stopping AFK bot')
    }
  }

  setTimeout(() => process.exit(0), 500)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
