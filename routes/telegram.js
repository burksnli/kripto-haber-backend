const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

let lastUpdateId = 0;
let storedNews = []; // Telegram haberlerini sakla

// SQLite database initialize
const dbPath = path.join(__dirname, '../news.db');
const db = new Database(dbPath);

// Create table if doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT,
    emoji TEXT,
    raw_message TEXT
  )
`);

// Load existing news from database
try {
  const rows = db.prepare('SELECT * FROM news ORDER BY timestamp DESC LIMIT 50').all();
  if (rows && rows.length > 0) {
    storedNews = rows;
  }
} catch (err) {
  console.error('Error loading news from database:', err);
}

/**
 * Telegram Webhook POST endpoint
 * Receives messages from Telegram and sends them to mobile app
 */
router.post('/telegram-webhook', async (req, res) => {
  try {
    const { message } = req.body;
    
    // If no message or text, return success
    if (!message || !message.text) {
      return res.json({ ok: true });
    }

    processMessage(message);
    res.json({ ok: true, message: 'News received and processed' });

  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Polling mode - Get updates from Telegram
 */
router.get('/telegram-poll', async (req, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}`
    );
    const data = await response.json();

    if (data.ok && data.result.length > 0) {
      data.result.forEach(update => {
        if (update.message && update.message.text) {
          processMessage(update.message);
          lastUpdateId = update.update_id;
        }
      });

      res.json({
        ok: true,
        updates_processed: data.result.length,
        last_update_id: lastUpdateId,
      });
    } else {
      res.json({
        ok: true,
        updates_processed: 0,
        message: 'No new messages',
      });
    }
  } catch (error) {
    console.error('Polling error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Process incoming message
 */
function processMessage(message) {
  const messageText = message.text.trim();
  const lines = messageText.split('\n');
  
  const telegramMessage = {
    id: `telegram_${message.message_id}_${Date.now()}`,
    title: lines[0] || 'Yeni Haber',
    body: lines.slice(1).join('\n') || messageText,
    timestamp: new Date(message.date * 1000).toISOString(),
    source: 'Telegram Bot',
    emoji: '📱',
    raw_message: message,
  };

  // Database'e kaydet
  try {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO news (id, title, body, timestamp, source, emoji, raw_message) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      telegramMessage.id,
      telegramMessage.title,
      telegramMessage.body,
      telegramMessage.timestamp,
      telegramMessage.source,
      telegramMessage.emoji,
      JSON.stringify(telegramMessage.raw_message)
    );
  } catch (err) {
    console.error('Error saving to database:', err);
  }

  // Haberi array'e ekle (en yeni başa)
  storedNews.unshift(telegramMessage);
  // Son 50 haberi tut
  if (storedNews.length > 50) {
    storedNews = storedNews.slice(0, 50);
  }

  console.log('\n✅ Yeni Haber Alındı:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📌 Başlık: ${telegramMessage.title}`);
  console.log(`📝 İçerik: ${telegramMessage.body}`);
  console.log(`⏰ Zaman: ${telegramMessage.timestamp}`);
  console.log(`📊 Toplam haberler: ${storedNews.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // TODO: Integrate with Firebase Cloud Messaging (FCM)
  // const fcmToken = await getUserFCMToken();
  // await sendPushNotification(fcmToken, telegramMessage);
}

/**
 * Get all stored news
 */
router.get('/news', (req, res) => {
  res.json({
    ok: true,
    count: storedNews.length,
    news: storedNews,
  });
});

/**
 * Test endpoint to verify webhook is working
 */
router.get('/telegram-webhook', (req, res) => {
  res.json({ 
    ok: true, 
    message: 'Telegram webhook is active and listening',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get webhook status (for debugging)
 */
router.get('/telegram-webhook-status', async (req, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(400).json({ 
        error: 'TELEGRAM_BOT_TOKEN not configured' 
      });
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`
    );
    const webhookInfo = await response.json();

    res.json({
      ok: true,
      webhook_info: webhookInfo,
      polling_status: `Last update ID: ${lastUpdateId}`,
    });
  } catch (error) {
    console.error('Error getting webhook status:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

/**
 * Send test message
 */
router.post('/telegram-test', (req, res) => {
  const testMessage = {
    message_id: Math.floor(Math.random() * 10000),
    text: req.body.text || 'Test Haberi\nBu bir test mesajıdır.',
    date: Math.floor(Date.now() / 1000),
  };

  processMessage(testMessage);

  res.json({
    ok: true,
    message: 'Test message processed',
    data: testMessage,
  });
});

module.exports = router;
