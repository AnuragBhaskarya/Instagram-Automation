import os
import subprocess
import logging
from telegram import Update
from telegram.ext import Application, ApplicationBuilder, CommandHandler, MessageHandler, ContextTypes, filters, ExtBot
from yt_dlp import YoutubeDL
import uuid
from flask import Flask, request, jsonify
import threading
import asyncio
from concurrent.futures import ThreadPoolExecutor
import time
from dotenv import load_dotenv
import socket
import requests
import json

load_dotenv()

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
MY_CHAT_ID_STR = os.getenv("MY_CHAT_ID")
try:
    MY_CHAT_ID = int(MY_CHAT_ID_STR)
except (ValueError, TypeError):
    logger.warning(f"MY_CHAT_ID '{MY_CHAT_ID_STR}' is not a valid integer. Assuming it's a username string.")
    MY_CHAT_ID = MY_CHAT_ID_STR


ptb_application_instance: Application = None
flask_app = Flask(__name__)
flask_task_executor = ThreadPoolExecutor(max_workers=min(4, (os.cpu_count() or 1) + 2)) # Slightly increased default based on common guidance

# Download video using yt-dlp
def download_video(url, download_path):
    logger.info(f"yt-dlp process preparing to download: {url} to {download_path} at {time.monotonic()}")
    ydl_opts = {
        'outtmpl': download_path,
        'format': 'bestvideo+bestaudio/best', # Reverted to original simpler format
        'quiet': False, # Kept False for diagnostics. Change to True if you prefer less yt-dlp output.
        'merge_output_format': 'mp4',
        'cookiesfrombrowser': ('chrome',),
        'noplaylist': True,
        # 'verbose': True, # For extreme debugging of yt-dlp
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            # The actual download (including metadata fetching) happens here
            ydl.download([url])
        logger.info(f"yt-dlp download finished for {url} at {time.monotonic()}")
    except Exception as e:
        logger.error(f"yt-dlp download failed for {url}: {e}")
        raise

# Process video with FFmpeg (remains synchronous, will be run in a thread)
def process_video(input_path, output_path):
    logger.info(f"FFmpeg processing starting: {input_path} to {output_path} at {time.monotonic()}")
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input_path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True
        )
        duration = float(result.stdout.strip())

        trim_amount = 0.1
        if duration <= trim_amount:
            logger.warning(f"Video {input_path} is {duration}s, too short to trim {trim_amount}s. Using full duration.")
            trim_duration_str = str(duration)
        else:
            trim_duration_str = str(duration - trim_amount)

        crop_offset = 300
        speed = 1.05
        pitch_factor = 1.03
        filter_complex = (
            f"[0:v]crop=in_w:if(gte(in_h\\,{crop_offset})\\,in_h-{crop_offset}\\,in_h):0:if(gte(in_h\\,{crop_offset})\\,{crop_offset}/2\\,0),"
            "scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,"
            "boxblur=luma_radius=10:luma_power=1[bg];"
            f"[0:v]crop=in_w:if(gte(in_h\\,{crop_offset})\\,in_h-{crop_offset}\\,in_h):0:if(gte(in_h\\,{crop_offset})\\,{crop_offset}/2\\,0),"
            "scale=w='if(gte(iw/ih,1080/1920),1080,-1)':h='if(gte(iw/ih,1080/1920),-1,1920)',"
            "scale=iw*0.90:ih*0.90[main];"
            "[bg][main]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[with_main];"
            f"[with_main]setpts=PTS/{speed},"
            "format=yuv420p[v];"  # Removed redundant yuv444p conversion
            f"[0:a]atempo={speed},asetrate=44100*{pitch_factor},aresample=44100[a]"
        )

        command = [
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-i', input_path,  # Removed -r 29.97 from before input
            '-filter_complex', filter_complex,
            '-map', '[v]',
            '-map', '[a]',
            '-ss', '0',
            '-t', trim_duration_str,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '23',
            '-r', '29.97',  # Moved framerate setting to output (if you need to force output framerate)
            '-c:a', 'aac',
            '-b:a', '192k',
            '-map_metadata', '-1',
            '-movflags', '+faststart',
            '-threads', str(os.cpu_count()),
            '-y',
            output_path
        ]

        ffmpeg_process = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, check=False)
        if ffmpeg_process.returncode != 0:
            error_message = f"FFmpeg failed for {input_path}. Return code: {ffmpeg_process.returncode}\nStderr: {ffmpeg_process.stderr}"
            logger.error(error_message)
            raise subprocess.CalledProcessError(ffmpeg_process.returncode, command, stderr=ffmpeg_process.stderr)

        logger.info(f"FFmpeg processing finished for {output_path} at {time.monotonic()}")
    except subprocess.CalledProcessError:
        raise
    except Exception as e:
        logger.error(f"FFmpeg processing general error for {input_path}: {e}")
        raise

# Main asynchronous processing function
async def execute_video_pipeline(bot: ExtBot, instagram_url: str, source_info: str):
    # This happens "concurrently" as the download_task starts up in its thread.
    try:
        await bot.send_message(chat_id=MY_CHAT_ID, text=f'🔥 Processing your video from {source_info}...\nURL: {instagram_url}')
        logger.info(f"Sent 'Processing' message for {instagram_url} at {time.monotonic()}")
    except Exception as e:
        logger.warning(f"Failed to send initial 'Processing' message for {instagram_url}: {e}")

    pipeline_start_time = time.monotonic()
    logger.info(f"execute_video_pipeline started for URL: {instagram_url} from {source_info} at {pipeline_start_time}")

    unique_id = str(uuid.uuid4())
    download_path = f'{unique_id}.mp4'
    processed_path = f'{unique_id}_processed.mp4'

    # Task to run download_video in a separate thread.
    # Create the task so it's scheduled, but don't await it immediately.
    logger.info(f"Scheduling download task for {instagram_url} at {time.monotonic()}")
    download_task = asyncio.create_task(
        asyncio.to_thread(download_video, instagram_url, download_path),
        name=f"download_{unique_id}"
    )

    # Send the initial notification message.

    try:
        # Now, await the completion of the download.
        await download_task
        download_complete_time = time.monotonic()
        logger.info(f"Download task completed for {instagram_url} at {download_complete_time} (duration: {download_complete_time - pipeline_start_time:.2f}s from pipeline start)")

        if not os.path.exists(download_path) or os.path.getsize(download_path) == 0:
            raise FileNotFoundError(f"Downloaded file {download_path} appears empty or missing after download_task.")

        # Task to run process_video in a separate thread.
        logger.info(f"Scheduling process task for {download_path} at {time.monotonic()}")
        process_task = asyncio.create_task(
            asyncio.to_thread(process_video, download_path, processed_path),
            name=f"process_{unique_id}"
        )
        await process_task
        process_complete_time = time.monotonic()
        logger.info(f"Process task completed for {processed_path} at {process_complete_time} (duration: {process_complete_time - download_complete_time:.2f}s)")

        if not os.path.exists(processed_path) or os.path.getsize(processed_path) == 0:
            raise FileNotFoundError(f"Processed file {processed_path} appears empty or missing after FFmpeg.")

        logger.info(f"Uploading {processed_path} to Telegram for URL: {instagram_url} at {time.monotonic()}")
        with open(processed_path, 'rb') as video_file:
            await bot.send_video(
                chat_id=MY_CHAT_ID,
                video=video_file,
                connect_timeout=15.0, # Increased connect timeout
                read_timeout=120.0,  # Increased read timeout for potentially slower networks
                write_timeout=600.0  # 10 minutes for upload, adjust as needed
            )
        upload_complete_time = time.monotonic()
        logger.info(f"Successfully sent video for URL: {instagram_url} at {upload_complete_time} (upload duration: {upload_complete_time - process_complete_time:.2f}s)")

    except FileNotFoundError as e:
        logger.error(f"File operation error for {instagram_url}: {e}")
        await bot.send_message(chat_id=MY_CHAT_ID, text=f'⚠️ File error: {str(e)}')
    except subprocess.CalledProcessError as e:
        error_lines = (e.stderr or "No stderr from FFmpeg.").strip().splitlines()
        error_snippet = "\n".join(error_lines[-5:])
        await bot.send_message(chat_id=MY_CHAT_ID, text=f'⚠️ FFmpeg processing error. Details:\n<code>{error_snippet}</code>', parse_mode='HTML')
    except Exception as e:
        logger.error(f"An unexpected error occurred in pipeline for {instagram_url}: {e}", exc_info=True)
        await bot.send_message(chat_id=MY_CHAT_ID, text=f'⚠️ An unexpected error occurred: {str(e)}')
    finally:
        cleanup_start_time = time.monotonic()
        for file_path in [download_path, processed_path]:
            if os.path.exists(file_path):
                try:
                    await asyncio.to_thread(os.remove, file_path)
                    logger.info(f"Cleaned up file: {file_path}")
                except Exception as cleanup_error:
                    logger.error(f"Cleanup failed for {file_path}: {cleanup_error}")
        logger.info(f"Cleanup finished at {time.monotonic()} (duration: {time.monotonic() - cleanup_start_time:.2f}s)")


def run_video_pipeline_sync_wrapper(bot: ExtBot, instagram_url: str, source_info: str):
    try:
        asyncio.run(execute_video_pipeline(bot, instagram_url, source_info))
    except Exception as e:
        logger.critical(f"Critical error in task runner for {instagram_url} from {source_info}: {e}", exc_info=True)

@flask_app.route('/process_instagram', methods=['GET', 'POST'])
def api_process_instagram():
    instagram_url = None
    if request.method == 'POST':
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({'error': 'Missing Instagram URL in request body'}), 400
        instagram_url = data['url']
    elif request.method == 'GET':
        instagram_url = request.args.get('url')
        if not instagram_url:
            return jsonify({'error': 'Missing Instagram URL in query parameter'}), 400

    if not instagram_url or not (instagram_url.startswith('http://') or instagram_url.startswith('https://')):
        return jsonify({'error': 'Invalid or missing Instagram URL format'}), 400

    if ptb_application_instance is None or ptb_application_instance.bot is None:
        logger.error("Flask API: Telegram bot instance not available.")
        return jsonify({'error': 'Bot service not ready, please try again later.'}), 503

    flask_task_executor.submit(
        run_video_pipeline_sync_wrapper,
        ptb_application_instance.bot,
        instagram_url,
        f"API-{request.method}"
    )

    logger.info(f"Accepted API request for URL: {instagram_url}, task submitted to executor.")
    return jsonify({'message': 'Video processing initiated. You will receive a message on Telegram upon completion.'}), 202

@flask_app.route('/health', methods=['GET'])
def health_check():
    active_tasks_approx = 0
    if hasattr(flask_task_executor, '_work_queue'): # Check if attribute exists
        active_tasks_approx = flask_task_executor._work_queue.qsize()

    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'bot_initialized': ptb_application_instance is not None and ptb_application_instance.bot is not None,
        'active_flask_tasks_approx': active_tasks_approx,
    }), 200

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Welcome to InstaDownloaderBot!\nSend an Instagram video URL to process, or use the API."
    )

async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    url = update.message.text.strip()
    if not (url.startswith('http://') or url.startswith('https://')):
        await update.message.reply_text("Please send a valid URL starting with http:// or https://.")
        return

    await update.message.reply_text("Got it! Your request is being queued for processing... ⏳")

    asyncio.create_task(
        execute_video_pipeline(context.bot, url, f"Telegram User: {update.effective_user.id}"),
        name=f"pipeline_tg_{update.effective_user.id}_{uuid.uuid4().hex[:6]}"
    )
    logger.info(f"Accepted Telegram request from user {update.effective_user.id} for URL: {url}, task created.")

def run_flask_app_in_thread():
    logger.info("Starting Flask app server in a separate thread...")
    flask_app.run(host='0.0.0.0', port=5000, threaded=True) # threaded=True is default for dev server, but explicit


def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    ip = s.getsockname()[0]
    s.close()
    return ip

url = "https://ip-holder.kmxconnect.workers.dev"  # Your worker URL
requests.post(url, json={"ip": get_ip()})

def main():
    global ptb_application_instance

    if not TELEGRAM_BOT_TOKEN:
        logger.critical("TELEGRAM_BOT_TOKEN not found. Exiting.")
        return
    if not MY_CHAT_ID_STR: # Check original string
        logger.critical("MY_CHAT_ID not found. Exiting.")
        return

    ptb_application_instance = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()

    ptb_application_instance.add_handler(CommandHandler("start", start_command))
    ptb_application_instance.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))

    flask_thread = threading.Thread(target=run_flask_app_in_thread, daemon=True)
    flask_thread.start()
    logger.info("Flask app thread initiated.")

    logger.info("Starting Telegram bot polling...")
    try:
        ptb_application_instance.run_polling(allowed_updates=Update.ALL_TYPES)
    except Exception as e:
        logger.critical(f"Telegram bot polling failed: {e}", exc_info=True)
    finally:
        logger.info("Telegram bot has stopped. Shutting down executor...")
        flask_task_executor.shutdown(wait=True) # Wait for pending tasks in flask executor
        logger.info("Executor shut down.")

if __name__ == '__main__':
    main()
