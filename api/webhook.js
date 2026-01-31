import express from "express";
import TelegramBot from "node-telegram-bot-api";
import pkg from "pg";

const { Pool } = pkg;

/* ===================== ENV ===================== */
const {
  DATABASE_URL,
  TOKEN,
  LOG_CHANNEL,
  CODE_GROUP,
  OWNER,
  BUSINESS_CONNECTION_ID,
  LOGGING
} = process.env;

/* ===================== CONSTANTS ===================== */
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

/* ===================== DB ===================== */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS codes (
    code_id TEXT PRIMARY KEY,
    time TEXT,
    sender_id BIGINT
  );
`);

/* ===================== BOT ===================== */
const bot = new TelegramBot(TOKEN, { polling: false });

/* ===================== EXPRESS ===================== */
const app = express();
app.use(express.json());

/* ===================== DB HELPERS ===================== */
async function checkCode(code) {
  const { rows } = await pool.query(
    "SELECT time, sender_id FROM codes WHERE code_id=$1",
    [code]
  );
  return rows.length ? rows[0] : { time: "NA", sender_id: 0 };
}

async function addCode(code, time, senderId) {
  await pool.query(
    "INSERT INTO codes (code_id,time,sender_id) VALUES ($1,$2,$3)",
    [code, time, senderId]
  );
}

/* ===================== LOGGING ===================== */
async function logWrong(msg, oldSender, code, time) {
  const curLink = `tg://openmessage?user_id=${msg.from.id}&message_id=${msg.message_id}`;
  const oldLink = `tg://openmessage?user_id=${oldSender}`;

  await bot.sendMessage(
    CODE_GROUP,
    `📝 *⚠ Used Code*\n\n` +
      `🔗 [Old Sender](${oldLink})\n` +
      `ID:\`${oldSender}\`\n` +
      `🕒 Sent at: ${time}\n` +
      `Code:\`${code}\`\n` +
      `Current Sender:[${msg.from.first_name}](${curLink})\n` +
      `ID:\`${msg.from.id}\``,
    { parse_mode: "Markdown", message_thread_id: WRONG_THREAD_ID }
  );
}

async function logMessage(msg, type) {
  if (LOGGING == 0) return;

  const time = new Date(msg.date * 1000).toISOString();
  const link = `tg://openmessage?user_id=${msg.from.id}&message_id=${msg.message_id}`;

  await bot.sendMessage(
    LOG_CHANNEL,
    `📝 *${type}*\n\n` +
      `🔗 Sender: [${msg.from.first_name}](${link})\n` +
      `🕒 Time: \`${time}\`\n` +
      `Sender ID:\`${msg.from.id}\`\n` +
      `Message ID:\`${msg.message_id}\`\n` +
      `Message:\n${msg.text}`,
    { parse_mode: "Markdown" }
  );
}

/* ===================== CORE LOGIC ===================== */
async function handleCode(msg) {
  const lines = msg.text.trim().split("\n");
  const header = lines[0].split(" ");

  if (header.length < 2) {
    await bot.sendMessage(
      msg.chat.id,
      "Usage:\n/<type> <amount>\nitem1\nitem2\nOnly for xbox: /xbox pc 1 month",
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  let type = header[0].slice(1).toLowerCase();
  let amount = header[1];

  if (!code_topics[type]) {
    await bot.sendMessage(msg.chat.id, "❌ Invalid gift card");
    return;
  }

  if (type === "xbox") {
    if (header.length !== 4 || header[1].toLowerCase() !== "pc") {
      await bot.sendMessage(msg.chat.id, "Write: /xbox pc 1 month");
      return;
    }
    amount = `${header[1].toLowerCase()} ${header[2]} ${header[3].toLowerCase()}`;
    if (!code_denos.xbox.includes(amount)) {
      await bot.sendMessage(msg.chat.id, "Invalid Xbox denomination");
      return;
    }
  } else {
    if (isNaN(amount) || !code_denos[type].includes(Number(amount))) {
      await bot.sendMessage(msg.chat.id, "Invalid amount");
      return;
    }
  }

  const items = [];
  const used = [];
  const invalid = [];

  for (const line of lines.slice(1)) {
    const item = line.trim();
    if (item.length !== code_length[type]) {
      invalid.push(item);
      continue;
    }

    const codePart = item.slice(-10, -1);
    const { time, sender_id } = await checkCode(codePart);

    if (time === "NA") {
      const ist = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      await addCode(codePart, ist, msg.chat.id);
      items.push(item);
    } else {
      await logWrong(msg, sender_id, item, time);
      used.push(item);
    }
  }

  if (!items.length) {
    let reply = "❌ Please provide at least one item\n";
    if (invalid.length) reply += "\nWrong format:\n" + invalid.join("\n");
    if (used.length) reply += "\nUsed:\n" + used.join("\n");
    await bot.sendMessage(msg.chat.id, reply, {
      reply_to_message_id: msg.message_id
    });
    return;
  }

  await bot.sendMessage(
    msg.chat.id,
    `Added Successfully✅\n\nType: ${type}\nCoins: ${amount}\nTotal gift cards: ${items.length}`,
    { reply_to_message_id: msg.message_id }
  );

  await bot.sendMessage(
    CODE_GROUP,
    `Sender:[${msg.chat.id}]\n${type} ${amount} : ${items.length}\n\`${items.join(
      "\n"
    )}\``,
    { parse_mode: "Markdown", message_thread_id: code_topics[type] }
  );

  await logMessage(msg, "New Code");
}

/* ===================== WEBHOOK ===================== */
app.post("/", async (req, res) => {
  const update = req.body;

  if (update.business_message) {
    const msg = update.business_message;
    if (msg.business_connection_id !== BUSINESS_CONNECTION_ID) {
      return res.send("IGNORED");
    }

    if (msg.text?.startsWith("/")) {
      const cmd = msg.text.split(" ")[0].toLowerCase();

      if (cmd === "/gc" || cmd === "/list") {
        let out = "";
        for (const c in code_list) {
          for (const d of code_denos[c]) {
            out += `${code_list[c]} ${d}\n/${c} ${d}\n`;
          }
        }
        await bot.sendMessage(msg.chat.id, out, { parse_mode: "Markdown" });
      } else if (code_topics[cmd.slice(1)]) {
        await handleCode(msg);
      } else {
        await bot.sendMessage(msg.chat.id, "❌ Unknown command");
      }
    }
  }

  res.status(200).send("OK");
});

export default app;

