function isValidDateYYYYMMDD(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  const [y, m, day] = s.split("-").map(Number);
  return d.getUTCFullYear() === y && (d.getUTCMonth() + 1) === m && d.getUTCDate() === day;
}

function todayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function minusDaysYYYYMMDD(toDateYYYYMMDD, days) {
  const t = new Date(toDateYYYYMMDD + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - days);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(isoDateA, isoDateB) {
  const a = new Date(isoDateA + "T00:00:00Z").getTime();
  const b = new Date(isoDateB + "T00:00:00Z").getTime();
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function parseMentionedUserIds(text) {
  const re = /<@!?\d+>/g;
  const matches = text.match(re) || [];
  return matches.map((m) => m.replace(/[<@!>]/g, ""));
}

async function hasRoleByName(interaction, roleName) {
  const member = interaction.member; // GuildMember in guild interactions
  if (!member || !member.roles) return false;

  const role = interaction.guild.roles.cache.find((r) => r.name === roleName);
  if (!role) return false;

  return member.roles.cache.has(role.id);
}

module.exports = {
  isValidDateYYYYMMDD,
  todayYYYYMMDD,
  minusDaysYYYYMMDD,
  daysBetween,
  parseMentionedUserIds,
  hasRoleByName,
};
