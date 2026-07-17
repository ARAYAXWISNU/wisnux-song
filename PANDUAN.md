

Folder ini sudah berupa **PWA (Progressive Web App)**: bisa diinstal ke HP/laptop,
dan tetap bisa dibuka **tanpa internet** setelah dibuka pertama kali, karena
tampilan aplikasinya (HTML/CSS/JS) disimpan oleh Service Worker di perangkat.

Catatan penting soal lagu: lagu yang kamu unggah diputar langsung dari
penyimpanan HP/laptop lewat pemilih file browser. Browser tidak mengizinkan
web app menyimpan akses permanen ke file di luar sesi demi keamanan, jadi
setiap kali aplikasi dibuka ulang kamu perlu pilih lagi file lagunya (drag &
drop atau klik area unggah). Ini normal untuk semua pemutar musik berbasis
web/PWA, bukan cuma punya kamu.

---

## 1. Isi folder ini

```
deck-lokal/
├── index.html          <- halaman aplikasi
├── manifest.json        <- identitas PWA (nama, ikon, warna)
├── sw.js                 <- service worker untuk cache offline
├── vercel.json           <- header khusus untuk Vercel
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    ├── icon-maskable-512.png
    ├── apple-touch-icon.png
    └── favicon-64.png
```

## 2. Deploy ke Vercel

**Lewat website (paling gampang):**
1. Buka https://vercel.com → New Project.
2. Upload folder `deck-lokal` ini (atau push dulu ke GitHub, lalu import repo-nya).
3. Framework preset pilih **Other** (tidak perlu build command, ini situs statis).
4. Klik **Deploy**.
5. Setelah selesai, kamu akan dapat domain seperti `https://deck-lokal.vercel.app`.

**Lewat CLI:**
```bash
npm install -g vercel
cd deck-lokal
vercel --prod
```

Setelah live, buka domainnya lewat HP → menu browser → **"Tambahkan ke Layar
Utama" / "Install App"**. Aplikasi akan muncul seperti aplikasi biasa dan bisa
dibuka tanpa internet.

---

## 3. Jadikan APK (biar bisa diinstal seperti aplikasi Android biasa)

Setelah situsnya live di Vercel (harus HTTPS — Vercel otomatis HTTPS),
kamu punya dua opsi. Website kamu **tidak perlu diubah lagi**, cukup dibungkus.

### Opsi A — PWABuilder (paling gampang, tanpa install apapun)
1. Buka https://www.pwabuilder.com
2. Masukkan URL Vercel kamu, misal `https://deck-lokal.vercel.app`
3. Klik **Start**, tunggu PWABuilder membaca `manifest.json` dan `sw.js` punya kamu.
4. Klik tab **Android** → **Generate Package**.
5. Pilih paket **APK** (atau **AAB** kalau mau upload ke Google Play).
6. Download hasilnya, lalu instal APK-nya ke HP Android (aktifkan dulu
   "Izinkan instal dari sumber tidak dikenal" jika muncul, atau upload AAB ke
   Play Console kalau mau publish resmi).

### Opsi B — Bubblewrap (CLI resmi dari Google, lebih fleksibel)
```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://deck-lokal.vercel.app/manifest.json
bubblewrap build
```
Ini akan menghasilkan file `.apk` dan `.aab`. Butuh Java JDK & Android SDK
(Bubblewrap akan menawarkan untuk mengunduhkannya otomatis saat `init`).

> Baik PWABuilder maupun Bubblewrap membungkus situs kamu jadi **Trusted Web
> Activity (TWA)** — cara resmi Google untuk mengubah PWA jadi APK asli tanpa
> nulis ulang kode Android.

---

## 4. Update aplikasi nanti

Kalau kamu ubah `index.html` lagi, cukup deploy ulang ke Vercel
(`vercel --prod` atau push ke Git). Service worker akan otomatis mengambil
versi terbaru saat pengguna online lalu tetap menyimpannya untuk dipakai
offline. APK yang sudah terinstal tidak perlu diinstal ulang — kontennya
mengikuti situs Vercel-nya secara otomatis karena TWA hanyalah "jendela" ke
situs kamu.
