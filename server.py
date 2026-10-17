import http.server
import socketserver
import urllib.request
import urllib.parse
import re
import json
import os
import sys
import traceback

PORT = 3000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
}

class WisnuxSongHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Range')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            if path == '/api/download':
                self.handle_api(query)
                return

            super().do_GET()
        except Exception as e:
            traceback.print_exc()
            try:
                self.send_json({'error': str(e)}, status=500)
            except:
                pass

    def handle_api(self, query):
        action = query.get('action', [''])[0]

        # ──────────────────────────────────────────────────────────────────────
        # 1. ACTION: search (Pencarian lagu online via YouTube + iTunes Fallback)
        # ──────────────────────────────────────────────────────────────────────
        if action == 'search':
            q = query.get('q', [''])[0] or query.get('query', [''])[0] or query.get('term', [''])[0]
            if not q.strip():
                self.send_json({'error': 'Parameter pencarian (q) diperlukan.'}, status=400)
                return

            results = []
            clean_q = q.strip()

            # 1.1 Coba via YouTube Search
            try:
                search_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(clean_q)}"
                req = urllib.request.Request(search_url, headers=BROWSER_HEADERS)
                with urllib.request.urlopen(req, timeout=6) as resp:
                    html = resp.read().decode('utf-8', errors='ignore')
                    m = re.search(r'var ytInitialData\s*=\s*({.*?});</script>', html) or re.search(r'ytInitialData\s*=\s*({.*?});</script>', html)
                    if m:
                        data = json.loads(m.group(1))
                        contents = data.get('contents', {}).get('twoColumnSearchResultsRenderer', {}).get('primaryContents', {}).get('sectionListRenderer', {}).get('contents', [])
                        for section in contents:
                            items = section.get('itemSectionRenderer', {}).get('contents', [])
                            for item in items:
                                v = item.get('videoRenderer')
                                if v and v.get('videoId'):
                                    title = v.get('title', {}).get('runs', [{}])[0].get('text', 'Lagu')
                                    author = v.get('ownerText', {}).get('runs', [{}])[0].get('text', 'Artis')
                                    dur = v.get('lengthText', {}).get('simpleText', '')
                                    thumbs = v.get('thumbnail', {}).get('thumbnails', [])
                                    thumb = thumbs[-1].get('url', '') if thumbs else ''
                                    vid = v.get('videoId')
                                    results.append({
                                        'id': vid,
                                        'title': title,
                                        'artist': author,
                                        'duration': dur,
                                        'thumbnail': thumb,
                                        'url': f"https://www.youtube.com/watch?v={vid}"
                                    })
                                    if len(results) >= 15:
                                        break
                            if len(results) >= 15:
                                break
            except Exception as e:
                print(f"[API search YouTube warning]: {e}")

            # 1.2 iTunes Search API untuk direct streaming audio preview
            try:
                itunes_url = f"https://itunes.apple.com/search?term={urllib.parse.quote(clean_q)}&media=music&limit=15"
                ireq = urllib.request.Request(itunes_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(ireq, timeout=5) as iresp:
                    idata = json.loads(iresp.read().decode('utf-8'))
                    itunes_items = idata.get('results', [])
                    
                    if len(results) == 0:
                        for it in itunes_items:
                            m_sec = it.get('trackTimeMillis', 0) / 1000
                            dur_str = f"{int(m_sec // 60)}:{int(m_sec % 60):02d}"
                            results.append({
                                'id': f"itunes-{it.get('trackId')}",
                                'title': it.get('trackName', 'Lagu'),
                                'artist': it.get('artistName', 'Artis'),
                                'duration': dur_str,
                                'thumbnail': it.get('artworkUrl100', ''),
                                'directAudio': it.get('previewUrl', ''),
                                'url': f"https://www.youtube.com/results?search_query={urllib.parse.quote(it.get('artistName', '') + ' ' + it.get('trackName', ''))}"
                            })
                    else:
                        for r in results:
                            for it in itunes_items:
                                it_title = it.get('trackName', '').lower()
                                if it_title and (it_title in r['title'].lower() or r['title'].lower() in it_title):
                                    r['directAudio'] = it.get('previewUrl', '')
                                    if not r.get('thumbnail'):
                                        r['thumbnail'] = it.get('artworkUrl100', '')
                                    break
                            # Jika tidak ada match langsung, pasangkan item pertama jika preview ada
                            if not r.get('directAudio') and len(itunes_items) > 0 and itunes_items[0].get('previewUrl'):
                                r['directAudio'] = itunes_items[0].get('previewUrl', '')
            except Exception as e:
                print(f"[API search iTunes warning]: {e}")

            self.send_json({
                'query': clean_q,
                'total': len(results),
                'results': results
            })
            return

        # ──────────────────────────────────────────────────────────────────────
        # 2. ACTION: spotify_playlist (Ekstraksi seluruh track playlist Spotify)
        # ──────────────────────────────────────────────────────────────────────
        if action == 'spotify_playlist':
            target_url = query.get('url', [''])[0] or query.get('playlistUrl', [''])[0]
            if not target_url:
                self.send_json({'error': 'Parameter url playlist Spotify diperlukan.'}, status=400)
                return

            pl_match = re.search(r'playlist[/:](\w+)', target_url)
            if not pl_match:
                self.send_json({'error': 'URL Playlist Spotify tidak valid. Format: https://open.spotify.com/playlist/ID'}, status=400)
                return

            playlist_id = pl_match.group(1)
            embed_url = f"https://open.spotify.com/embed/playlist/{playlist_id}"

            try:
                sreq = urllib.request.Request(embed_url, headers=BROWSER_HEADERS)
                with urllib.request.urlopen(sreq, timeout=10) as sresp:
                    s_html = sresp.read().decode('utf-8', errors='ignore')
                    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', s_html)
                    if not m:
                        self.send_json({'error': 'Gagal mengekstrak data dari halaman Spotify. Pastikan playlist bersifat publik.'}, status=500)
                        return

                    s_data = json.loads(m.group(1))
                    entity = s_data.get('props', {}).get('pageProps', {}).get('state', {}).get('data', {}).get('entity', {})
                    pl_name = entity.get('name') or entity.get('title') or 'Playlist Spotify'
                    track_list = entity.get('trackList', [])

                    tracks = []
                    for idx, t in enumerate(track_list):
                        artist_name = t.get('subtitle') or ''
                        if not artist_name and t.get('artists'):
                            artist_name = t['artists'][0].get('name', 'Spotify Artist')
                        tracks.append({
                            'index': idx + 1,
                            'title': t.get('title') or t.get('name') or 'Lagu Spotify',
                            'artist': artist_name or 'Artis Spotify',
                            'duration': t.get('duration', 0),
                            'uri': t.get('uri', '')
                        })

                    self.send_json({
                        'platform': 'spotify_playlist',
                        'playlistId': playlist_id,
                        'title': pl_name,
                        'total': len(tracks),
                        'tracks': tracks
                    })
                    return
            except Exception as e:
                print(f"[API spotify_playlist error]: {e}")
                self.send_json({'error': f'Gagal memproses playlist Spotify: {str(e)}'}, status=500)
                return

        # ──────────────────────────────────────────────────────────────────────
        # 3. ACTION: download (Proxy media stream bebas CORS)
        # ──────────────────────────────────────────────────────────────────────
        if action == 'download':
            audio_url = query.get('audioUrl', [''])[0]
            if not audio_url:
                self.send_json({'error': 'Missing audioUrl parameter'}, status=400)
                return
            try:
                parsed_url = urllib.parse.unquote(audio_url)
                dreq = urllib.request.Request(parsed_url, headers={
                    'User-Agent': BROWSER_HEADERS['User-Agent'],
                    'Accept': '*/*'
                })
                with urllib.request.urlopen(dreq, timeout=15) as dresp:
                    content_type = dresp.headers.get('Content-Type', 'audio/mpeg')
                    data = dresp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(data)))
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    self.wfile.write(data)
                    return
            except Exception as e:
                self.send_json({'error': f'Gagal proxy audio: {str(e)}'}, status=500)
                return

        self.send_json({'error': f'Action unknown: {action}'}, status=400)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    server_address = ('0.0.0.0', PORT)
    httpd = ThreadedHTTPServer(server_address, WisnuxSongHandler)
    print(f"[Wisnux Song Server] Berjalan di port {PORT} (0.0.0.0:{PORT})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
