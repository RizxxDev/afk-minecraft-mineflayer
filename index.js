const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')

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
  const accounts = normalizeAccounts(parsed, commandsAfterSpawn, connectStaggerMs)

  return {
    host: parsed.host || 'localhost',
    port: Number(parsed.port || 25565),
    version: parsed.version === undefined ? false : parsed.version,
    connectStaggerMs,
    reconnect: {
      enabled: parsed.reconnect?.enabled !== false,
      minDelayMs: Number(parsed.reconnect?.minDelayMs || 5000),
      maxDelayMs: Number(parsed.reconnect?.maxDelayMs || 60000),
      backoffFactor: Number(parsed.reconnect?.backoffFactor || 1.6)
    },
    afk: {
      enabled: parsed.afk?.enabled !== false,
      intervalMs: Number(parsed.afk?.intervalMs || 45000),
      lookAround: parsed.afk?.lookAround !== false,
      swingArm: parsed.afk?.swingArm !== false,
      jump: parsed.afk?.jump === true
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

function normalizeAccounts (parsed, defaultCommandsAfterSpawn, connectStaggerMs) {
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
      : defaultCommandsAfterSpawn
  }))
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

  session.bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: session.account.username,
    auth: session.account.auth,
    version: config.version,
    profilesFolder: path.resolve(__dirname, session.account.profilesFolder),
    keepAlive: true,
    checkTimeoutInterval: 30 * 1000,
    respawn: true
  })

  session.bot.once('login', () => {
    sessionLog(session, 'Logged in.')
    session.reconnectAttempt = 0
  })

  session.bot.once('spawn', () => {
    sessionLog(session, 'Spawned. AFK loop is active.')
    if (session.shouldReportReconnect) {
      sendStatusWebhook(session, 'Reconnected', `Bot ${session.account.username} reconnected to ${config.host}:${config.port}.`)
        .catch((err) => sessionLog(session, `Webhook failed: ${err.message || err}`))
      session.shouldReportReconnect = false
    }
    session.hasSpawnedOnce = true
    runCommandsAfterSpawn(session)
    startRepeatingCommands(session)
    startAfkLoop(session)
  })

  session.bot.on('message', (message) => {
    const text = message.toString().trim()
    if (text) sessionLog(session, `[CHAT] ${text}`)
    handleShardMessage(session, text).catch((err) => sessionLog(session, `Webhook failed: ${err.message || err}`))
  })

  session.bot.on('kicked', (reason) => {
    sessionLog(session, `Kicked: ${formatReason(reason)}`)
  })

  session.bot.on('error', (err) => {
    sessionLog(session, `Error: ${err.message || err}`)
  })

  session.bot.once('end', (reason) => {
    const disconnectReason = reason || 'socketClosed'
    sessionLog(session, `Disconnected: ${disconnectReason}`)
    if (!shuttingDown && session.hasSpawnedOnce) {
      session.shouldReportReconnect = true
      sendStatusWebhook(session, 'Disconnected', `Bot ${session.account.username} disconnected from ${config.host}:${config.port}. Reason: ${disconnectReason}`)
        .catch((err) => sessionLog(session, `Webhook failed: ${err.message || err}`))
    }
    stopAfkLoop(session)
    stopRepeatingCommands(session)
    session.bot = null
    scheduleReconnect(session)
  })

  session.bot.on('death', () => {
    sessionLog(session, 'Bot died. Mineflayer will respawn automatically when the server allows it.')
  })
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
