const fs = require('fs');
const http = require('http');
const path = require('path');
const { Client, Collection, GatewayIntentBits, MessageFlags, REST, Routes } = require('discord.js');

let config = {};
try {
  config = require('./config.json');
} catch {
  /* Railway / الإنتاج: استخدم متغير DISCORD_TOKEN */
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

client.commands = new Collection();

const commandsDir = path.join(__dirname, 'commands');
const eventsDir = path.join(__dirname, 'events');

const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsDir, file));
  client.commands.set(command.data.name, command);
}

const eventFiles = fs.readdirSync(eventsDir).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsDir, file));
  client.on(event.name, (...args) => event.execute(...args));
}

const token =
  process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || config.token;
if (!token) {
  console.error(
    '[bot] Missing token. In Railway: open your service → Variables → Raw Editor (or Add Variable). ' +
      'Set name DISCORD_TOKEN and value = your bot token from Discord Developer Portal. Then redeploy. ' +
      '(Optional alias: BOT_TOKEN.)'
  );
  process.exit(1);
}

/* Railway (وغيرها) يتوقع خدمة تستمع على PORT وإلا يُرسل SIGTERM. بوت ديسكورد لا يفتح منفذ HTTP من تلقاء نفسه. */
const railPort = process.env.PORT;
if (railPort) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
    })
    .listen(Number(railPort), '0.0.0.0', () => {
      console.log(`[health] HTTP على المنفذ ${railPort} (فحص الصحة / Railway)`);
    });
}

process.once('SIGTERM', () => {
  console.log('[bot] SIGTERM — إغلاق الاتصال…');
  client
    .destroy()
    .then(() => process.exit(0))
    .catch(() => process.exit(0));
});

client.once('clientReady', async () => {
  const body = [];
  for (const file of commandFiles) {
    const command = require(path.join(commandsDir, file));
    body.push(command.data.toJSON());
  }
  const rest = new REST().setToken(token);
  const names = body.map(c => c.name).join(', ');
  const guildId =
    process.env.DISCORD_GUILD_ID ||
    process.env.GUILD_ID ||
    process.env.RAILWAY_GUILD_ID;

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log(
      `[commands] Registered globally (${body.length}): ${names}. ` +
        'قد يستغرق ظهورها في كل السيرفرات حتى ~1 ساعة.'
    );
    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body }
      );
      console.log(
        `[commands] Registered for guild ${guildId} — الأوامر تظهر هنا فوراً (بدون انتظار).`
      );
    } else {
      console.log(
        '[commands] Tip: أضف DISCORD_GUILD_ID في Railway (معرّف السيرفر) لتسجيل أوامر فورية في سيرفرك.'
      );
    }
  } catch (err) {
    console.error('[commands] فشل تسجيل slash commands:', err);
  }

  const soundLib = require('./lib/soundLibrary');
  console.log(`[sounds] Storage: ${soundLib.soundsDir}`);
  if (!process.env.SOUNDS_DIR) {
    console.warn(
      '[sounds] بدون SOUNDS_DIR الملفات على القرص المؤقت — أي redeploy يمسح الأصوات. على Railway: أضف Volume واضبط SOUNDS_DIR (مثل /data/sounds).'
    );
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(err);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const payload = { content: 'حدث خطأ أثناء تنفيذ الأمر.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

client.login(token);