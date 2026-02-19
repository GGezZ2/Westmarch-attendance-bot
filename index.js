require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
} = require("discord.js");

const { openDb, initDb, run, all } = require("./db");
const {
  isValidDateYYYYMMDD,
  todayYYYYMMDD,
  minusDaysYYYYMMDD,
  daysBetween,
  hasRoleByName,
} = require("./util");

const GM_ROLE_NAME = process.env.GM_ROLE_NAME || "Gm-bot";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const db = openDb(process.env.DB_PATH || "./data.sqlite");
initDb(db);

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Helpers: resolve display names
async function resolveNames(guild, userIds) {
  const unique = [...new Set(userIds)];
  const out = [];
  for (const id of unique) {
    try {
      const m = await guild.members.fetch(id);
      out.push({ id, name: m.displayName });
    } catch {
      out.push({ id, name: `user:${id}` });
    }
  }
  return out;
}

// ===== Pending state in RAM (ephemeral flows) =====
// Keyed per-guild per-user, così due GM diversi non si pestano i piedi.
function keyFor(interaction) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

const pendingAdd = new Map(); // key -> { date, masterId, masterName, playerIds: Set<string> }
const pendingSuggest = new Map(); // key -> { slots, lookbackDays, ignoreDays, bookedIds: Set<string> }

function buildAddComponents(key) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`shot_add_select|${key}`)
    .setPlaceholder("Seleziona giocatori (max 25)")
    .setMinValues(1)
    .setMaxValues(25);

  const row1 = new ActionRowBuilder().addComponents(select);

  const btnReset = new ButtonBuilder()
    .setCustomId(`shot_add_reset|${key}`)
    .setLabel("Reset")
    .setStyle(ButtonStyle.Secondary);

  const btnConfirm = new ButtonBuilder()
    .setCustomId(`shot_add_confirm|${key}`)
    .setLabel("Conferma & salva")
    .setStyle(ButtonStyle.Success);

  const btnCancel = new ButtonBuilder()
    .setCustomId(`shot_add_cancel|${key}`)
    .setLabel("Annulla")
    .setStyle(ButtonStyle.Danger);

  const row2 = new ActionRowBuilder().addComponents(btnReset, btnConfirm, btnCancel);

  return [row1, row2];
}

function buildSuggestComponents(key) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`shot_suggest_select|${key}`)
    .setPlaceholder("Seleziona prenotati (max 25)")
    .setMinValues(1)
    .setMaxValues(25);

  const row1 = new ActionRowBuilder().addComponents(select);

  const btnReset = new ButtonBuilder()
    .setCustomId(`shot_suggest_reset|${key}`)
    .setLabel("Reset")
    .setStyle(ButtonStyle.Secondary);

  const btnConfirm = new ButtonBuilder()
    .setCustomId(`shot_suggest_confirm|${key}`)
    .setLabel("Calcola suggerimento")
    .setStyle(ButtonStyle.Success);

  const btnCancel = new ButtonBuilder()
    .setCustomId(`shot_suggest_cancel|${key}`)
    .setLabel("Annulla")
    .setStyle(ButtonStyle.Danger);

  const row2 = new ActionRowBuilder().addComponents(btnReset, btnConfirm, btnCancel);

  return [row1, row2];
}

function previewList(names, max = 10) {
  if (names.length === 0) return "_nessuno_";
  const shown = names.slice(0, max);
  const more = names.length > max ? ` …(+${names.length - max})` : "";
  return shown.map((n) => `**${n}**`).join(", ") + more;
}

client.on("interactionCreate", async (interaction) => {
  try {
    // ===== Slash commands =====
    if (interaction.isChatInputCommand() && interaction.commandName === "shot") {
      const sub = interaction.options.getSubcommand();
      const isGm = await hasRoleByName(interaction, GM_ROLE_NAME);

      if (sub === "add") {
        if (!isGm) {
          return interaction.reply({ content: `❌ Serve il ruolo @${GM_ROLE_NAME}.`, ephemeral: true });
        }

        const date = interaction.options.getString("date", true);
        const master = interaction.options.getUser("master", true);

        if (!isValidDateYYYYMMDD(date)) {
          return interaction.reply({ content: "❌ Data non valida. Usa YYYY-MM-DD.", ephemeral: true });
        }

        const key = keyFor(interaction);
        pendingAdd.set(key, {
          date,
          masterId: master.id,
          masterName: master.username,
          playerIds: new Set(),
        });

        const components = buildAddComponents(key);

        return interaction.reply({
          ephemeral: true,
          content:
            `📝 **Registra shot**\n` +
            `📅 Data: **${date}**\n` +
            `🎲 Master: **${master.username}**\n\n` +
            `Seleziona i giocatori dal menu (max 25) e poi premi **Conferma & salva**.`,
          components,
        });
      }

      if (sub === "suggest") {
        if (!isGm) {
          return interaction.reply({ content: `❌ Serve il ruolo @${GM_ROLE_NAME}.`, ephemeral: true });
        }

        const slots = interaction.options.getInteger("slots") ?? 4;
        const lookbackDays = interaction.options.getInteger("lookback_days") ?? 30;
        const ignoreDays = interaction.options.getInteger("ignore_days") ?? 0;

        const key = keyFor(interaction);
        pendingSuggest.set(key, {
          slots,
          lookbackDays,
          ignoreDays,
          bookedIds: new Set(),
        });

        const components = buildSuggestComponents(key);

        return interaction.reply({
          ephemeral: true,
          content:
            `🎯 **Suggerisci roster dai prenotati**\n` +
            `Slots: **${slots}** — lookback: **${lookbackDays}g** — ignore: **${ignoreDays}g**\n\n` +
            `Seleziona i prenotati dal menu (max 25) e poi premi **Calcola suggerimento**.`,
          components,
        });
      }

      if (sub === "stats") {
        const today = todayYYYYMMDD();
        const to = interaction.options.getString("to") || today;
        const from = interaction.options.getString("from") || minusDaysYYYYMMDD(to, 30);

        if (!isValidDateYYYYMMDD(from) || !isValidDateYYYYMMDD(to) || from > to) {
          return interaction.reply({ content: "❌ Range date non valido (from/to in YYYY-MM-DD).", ephemeral: true });
        }

        const rows = await all(
          db,
          `
          SELECT
            a.player_id,
            a.player_name,
            COUNT(*) as sessions,
            MAX(s.shot_date) as last_date
          FROM attendance a
          JOIN shots s ON s.id = a.shot_id
          WHERE s.shot_date BETWEEN ? AND ?
          GROUP BY a.player_id, a.player_name
          ORDER BY sessions DESC, last_date DESC
          `,
          [from, to]
        );

        if (rows.length === 0) {
          return interaction.reply({ content: `Nessuna shot tra **${from}** e **${to}**.`, ephemeral: true });
        }

        const lines = rows
          .slice(0, 40)
          .map((r) => `• **${r.player_name}** — ${r.sessions} sessioni, ultima: ${r.last_date}`);

        return interaction.reply({
          content:
            `📊 **Presenze** (${from} → ${to})\n` +
            lines.join("\n") +
            (rows.length > 40 ? `\n…+${rows.length - 40}` : ""),
        });
      }
    }

    // ===== User select menus =====
    if (interaction.isUserSelectMenu()) {
      const [kind, key] = interaction.customId.split("|");

      // ADD: selezione giocatori
      if (kind === "shot_add_select") {
        const isGm = await hasRoleByName(interaction, GM_ROLE_NAME);
        if (!isGm) return interaction.reply({ content: `❌ Serve il ruolo @${GM_ROLE_NAME}.`, ephemeral: true });

        const pending = pendingAdd.get(key);
        if (!pending) return interaction.reply({ content: "❌ Sessione scaduta. Rifai `/shot add`.", ephemeral: true });

        for (const id of interaction.values) {
          if (id !== pending.masterId) pending.playerIds.add(id);
        }

        const resolved = await resolveNames(interaction.guild, [...pending.playerIds]);

        return interaction.reply({
          ephemeral: true,
          content:
            `✅ Selezionati: **${interaction.values.length}** — Totale in lista: **${pending.playerIds.size}**\n` +
            `Anteprima: ${previewList(resolved.map((x) => x.name))}\n\n` +
            `Se vuoi cambiare, premi **Reset** e riseleziona. Poi **Conferma & salva**.`,
        });
      }

      // SUGGEST: selezione prenotati
      if (kind === "shot_suggest_select") {
        const isGm = await hasRoleByName(interaction, GM_ROLE_NAME);
        if (!isGm) return interaction.reply({ content: `❌ Serve il ruolo @${GM_ROLE_NAME}.`, ephemeral: true });

        const pending = pendingSuggest.get(key);
        if (!pending) return interaction.reply({ content: "❌ Sessione scaduta. Rifai `/shot suggest`.", ephemeral: true });

        for (const id of interaction.values) {
          pending.bookedIds.add(id);
        }

        const resolved = await resolveNames(interaction.guild, [...pending.bookedIds]);

        return interaction.reply({
          ephemeral: true,
          content:
            `✅ Selezionati: **${interaction.values.length}** — Totale prenotati: **${pending.bookedIds.size}**\n` +
            `Anteprima: ${previewList(resolved.map((x) => x.name))}\n\n` +
            `Se vuoi cambiare, premi **Reset**. Poi **Calcola suggerimento**.`,
        });
      }
    }

    // ===== Buttons =====
    if (interaction.isButton()) {
      const [kind, key] = interaction.customId.split("|");

      // ---- ADD buttons ----
      if (kind === "shot_add_reset") {
        const pending = pendingAdd.get(key);
        if (!pending) return interaction.reply({ content: "❌ Sessione scaduta. Rifai `/shot add`.", ephemeral: true });
        pending.playerIds.clear();
        return interaction.reply({ content: "🧹 Lista giocatori resettata. Riseleziona dal menu.", ephemeral: true });
      }

      if (kind === "shot_add_cancel") {
        pendingAdd.delete(key);
        return interaction.update({ content: "❎ Operazione annullata.", components: [] });
      }

      if (kind === "shot_add_confirm") {
        const isGm = await hasRoleByName(interaction, GM_ROLE_NAME);
        if (!isGm) return interaction.reply({ content: `❌ Serve il ruolo @${GM_ROLE_NAME}.`, ephemeral: true });

        const pending = pendingAdd.get(key);
        if (!pending) return interaction.reply({ content: "❌ Sessione scaduta. Rifai `/shot add`.", ephemeral: true });

        if (pending.playerIds.size === 0) {
          return interaction.reply({ content: "❌ Nessun giocatore selezionato. Usa il menu (max 25).", ephemeral: true });
        }

        const createdAt = new Date().toISOString();
        const insShot = await run(
          db,
          `INSERT INTO shots (shot_date, master_id, master_nam_
