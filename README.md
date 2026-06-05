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
      "commandsAfterSpawn": ["/login password1", "/server donutsmp"]
    },
    {
      "username": "akun2",
      "auth": "offline",
      "profilesFolder": "./auth-cache/akun2",
      "commandsAfterSpawn": ["/login password2", "/server donutsmp"]
    }
  ]
}
```

Bot otomatis memberi jeda login antar akun memakai `connectStaggerMs`, default 5000 ms.

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
