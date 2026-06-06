# Minecraft AFK Reconnect Bot

Bot AFK sederhana untuk Minecraft Java Edition, dibuat untuk server milik sendiri/private atau server yang memang mengizinkan bot AFK. Jangan dipakai untuk melanggar aturan server publik.

## Fitur

- Auto reconnect saat disconnect atau kick.
- Delay reconnect memakai backoff agar tidak spam login.
- Bisa pakai `offline` auth untuk server offline-mode atau `microsoft` untuk akun resmi.
- Aksi AFK ringan: lihat sekitar, swing arm, dan opsional jump.
- Bisa menjalankan command setelah spawn, misalnya `/login password` untuk server private offline-mode.

## Cara Pakai

1. Install Node.js 18 atau lebih baru.
2. Buka terminal di folder ini.
3. Jalankan:

```bash
npm install
copy config.example.json config.json
npm start
```

Di PowerShell, kalau `copy` tidak cocok:

```powershell
Copy-Item config.example.json config.json
```

## Konfigurasi

Edit `config.json`:

```json
{
  "host": "play.example.com",
  "port": 25565,
  "version": false,
  "accounts": [
    {
      "username": "NamaBot1",
      "auth": "microsoft",
      "profilesFolder": "./auth-cache/NamaBot1",
      "commandsAfterSpawn": ["/server donutsmp"]
    },
    {
      "username": "NamaBot2",
      "auth": "microsoft",
      "profilesFolder": "./auth-cache/NamaBot2",
      "commandsAfterSpawn": ["/server donutsmp"]
    }
  ]
}
```

Untuk server offline-mode/private:

```json
{
  "accounts": [
    {
      "username": "AFKBot",
      "auth": "offline"
    }
  ]
}
```

Untuk server yang butuh login command setelah masuk, isi:

```json
{
  "accounts": [
    {
      "username": "AFKBot",
      "auth": "offline",
      "commandsAfterSpawn": ["/login password_kamu", "/server donutsmp"]
    }
  ]
}
```

Simpan password hanya di komputer/server yang kamu percaya.

## Multi Akun

Untuk menjalankan lebih dari 1 akun, tambah objek baru di `accounts`. Setiap akun punya `username`, `auth`, `profilesFolder`, dan `commandsAfterSpawn` sendiri.

```json
{
  "accounts": [
    {
      "username": "akun1",
      "auth": "offline",
      "profilesFolder": "./auth-cache/akun1",
      "proxy": {
        "enabled": false,
        "host": "",
        "port": 8080,
        "type": "http",
        "username": "",
        "password": ""
      },
      "commandsAfterSpawn": ["/login password1", "/server donutsmp"]
    },
    {
      "username": "akun2",
      "auth": "offline",
      "profilesFolder": "./auth-cache/akun2",
      "proxy": {
        "enabled": true,
        "host": "127.0.0.1",
        "port": 8080,
        "type": "http",
        "username": "",
        "password": ""
      },
      "commandsAfterSpawn": ["/login password2", "/server donutsmp"]
    }
  ]
}
```

Bot otomatis memberi jeda login antar akun memakai `connectStaggerMs`, default 5000 ms.

## Proxy Per Akun

Proxy bersifat opsional dan disetel per akun. Jika `enabled` adalah `false`, akun login langsung tanpa proxy.

```json
{
  "username": "akun1",
  "auth": "offline",
  "proxy": {
    "enabled": true,
    "host": "proxy.example.com",
    "port": 8080,
    "type": "http",
    "username": "user_proxy",
    "password": "password_proxy"
  }
}
```

`type` bisa `"http"` untuk HTTP proxy, `5` / `"socks5"`, atau `4` / `"socks4"`. Untuk proxy tanpa username/password, kosongkan saja field itu. Proxy ini dipakai untuk koneksi Minecraft ke server; untuk akun Microsoft, proses auth browser/token bisa tetap memakai koneksi normal tergantung library auth.

## Hemat Bandwidth

Untuk banyak akun, gunakan setting ini agar bot meminta chunk lebih sedikit dan tidak mengirim gerakan AFK kecil terus-menerus:

```json
{
  "networkOptimization": {
    "enabled": true,
    "viewDistance": 2,
    "checkTimeoutIntervalMs": 90000,
    "chat": "enabled",
    "colorsEnabled": false,
    "hideSkinParts": true
  },
  "afk": {
    "enabled": false,
    "intervalMs": 300000,
    "lookAround": false,
    "swingArm": false,
    "jump": false
  }
}
```

`viewDistance: 2` adalah bagian paling terasa. Chat tetap `enabled` karena bot perlu membaca `Your shards` dan `Next shard in ...`.

## Kirim Shards ke Discord

Jika chat server mengirim pesan seperti `Your shards: 181`, bot bisa mengirim jumlahnya ke Discord webhook:

```json
{
  "discordWebhook": {
    "enabled": true,
    "url": "https://discord.com/api/webhooks/...",
    "username": "Minecraft Shards"
  }
}
```

Jaga URL webhook seperti password. Siapa pun yang punya URL itu bisa mengirim pesan ke channel Discord tersebut.

Webhook yang sama juga dipakai untuk memberi tahu saat bot disconnect dan saat bot berhasil reconnect.

## Auto Masuk AFK Jika Countdown Shard Tidak Ada

Setelah bot spawn, bot menunggu pesan seperti `Next shard in 60s`. Default `checkAfterSpawnMs` adalah 75000 ms supaya satu siklus countdown sempat muncul dulu. Jika countdown belum diterima setelah itu, bot baru menjalankan `/afk`, menunggu GUI terbuka, lalu klik slot `clickSlot`.

Pendeteksian ini hanya berjalan 1x per akun selama proses bot hidup. Setelah countdown terdeteksi sekali, atau setelah bot sekali mencoba masuk AFK, pengecekan ini tidak diulang lagi sampai bot direstart.

```json
{
  "shardAfkGuard": {
    "enabled": true,
    "checkAfterSpawnMs": 75000,
    "afkCommand": "/afk",
    "guiWaitMs": 10000,
    "clickSlot": 0,
    "itemNames": ["AFK 1", "AfK 1"]
  }
}
```

Untuk GUI seperti gambar `AFK 1` di kiri atas, `clickSlot: 0` biasanya benar. Bot tetap mencoba mencari item bernama `AFK 1` dulu sebelum fallback ke slot itu.

## Auto Pakai Shard Booster

Jika inventory bot punya potion/item bernama `SHARD BOOSTER`, bot akan equip item itu lalu mencoba minum/menggunakannya setelah bot terkonfirmasi berada di tempat AFK. Konfirmasi ini memakai chat countdown seperti `Next shard in 60s`, atau fallback beberapa detik setelah klik GUI AFK berhasil.

```json
{
  "booster": {
    "enabled": true,
    "useAfterAfkMs": 12000,
    "confirmAfterAfkClickMs": 10000,
    "itemNames": ["SHARD BOOSTER"],
    "consumeTimeoutMs": 8000
  }
}
```

Nama item dicek dari display name dan lore NBT, jadi item custom server seperti pada screenshot bisa kebaca. Jika countdown tidak muncul, bot juga bisa menganggap area AFK sudah tercapai beberapa detik setelah klik GUI AFK berhasil.

## Jalan 24/7

Paling stabil jalankan di VPS, komputer rumah yang selalu menyala, atau panel hosting yang mendukung Node.js.

Dengan PM2:

```bash
npm install -g pm2
pm2 start index.js --name minecraft-afk
pm2 save
```

## Catatan

- Ini untuk Minecraft Java Edition. Untuk Bedrock perlu pendekatan/library berbeda.
- Jika `auth` adalah `microsoft`, login pertama biasanya meminta kode di browser. Setelah sukses, token disimpan di folder `auth-cache`.
- Beberapa server menolak bot atau punya aturan AFK. Ikuti aturan server.
