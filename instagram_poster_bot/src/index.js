export default {
  async scheduled(event, env, ctx) {
    console.log('Cron triggered:', event);
    
    // Check if manual trigger is requested
    const manualTrigger = await env.MEDIA_KV.get('manual_trigger_requested');
    
    if (manualTrigger) {
      await env.MEDIA_KV.delete('manual_trigger_requested'); // Clear the flag
      await notify(env, '🎯 Manual trigger detected - starting job...');
      return handlePost(env);
    }
    
    // Check if this is a scheduled run (every 4 hours)
    // Cron runs every minute, but we only want uploads every 4 hours
    if (event.cron) {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      
      // Run at specific hours: 0, 4, 8, 12, 16, 20 (every 4 hours)
      // Only run on the first minute of these hours to avoid multiple triggers
      if (currentMinute === 0 && currentHour % 4 === 0) {
        await notify(env, '⏰ Scheduled upload triggered - starting job...');
        return handlePost(env);
      }
    }
    
    return new Response('Cron check completed - no action needed');
  },
  
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    
    if (url.pathname === '/') {
      return new Response('bot is running', { status: 200 });
    }
    
    if (url.pathname === '/trigger') {
      if (req.method !== 'POST' && req.method !== 'GET') {
        return new Response('Only GET/POST allowed', { status: 405 });
      }
      
      // Check if job is already running or queued
      const isRunning = await env.MEDIA_KV.get('job_running');
      const isQueued = await env.MEDIA_KV.get('manual_trigger_requested');
      
      if (isRunning) {
        const lockData = JSON.parse(isRunning);
        const now = Date.now();
        // If lock is older than 5 minutes, clear it
        if (now - lockData.timestamp > 300000) {
          await env.MEDIA_KV.delete('job_running');
        } else {
          return new Response('⏳ Job is already running, please wait...', { status: 429 });
        }
      }
      
      if (isQueued) {
        return new Response('⏳ Job is already queued, will start soon...', { status: 429 });
      }
      
      // Set trigger flag - cron will pick it up within 1 minute
      await env.MEDIA_KV.put('manual_trigger_requested', JSON.stringify({
        timestamp: Date.now(),
        type: 'manual'
      }), { expirationTtl: 120 }); // 2 minute expiry
      
      await notify(env, '📋 Manual upload job queued - will start within 1 minute');
      
      return new Response('✅ Job queued successfully! Will start within 1 minute via cron', { status: 200 });
    }
    
    return new Response('Not Found', { status: 404 });
  },
};

async function handlePost(env) {
  // Set job running flag
  await env.MEDIA_KV.put('job_running', JSON.stringify({
    timestamp: Date.now(),
    status: 'running'
  }), { expirationTtl: 600 }); // 10 minute expiry as backup

  try {
    await handlePostComplete(env);
  } catch (error) {
    await notify(env, '❌ Job execution error: ' + error.message);
    console.error('Job execution error:', error);
  } finally {
    // Always clear the running flag when done
    await env.MEDIA_KV.delete('job_running');
  }
}

async function handlePostComplete(env) {
  const captions = [
    'still here? follow (@sillytonic)',
    'caught you lurking 👀 (@sillytonic)',
    'follow or regret it (@sillytonic)',
    'your feed needs me (@sillytonic)',
    'been stalking? just follow (@sillytonic)',
    'plot twist: hit follow (@sillytonic)',
    'you know what to do (@sillytonic)',
    'follow for daily chaos (@sillytonic)',
    'stop scrolling, start following (@sillytonic)',
    'your thumb + follow button (@sillytonic)',
    'seen enough? follow now (@sillytonic)',
    'follow me or stay basic (@sillytonic)',
    'lurker to follower speedrun (@sillytonic)',
    'follow and thank me later (@sillytonic)',
    'make your feed less boring (@sillytonic)',
    'follow button is right there (@sillytonic)',
    'you + follow = perfection (@sillytonic)',
    'stop being shy, follow (@sillytonic)',
    'follow for more vibes (@sillytonic)',
    'hit follow, hit different (@sillytonic)',
  ];
  
  const caption = captions[Math.floor(Math.random() * captions.length)];

  await notify(env, '🔄 Starting job');
  
  const accessToken = await getAccessToken(env);
  const files = await listDropboxFiles("", accessToken, env);
  if (!files || files.length === 0) {
    await notify(env, '⚠️ No videos left to post.');
    return;
  }
  const file = files[0]; // oldest video

  // Upload video to Instagram (Facebook Graph API)
  const uploadRes = await fetch(
    `https://graph.facebook.com/v22.0/${env.FB_PAGE_ID}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        video_url: file.url,
        media_type: 'REELS',
        caption,
        access_token: env.FB_ACCESS_TOKEN,
      }),
    }
  );
  
  const uploadJson = await uploadRes.json();
  console.log('Upload response:', uploadJson);

  if (!uploadJson.id) {
    throw new Error(`Upload failed: ${JSON.stringify(uploadJson)}`);
  }
  const creationId = uploadJson.id;

  // Poll Instagram status
  const maxPollingTime = 180000; // 3 minutes max
  const pollingStartTime = Date.now();
  let isReady = false;
  let attempts = 0;
  
  while (!isReady && (Date.now() - pollingStartTime) < maxPollingTime) {
    attempts++;
    
    try {
      const statusRes = await fetch(
        `https://graph.facebook.com/v22.0/${creationId}?fields=status,status_code&access_token=${env.FB_ACCESS_TOKEN}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );
      
      const statusJson = await statusRes.json();
      console.log(`Status check #${attempts}:`, statusJson);
      
      if (statusJson.status_code) {
        if (statusJson.status_code === 'FINISHED') {
          isReady = true;
          break;
        } else if (statusJson.status_code === 'ERROR') {
          throw new Error(`Instagram processing failed: ${JSON.stringify(statusJson)}`);
        }
      } else if (statusJson.status === 'FINISHED') {
        isReady = true;
        break;
      }
      
    } catch (pollError) {
      console.warn(`Polling attempt ${attempts} failed:`, pollError);
      if (attempts >= 10) {
        isReady = true;
        break;
      }
    }
    
    // Wait 6 seconds between polls
    await new Promise(res => setTimeout(res, 6000));
  }

  // Publish media
  const publishRes = await fetch(
    `https://graph.facebook.com/v22.0/${env.FB_PAGE_ID}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: env.FB_ACCESS_TOKEN,
      }),
    }
  );
  
  const publishJson = await publishRes.json();
  console.log('Publish response:', publishJson);

  if (!publishJson.id) {
    // Retry logic if needed
    if (publishJson.error && publishJson.error.message.includes('not ready')) {
      await new Promise(res => setTimeout(res, 30000));
      
      const retryPublishRes = await fetch(
        `https://graph.facebook.com/v22.0/${env.FB_PAGE_ID}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            creation_id: creationId,
            access_token: env.FB_ACCESS_TOKEN,
          }),
        }
      );
      
      const retryPublishJson = await retryPublishRes.json();
      if (!retryPublishJson.id) {
        throw new Error(`Publish failed after retry: ${JSON.stringify(retryPublishJson)}`);
      }
    } else {
      throw new Error(`Publish failed: ${JSON.stringify(publishJson)}`);
    }
  }

  await notify(env, '🗑️ Cleaning up - deleting video from Dropbox...');
  await deleteDropboxFile(file.path_lower, accessToken, env);

  await notify(env, `✅ Job completed successfully!\nCaption: ${caption}\nInstagram Post ID: ${publishJson.id || 'retry_success'}`);
}

// ===== All your existing helper functions remain exactly the same =====

async function getAccessToken(env) {
  const cached = await env.MEDIA_KV.get('dropbox_access_token');
  if (cached) {
    try {
      const data = JSON.parse(cached);
      const expiresAt = new Date(data.expires_at);
      if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
        return data.access_token;
      }
    } catch (e) {
      console.warn('Failed parsing cached token', e);
    }
  }

  const creds = btoa(`${env.DROPBOX_APP_KEY}:${env.DROPBOX_APP_SECRET}`);
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.DROPBOX_REFRESH_TOKEN,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Dropbox token refresh failed: ${res.status} ${txt}`);
  }

  const json = await res.json();
  const expiresAt = new Date(Date.now() + (json.expires_in - 600) * 1000);

  await env.MEDIA_KV.put(
    'dropbox_access_token',
    JSON.stringify({ access_token: json.access_token, expires_at: expiresAt.toISOString() })
  );
  return json.access_token;
}

async function listDropboxFiles(path, token, env) {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, recursive: false }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`list_folder failed: ${res.status} ${txt}`);
  }

  const { entries } = await res.json();
  const files = entries.filter(e => e['.tag'] === 'file');

  if (files.length === 0) return [];

  files.sort((a, b) => {
    const dateA = new Date(a.server_modified);
    const dateB = new Date(b.server_modified);
    return dateA - dateB;
  });

  const oldestFile = files[0];

  let url = await env.MEDIA_KV.get('sharedlink:' + oldestFile.path_lower);
  if (!url) {
    url = await getSharedLink(oldestFile.path_lower, token);
    await env.MEDIA_KV.put('sharedlink:' + oldestFile.path_lower, url, { expirationTtl: 86400 });
  }

  return [{ path_lower: oldestFile.path_lower, url: toRawDropboxLink(url) }];
}

async function getSharedLink(path, token) {
  let res = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, direct_only: true }),
  });
  
  if (!res.ok) {
    throw new Error(`Failed to list shared links: ${res.status}`);
  }
  
  const data = await res.json();
  if (data.links?.length) return data.links[0].url;

  res = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  
  if (!res.ok) {
    throw new Error(`Failed to create shared link: ${res.status}`);
  }
  
  const createData = await res.json();
  return createData.url;
}

async function deleteDropboxFile(path, token, env) {
  const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.warn(`Failed to delete ${path}: ${txt}`);
  }
}

function toRawDropboxLink(url) {
  const [base, qs] = url.split('?');
  const p = new URLSearchParams(qs || '');
  p.delete('dl');
  p.set('raw', '1');
  return `${base}?${p.toString()}`;
}

async function notify(env, message) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: env.TELEGRAM_CHAT_ID, 
        text: message,
        parse_mode: 'HTML'
      }),
    });
    
    if (!res.ok) {
      console.error('Telegram notification failed:', await res.text());
    }
  } catch (e) {
    console.error('Telegram notify failed:', e);
  }
}