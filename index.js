require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");

const { openDb, initDb, run, all } = require("./db");
const {
  isValidDateYYYYMMDD,
  todayYYYYMMDD,
  minusDaysYYYYMMDD,
  daysBetween,
  parseMentionedUserIds,
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

client.on("interactionCreate", async (interaction) => {
  try {
    // 1) Slash commands
    if (interaction.isChatInputCommand() && interaction.commandName === "shot") {
      const sub = interaction.options.getSubcommand();

      // Restrizione ruolo per i comandi “operativi”
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

        // Modal per incollare giocatori (senza limiti pratici)
        const modal = new ModalBuilder()
          .setCustomId(`shot_add_modal|${date}|${master.id}|${master.username}`)
          .setTitle("Registra Oneshoot - Giocatori");

        const input = new TextInputBuilder()
          .setCustomId("players_text")
          .setLabel("Incolla qui i giocatori (menzioni @... anche su più righe)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (sub === "suggest") {
        if (!isGm) {
          return interaction.reply({ content: `❌ Serve il ruolo @${GM_ROLE_NAME}.`, ephemeral: true });
        }

        const slots = interaction.options.getInteger("slots") ?? 4;
        const lookbackDays = interaction.options.getInteger("lookback_days") ?? 30;
        const ignoreDays = interaction.options.getInteger("ignore_days") ?? 0;

        const modal = new ModalBuilder()
          .setCustomId(`shot_suggest_modal|${slots}|${lookbackDays}|${ignoreDays}`)
          .setTitle("Suggerisci roster - Prenotati");

        const input = new TextInputBuilder()
          .setCustomId("booked_text")
          .setLabel("Incolla qui i prenotati (menzioni @... anche su più righe)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (sub === "stats") {
        // stats: se vuoi restringerlo al ruolo GM, basta mettere:
        // if (!isGm) return interaction.reply({ ... })
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

        // (Compatto per evitare wall-of-text)
        const lines = rows.slice(0, 40).map((r) => `• **${r.player_name}** — ${r.sessions} sessioni, ultima: ${r.last_date}`);
        return interaction.reply({
          content: `📊 **Presenze** (${from} → ${to})\n` + lines.join("\n") + (rows.length > 40 ? `\n…+${rows.length - 40}` : ""),
        });
      }
    }

    // 2) Modal submits
    if (interaction.isModalSubmit()) {
      // shot add modal
      if (interaction.customId.startsWith("shot_add_modal|")) {
        const isGm = await hasRoleByName(interaction, GM_ROLE_NAME);
        if (!isGm) return interaction.reply({ content: `❌ Serve il ruolo @${GM_ROLE_NAME}.`, ephemeral: true });

        const parts = interaction.customId.split("|");
        const date = parts[1];
        const masterId = parts[2];
        const masterName = parts[3];

        const text = interaction.fields.getTextInputValue("players_text");
        const playerIds = parseMentionedUserIds(text);

        const uniquePlayerIds = [...new Set(playerIds)].filter((id) => id !== masterId);

        if (uniquePlayerIds.length === 0) {
          return interaction.reply({ content: "❌ Non ho trovato menzioni valide nel testo.", ephemeral: true });
        }

        const createdAt = new Date().toISOString();
        const insShot = await run(
          db,
          `INSERT INTO shots (shot_date, master_id, master_name, created_by_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [date, masterId, masterName, interaction.user.id, createdAt]
        );

        const shotId = insShot.lastID;
        const resolved = await resolveNames(interaction.guild, uniquePlayerIds);

        for (const p of resolved) {
          await run(
            db,
            `INSERT OR IGNORE INTO attendance (shot_id, player_id, player_name)
             VALUES (?, ?, ?)`,
            [shotId, p.id, p.name]
          );
        }

        return interaction.reply({
          content:
            `✅ Shot registrata!\n📅 **${date}** — 🎲 Master: **${masterName}**\n` +
            `👥 Giocatori (${resolved.length}): ${resolved.map((p) => `**${p.name}**`).join(", ")}`,
        });
      }

      // shot suggest modal
      if (interaction.customId.startsWith("shot_suggest_modal|")) {
        const isGm = await hasRoleByName(interaction, GM_ROLE_NAME);
        if (!isGm) return interaction.reply({ content: `❌ Serve il ruolo @${GM_ROLE_NAME}.`, ephemeral: true });

        const [, slotsS, lookbackS, ignoreS] = interaction.customId.split("|");
        const slots = Number(slotsS);
        const lookbackDays = Number(lookbackS);
        const ignoreDays = Number(ignoreS);

        const text = interaction.fields.getTextInputValue("booked_text");
        const bookedIds = [...new Set(parseMentionedUserIds(text))];

        if (bookedIds.length === 0) {
          return interaction.reply({ content: "❌ Non ho trovato menzioni valide nei prenotati.", ephemeral: true });
        }

        const today = todayYYYYMMDD();
        const lookbackFrom = minusDaysYYYYMMDD(today, lookbackDays);

        // last played per ciascun prenotato (se mai giocato -> null)
        const lastPlayedRows = await all(
          db,
          `
          SELECT a.player_id, a.player_name, MAX(s.shot_date) as last_played
          FROM attendance a
          JOIN shots s ON s.id = a.shot_id
          WHERE a.player_id IN (${bookedIds.map(() => "?").join(",")})
          GROUP BY a.player_id, a.player_name
          `,
          bookedIds
        );

        const lastMap = new Map(lastPlayedRows.map((r) => [r.player_id, { name: r.player_name, last: r.last_played }]));

        // recent sessions count
        const recentRows = await all(
          db,
          `
          SELECT a.player_id, COUNT(*) as recent_sessions
          FROM attendance a
          JOIN shots s ON s.id = a.shot_id
          WHERE a.player_id IN (${bookedIds.map(() => "?").join(",")})
            AND s.shot_date BETWEEN ? AND ?
          GROUP BY a.player_id
          `,
          [...bookedIds, lookbackFrom, today]
        );
        const recentMap = new Map(recentRows.map((r) => [r.player_id, r.recent_sessions]));

        // resolve nomi per chi non è mai apparso nel DB
        const resolvedBooked = await resolveNames(interaction.guild, bookedIds);

        const scored = resolvedBooked.map((p) => {
          const last = lastMap.get(p.id)?.last ?? null;
          const name = lastMap.get(p.id)?.name ?? p.name;
          const daysSince = last ? daysBetween(last, today) : 999999; // “mai giocato” in cima
          const recent = recentMap.get(p.id) ?? 0;
          return { id: p.id, name, last, daysSince, recent };
        });

        // ignoreDays filter
        const filtered = scored.filter((p) => (p.last ? p.daysSince >= ignoreDays : true));

        filtered.sort((a, b) => {
          if (b.daysSince !== a.daysSince) return b.daysSince - a.daysSince;
          if (a.recent !== b.recent) return a.recent - b.recent;
          return a.name.localeCompare(b.name);
        });

        const picks = filtered.slice(0, Math.max(1, slots));

        const lines = picks.map(
          (p, i) =>
            `${i + 1}. **${p.name}** — ultima: ${p.last ?? "mai"} (${p.last ? `${p.daysSince}g fa` : "—"}), ` +
            `recenti(${lookbackDays}g): **${p.recent}**`
        );

        return interaction.reply({
          content:
            `🎯 **Suggerimento dai prenotati** (slots=${slots}, lookback=${lookbackDays}g, ignore=${ignoreDays}g)\n` +
            lines.join("\n"),
        });
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const msg = "❌ Errore interno. Controlla i log su Railway.";
      if (interaction.replied || interaction.deferred) return interaction.followUp({ content: msg, ephemeral: true });
      return interaction.reply({ content: msg, ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
