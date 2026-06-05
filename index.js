const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')

const configPath = path.join(__dirname, 'config.json')
const exampleConfigPath = path.join(__dirname, 'config.example.json')
const config = loadConfig()

let bot = null
let afkTimer = null
let repeatingCommandTimers = []
let reconnectTimer = null
let reconnectAttempt = 0
let hasSpawnedOnce = false
let shouldReportReconnect = false
let shuttingDown = false

connect()

function loadConfig () {
  const file = fs.existsSync(configPath) ? configPath : exampleConfigPath
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))

  return {
    host: parsed.host || 'localhost',
    port: Number(parsed.port || 25565),
    username: parsed.username || 'AFKBot',
    auth: parsed.auth || 'offline',
    version: parsed.version === undefined ? false : parsed.version,
    profilesFolder: parsed.profilesFolder || './auth-cache',
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
    commandsAfterSpawn: Array.isArray(parsed.commandsAfterSpawn) ? parsed.commandsAfterSpawn : [],
    repeatingCommands: Array.isArray(parsed.repeatingCommands) ? parsed.repeatingCommands : [],
    discordWebhook: {
      enabled: parsed.discordWebhook?.enabled === true,
      url: parsed.discordWebhook?.url || '',
      username: parsed.discordWebhook?.username || 'Minecraft AFK Bot'
    }
  }
}

function connect () {
  clearTimeout(reconnectTimer)
  reconnectTimer = null

  log(`Connecting to ${config.host}:${config.port} as ${config.username} (${config.auth})`)

  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: config.version,
    profilesFolder: path.resolve(__dirname, config.profilesFolder),
    keepAlive: true,
    checkTimeoutInterval: 30 * 1000,
    respawn: true
  })

  bot.once('login', () => {
    log('Logged in.')
    reconnectAttempt = 0
  })

  bot.once('spawn', () => {
    log('Spawned. AFK loop is active.')
    if (shouldReportReconnect) {
      sendStatusWebhook('Reconnected', `Bot ${config.username} reconnected to ${config.host}:${config.port}.`)
        .catch((err) => log(`Webhook failed: ${err.message || err}`))
      shouldReportReconnect = false
    }
    hasSpawnedOnce = true
    runCommandsAfterSpawn()
    startRepeatingCommands()
    startAfkLoop()
  })

  bot.on('message', (message) => {
    const text = message.toString().trim()
    if (text) log(`[CHAT] ${text}`)
    handleShardMessage(text).catch((err) => log(`Webhook failed: ${err.message || err}`))
  })

  bot.on('kicked', (reason) => {
    log(`Kicked: ${formatReason(reason)}`)
  })

  bot.on('error', (err) => {
    log(`Error: ${err.message || err}`)
  })

  bot.once('end', (reason) => {
    const disconnectReason = reason || 'socketClosed'
    log(`Disconnected: ${disconnectReason}`)
    if (!shuttingDown && hasSpawnedOnce) {
      shouldReportReconnect = true
      sendStatusWebhook('Disconnected', `Bot ${config.username} disconnected from ${config.host}:${config.port}. Reason: ${disconnectReason}`)
        .catch((err) => log(`Webhook failed: ${err.message || err}`))
    }
    stopAfkLoop()
    stopRepeatingCommands()
    bot = null
    scheduleReconnect()
  })

  bot.on('death', () => {
    log('Bot died. Mineflayer will respawn automatically when the server allows it.')
  })
}

function startAfkLoop () {
  stopAfkLoop()

  if (!config.afk.enabled) {
    log('AFK actions are disabled in config.')
    return
  }

  afkTimer = setInterval(() => {
    if (!bot || !bot.entity) return
    doAfkAction().catch((err) => log(`AFK action failed: ${err.message || err}`))
  }, config.afk.intervalMs)

  doAfkAction().catch((err) => log(`AFK action failed: ${err.message || err}`))
}

function stopAfkLoop () {
  if (afkTimer) clearInterval(afkTimer)
  afkTimer = null
}

async function doAfkAction () {
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
      if (bot) bot.setControlState('jump', false)
    }, 350)
  }
}

function runCommandsAfterSpawn () {
  config.commandsAfterSpawn.forEach((command, index) => {
    const cleanCommand = String(command || '').trim()
    if (!cleanCommand) return

    setTimeout(() => {
      if (!bot) return
      sendCommand(cleanCommand, 'Running command after spawn')
    }, 2500 + (index * 2500))
  })
}

function startRepeatingCommands () {
  stopRepeatingCommands()

  for (const entry of config.repeatingCommands) {
    const command = String(entry.command || '').trim()
    const intervalMs = Number(entry.intervalMs || 0)
    const initialDelayMs = Number(entry.initialDelayMs || intervalMs)

    if (!command || intervalMs < 1000) continue

    const run = () => sendCommand(command, 'Running repeating command')
    const initialTimer = setTimeout(() => {
      run()
      const intervalTimer = setInterval(run, intervalMs)
      repeatingCommandTimers.push(intervalTimer)
    }, initialDelayMs)

    repeatingCommandTimers.push(initialTimer)
    log(`Scheduled repeating command ${redactCommand(normalizeCommand(command))} every ${Math.round(intervalMs / 1000)}s.`)
  }
}

function stopRepeatingCommands () {
  for (const timer of repeatingCommandTimers) {
    clearTimeout(timer)
    clearInterval(timer)
  }

  repeatingCommandTimers = []
}

function sendCommand (command, label) {
  if (!bot) return
  const message = normalizeCommand(command)
  log(`${label}: ${redactCommand(message)}`)
  bot.chat(message)
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

async function handleShardMessage (text) {
  const match = text.match(/\bYour\s+shards:\s*([\d,]+)/i)
  if (!match) return

  const shards = match[1].replace(/,/g, '')
  await sendShardWebhook(shards)
}

async function sendShardWebhook (shards) {
  await sendDiscordWebhook(`Shards ${config.username}: ${shards}`)
  log(`Sent shards count to Discord: ${shards}`)
}

async function sendStatusWebhook (title, details) {
  await sendDiscordWebhook(`**${title}**\n${details}`)
  log(`Sent ${title.toLowerCase()} status to Discord.`)
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

function scheduleReconnect () {
  if (shuttingDown || !config.reconnect.enabled) return

  reconnectAttempt += 1
  const delay = Math.min(
    config.reconnect.maxDelayMs,
    Math.round(config.reconnect.minDelayMs * Math.pow(config.reconnect.backoffFactor, reconnectAttempt - 1))
  )

  log(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempt}).`)
  reconnectTimer = setTimeout(connect, delay)
}

function formatReason (reason) {
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function log (message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function shutdown () {
  if (shuttingDown) return
  shuttingDown = true
  stopAfkLoop()
  stopRepeatingCommands()
  clearTimeout(reconnectTimer)

  if (bot) {
    log('Stopping bot...')
    bot.quit('Stopping AFK bot')
  }

  setTimeout(() => process.exit(0), 500)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
