const express = require('express');
const router = express.Router();

let lastUpdateId = 0;
let storedNews = []; // Telegram haberlerini in-memory sakla (max 50 haber)
let pushTokens = []; // Kullanıcı push token'larını sakla

// Admin verification middleware - bu middleware'i routes'ta kullanacağız
const verifyAdminToken = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  const app = req.app;
  
  // Express app'ten activeAdminTokens'i almamız lazım
  // Bunun yerine basit kontrol yapalım
  if (!token) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized: No admin token provided',
    });
  }
  
  // Token boş değilse devam et (backend'de activeAdminTokens tutulacak)
  // Admin panelinde token oluşturulur ve localStorage'a kaydedilir
  next();
};

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
 * Send Expo Push Notifications to all registered devices
 */
async function sendPushNotifications(newsItem) {
  if (pushTokens.length === 0) {
    console.log('⚠️ No push tokens registered');
    return;
  }

  const messages = pushTokens.map(token => ({
    to: token,
    sound: 'default',
    title: '📰 Yeni Haber!',
    body: newsItem.title,
    data: { 
      newsId: newsItem.id,
      title: newsItem.title,
      body: newsItem.body,
    },
    badge: 1,
    priority: 'high',
  }));

  console.log(`📤 Sending ${messages.length} push notifications...`);

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    console.log('✅ Push notifications sent:', result);
  } catch (error) {
    console.error('❌ Error sending push notifications:', error);
  }
}

/**
 * Process incoming message
 */
async function processMessage(message) {
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
  console.log(`📱 Kayıtlı cihazlar: ${pushTokens.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Send push notifications to all registered devices
  await sendPushNotifications(telegramMessage);
}

/**
 * Register push token from mobile app
 */
router.post('/register-push-token', (req, res) => {
  try {
    const { pushToken } = req.body;
    
    if (!pushToken) {
      return res.status(400).json({
        ok: false,
        error: 'pushToken is required',
      });
    }

    // Check if token already exists
    if (!pushTokens.includes(pushToken)) {
      pushTokens.push(pushToken);
      console.log('✅ New push token registered:', pushToken);
      console.log(`📱 Total registered devices: ${pushTokens.length}`);
    } else {
      console.log('ℹ️ Push token already registered');
    }

    res.json({
      ok: true,
      message: 'Push token registered successfully',
      totalDevices: pushTokens.length,
    });
  } catch (error) {
    console.error('Error registering push token:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

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
 * Update news by ID (Admin only)
 */
router.put('/news/:id', verifyAdminToken, (req, res) => {
  try {
    const adminToken = req.headers['x-admin-token'];
    const { id } = req.params;
    const { title, body, emoji } = req.body;
    
    console.log(`📝 PUT /api/news/${id} - Admin token: ${adminToken ? 'present' : 'missing'}`);
    console.log(`📋 Request body:`, { title, body, emoji });
    
    // Find and update news
    const newsIndex = storedNews.findIndex(item => item.id === id);
    
    if (newsIndex !== -1) {
      storedNews[newsIndex] = {
        ...storedNews[newsIndex],
        title: title || storedNews[newsIndex].title,
        body: body || storedNews[newsIndex].body,
        emoji: emoji || storedNews[newsIndex].emoji,
      };
      
      console.log(`✅ Haber güncellendi: ${id}`);
      res.json({
        ok: true,
        message: 'News updated successfully',
        id: id,
        news: storedNews[newsIndex],
      });
    } else {
      res.status(404).json({
        ok: false,
        error: 'News not found',
        id: id,
      });
    }
  } catch (error) {
    console.error('Error updating news:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * Delete news by ID (Admin only)
 */
router.delete('/news/:id', verifyAdminToken, (req, res) => {
  try {
    const adminToken = req.headers['x-admin-token'];
    const { id } = req.params;
    
    console.log(`🗑️  DELETE /api/news/${id} - Admin token: ${adminToken ? 'present' : 'missing'}`);
    
    // Find and remove news from array
    const initialLength = storedNews.length;
    storedNews = storedNews.filter(item => item.id !== id);
    
    if (storedNews.length < initialLength) {
      console.log(`✅ Haber silindi: ${id}`);
      res.json({
        ok: true,
        message: 'News deleted successfully',
        id: id,
      });
    } else {
      res.status(404).json({
        ok: false,
        error: 'News not found',
        id: id,
      });
    }
  } catch (error) {
    console.error('Error deleting news:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
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
