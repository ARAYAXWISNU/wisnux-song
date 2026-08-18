export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, url, audioUrl } = req.query;

  const BROWSER_HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    Referer: 'https://www.tiktok.com/',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── ACTION: info ──────────────────────────────────────────────────────────
  if (action === 'info') {
    if (!url) return res.status(400).json({ error: 'Parameter url diperlukan.' });

    const cleanUrl = url.trim();
    let resolvedUrl = cleanUrl;

    // Expand short links (vt.tiktok.com, vm.tiktok.com, etc.)
    try {
      if (!cleanUrl.includes('/video/') && !cleanUrl.includes('/photo/')) {
        const headRes = await fetch(cleanUrl, {
          method: 'GET',
          headers: BROWSER_HEADERS,
          redirect: 'follow',
        });
        if (headRes.url && headRes.url.includes('tiktok.com')) {
          if (!headRes.url.endsWith('/?_r=1') && !headRes.url.endsWith('tiktok.com/')) {
            resolvedUrl = headRes.url;
          }
        }
      }
    } catch (_) {}

    const urlsToTry = [cleanUrl];
    if (resolvedUrl !== cleanUrl) {
      urlsToTry.unshift(resolvedUrl);
    }

    const errors = [];

    for (const targetUrl of urlsToTry) {
      // ── Provider 1: TikWM (POST) ───────────────────────────────────────────
      try {
        const tikwmRes = await fetch('https://www.tikwm.com/api/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': BROWSER_HEADERS['User-Agent'],
          },
          body: `url=${encodeURIComponent(targetUrl)}&hd=1`,
        });

        if (tikwmRes.ok) {
          const data = await tikwmRes.json();
          if (data.code === 0 && data.data) {
            const title =
              data.data.title ||
              data.data.music_info?.title ||
              'Lagu TikTok';
            const artist =
              data.data.music_info?.author ||
              data.data.author?.nickname ||
              'Kreator TikTok';
            const rawAudioUrl =
              data.data.music || data.data.play || data.data.wmplay;

            if (rawAudioUrl) {
              const fullAudioUrl = rawAudioUrl.startsWith('//')
                ? 'https:' + rawAudioUrl
                : rawAudioUrl.startsWith('/')
                ? 'https://www.tikwm.com' + rawAudioUrl
                : rawAudioUrl;

              const host = req.headers.host;
              const protocol = req.headers['x-forwarded-proto'] || 'http';
              const downloadUrl = `${protocol}://${host}/api/tiktok?action=download&audioUrl=${encodeURIComponent(fullAudioUrl)}`;

              return res.status(200).json({ title, artist, downloadUrl });
            }
          }
          if (data.msg) errors.push(`TikWM: ${data.msg}`);
        }
      } catch (err) {
        errors.push(`TikWM: ${err.message}`);
      }

      // ── Provider 2: TikWM (GET fallback) ──────────────────────────────────
      try {
        await sleep(500);
        const getRes = await fetch(
          `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`,
          { headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] } }
        );
        if (getRes.ok) {
          const data = await getRes.json();
          if (data.code === 0 && data.data) {
            const title =
              data.data.title ||
              data.data.music_info?.title ||
              'Lagu TikTok';
            const artist =
              data.data.music_info?.author ||
              data.data.author?.nickname ||
              'Kreator TikTok';
            const rawAudioUrl =
              data.data.music || data.data.play || data.data.wmplay;

            if (rawAudioUrl) {
              const fullAudioUrl = rawAudioUrl.startsWith('//')
                ? 'https:' + rawAudioUrl
                : rawAudioUrl.startsWith('/')
                ? 'https://www.tikwm.com' + rawAudioUrl
                : rawAudioUrl;

              const host = req.headers.host;
              const protocol = req.headers['x-forwarded-proto'] || 'http';
              const downloadUrl = `${protocol}://${host}/api/tiktok?action=download&audioUrl=${encodeURIComponent(fullAudioUrl)}`;

              return res.status(200).json({ title, artist, downloadUrl });
            }
          }
        }
      } catch (err) {
        errors.push(`TikWM GET: ${err.message}`);
      }

      // ── Provider 3: btch-downloader ───────────────────────────────────────
      try {
        const { ttdl } = await import('btch-downloader');
        const resData = await ttdl(targetUrl);
        if (resData && resData.status !== false) {
          const rawAudioUrl =
            resData.audio?.[0] || resData.audioUrl || resData.video?.[0];
          if (rawAudioUrl) {
            const title = resData.title || resData.title_audio || 'Lagu TikTok';
            const artist = resData.author || 'Kreator TikTok';
            const host = req.headers.host;
            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const downloadUrl = `${protocol}://${host}/api/tiktok?action=download&audioUrl=${encodeURIComponent(rawAudioUrl)}`;

            return res.status(200).json({ title, artist, downloadUrl });
          }
        }
      } catch (err) {
        errors.push(`btch-downloader: ${err.message}`);
      }

      // ── Provider 4: HTML Scraping + oEmbed ────────────────────────────────
      try {
        let title = 'Lagu TikTok';
        let artist = 'Kreator TikTok';

        try {
          const oembedRes = await fetch(
            `https://www.tiktok.com/oembed?url=${encodeURIComponent(targetUrl)}`
          );
          if (oembedRes.ok) {
            const oembed = await oembedRes.json();
            if (oembed.title) title = oembed.title;
            if (oembed.author_name) artist = oembed.author_name;
          }
        } catch (_) {}

        const pageRes = await fetch(targetUrl, {
          headers: BROWSER_HEADERS,
          redirect: 'follow',
        });

        if (pageRes.ok) {
          const html = await pageRes.text();

          const jsonMatch =
            html.match(
              /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
            ) ||
            html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);

          if (jsonMatch) {
            const sigi = JSON.parse(jsonMatch[1]);
            const itemModule =
              sigi?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo
                ?.itemStruct;
            const musicUrl =
              itemModule?.music?.playUrl ||
              Object.values(sigi?.ItemModule || {})[0]?.music?.playUrl;

            if (musicUrl) {
              title = itemModule?.music?.title || title;
              artist = itemModule?.music?.authorName || artist;

              const host = req.headers.host;
              const protocol = req.headers['x-forwarded-proto'] || 'http';
              const downloadUrl = `${protocol}://${host}/api/tiktok?action=download&audioUrl=${encodeURIComponent(musicUrl)}`;

              return res.status(200).json({ title, artist, downloadUrl });
            }
          }

          const playMatch =
            html.match(/"playUrl":"([^"]+)"/) ||
            html.match(/"play_url":"([^"]+)"/) ||
            html.match(/"downloadAddr":"([^"]+)"/);

          if (playMatch && playMatch[1]) {
            const rawAudioUrl = playMatch[1]
              .replace(/\\u002F/g, '/')
              .replace(/\\u0026/g, '&');
            const host = req.headers.host;
            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const downloadUrl = `${protocol}://${host}/api/tiktok?action=download&audioUrl=${encodeURIComponent(rawAudioUrl)}`;

            return res.status(200).json({ title, artist, downloadUrl });
          }
        }
      } catch (err) {
        errors.push(`HTML Scrape: ${err.message}`);
      }
    }

    return res.status(500).json({
      error:
        'Gagal mengambil lagu dari TikTok. Tautan mungkin privat, sudah dihapus, atau sedang dibatasi.',
    });
  }

  // ── ACTION: download ──────────────────────────────────────────────────────
  if (action === 'download') {
    if (!audioUrl)
      return res.status(400).json({ error: 'Missing audioUrl parameter' });

    try {
      const audioRes = await fetch(audioUrl, {
        headers: {
          'User-Agent': BROWSER_HEADERS['User-Agent'],
          Accept: '*/*',
          Referer: 'https://www.tiktok.com/',
        },
        redirect: 'follow',
      });

      if (!audioRes.ok) {
        return res
          .status(audioRes.status)
          .send(`Gagal mengambil file musik (HTTP ${audioRes.status}).`);
      }

      const contentType =
        audioRes.headers.get('Content-Type') || 'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const arrayBuffer = await audioRes.arrayBuffer();
      return res.status(200).send(Buffer.from(arrayBuffer));
    } catch (err) {
      return res
        .status(500)
        .send('Gagal mengunduh musik dari proxy: ' + err.message);
    }
  }

  return res.status(400).json({
    error: 'Aksi tidak valid. Gunakan action=info atau action=download.',
  });
}
