const fs = require('fs');
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

const token = process.env.DISCORD_TOKEN || config.token;
if (!token) {
  console.error('Missing token: set DISCORD_TOKEN or copy config.example.json to config.json');
  process.exit(1);
}

client.once('clientReady', async () => {
  const body = [];
  for (const file of commandFiles) {
    const command = require(path.join(commandsDir, file));
    body.push(command.data.toJSON());
  }
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(client.user.id), { body });
  console.log('Slash commands registered.');
});

client.on('interactionCreate', async interaction => {
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