import TelegramBot from "node-telegram-bot-api";
import pkg from "pg";

const { Pool } = pkg;

/* ================= ENV ================= */
const {
  TOKEN,
  DATABASE_URL,
  LOG_CHANNEL,
  CODE_GROUP,
  OWNER,
  BUSINESS_CONNECTION_ID,
  LOGGING
} = process.env;

/* ================= CONSTANTS ================= */
const WRONG_THREAD_ID = 182;

const code_topics = {
  sot: "15",
  xbox: "14",
  roblox: "10",
  overwatch: "11",
  minecraft: "13",
  lol: "12"
};

const code_list = {
  sot: "Sea of Thieves",
  roblox: "Roblox GC",
  overwatch: "Overwatch",
  minecraft: "Minecraft minecoins",
  lol: "League of Legends",
  xbox: "Xbox Game pass"
};

const code_denos = {
  sot: [550, 1000],
  roblox: [400, 800, 1000],
  overwatch: [200, 500, 1000],
  minecraft: [330],
  lol: [575, 100],
  xbox: ["pc 1 month", "pc 3 month"]
};

const code_length = {
  sot: 29,
  xbox: 29,
  roblox: 17,
  overwatch: 25,
  minecraft: 29,
  lol: 19
};

/* ================= DB ================= */
const pool = new Pool({ connectionString: DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS codes (
      code_id TEXT PRIMARY KEY,
      time TEXT,
      sender_id BIGINT
    );
  `);
}
initDB();

async function checkCode(code) {
  const { rows } = await pool.query(
    "SELECT time, sender_id FROM codes WHERE code_id=$1",
    [code]
  );
  return rows.length ? rows[0] : { time: "NA", sender_id: 0 };
}

async function addCode(code, time, sender) {
  await pool.query(
    "INSERT INTO codes (code_id,time,sender_id) VALUES ($1,$2,$3)",
    [code, time, sender]
  );
}

/* ================= BOT ================= */
const bot = new TelegramBot(TOKEN);

/* ================= LOGGING ================= */
async function logMessage(msg, title) {
  if (LOGGING == 0) return;

  const link = `tg://openmessage?user_id=${msg.from.id}&message_id=${msg.message_id}`;
  await bot.sendMessage(LOG_CHANNEL, 
    `📝 *${title}*\n\n` +
    `👤 [${msg.from.first_name}](${link})\n` +
    `ID:\`${msg.from.id}\`\n\n` +
    `${msg.text}`,
    { parse_mode: "Markdown" }
  );
}

async function logWrong(msg, oldSender, code, time) {
  await bot.sendMessage(
    CODE_GROUP,
    `⚠ *Used Code*\n\n` +
    `Old Sender ID:\`${oldSender}\`\n` +
    `🕒 ${time}\n` +
    `Code:\`${code}\`\n` +
    `New Sender:\`${msg.from.id}\``,
    { parse_mode: "Markdown", message_thread_id: WRONG_THREAD_ID }
  );
}

/* ================= CORE ================= */
async function handleCode(msg) {
  const lines = msg.text.trim().split("\n");
  const header = lines[0].split(" ");

  let type = header[0].slice(1).toLowerCase();
  let amount = header[1];

  if (!code_topics[type]) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid gift card");
  }

  if (type === "xbox") {
    if (header.length !== 4) {
      return bot.sendMessage(msg.chat.id, "Use /xbox pc 1 month");
    }
    amount = `${header[1].toLowerCase()} ${header[2]} ${header[3].toLowerCase()}`;
    if (!code_denos.xbox.includes(amount)) {
      return bot.sendMessage(msg.chat.id, "Invalid Xbox denomination");
    }
  } else {
    if (!amount || !code_denos[type].includes(Number(amount))) {
      return bot.sendMessage(msg.chat.id, "Invalid amount");
    }
  }

  let added = [], used = [], invalid = [];

  for (const line of lines.slice(1)) {
    const code = line.trim();
    if (code.length !== code_length[type]) {
      invalid.push(code);
      continue;
    }

    const codePart = code.slice(-10, -1);
    const { time, sender_id } = await checkCode(codePart);

    if (time === "NA") {
      const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      await addCode(codePart, now, msg.chat.id);
      added.push(code);
    } else {
      await logWrong(msg, sender_id, code, time);
      used.push(code);
    }
  }

  await bot.sendMessage(
    msg.chat.id,
    `✅ Added: ${added.length}\n❌ Used: ${used.length}\n⚠ Invalid: ${invalid.length}`
  );

  if (added.length) {
    await bot.sendMessage(
      CODE_GROUP,
      `Sender: ${msg.chat.id}\n${type} ${amount}: ${added.length}\n\`${added.join("\n")}\``,
      { parse_mode: "Markdown", message_thread_id: code_topics[type] }
    );
  }

  await logMessage(msg, "New Code");
}

/* ================= WEBHOOK ENTRY ================= */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Bot running");
  }

  const update = req.body;

  // Business message
  if (update.business_message) {
    const msg = update.business_message;
    if (msg.business_connection_id !== BUSINESS_CONNECTION_ID) {
      return res.send("IGNORED");
    }

    if (msg.text?.startsWith("/")) {
      if (msg.text === "/gc" || msg.text === "/list") {
        let out = "";
        for (const c in code_list) {
          for (const d of code_denos[c]) {
            out += `${code_list[c]} ${d}\n/${c} ${d}\n`;
          }
        }
        await bot.sendMessage(msg.chat.id, out, { parse_mode: "Markdown" });
      } else if (code_topics[msg.text.split(" ")[0].slice(1)]) {
        await handleCode(msg);
      }
    }
  }

  res.status(200).send("OK");
}
