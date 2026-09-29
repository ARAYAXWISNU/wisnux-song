import { ttdl, youtube, igdl, twitter, fbdown, spotify, soundcloud, aio } from 'btch-downloader';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, url, audioUrl } = req.query;

  const BROWSER_HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ──────────────────────────────────────────────────────────────────────────
  // ACTION: download (Proxy file media agar bebas CORS & bisa disimpan offline)
  // ──────────────────────────────────────────────────────────────────────────
  if (action === 'download') {
    if (!audioUrl) {
      return res.status(400).json({ error: 'Missing audioUrl parameter' });
    }

    try {
      const parsedAudioUrl = decodeURIComponent(audioUrl);
      const audioRes = await fetch(parsedAudioUrl, {
        headers: {
          'User-Agent': BROWSER_HEADERS['User-Agent'],
          Accept: '*/*',
          Referer: new URL(parsedAudioUrl).origin + '/',
        },
        redirect: 'follow',
      });

      if (!audioRes.ok) {
        return res
          .status(audioRes.status)
          .send(`Gagal mengambil media (HTTP ${audioRes.status}).`);
      }

      const contentType =
        audioRes.headers.get('Content-Type') || 'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Accept-Ranges', 'bytes');

      const arrayBuffer = await audioRes.arrayBuffer();
      return res.status(200).send(Buffer.from(arrayBuffer));
    } catch (err) {
      return res
        .status(500)
        .send('Gagal mengunduh audio lewat proxy: ' + err.message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ACTION: info (Menganalisis link YouTube, TikTok, IG, X, Spotify, dll)
  // ──────────────────────────────────────────────────────────────────────────
  if (action === 'info') {
    if (!url) {
      return res.status(400).json({ error: 'Parameter url diperlukan.' });
    }

    const cleanUrl = url.trim();
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const makeProxyUrl = (target) =>
      `${protocol}://${host}/api/download?action=download&audioUrl=${encodeURIComponent(target)}`;

    // 1. YouTube
    if (
      cleanUrl.includes('youtube.com') ||
      cleanUrl.includes('youtu.be')
    ) {
      try {
        let ytTitle = 'Lagu YouTube';
        let ytArtist = 'YouTube Creator';

        // Coba oEmbed YouTube untuk judul & author akurat
        try {
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`
          );
          if (oembedRes.ok) {
            const oe = await oembedRes.json();
            if (oe.title) ytTitle = oe.title;
            if (oe.author_name) ytArtist = oe.author_name;
          }
        } catch (_) {}

        // Provider 1: btch-downloader youtube
        try {
          const ytData = await youtube(cleanUrl);
          if (ytData && ytData.status !== false) {
            const rawAudio = ytData.mp3 || ytData.mp4;
            if (rawAudio) {
              return res.status(200).json({
                platform: 'youtube',
                title: ytData.title || ytTitle,
                artist: ytData.author || ytArtist,
                thumbnail: ytData.thumbnail || '',
                downloadUrl: makeProxyUrl(rawAudio),
                rawAudioUrl: rawAudio,
              });
            }
          }
        } catch (ytErr) {
          console.warn('btch youtube error:', ytErr.message);
        }

        // Provider 2: Cobalt public API fallback
        try {
          const cobaltRes = await fetch('https://api.cobalt.tools/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              url: cleanUrl,
              downloadMode: 'audio',
              audioFormat: 'mp3',
            }),
          });
          if (cobaltRes.ok) {
            const cobData = await cobaltRes.json();
            const mediaUrl = cobData.url || cobData.audio;
            if (mediaUrl) {
              return res.status(200).json({
                platform: 'youtube',
                title: ytTitle,
                artist: ytArtist,
                downloadUrl: makeProxyUrl(mediaUrl),
                rawAudioUrl: mediaUrl,
              });
            }
          }
        } catch (cobErr) {
          console.warn('Cobalt API fallback error:', cobErr.message);
        }

        // Provider 3: Invidious public audio stream fallback
        try {
          let videoId = '';
          const match1 = cleanUrl.match(/[?&]v=([^&#]+)/);
          const match2 = cleanUrl.match(/youtu\.be\/([^?&#]+)/);
          const match3 = cleanUrl.match(/shorts\/([^?&#]+)/);
          if (match1) videoId = match1[1];
          else if (match2) videoId = match2[1];
          else if (match3) videoId = match3[1];

          if (videoId) {
            const invidiousInstances = [
              'https://inv.tux.pizza',
              'https://invidious.nerdvpn.de',
              'https://vid.puffyan.us',
            ];
            for (const inst of invidiousInstances) {
              try {
                const invRes = await fetch(
                  `${inst}/api/v1/videos/${videoId}?fields=title,author,formatStreams,adaptiveFormats`,
                  { headers: BROWSER_HEADERS }
                );
                if (invRes.ok) {
                  const data = await invRes.json();
                  const audioFormat = data.adaptiveFormats?.find((f) =>
                    f.type?.startsWith('audio/')
                  );
                  if (audioFormat && audioFormat.url) {
                    return res.status(200).json({
                      platform: 'youtube',
                      title: data.title || ytTitle,
                      artist: data.author || ytArtist,
                      downloadUrl: makeProxyUrl(audioFormat.url),
                      rawAudioUrl: audioFormat.url,
                    });
                  }
                }
              } catch (_) {}
            }
          }
        } catch (_) {}

        return res.status(500).json({
          error:
            'Gagal mengekstrak audio dari link YouTube ini. Pastikan video tidak diproteksi/private.',
        });
      } catch (err) {
        return res
          .status(500)
          .json({ error: 'Gagal memproses YouTube: ' + err.message });
      }
    }

    // 2. TikTok
    if (
      cleanUrl.includes('tiktok.com') ||
      cleanUrl.includes('douyin.com')
    ) {
      try {
        let resolvedUrl = cleanUrl;
        if (!cleanUrl.includes('/video/') && !cleanUrl.includes('/photo/')) {
          try {
            const headRes = await fetch(cleanUrl, {
              headers: BROWSER_HEADERS,
              redirect: 'follow',
            });
            if (headRes.url && headRes.url.includes('tiktok.com')) {
              resolvedUrl = headRes.url;
            }
          } catch (_) {}
        }

        // Coba TikWM API
        try {
          const tikwmRes = await fetch('https://www.tikwm.com/api/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'User-Agent': BROWSER_HEADERS['User-Agent'],
            },
            body: `url=${encodeURIComponent(resolvedUrl)}&hd=1`,
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
              const rawAudio =
                data.data.music || data.data.play || data.data.wmplay;
              if (rawAudio) {
                const fullAudio = rawAudio.startsWith('//')
                  ? 'https:' + rawAudio
                  : rawAudio.startsWith('/')
                  ? 'https://www.tikwm.com' + rawAudio
                  : rawAudio;

                return res.status(200).json({
                  platform: 'tiktok',
                  title,
                  artist,
                  thumbnail: data.data.cover || '',
                  downloadUrl: makeProxyUrl(fullAudio),
                  rawAudioUrl: fullAudio,
                });
              }
            }
          }
        } catch (_) {}

        // Fallback btch ttdl
        try {
          const ttdlData = await ttdl(resolvedUrl);
          if (ttdlData && ttdlData.status !== false) {
            const rawAudio =
              ttdlData.audio?.[0] || ttdlData.video?.[0];
            if (rawAudio) {
              return res.status(200).json({
                platform: 'tiktok',
                title: ttdlData.title || ttdlData.title_audio || 'Lagu TikTok',
                artist: 'Kreator TikTok',
                thumbnail: ttdlData.thumbnail || '',
                downloadUrl: makeProxyUrl(rawAudio),
                rawAudioUrl: rawAudio,
              });
            }
          }
        } catch (_) {}

        return res.status(500).json({
          error:
            'Gagal mengunduh musik dari TikTok. Video mungkin privat atau tautan tidak valid.',
        });
      } catch (err) {
        return res
          .status(500)
          .json({ error: 'Gagal memproses TikTok: ' + err.message });
      }
    }

    // 3. Instagram (Reel, Post, Story)
    if (
      cleanUrl.includes('instagram.com') ||
      cleanUrl.includes('instagr.am')
    ) {
      try {
        let igTitle = 'Instagram Reel Audio';
        let igArtist = 'Instagram Creator';

        try {
          const oembedRes = await fetch(
            `https://api.instagram.com/oembed/?url=${encodeURIComponent(cleanUrl)}`
          );
          if (oembedRes.ok) {
            const oe = await oembedRes.json();
            if (oe.title) igTitle = oe.title.slice(0, 50);
            if (oe.author_name) igArtist = oe.author_name;
          }
        } catch (_) {}

        const igData = await igdl(cleanUrl);
        if (igData && igData.status !== false && igData.result?.length > 0) {
          const firstMedia = igData.result[0];
          const mediaUrl = firstMedia.url || firstMedia;
          if (mediaUrl) {
            return res.status(200).json({
              platform: 'instagram',
              title: igTitle,
              artist: igArtist,
              thumbnail: firstMedia.thumbnail || '',
              downloadUrl: makeProxyUrl(mediaUrl),
              rawAudioUrl: mediaUrl,
            });
          }
        }

        // Fallback AIO
        const aioData = await aio(cleanUrl);
        if (aioData && aioData.status !== false && aioData.url) {
          return res.status(200).json({
            platform: 'instagram',
            title: aioData.title || igTitle,
            artist: igArtist,
            downloadUrl: makeProxyUrl(aioData.url),
            rawAudioUrl: aioData.url,
          });
        }

        return res.status(500).json({
          error:
            'Gagal mengambil media Instagram. Pastikan akun tidak privat dan reel bisa diakses publik.',
        });
      } catch (err) {
        return res
          .status(500)
          .json({ error: 'Gagal memproses Instagram: ' + err.message });
      }
    }

    // 4. Twitter / X
    if (
      cleanUrl.includes('twitter.com') ||
      cleanUrl.includes('x.com')
    ) {
      try {
        const twData = await twitter(cleanUrl);
        if (twData && twData.status !== false && twData.url) {
          return res.status(200).json({
            platform: 'twitter',
            title: twData.title || 'Audio X / Twitter',
            artist: 'X Creator',
            downloadUrl: makeProxyUrl(twData.url),
            rawAudioUrl: twData.url,
          });
        }

        // Fallback AIO
        const aioData = await aio(cleanUrl);
        if (aioData && aioData.status !== false && aioData.url) {
          return res.status(200).json({
            platform: 'twitter',
            title: aioData.title || 'Audio X / Twitter',
            artist: 'X Creator',
            downloadUrl: makeProxyUrl(aioData.url),
            rawAudioUrl: aioData.url,
          });
        }

        return res.status(500).json({
          error:
            'Gagal mengambil video/audio dari X/Twitter. Pastikan tweet berisi media publik.',
        });
      } catch (err) {
        return res
          .status(500)
          .json({ error: 'Gagal memproses X/Twitter: ' + err.message });
      }
    }

    // 5. Spotify
    if (cleanUrl.includes('spotify.com')) {
      try {
        const spData = await spotify(cleanUrl);
        const actual = spData?.result || spData;
        if (actual && actual.download || actual.audio) {
          const audioLink = actual.download || actual.audio;
          return res.status(200).json({
            platform: 'spotify',
            title: actual.title || 'Lagu Spotify',
            artist: actual.artist || actual.author || 'Spotify Artist',
            thumbnail: actual.thumbnail || '',
            downloadUrl: makeProxyUrl(audioLink),
            rawAudioUrl: audioLink,
          });
        }
      } catch (err) {
        console.warn('Spotify error:', err.message);
      }
    }

    // 6. SoundCloud
    if (cleanUrl.includes('soundcloud.com')) {
      try {
        const scData = await soundcloud(cleanUrl);
        const actual = scData?.result || scData;
        if (actual && (actual.audio || actual.download || actual.url)) {
          const audioLink = actual.audio || actual.download || actual.url;
          return res.status(200).json({
            platform: 'soundcloud',
            title: actual.title || 'Lagu SoundCloud',
            artist: actual.author || 'SoundCloud Artist',
            thumbnail: actual.thumbnail || '',
            downloadUrl: makeProxyUrl(audioLink),
            rawAudioUrl: audioLink,
          });
        }
      } catch (err) {
        console.warn('SoundCloud error:', err.message);
      }
    }

    // 7. Facebook
    if (cleanUrl.includes('facebook.com') || cleanUrl.includes('fb.watch')) {
      try {
        const fbData = await fbdown(cleanUrl);
        if (fbData && fbData.status !== false) {
          const mediaUrl = fbData.Normal_video || fbData.HD;
          if (mediaUrl) {
            return res.status(200).json({
              platform: 'facebook',
              title: 'Audio Facebook Video',
              artist: 'Facebook Creator',
              downloadUrl: makeProxyUrl(mediaUrl),
              rawAudioUrl: mediaUrl,
            });
          }
        }
      } catch (_) {}
    }

    // 8. General AIO fallback untuk platform lainnya
    try {
      const generalData = await aio(cleanUrl);
      if (generalData && generalData.status !== false && generalData.url) {
        return res.status(200).json({
          platform: 'general',
          title: generalData.title || 'Media Online',
          artist: 'Web Creator',
          downloadUrl: makeProxyUrl(generalData.url),
          rawAudioUrl: generalData.url,
        });
      }
    } catch (_) {}

    return res.status(400).json({
      error:
        'Platform tidak didukung atau tautan tidak dapat diproses. Coba tautan YouTube, TikTok, Instagram, X/Twitter, Facebook, atau Spotify.',
    });
  }

  return res.status(400).json({
    error: 'Aksi tidak valid. Gunakan action=info atau action=download.',
  });
}
