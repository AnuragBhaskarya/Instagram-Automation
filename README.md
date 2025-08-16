
# Instagram Content Automation Framework 🎬📱

A complete, production-ready workflow for automatically downloading, processing, storing, and posting Instagram content using a sophisticated three-bot system with advanced video processing and OAuth management.

## 🔄 Workflow Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│   VIDEO PROCESSOR   │────▶│ TELEGRAM TO DROPBOX  │────▶│  INSTAGRAM POSTER   │
│   (Local Machine)   │     │  (Cloudflare Worker) │     │ (Cloudflare Worker) │
│     main.py         │     │     worker.js        │     │     worker.js       │
└─────────────────────┘     └──────────────────────┘     └─────────────────────┘
          │                            │                           │
          ▼                            ▼                           ▼
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│ • yt-dlp downloads  │    │ • OAuth 2.0 tokens   │    │ • Every 4hrs cron   │
│ • Advanced FFmpeg   │    │ • Auto file upload   │    │ • 20 random captions│
│ • Telegram + Flask  │    │ • /stats analytics   │    │ • Facebook Graph API│
│ • IP registration   │    │ • Smart KV caching   │    │ • Auto file cleanup │
│ • Async processing  │    │ • Error reporting    │    │ • Job locking       │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
```


### 📋 Complete Process Flow

1. **🎥 Download \& Process** → `main.py` downloads Instagram videos using yt-dlp with Chrome cookies, applies sophisticated FFmpeg processing (crop, blur background, speed/pitch adjustment), and delivers via both Telegram bot and Flask REST API
2. **📦 Store \& Manage** → Forward processed videos to telegram-to-dropbox worker which handles OAuth 2.0 token refresh, uploads to Dropbox with smart caching, and provides detailed analytics via `/stats` command
3. **📱 Auto Post** → instagram-uploader worker runs every 4 hours via cron, fetches oldest video from Dropbox, posts to Instagram @sillytonic with random captions, and cleans up files automatically

***

## 📑 Table of Contents

- [🎥 Video Processor Bot](#-video-processor-bot)
- [📦 Telegram to Dropbox Bot](#-telegram-to-dropbox-bot)
- [📱 Instagram Poster Bot](#-instagram-poster-bot)
- [🚀 Complete Setup Guide](#-complete-setup-guide)
- [🔧 Advanced Configuration](#-advanced-configuration)
- [🛠️ Troubleshooting](#%EF%B8%8F-troubleshooting)

***

## 🎥 Video Processor Bot

**Location:** `main.py` (Local Machine)
**Purpose:** Downloads Instagram videos and applies advanced processing optimized for Instagram reposting

### ✨ Key Features

#### **Advanced Video Processing Pipeline**

- **yt-dlp Integration**: Downloads Instagram videos with Chrome cookie support for private content
- **Sophisticated FFmpeg Processing**:
    - **Smart Cropping**: Removes 300px from top/bottom while preserving aspect ratio
    - **Portrait Optimization**: Scales to 1080x1920 (Instagram Reels format)
    - **Blur Background**: Creates professional blurred background for non-portrait videos
    - **Speed Enhancement**: 1.05x speed with 1.03x pitch adjustment for engagement
    - **Quality Scaling**: 90% scaling with perfect centering overlay
    - **Format Optimization**: 29.97fps output, H.264 encoding, 192k AAC audio


#### **Dual Interface Architecture**

- **Telegram Bot**: Direct URL processing via chat interface
- **Flask REST API**: HTTP endpoints for integration with external systems
- **Async Processing**: ThreadPoolExecutor with up to 4 concurrent workers
- **Real-time Updates**: Progress notifications throughout processing pipeline


#### **Smart Resource Management**

- **Automatic Cleanup**: Removes all temporary files after processing
- **Performance Monitoring**: Detailed timing logs for each processing stage
- **Memory Optimization**: Streams video data to minimize RAM usage
- **Error Recovery**: Comprehensive error handling with user notifications


### 🔧 Setup Requirements

#### **System Dependencies**

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg python3-pip

# macOS with Homebrew
brew install ffmpeg python3

# Windows
# Download FFmpeg from https://ffmpeg.org/download.html
# Add FFmpeg bin directory to system PATH
```


#### **Python Dependencies**

```bash
pip install yt-dlp python-telegram-bot flask python-dotenv requests
```


#### **Environment Configuration**

Create `.env` file in project root:

```env
TELEGRAM_BOT_TOKEN=bot123456789:ABCDEF1234567890GHIJKLMNOP
MY_CHAT_ID=123456789
```


#### **Get Your Telegram Chat ID**

1. Start conversation with your bot
2. Send any message
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Find your chat ID in the JSON response

### 🎯 Usage \& Interfaces

#### **Telegram Bot Commands**

```bash
# Start the bot
python main.py

# Bot responds to:
/start              # Welcome message with instructions
<Instagram_URL>     # Direct video processing
```


#### **Flask API Endpoints**

```bash
# Health check
GET http://localhost:5000/health

# Process video (POST)
POST http://localhost:5000/process_instagram
Content-Type: application/json
{"url": "https://www.instagram.com/reel/ABC123/"}

# Process video (GET)
GET http://localhost:5000/process_instagram?url=<instagram_url>
```


### 🏗️ Technical Architecture

#### **Processing Pipeline**

1. **Download Stage**: yt-dlp with Chrome cookies → Raw MP4
2. **Analysis Stage**: FFprobe duration detection → Metadata
3. **Processing Stage**: Complex FFmpeg filter chain → Optimized MP4
4. **Upload Stage**: Telegram API with 10-minute timeout → Delivery
5. **Cleanup Stage**: Async file removal → Resource cleanup

#### **FFmpeg Filter Chain Details**

```bash
# Background creation with blur
crop=in_w:if(gte(in_h\,300)\,in_h-300\,in_h):0:if(gte(in_h\,300)\,150\,0)
scale=1080:1920:force_original_aspect_ratio=increase
crop=1080:1920
boxblur=luma_radius=10:luma_power=1[bg]

# Main video processing
crop=in_w:if(gte(in_h\,300)\,in_h-300\,in_h):0:if(gte(in_h\,300)\,150\,0)
scale=w='if(gte(iw/ih,1080/1920),1080,-1)':h='if(gte(iw/ih,1080/1920),-1,1920)'
scale=iw*0.90:ih*0.90[main]

# Overlay and timing
[bg][main]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[with_main]
setpts=PTS/1.05
atempo=1.05,asetrate=44100*1.03,aresample=44100[a]
```


***

## 📦 Telegram to Dropbox Bot

**Location:** `worker.js` (Cloudflare Worker)
**Purpose:** Intelligent video storage system with OAuth management and analytics

### ✨ Advanced Features

#### **Smart OAuth 2.0 Management**

- **Automatic Token Refresh**: Handles token expiry with 5-minute buffer
- **KV Caching**: Stores tokens with proper TTL to minimize API calls
- **Error Recovery**: Comprehensive error handling for auth failures
- **Security**: Refresh tokens stored in Cloudflare secrets


#### **Intelligent File Upload**

- **Direct Streaming**: Videos stream directly from Telegram to Dropbox
- **Auto-rename**: Handles filename conflicts automatically
- **Metadata Preservation**: Maintains original file properties
- **Progress Tracking**: Real-time upload status notifications


#### **Comprehensive Analytics**

- **Storage Statistics**: Total video count and storage usage
- **Posting Schedule**: Days covered based on 6 videos/day calculation
- **Human-readable Sizes**: Automatic size formatting (B, KB, MB, GB)
- **Real-time Updates**: Live statistics via `/stats` command


### 🔧 Setup Requirements

#### **Cloudflare Worker Deployment**

```bash
cd telegram-to-dropbox
wrangler deploy
```


#### **Environment Secrets**

```bash
wrangler secret put TELEGRAM_BOT_TOKEN    # From @BotFather
wrangler secret put ADMIN_CHAT_ID         # Your Telegram chat ID
wrangler secret put DROPBOX_REFRESH_TOKEN # From OAuth flow
wrangler secret put DROPBOX_APP_KEY       # From Dropbox App Console
wrangler secret put DROPBOX_APP_SECRET    # From Dropbox App Console
```


#### **KV Namespace Configuration**

```bash
# Create namespace
wrangler kv:namespace create "DROPBOX_AUTH_KV"

# Add to wrangler.toml
[[kv_namespaces]]
binding = "DROPBOX_AUTH_KV"
id = "your_returned_namespace_id"
preview_id = "your_returned_preview_id"
```


#### **Dropbox OAuth Setup**

1. **Create App**: Visit [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. **Configure Permissions**:
    - `files.content.write` - Upload files
    - `files.content.read` - Download files
    - `files.metadata.read` - Read file information
3. **Generate Refresh Token**: Use OAuth 2.0 flow to get long-term refresh token
4. **App Folder vs Full Access**: Choose based on your security needs

#### **Telegram Webhook Setup**

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-worker.your-subdomain.workers.dev"}'
```


### 🎯 Commands \& Usage

#### **Available Commands**

- **Forward Video** → Automatic upload with progress notifications
- **`/start`** → Welcome message and usage instructions
- **`/stats`** → Comprehensive storage analytics


#### **Analytics Output Example**

```
📊 Dropbox Stats

Total Videos: 42
Days Covered (@6/day): 7.0  
Total Size: 1.2 GB
```


### 🔄 OAuth Token Management Flow

```
1. Check KV cache for valid token
   ├─ Valid (>5min remaining) → Use cached token
   └─ Invalid/Expired → Refresh flow

2. Token Refresh Process
   ├─ POST to Dropbox OAuth endpoint
   ├─ Validate response
   ├─ Store in KV with TTL
   └─ Return fresh token

3. Error Handling
   ├─ Network failures → Retry with backoff
   ├─ Invalid credentials → Alert admin
   └─ Rate limiting → Exponential backoff
```


***

## 📱 Instagram Poster Bot

**Location:** `worker.js` (Cloudflare Worker)
**Purpose:** Fully automated Instagram posting system with intelligent scheduling and content management

### ✨ Sophisticated Features

#### **Intelligent Cron Scheduling**

- **4-Hour Intervals**: Posts at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
- **Minute-Perfect Timing**: Only triggers on minute 0 to avoid duplicates
- **Manual Override**: `/trigger` endpoint for immediate posting
- **Job Locking**: Prevents concurrent executions with timeout protection


#### **Dynamic Caption System**

20 carefully crafted captions optimized for engagement:

```javascript
'still here? follow (@sillytonic)'
'caught you lurking 👀 (@sillytonic)'  
'follow or regret it (@sillytonic)'
'your feed needs me (@sillytonic)'
'been stalking? just follow (@sillytonic)'
// ... and 15 more variations
```


#### **Robust Instagram Integration**

- **Facebook Graph API v22.0**: Latest API version for maximum compatibility
- **Instagram Reels Posting**: Optimized for Reels format
- **Upload Polling**: Intelligent status checking with 3-minute timeout
- **Retry Logic**: Automatic retry for "not ready" responses
- **Error Recovery**: Comprehensive error handling with admin notifications


#### **Smart File Management**

- **FIFO Queue**: Always posts oldest video first (server_modified sorting)
- **Automatic Cleanup**: Deletes videos from Dropbox after successful posting
- **Shared Link Caching**: 24-hour KV caching for Dropbox URLs
- **Raw Link Conversion**: Converts Dropbox share links to direct download URLs


### 🔧 Detailed Setup Requirements

#### **Cloudflare Worker Configuration**

```bash
cd instagram-poster
wrangler deploy
```


#### **Cron Triggers Setup**

Add to `wrangler.toml`:

```toml
[triggers]
crons = ["* * * * *"]  # Every minute (internal logic filters to 4-hour intervals)
```


#### **Environment Secrets Configuration**

```bash
wrangler secret put FB_ACCESS_TOKEN      # Facebook/Instagram access token
wrangler secret put FB_PAGE_ID           # Instagram Business Account ID  
wrangler secret put TELEGRAM_BOT_TOKEN   # For notifications
wrangler secret put TELEGRAM_CHAT_ID     # Admin notification chat
wrangler secret put DROPBOX_REFRESH_TOKEN # For video access
wrangler secret put DROPBOX_APP_KEY      # Dropbox app credentials
wrangler secret put DROPBOX_APP_SECRET   # Dropbox app credentials
```


#### **KV Namespace Requirements**

```bash
# Create namespace
wrangler kv:namespace create "MEDIA_KV"

# Add to wrangler.toml
[[kv_namespaces]]
binding = "MEDIA_KV"
id = "your_media_kv_namespace_id"
preview_id = "your_media_kv_preview_id"
```


#### **Facebook/Instagram API Setup**

1. **Create Facebook App**: [Facebook Developers](https://developers.facebook.com)
2. **Add Products**:
    - Instagram Basic Display
    - Instagram Graph API
3. **Generate Access Token**:
    - Long-lived User Access Token
    - Convert to Page Access Token
    - Get Instagram Business Account ID
4. **Required Permissions**:
    - `instagram_basic`
    - `instagram_content_publish`
    - `pages_show_list`

### 🎯 Advanced Usage

#### **Manual Trigger Endpoint**

```bash
# Immediate posting (queues within 1 minute)
POST https://your-worker.your-subdomain.workers.dev/trigger
GET  https://your-worker.your-subdomain.workers.dev/trigger

# Response handling
200 ✅ Job queued successfully! Will start within 1 minute via cron
429 ⏳ Job is already running/queued, please wait...
```


#### **Cron Schedule Logic**

```javascript
// Internal scheduling logic
const currentHour = now.getUTCHours();
const currentMinute = now.getUTCMinutes();

// Only run at exact hours: 0, 4, 8, 12, 16, 20
if (currentMinute === 0 && currentHour % 4 === 0) {
    await handlePost(env);
}
```


### 🔄 Complete Posting Pipeline

```
1. Cron Trigger (Every 4 hours)
   ├─ Check manual trigger flag
   ├─ Validate time constraints  
   └─ Set job running lock

2. Content Selection
   ├─ Refresh Dropbox access token
   ├─ List all videos in folder
   ├─ Sort by server_modified (oldest first)
   └─ Select random caption

3. Instagram Upload Process
   ├─ POST to Graph API /media endpoint
   ├─ Poll upload status (max 3 minutes)
   ├─ Handle processing delays
   └─ Publish when ready

4. Cleanup & Notification
   ├─ Delete video from Dropbox
   ├─ Send success notification
   ├─ Clear job running lock
   └─ Log completion details
```


***

## 🚀 Complete Setup Guide

### 1. Repository Structure

```
instagram-automation-framework/
├── main.py                           # Video processor (local)
├── requirements.txt                  # Python dependencies
├── .env                             # Local environment variables
├── telegram-to-dropbox/             # Cloudflare Worker
│   ├── worker.js                    # Dropbox upload bot
│   └── wrangler.toml               # Worker configuration
├── instagram-poster/                # Cloudflare Worker  
│   ├── worker.js                   # Instagram posting bot
│   └── wrangler.toml              # Worker configuration with cron
├── .env.example                    # Template for environment variables
├── .gitignore                      # Ignore sensitive files
└── README.md                       # This comprehensive guide
```


### 2. Prerequisites Checklist

#### **Required Accounts**

- ✅ **Telegram**: Create bot via [@BotFather](https://t.me/botfather)
- ✅ **Dropbox**: Developer account with app created
- ✅ **Facebook**: Developer account for Instagram API
- ✅ **Instagram**: Business account (required for API access)
- ✅ **Cloudflare**: Account with Workers plan


#### **Required Software**

- ✅ **Python 3.7+**: For local video processor
- ✅ **FFmpeg**: System-wide installation required
- ✅ **Node.js**: For Wrangler CLI
- ✅ **Chrome Browser**: For yt-dlp cookie extraction


### 3. Step-by-Step Installation

#### **Step 1: Clone and Setup Local Environment**

```bash
# Clone your repository
git clone <your-repo-url>
cd instagram-automation-framework

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install Python dependencies  
pip install -r requirements.txt

# Create environment file
cp .env.example .env
# Edit .env with your actual values
```


#### **Step 2: Configure Video Processor**

```bash
# .env configuration
TELEGRAM_BOT_TOKEN=bot123456789:YOUR_BOT_TOKEN_FROM_BOTFATHER
MY_CHAT_ID=123456789  # Your Telegram user ID

# Test local setup
python main.py
# Send test Instagram URL to your bot
```


#### **Step 3: Setup Telegram to Dropbox Worker**

```bash
cd telegram-to-dropbox

# Install Wrangler CLI globally
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create KV namespace
wrangler kv:namespace create "DROPBOX_AUTH_KV"
# Copy the returned namespace ID to wrangler.toml

# Configure secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put ADMIN_CHAT_ID
wrangler secret put DROPBOX_REFRESH_TOKEN  
wrangler secret put DROPBOX_APP_KEY
wrangler secret put DROPBOX_APP_SECRET

# Deploy worker
wrangler deploy

# Set Telegram webhook
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \  
  -d '{"url":"https://your-worker.your-subdomain.workers.dev"}'
```


#### **Step 4: Setup Instagram Poster Worker**

```bash
cd ../instagram-poster

# Create KV namespace
wrangler kv:namespace create "MEDIA_KV"
# Add namespace ID to wrangler.toml

# Configure secrets
wrangler secret put FB_ACCESS_TOKEN      # Instagram/Facebook token
wrangler secret put FB_PAGE_ID           # Instagram Business Account ID
wrangler secret put TELEGRAM_BOT_TOKEN   # For notifications  
wrangler secret put TELEGRAM_CHAT_ID     # Admin chat ID
wrangler secret put DROPBOX_REFRESH_TOKEN
wrangler secret put DROPBOX_APP_KEY
wrangler secret put DROPBOX_APP_SECRET

# Deploy with cron triggers
wrangler deploy
```


### 4. Required Configuration Files

#### **telegram-to-dropbox/wrangler.toml**

```toml
name = "telegram-to-dropbox"
main = "worker.js"
compatibility_date = "2024-08-16"

[[kv_namespaces]]
binding = "DROPBOX_AUTH_KV"
id = "your_dropbox_auth_kv_namespace_id"
preview_id = "your_preview_namespace_id"
```


#### **instagram-poster/wrangler.toml**

```toml
name = "instagram-poster"
main = "worker.js" 
compatibility_date = "2024-08-16"

[triggers]
crons = ["* * * * *"]

[[kv_namespaces]]
binding = "MEDIA_KV"
id = "your_media_kv_namespace_id"
preview_id = "your_media_preview_id"
```


#### **requirements.txt**

```txt
yt-dlp==2024.8.6
python-telegram-bot==20.3
flask==2.3.2
python-dotenv==1.0.0
requests==2.31.0
```


### 5. Testing the Complete Workflow

#### **End-to-End Test**

```bash
# 1. Start local processor
python main.py

# 2. Send Instagram URL to your Telegram bot
# Example: https://www.instagram.com/reel/ABC123/

# 3. Verify processed video received in Telegram

# 4. Forward video to Dropbox bot
# Verify upload confirmation

# 5. Check Dropbox storage stats
# Send: /stats

# 6. Test manual Instagram posting
curl -X POST "https://instagram-poster.your-subdomain.workers.dev/trigger"

# 7. Verify posting on @sillytonic Instagram
```


***

## 🔧 Advanced Configuration

### Environment Variables Reference

#### **Local Machine (.env)**

```env
# Telegram Configuration
TELEGRAM_BOT_TOKEN=bot123456789:ABCDEF1234567890
MY_CHAT_ID=123456789

# Optional: Custom download paths  
DOWNLOAD_PATH=/custom/download/path
PROCESSED_PATH=/custom/processed/path
```


#### **Cloudflare Secrets (telegram-to-dropbox)**

```bash
TELEGRAM_BOT_TOKEN=bot123456789:ABCDEF1234567890
ADMIN_CHAT_ID=123456789
DROPBOX_REFRESH_TOKEN=sl.xxxxxxxxxxxxxxxxx
DROPBOX_APP_KEY=abcdefghijk12345  
DROPBOX_APP_SECRET=lmnopqrstuv67890
```


#### **Cloudflare Secrets (instagram-poster)**

```bash  
FB_ACCESS_TOKEN=EAAG...  # Long-lived Instagram access token
FB_PAGE_ID=12345678901234567  # Instagram Business Account ID
TELEGRAM_BOT_TOKEN=bot123456789:ABCDEF1234567890
TELEGRAM_CHAT_ID=123456789
DROPBOX_REFRESH_TOKEN=sl.xxxxxxxxxxxxxxxxx
DROPBOX_APP_KEY=abcdefghijk12345
DROPBOX_APP_SECRET=lmnopqrstuv67890
```


### FFmpeg Custom Configuration

#### **Performance Tuning**

```javascript
// In main.py, modify FFmpeg command for different performance profiles

// High Quality (slower)
'-preset', 'slow', '-crf', '18'

// Balanced (current default)  
'-preset', 'veryfast', '-crf', '23'

// Fast (lower quality)
'-preset', 'ultrafast', '-crf', '28'
```


#### **Custom Filter Modifications**

```javascript
// Adjust crop amount (currently 300px)
const crop_offset = 200; // Reduce cropping

// Modify speed settings  
const speed = 1.1;        // Faster playback
const pitch_factor = 1.0; // No pitch change

// Scale adjustments
scale=iw*0.95:ih*0.95     // Larger overlay (95% vs 90%)
```


### Instagram Posting Customization

#### **Modify Posting Schedule**

```javascript
// Change from 4-hour to 6-hour intervals
if (currentMinute === 0 && currentHour % 6 === 0) {
    await handlePost(env);
}

// Specific posting times (8 AM, 2 PM, 8 PM UTC)
const postingHours = [8, 14, 20];
if (currentMinute === 0 && postingHours.includes(currentHour)) {
    await handlePost(env);
}
```


#### **Custom Caption Sets**

```javascript
// Add seasonal captions
const seasonalCaptions = [
    'summer vibes only (@sillytonic)',
    'winter mood activated (@sillytonic)',
    // ... add your custom captions
];

// Combine with default captions
const allCaptions = [...captions, ...seasonalCaptions];
```


***

## 🛠️ Troubleshooting

### Common Issues \& Solutions

#### **Video Processor Issues**

**"FFmpeg not found" Error**

```bash
# Verify FFmpeg installation
ffmpeg -version

# Ubuntu/Debian installation
sudo apt update && sudo apt install ffmpeg

# macOS installation  
brew install ffmpeg

# Windows: Add FFmpeg to system PATH
# Download from https://ffmpeg.org/download.html
```

**"yt-dlp download failed" Error**

```bash
# Update yt-dlp to latest version
pip install --upgrade yt-dlp

# Clear browser cookies cache
# Chrome cookies might be outdated

# Test with different format
# Modify ydl_opts in main.py:
'format': 'worst'  # For testing
```

**Flask API Not Responding**

```bash
# Check if port 5000 is available
netstat -an | grep 5000  # Linux/macOS
netstat -an | findstr 5000  # Windows

# Try different port
flask_app.run(host='0.0.0.0', port=5001)
```


#### **Telegram to Dropbox Issues**

**"Dropbox token refresh failed" Error**

```bash
# Verify refresh token is valid
curl -X POST https://api.dropbox.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token&refresh_token=YOUR_REFRESH_TOKEN&client_id=YOUR_APP_KEY&client_secret=YOUR_APP_SECRET"

# Check app permissions in Dropbox console
# Ensure files.content.write permission is granted
```

**KV Namespace Issues**

```bash
# List all KV namespaces
wrangler kv:namespace list

# Test KV operations
wrangler kv:key put --namespace-id="YOUR_ID" "test_key" "test_value"
wrangler kv:key get --namespace-id="YOUR_ID" "test_key"
```

**Telegram Webhook Problems**

```bash
# Check webhook status
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"

# Delete and reset webhook
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-worker.your-subdomain.workers.dev"}'
```


#### **Instagram Poster Issues**

**"Upload failed" Errors**

```bash
# Verify Instagram Business Account setup
curl "https://graph.facebook.com/v22.0/me/accounts?access_token=YOUR_TOKEN"

# Check Instagram account connection
curl "https://graph.facebook.com/v22.0/YOUR_PAGE_ID?fields=instagram_business_account&access_token=YOUR_TOKEN"

# Test with smaller video file first
```

**"Publish failed" Errors**

```bash
# Check media status before publishing
curl "https://graph.facebook.com/v22.0/CREATION_ID?fields=status,status_code&access_token=YOUR_TOKEN"

# Common status codes:
# IN_PROGRESS - Still processing
# FINISHED - Ready to publish  
# ERROR - Processing failed
```

**Cron Not Triggering**

```bash
# View cron logs
wrangler tail --format=pretty

# Test manual trigger
curl -X POST "https://instagram-poster.your-subdomain.workers.dev/trigger"

# Verify cron schedule in dashboard
# Check Cloudflare Workers > your-worker > Triggers
```


### Debug Mode \& Logging

#### **Enable Verbose Logging**

```javascript
// In main.py, modify logging level
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.DEBUG  # Changed from INFO
)

// In worker.js files, add debug logs
console.log('DEBUG: Variable value:', someVariable);
```


#### **Monitor Worker Performance**

```bash
# Real-time worker logs
wrangler tail --format=pretty

# Specific worker logs  
wrangler tail --name=telegram-to-dropbox --format=pretty
wrangler tail --name=instagram-poster --format=pretty
```


#### **API Response Debugging**

```javascript
// Add detailed logging for API responses
console.log('Full API Response:', JSON.stringify(response, null, 2));

// Log request details
console.log('Request URL:', url);
console.log('Request Body:', body);
console.log('Request Headers:', headers);
```


### Performance Optimization

#### **Local Processing Optimization**

```python
# Increase thread pool size for high-volume processing
flask_task_executor = ThreadPoolExecutor(max_workers=8)  # Increased from 4

# Optimize FFmpeg for faster processing
'-threads', str(os.cpu_count() * 2),  # Use more threads
'-preset', 'ultrafast',  # Fastest preset
```


#### **Cloudflare Worker Optimization**

```javascript
// Increase timeout limits where possible
const uploadTimeout = 300000;  // 5 minutes for large files

// Batch KV operations
await Promise.all([
    env.MEDIA_KV.put(key1, value1),
    env.MEDIA_KV.put(key2, value2)
]);
```


### Security Best Practices

#### **Token Rotation**

```bash
# Rotate Dropbox refresh token monthly
# 1. Generate new refresh token via OAuth flow
# 2. Update Cloudflare secrets
# 3. Test all workers functionality

# Rotate Telegram bot token if compromised
# 1. Regenerate token via @BotFather  
# 2. Update all references
# 3. Update webhooks
```


#### **Access Control**

```javascript
// Add IP whitelist for Flask API (optional)
ALLOWED_IPS = ['192.168.1.0/24', 'your.static.ip']

// Implement rate limiting for manual triggers
const lastTrigger = await env.MEDIA_KV.get('last_manual_trigger');
const now = Date.now();
if (lastTrigger && (now - parseInt(lastTrigger)) < 60000) {
    return new Response('Rate limited', { status: 429 });
}
```


***

## 📊 Monitoring \& Analytics

### Performance Metrics

#### **Processing Times (Typical)**

- **Video Download**: 10-30 seconds (depends on file size)
- **FFmpeg Processing**: 15-45 seconds (depends on duration)
- **Telegram Upload**: 5-20 seconds (depends on file size)
- **Total Pipeline**: 30-95 seconds per video


#### **Storage Analytics**

```javascript
// Daily storage usage estimation
Videos per day: 6
Average video size: ~25MB  
Daily storage: ~150MB
Monthly storage: ~4.5GB
```


### Cost Monitoring

#### **Cloudflare Workers Usage**

- **Free Tier**: 100,000 requests/day
- **Typical Usage**: ~50 requests/day per worker
- **KV Operations**: ~200 reads/writes per day
- **Bandwidth**: Minimal (mostly API calls)


#### **Dropbox Storage**

- **Free Tier**: 2GB storage
- **Estimated Usage**: ~4.5GB/month
- **Recommendation**: Dropbox Plus (2TB) for long-term storage


### Health Monitoring Setup

#### **Create Monitoring Dashboard**

```javascript
// Add health check endpoints to all workers
if (url.pathname === '/health') {
    return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
```


#### **Uptime Monitoring**

Set up external monitoring for:

- `http://your-local-ip:5000/health` (Video Processor)
- `https://telegram-to-dropbox.your-subdomain.workers.dev/health`
- `https://instagram-poster.your-subdomain.workers.dev/health`

***

## 🔒 Security \& Compliance

### Data Privacy

- **No Data Retention**: Videos deleted after processing/posting
- **Encrypted Transit**: All API calls use HTTPS/TLS
- **Token Security**: All credentials stored in secure environments
- **Access Logs**: Minimal logging of personal data


### Instagram Compliance

- **Content Rights**: Only post content you own or have rights to
- **API Rate Limits**: Respect Facebook Graph API limitations
- **Community Guidelines**: Ensure content meets Instagram standards
- **Business Account**: Required for API access


### GDPR Considerations

- **Data Processing**: Minimal personal data processing
- **User Consent**: Required for any user-generated content
- **Data Deletion**: Automatic cleanup implemented
- **Access Rights**: Users can request data deletion

***

## 📝 License \& Contributing

### License

MIT License - Feel free to modify and distribute with attribution.

### Contributing Guidelines

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit changes**: `git commit -m 'Add amazing feature'`
4. **Push to branch**: `git push origin feature/amazing-feature`
5. **Open Pull Request**

### Code Standards

- **Python**: Follow PEP 8 guidelines
- **JavaScript**: Use ES6+ features, async/await patterns
- **Documentation**: Comment complex logic thoroughly
- **Error Handling**: Always include try/catch blocks
- **Testing**: Test all API integrations before committing

***

## 🎯 Future Enhancements

### Planned Features

- **Multi-account Support**: Post to multiple Instagram accounts
- **Content Scheduling**: Advanced posting schedule management
- **Analytics Dashboard**: Web interface for monitoring metrics
- **Content Filtering**: AI-powered content quality assessment
- **Backup Systems**: Automated backup to multiple cloud providers


### Suggested Improvements

- **Video Quality Enhancement**: AI upscaling for low-quality inputs
- **Caption Intelligence**: AI-generated captions based on content
- **Hashtag Optimization**: Automatic hashtag suggestion system
- **Performance Analytics**: Instagram post performance tracking
- **Content Moderation**: Automated content screening

***

*Built with ❤️ for automated content creation*
*Developed in Darrang, Assam, India 🇮🇳*

***

**🚨 Important Notes:**

- Always respect platform terms of service
- Monitor your automation to ensure quality
- Keep your API tokens secure and rotate regularly
- Test thoroughly before deploying to production
- Consider legal implications of content automation

**📞 Support:**

- Create GitHub issues for bugs/feature requests
- Check Cloudflare Workers documentation for platform limits
- Monitor Instagram API changelog for breaking changes
