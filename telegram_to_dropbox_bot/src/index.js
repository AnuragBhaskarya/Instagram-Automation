// KV keys for storing Dropbox auth data
const KV_DROPBOX_ACCESS_TOKEN_KEY = "dropbox_access_token";
const KV_DROPBOX_EXPIRES_AT_KEY = "dropbox_expires_at"; // seconds since epoch

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'POST') {
        let update;
        try {
          update = await request.json();
          console.log('UPLOAD BOT (DROPBOX) RAW UPDATE:', JSON.stringify(update, null, 2));
        } catch (jsonError) {
          console.error('UPLOAD BOT (DROPBOX) CRITICAL: Failed to parse JSON:', jsonError.stack);
          await sendMessageQuietly(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, `UPLOAD BOT (DROPBOX) CRITICAL: JSON parse error: ${jsonError.message}`);
          return new Response('OK_JSON_PARSE_ERROR', { status: 200 });
        }

        return await handleUpdate(update, env, ctx);
      } else {
        console.log(`UPLOAD BOT (DROPBOX): Received ${request.method} request`);
        return new Response('Hello! This is the Telegram Dropbox Uploader Bot.', { status: 200 });
      }
    } catch (err) {
      console.error('UPLOAD BOT (DROPBOX) Top-level error:', err.stack);
      await sendMessageQuietly(env.TELEGRAM_BOT_TOKEN, env.ADMIN_CHAT_ID, `UPLOAD BOT (DROPBOX) Top-level error: ${err.message}`);
      return new Response('OK_TOP_LEVEL_ERROR_CAUGHT', { status: 200 });
    }
  },
};

// --- Dropbox OAuth Token Management ---
async function getDropboxAccessToken(env, ctx) {
  if (!env.DROPBOX_AUTH_KV) throw new Error("Dropbox KV namespace not bound!");

  let accessToken = await env.DROPBOX_AUTH_KV.get(KV_DROPBOX_ACCESS_TOKEN_KEY);
  const expiresAtText = await env.DROPBOX_AUTH_KV.get(KV_DROPBOX_EXPIRES_AT_KEY);
  const expiresAt = expiresAtText ? parseInt(expiresAtText) : 0;

  if (accessToken && expiresAt > (Math.floor(Date.now() / 1000) + 300)) {
    console.log("UPLOAD BOT (DROPBOX): Using cached token.");
    return accessToken;
  }

  console.log("UPLOAD BOT (DROPBOX): Refreshing access token...");
  const tokenUrl = 'https://api.dropbox.com/oauth2/token';
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: env.DROPBOX_REFRESH_TOKEN,
    client_id: env.DROPBOX_APP_KEY,
    client_secret: env.DROPBOX_APP_SECRET
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dropbox token refresh failed: ${response.status} - ${errorText}`);
  }

  const tokenData = await response.json();
  accessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in;
  const newExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  await env.DROPBOX_AUTH_KV.put(KV_DROPBOX_ACCESS_TOKEN_KEY, accessToken, { expirationTtl: expiresIn });
  await env.DROPBOX_AUTH_KV.put(KV_DROPBOX_EXPIRES_AT_KEY, newExpiresAt.toString(), { expirationTtl: expiresIn });

  console.log("UPLOAD BOT (DROPBOX): Token refreshed.");
  return accessToken;
}

// --- Dropbox Folder Stats ---
async function getDropboxFolderStats(accessToken) {
  let videoCount = 0;
  let totalSize = 0;

  const listUrl = 'https://api.dropboxapi.com/2/files/list_folder';
  let cursor = null;

  do {
    const payload = cursor ? { cursor } : { path: "", recursive: false };
    const url = cursor ? 'https://api.dropboxapi.com/2/files/list_folder/continue' : listUrl;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      throw new Error(`Dropbox list_folder failed: ${resp.status} ${await resp.text()}`);
    }

    const data = await resp.json();
    data.entries.forEach(entry => {
      if (entry['.tag'] === 'file' && entry.name.toLowerCase().endsWith('.mp4')) {
        videoCount++;
        totalSize += entry.size || 0;
      }
    });
    cursor = data.has_more ? data.cursor : null;
  } while (cursor);

  const i = Math.floor(Math.log(totalSize) / Math.log(1024));
  const readableSize = totalSize > 0 ? (totalSize / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KB', 'MB', 'GB'][i] : "0 B";

  return { videoCount, totalSize, readableSize };
}

// --- Main Update Handler ---
async function handleUpdate(update, env, ctx) {
  const message = update.message || update.channel_post;
  if (!message) return new Response('OK_NO_MESSAGE', { status: 200 });

  const chatId = message.chat.id;

  if (message.text?.toLowerCase().startsWith('/start')) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Hello! Send me a video for Dropbox upload, or use /stats.');
    return new Response('OK_START', { status: 200 });
  }

  if (message.text?.toLowerCase().startsWith('/stats')) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '📊 Fetching stats from Dropbox...');
    try {
      const accessToken = await getDropboxAccessToken(env, ctx);
      const stats = await getDropboxFolderStats(accessToken);
      const videosPerDay = 6;
      const daysCovered = stats.videoCount > 0 ? (stats.videoCount / videosPerDay).toFixed(1) : "0.0";
      let statsMessage = `<b>📊 Dropbox Stats</b>\n\n`;
      statsMessage += `Total Videos: <b>${stats.videoCount}</b>\n`;
      statsMessage += `Days Covered (@${videosPerDay}/day): <b>${daysCovered}</b>\n`;
      statsMessage += `Total Size: <b>${stats.readableSize}</b>`;
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, statsMessage, "HTML");
    } catch (err) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Error fetching stats: ${err.message}`);
    }
    return new Response('OK_STATS', { status: 200 });
  }

  if (message.video) {
    return await processAndUploadVideoToDropbox(message.video, chatId, env, ctx);
  }

  return new Response('OK_IGNORED', { status: 200 });
}

// --- Upload Video to Dropbox ---
async function processAndUploadVideoToDropbox(videoObject, chatId, env, ctx) {
  const fileId = videoObject.file_id;
  const fileName = videoObject.file_name || `video_${videoObject.file_unique_id}.mp4`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Received video: ${fileName}. Uploading to Dropbox...`);

  const fileInfoUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const fileInfoResponse = await fetch(fileInfoUrl);
  if (!fileInfoResponse.ok) throw new Error(`Telegram getFile failed: ${await fileInfoResponse.text()}`);
  const fileInfoJson = await fileInfoResponse.json();
  const filePath = fileInfoJson.result.file_path;

  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const telegramFileResponse = await fetch(fileUrl);
  if (!telegramFileResponse.ok) throw new Error(`Telegram file download failed: ${telegramFileResponse.statusText}`);

  const accessToken = await getDropboxAccessToken(env, ctx);
  const uploadUrl = 'https://content.dropboxapi.com/2/files/upload';
  const dropboxArgs = {
    path: `/${fileName}`,
    mode: 'add',
    autorename: true,
    mute: false
  };

  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify(dropboxArgs)
    },
    body: telegramFileResponse.body
  });

  if (!uploadResp.ok) throw new Error(`Dropbox upload failed: ${await uploadResp.text()}`);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Uploaded "${fileName}" to Dropbox.`);
  return new Response('OK_VIDEO_UPLOADED', { status: 200 });
}

// --- Telegram Helpers ---
async function sendMessage(botToken, chatId, text, parseMode = null) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = { chat_id: chatId, text };
  if (parseMode) payload.parse_mode = parseMode;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) console.error(`Telegram sendMessage error: ${await resp.text()}`);
}

async function sendMessageQuietly(botToken, chatId, text, parseMode = null) {
  try { await sendMessage(botToken, chatId, text, parseMode); } catch (_) {}
}
