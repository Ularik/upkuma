const path = require("path");

// Загрузка переменных из .env рядом с bot.js (уже заданные в окружении не перезаписываются)
try {
    process.loadEnvFile(path.join(__dirname, ".env"));
}
catch (error) {
    if (error.code !== "ENOENT") {
        throw error;
    }
}

function requireEnv(name) {
    const value = process.env[name];

    if (!value || !value.trim()) {
        console.error(`Не задана переменная окружения ${name} (см. .env.example)`);
        process.exit(1);
    }

    return value.trim();
}

const TOKEN = requireEnv("TELEGRAM_TOKEN");
const ALLOWED_CHAT_IDS = requireEnv("ALLOWED_CHAT_IDS")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
const KUMA_URL = (process.env.KUMA_URL || "http://localhost:3001").replace(/\/+$/, "");
const KUMA_API_KEY = requireEnv("KUMA_API_KEY");

async function telegram(method, params = {}) {
    const response = await fetch(
        `https://api.telegram.org/bot${TOKEN}/${method}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(40000)
        }
    );

    const data = await response.json();

    if (!data.ok) {
        throw new Error(`Telegram API: ${JSON.stringify(data)}`);
    }

    return data.result;
}

async function getKumaMetrics() {
    const auth = Buffer
        .from(`:${KUMA_API_KEY}`)
        .toString("base64");

    const response = await fetch(`${KUMA_URL}/metrics`, {
        headers: {
            "Authorization": `Basic ${auth}`
        },
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
        throw new Error(
            `Uptime Kuma HTTP ${response.status}`
        );
    }

    return await response.text();
}

function parseMonitors(text) {
    const monitors = [];

    for (const line of text.split("\n")) {

        if (!line.startsWith("monitor_status{")) {
            continue;
        }

        const nameMatch =
            line.match(/monitor_name="((?:\\.|[^"])*)"/);

        const statusMatch =
            line.match(/\}\s+([0-9.]+)$/);

        if (!nameMatch || !statusMatch) {
            continue;
        }

        const name = nameMatch[1]
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");

        const status = Number(statusMatch[1]);

        monitors.push({
            name,
            status
        });
    }

    return monitors;
}

async function sendStatus(chatId) {
    // Авторизация в Uptime Kuma
    const auth = Buffer.from(`:${KUMA_API_KEY}`).toString("base64");

    // Запуск принудительной проверки всех активных мониторов
    const forceResponse = await fetch(
        `${KUMA_URL}/api/monitors/force-check`,
        {
            method: "POST",
            headers: {
                "Authorization": `Basic ${auth}`
            },
            signal: AbortSignal.timeout(300000)
        }
    );

    if (!forceResponse.ok) {
        throw new Error(`Force check HTTP ${forceResponse.status}`);
    }

    const forceResult = await forceResponse.json();

    if (!forceResult.ok) {
        throw new Error("Не удалось выполнить принудительную проверку");
    }

    // Получение обновлённых статусов
    const metrics = await getKumaMetrics();
    const monitors = parseMonitors(metrics);

    if (monitors.length === 0) {
    await telegram("sendMessage", {
        chat_id: chatId,
        text: "📊 Статус сайтов\n\nМониторы не найдены."
    });

    return;
}

    let message = "📊 Статус сайтов\n\n";
    let up = 0;
    let down = 0;
    let unknown = 0;

    for (const monitor of monitors) {

        if (monitor.status === 1) {
    message += `🟢 ${monitor.name} — UP\n`;
    up++;
}
else if (monitor.status === 0) {
    message += `🔴 ${monitor.name} — DOWN\n`;
    down++;
}
else {
    message += `🟡 ${monitor.name} — UNKNOWN\n`;
    unknown++;
}
    }

    message += `\nВсего: ${monitors.length}`;
message += `\nUP: ${up}`;
message += `\nDOWN: ${down}`;

    if (unknown > 0) {
        message += `\nUNKNOWN: ${unknown}`;
    }

    await telegram("sendMessage", {
        chat_id: chatId,
        text: message
    });
}
async function main() {

    console.log("Telegram Status Bot запущен.");

    let offset = 0;

    while (true) {

        try {

            const updates = await telegram("getUpdates", {
                offset,
                timeout: 30,
                allowed_updates: ["message"]
            });

            for (const update of updates) {

                offset = update.update_id + 1;

                const message = update.message;

                if (!message || !message.text) {
                    continue;
                }

                const chatId = String(message.chat.id);
                const command = message.text.trim();

                console.log(
                    `Получено: ${command} от Chat ID ${chatId}`
                );

                if (!ALLOWED_CHAT_IDS.includes(chatId)) {
    continue;
}

                if (command === "/status") {

                    try {
                        await sendStatus(chatId);
                    }
                    catch (error) {

                        console.error(error);

                        await telegram("sendMessage", {
                            chat_id: chatId,
                            text:
                                "❌ Не удалось получить статус Uptime Kuma."
                        });
                    }
                }
            }

        }
        catch (error) {

            console.error(
                "Ошибка Telegram:",
                error.message
            );

            await new Promise(
                resolve => setTimeout(resolve, 5000)
            );
        }
    }
}

main();