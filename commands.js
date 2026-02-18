const { SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("shot")
    .setDescription("Gestione oneshot presenze")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Registra una oneshot (apre un form per incollare i giocatori)")
        .addStringOption((opt) =>
          opt.setName("date").setDescription("Data shot (YYYY-MM-DD)").setRequired(true)
        )
        .addUserOption((opt) =>
          opt.setName("master").setDescription("Il master").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("stats")
        .setDescription("Statistiche presenze (default ultimi 30 giorni)")
        .addStringOption((opt) => opt.setName("from").setDescription("Da (YYYY-MM-DD)").setRequired(false))
        .addStringOption((opt) => opt.setName("to").setDescription("A (YYYY-MM-DD)").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("suggest")
        .setDescription("Suggerisce chi prendere tra i prenotati (apre un form)")
        .addIntegerOption((opt) => opt.setName("slots").setDescription("Numero posti (default 4)").setRequired(false))
        .addIntegerOption((opt) => opt.setName("lookback_days").setDescription("Finestra recenti (default 30)").setRequired(false))
        .addIntegerOption((opt) => opt.setName("ignore_days").setDescription("Escludi chi ha giocato negli ultimi X giorni (default 0)").setRequired(false))
    ),
].map((c) => c.toJSON());

module.exports = { commands };
