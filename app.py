import os
import re
import json
import queue
import threading
import urllib.parse
import random
from datetime import datetime
from functools import wraps
import asyncio
import aiohttp
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, Response, stream_with_context

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "meou_scan_secret_key_default_123")

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

USERS = {}
for key, value in os.environ.items():
    if key.startswith("USER_EMAIL_"):
        index_suffix = key.replace("USER_EMAIL_", "")
        password = os.getenv(f"USER_PASS_{index_suffix}")
        if password:
            USERS[value] = password

# ── Display name mapping: email -> display_name ────────────────────────
def _load_display_names():
    """Parse displayname.txt and build {email: display_name} dict."""
    mapping = {}
    txt_path = os.path.join(os.path.dirname(__file__), 'displayname.txt')
    if not os.path.exists(txt_path):
        return mapping
    try:
        with open(txt_path, encoding='utf-8') as f:
            content = f.read()
        emails = re.findall(r'USER_EMAIL_\d+="([^"]+)"', content)
        names  = re.findall(r'DISPLAY_NAME_\d+="([^"]+)"', content)
        for email, name in zip(emails, names):
            mapping[email.strip()] = name.strip()
    except Exception as e:
        print(f"[WARN] Could not load displayname.txt: {e}")
    return mapping

DISPLAY_NAMES = _load_display_names()

ECOMMERCE_DOMAINS = r'(?:shopee\.vn|shope\.ee|lazada\.vn|lzd\.co|tiktok\.com|tiki\.vn|ti\.ki|joyme|s\.shopee\.vn)'
LINK_PATTERNS = [
    re.compile(r'https?://[^\s"\'\'<>\\{}]*' + ECOMMERCE_DOMAINS + r'[^\s"\'\'<>\\{}]*'),
    re.compile(r'https(?:%3A|:|\\u00253A)[^\s"\'\'<>\\{}]*' + ECOMMERCE_DOMAINS + r'[^\s"\'\'<>\\{}]*')
]

# ── Pre-compiled regex patterns (module-level, compiled once at startup) ──
_RE_META     = re.compile(r'<meta[^>]*>')
_RE_TEXT     = re.compile(r'"text"\s*:\s*"(?:[^"\\]|\\.)*"')
_RE_CONTENT  = re.compile(r'"content"\s*:\s*"(?:[^"\\]|\\.)*"')
_RE_SIMPLE   = re.compile(r'"simpleText"\s*:\s*"(?:[^"\\]|\\.)*"')
_RE_SHOP_ID  = re.compile(r'"shoppingId"\s*:\s*"([^"]{5,30})"')
_RE_MERCHANT = re.compile(r'"merchantName"\s*:\s*"([^"]+)"')
_RE_RENDERER = re.compile(r'"(?:merchShelfItemRenderer|shoppingCarouselItemRenderer|productListItemRenderer)"')

# ── Cancel flag registry: user_email -> threading.Event ──────────────
SCAN_CANCEL_FLAGS: dict[str, threading.Event] = {}

# ── Hàng đợi quét (Queue) ──────────────
class FIFOLock:
    def __init__(self):
        self.waiters = []
        self.lock = threading.Lock()
        
    def locked(self):
        with self.lock:
            return len(self.waiters) > 0
            
    def acquire(self):
        me = threading.Event()
        with self.lock:
            self.waiters.append(me)
            if len(self.waiters) == 1:
                me.set()
        me.wait()
        
    def release(self):
        with self.lock:
            if self.waiters:
                self.waiters.pop(0)
            if self.waiters:
                self.waiters[0].set()

scan_lock = FIFOLock()
current_scanning_user = {"email": None, "username": None}

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def get_clean_ecommerce_url(raw_url):
    try:
        decoded = urllib.parse.unquote(urllib.parse.unquote(raw_url))
        decoded = decoded.replace('\\/', '/').replace('\\u0026', '&').replace('\\', '').split('"')[0].split("'")[0]
        
        if 'an_redir' in decoded:
            return None
            
        if 'youtube.com/redirect' in decoded or 'url=' in decoded or 'q=' in decoded:
            # Chặn đứng các link sinh ra từ Mô tả, Bình luận, và Giới thiệu kênh qua định tuyến redirect
            if 'event=video_description' in decoded or 'event=comments' in decoded or 'event=channel_description' in decoded:
                return None
            parsed = urllib.parse.urlparse(decoded)
            query_params = urllib.parse.parse_qs(parsed.query)
            if 'q' in query_params: decoded = query_params['q'][0]
            elif 'url' in query_params: decoded = query_params['url'][0]
            elif 'origin_link' in query_params: decoded = query_params['origin_link'][0]

        decoded_lower = decoded.lower()
        
        if 'lazada.vn' in decoded_lower or 'lzd.co' in decoded_lower:
            if '.html' not in decoded_lower and '/products/' not in decoded_lower:
                return None
            if '.html' in decoded_lower:
                decoded = decoded.split('.html')[0] + '.html'
            else:
                decoded = decoded.split('?')[0]
            return {"url": decoded, "platform": "Lazada"}
            
        elif 'shopee.vn' in decoded_lower or 'shope.ee' in decoded_lower or 's.shopee.vn' in decoded_lower:
            if '/product/' not in decoded_lower and '-i.' not in decoded_lower and 'sp_atk' not in decoded_lower:
                return None
            decoded = decoded.split('?')[0]
            return {"url": decoded, "platform": "Shopee"}
            
        elif 'tiktok.com' in decoded_lower:
            if '/product/' not in decoded_lower and '/view/product/' not in decoded_lower:
                return None
            decoded = decoded.split('?')[0]
            return {"url": decoded, "platform": "Other"}
            
        elif 'tiki.vn' in decoded_lower or 'ti.ki' in decoded_lower:
            if '.html' not in decoded_lower and '/p' not in decoded_lower:
                return None
            decoded = decoded.split('?')[0]
            return {"url": decoded, "platform": "Other"}
            
        else:
            decoded = decoded.split('?')[0]
            return {"url": decoded, "platform": "Other"}
            
    except: return None

def extract_video_id(url):
    match = re.search(r'(?:v=|youtu\.be/|shorts/|/embed/)([0-9A-Za-z_-]{11})', url)
    return match.group(1) if match else None

def parse_iso_duration(duration_str):
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str)
    if not match: return 0
    h, m, s = int(match.group(1) or 0), int(match.group(2) or 0), int(match.group(3) or 0)
    return h * 3600 + m * 60 + s

async def get_channel_info(session_http, url):
    try:
        if '@' in url:
            handle = url.split('@')[-1].split('/')[0].split('?')[0]
            api_url = f"{YOUTUBE_API_BASE}/channels?part=snippet,contentDetails&forHandle={handle}&key={YOUTUBE_API_KEY}"
        elif '/channel/' in url:
            channel_id = url.split('/channel/')[-1].split('/')[0].split('?')[0]
            api_url = f"{YOUTUBE_API_BASE}/channels?part=snippet,contentDetails&id={channel_id}&key={YOUTUBE_API_KEY}"
        else: return [], "MeoU"

        async with session_http.get(api_url) as resp:
            data = await resp.json()
            if not data.get('items'): return [], "Channel"
            item = data['items'][0]
            channel_name, channel_id = item['snippet']['title'], item['id']
            if channel_id.startswith("UC"):
                base_id = channel_id[2:]
                return ["UU" + base_id, "UUSH" + base_id, "UULV" + base_id], channel_name
            uploads_id = item['contentDetails']['relatedPlaylists'].get('uploads')
            return [uploads_id] if uploads_id else [], channel_name
    except: return [], "MeoU"

async def get_playlist_videos(session_http, playlist_id, start_date, max_results=50, max_pages=100, cancel_flag=None):
    video_ids = []
    next_page_token = None
    pages_fetched = 0
    
    try:
        while pages_fetched < max_pages:
            if cancel_flag and cancel_flag.is_set():
                break

            api_url = f"{YOUTUBE_API_BASE}/playlistItems?part=snippet&maxResults={max_results}&playlistId={playlist_id}&key={YOUTUBE_API_KEY}"
            if next_page_token:
                api_url += f"&pageToken={next_page_token}"
                
            async with session_http.get(api_url) as resp:
                if resp.status != 200:
                    break
                data = await resp.json()
                items = data.get('items', [])
                stop_fetching = False
                
                for item in items:
                    pub_date = item['snippet']['publishedAt'].split('T')[0]
                    if pub_date < start_date:
                        stop_fetching = True
                        break
                    video_ids.append(item['snippet']['resourceId']['videoId'])
                
                if stop_fetching:
                    break
                
                next_page_token = data.get('nextPageToken')
                if not next_page_token:
                    break
                    
            pages_fetched += 1
            
        return video_ids
    except Exception as e:
        print(f"Lỗi lấy playlist: {e}")
        return video_ids

def parse_video_html(html_content, video_data):
    """
    Synchronous helper function for CPU-bound HTML parsing and regex operations.
    This runs in a thread pool to avoid blocking the asyncio event loop.
    """
    clean_html = html_content
    
    # LỚP BẢO VỆ 1: Tiêu huỷ văn bản thô.
    # Dùng pre-compiled patterns (module-level) thay vì compile lại mỗi lần gọi hàm
    clean_html = _RE_META.sub('', clean_html)
    clean_html = _RE_TEXT.sub('""', clean_html)
    clean_html = _RE_CONTENT.sub('""', clean_html)
    clean_html = _RE_SIMPLE.sub('""', clean_html)

    raw_links = {}
    for p in LINK_PATTERNS:
        for m in p.findall(clean_html):
            clean_data = get_clean_ecommerce_url(m)
            if clean_data and clean_data['url'] not in raw_links:
                raw_links[clean_data['url']] = clean_data['platform']
                
    ecommerce_items = [{"clean_url": k, "platform": v} for k, v in raw_links.items()]
    
    unique_ids = set(_RE_SHOP_ID.findall(clean_html))
    json_merchants = _RE_MERCHANT.findall(clean_html)
    has_renderers = bool(_RE_RENDERER.search(clean_html))
    
    has_native_shopping = bool(unique_ids) or bool(json_merchants) or has_renderers
    
    shopee_c = 0
    lazada_c = 0
    total_other_count = 0
    
    # LỚP BẢO VỆ 2: NẾU KHÔNG CÓ GIỎ HÀNG THẬT -> XOÁ SẠCH MỌI LINK
    if not has_native_shopping:
        ecommerce_items = []
    else:
        shopee_c = sum(1 for i in ecommerce_items if i['platform'] == 'Shopee')
        lazada_c = sum(1 for i in ecommerce_items if i['platform'] == 'Lazada')
        
        if shopee_c == 0 and lazada_c == 0:
            other_url_c = sum(1 for i in ecommerce_items if i['platform'] == 'Other')
            if unique_ids:
                native_other_count = len(unique_ids)
            else:
                unique_merchants = {m.strip().lower() for m in json_merchants if m.strip() and 'shopee' not in m.lower() and 'lazada' not in m.lower()}
                native_other_count = len(unique_merchants)
            total_other_count = max(other_url_c, native_other_count)
    
    video_data.update({
        'has_shopping': has_native_shopping,
        'shopping_links': ecommerce_items,
        'shopee_count': shopee_c,
        'lazada_count': lazada_c,
        'other_count': total_other_count,
        'status': 'success'
    })
    return video_data

async def fetch_html_and_extract_links(session_http, video_data, semaphore, cancel_flag=None):
    vid = video_data['vid']
    shorts_url = f"https://www.youtube.com/shorts/{vid}"
    is_short_candidate = video_data.get('is_short_candidate', True)
    
    async with semaphore:
        if cancel_flag and cancel_flag.is_set():
            video_data.update({'has_shopping': False, 'shopping_links': [], 'shopee_count': 0, 'lazada_count': 0, 'other_count': 0, 'status': 'cancelled', 'url': f"https://www.youtube.com/watch?v={vid}"})
            return video_data

        try:
            await asyncio.sleep(0.1 + (hash(vid) % 20) / 100)
            
            current_type = video_data['type']
            html_content = ""
            
            if is_short_candidate:
                async with session_http.get(shorts_url, allow_redirects=False, timeout=10) as resp:
                    if resp.status == 200:
                        video_data['type'] = 'Short'
                        video_data['url'] = shorts_url
                        html_content = await resp.text()
                    else:
                        if current_type != 'Stream':
                            video_data['type'] = 'Video'
                        video_data['url'] = f"https://www.youtube.com/watch?v={vid}"
            else:
                if current_type != 'Stream':
                    video_data['type'] = 'Video'
                video_data['url'] = f"https://www.youtube.com/watch?v={vid}"
            
            if not html_content:
                async with session_http.get(video_data['url'], timeout=10) as resp:
                    html_content = await resp.text()
            
            if video_data['type'] == 'Stream':
                html_no_spaces = html_content.replace(' ', '')
                is_premiere = (
                    'Đã công chiếu' in html_content or
                    'Premiered' in html_content or
                    '"isPremiere":true' in html_no_spaces or
                    'BADGE_STYLE_TYPE_PREMIERE' in html_content or
                    '"iconType":"PREMIERE"' in html_content
                )
                is_real_live = (
                    'Đã phát trực tiếp' in html_content or
                    'Streamed live' in html_content
                )
                if is_premiere and not is_real_live:
                    video_data['type'] = 'Video'
            
            video_data = await asyncio.to_thread(parse_video_html, html_content, video_data)
            return video_data
        except:
            video_data.update({'has_shopping': False, 'shopping_links': [], 'shopee_count': 0, 'lazada_count': 0, 'other_count': 0, 'status': 'error', 'url': f"https://www.youtube.com/watch?v={vid}"})
            return video_data

async def process_all_urls(urls, start_date, end_date, cancel_flag=None, progress_queue=None):
    candidate_ids = []
    final_channel_name = "MeoU"
    
    user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    ]
    
    headers = {
        "User-Agent": random.choice(user_agents),
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": "PREF=hl=vi&gl=VN; YSC=meou_scan_magic; VISITOR_INFO1_LIVE=meou_scan_magic;",
        "X-Forwarded-For": f"14.161.{random.randint(1,255)}.{random.randint(1,255)}" # Giả mạo IP VN (dải của VNPT)
    }
    
    connector = aiohttp.TCPConnector(limit=20)  # Khớp với semaphore(15) + buffer nhỏ
    async with aiohttp.ClientSession(headers=headers, connector=connector) as session_http:
        for u in urls:
            if cancel_flag and cancel_flag.is_set():
                break
            if '/@' in u or '/channel/' in u:
                playlist_ids, name = await get_channel_info(session_http, u)
                if playlist_ids:
                    final_channel_name = name
                    for pid in playlist_ids:
                        if cancel_flag and cancel_flag.is_set():
                            break
                        vids = await get_playlist_videos(session_http, pid, start_date, max_results=50, cancel_flag=cancel_flag)
                        candidate_ids.extend(vids)
            else:
                vid = extract_video_id(u)
                if vid:
                    candidate_ids.append(vid)
                
        unique_ids = list(set(candidate_ids))
        valid_videos = []

        for i in range(0, len(unique_ids), 50):
            if cancel_flag and cancel_flag.is_set():
                break
            chunk = unique_ids[i:i+50]
            api_url = f"{YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,liveStreamingDetails&id={','.join(chunk)}&key={YOUTUBE_API_KEY}"
            try:
                async with session_http.get(api_url) as resp:
                    data = await resp.json()
                    for item in data.get('items', []):
                        pub_date = item['snippet']['publishedAt'].split('T')[0]
                        if start_date <= pub_date <= end_date:
                            vid = item['id']
                            is_live = 'liveStreamingDetails' in item or item['snippet'].get('liveBroadcastContent') != 'none'
                            v_type = "Stream" if is_live else "Video"
                            duration_str = item.get('contentDetails', {}).get('duration', 'PT0S')
                            duration_sec = parse_iso_duration(duration_str)
                            is_short_candidate = duration_sec <= 185
                            valid_videos.append({
                                "vid": vid,
                                "url": "",
                                "upload_date": pub_date,
                                "display_date": datetime.strptime(pub_date, "%Y-%m-%d").strftime("%d/%m/%Y"),
                                "type": v_type,
                                "channel_name": item['snippet'].get('channelTitle', final_channel_name),
                                "is_short_candidate": is_short_candidate
                            })
            except: continue

        semaphore = asyncio.Semaphore(15)
        total_videos = len(valid_videos)

        # Gửi tổng số video ngay khi biết để frontend hiện thanh tiến trình
        if progress_queue:
            progress_queue.put_nowait({"type": "progress", "done": 0, "total": total_videos})

        done_count = 0

        async def fetch_and_report(video_data):
            nonlocal done_count
            result = await fetch_html_and_extract_links(session_http, video_data, semaphore, cancel_flag)
            done_count += 1
            if progress_queue:
                progress_queue.put_nowait({"type": "progress", "done": done_count, "total": total_videos})
            return result

        tasks = [fetch_and_report(v) for v in valid_videos]
        scanned_results = await asyncio.gather(*tasks)

    return scanned_results, final_channel_name

# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/')
@login_required
def index():
    email = session['user']
    username = DISPLAY_NAMES.get(email, email.split('@')[0])
    # Mở khoá toàn bộ tính năng cho tất cả người dùng
    return render_template('index.html', user=email, username=username, is_admin=True)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        if email in USERS and USERS[email] == password:
            session['user'] = email
            return jsonify({"status": "success"})
        return jsonify({"status": "error", "message": "Email hoặc mật khẩu sai!"}), 401
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('login'))

@app.route('/api/cancel', methods=['POST'])
@login_required
def cancel_scan():
    """Hủy scan đang chạy cho user hiện tại."""
    user = session['user']
    flag = SCAN_CANCEL_FLAGS.get(user)
    if flag:
        flag.set()
        return jsonify({"status": "cancelled"})
    return jsonify({"status": "no_active_scan"})

@app.route('/api/scan', methods=['POST'])
@login_required
def scan_links():
    user = session['user']

    cancel_flag = threading.Event()
    SCAN_CANCEL_FLAGS[user] = cancel_flag

    # Đọc data TRƯỚC khi spawn thread (Flask request context không có sẵn trong thread)
    data = request.get_json()
    urls = data.get('urls', [])
    start_date = data.get('startDate')
    end_date = data.get('endDate')

    progress_queue: queue.Queue = queue.Queue()

    def run_scan():
        if scan_lock.locked():
            # Đang có người khác chạy -> Báo đang chờ
            waiting_for = current_scanning_user.get("username", "ai đó")
            progress_queue.put({"type": "waiting", "waiting_for": waiting_for})

        # Dừng ở đây cho đến khi lấy được chìa khóa (hoặc block)
        scan_lock.acquire()
        # --- Tách thành try riêng sau khi acquire() đã thành công ---
        # để finally luôn gọi release() đúng cặp với acquire() đã hoàn thành
        try:
            # Nếu user đã ấn "Ngừng Quét" trong lúc đang xếp hàng
            if cancel_flag.is_set():
                progress_queue.put({"type": "result", "results": [], "channel_name": "Đã hủy xếp hàng", "cancelled": True})
                return

            current_scanning_user["email"] = user
            current_scanning_user["username"] = user.split('@')[0]

            # Gửi 1 event progress ảo để UI thoát khỏi trạng thái "Waiting"
            progress_queue.put({"type": "progress", "done": 0, "total": 0})

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                scanned_results, final_channel_name = loop.run_until_complete(
                    process_all_urls(urls, start_date, end_date, cancel_flag, progress_queue)
                )
            finally:
                loop.close()

            if cancel_flag.is_set():
                progress_queue.put({"type": "result", "results": [], "channel_name": "Đã hủy", "cancelled": True})
            else:
                scanned_results.sort(key=lambda x: x['upload_date'], reverse=True)
                progress_queue.put({"type": "result", "results": scanned_results, "channel_name": final_channel_name, "cancelled": False})
        except Exception as e:
            print(f"Lỗi Scan: {e}")
            progress_queue.put({"type": "result", "results": [], "channel_name": "Lỗi", "cancelled": False})
        finally:
            current_scanning_user["email"] = None
            current_scanning_user["username"] = None
            scan_lock.release()
            SCAN_CANCEL_FLAGS.pop(user, None)
            progress_queue.put(None)  # Sentinel để kết thúc SSE stream

    scan_thread = threading.Thread(target=run_scan, daemon=True)
    scan_thread.start()

    def generate():
        while True:
            try:
                item = progress_queue.get(timeout=300)  # Tối đa 5 phút chờ
            except queue.Empty:
                break
            if item is None:
                break
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

if __name__ == '__main__':
    app.run(debug=True, port=5000, threaded=True)
