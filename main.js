// ============================================================
// CS 1.6 SUNUCU - OTOMATİK KURULUM (v3 - Çalışan Link)
// ============================================================
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ================= AYARLAR =================
const SUNUCU_KLASORU = '/home/container/cs16-server';
const MAP = 'de_dust2';
const MAXPLAYERS = '32';
const PORT = '27015';
// ==========================================

let sunucuProcess = null;
let baslangicZamani = null;

// ---------- Log yardımcıları ----------
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const ok = (msg) => console.log(`\x1b[32m[OK]\x1b[0m ${msg}`);
const hata = (msg) => console.log(`\x1b[31m[X]\x1b[0m ${msg}`);
const bilgi = (msg) => console.log(`\x1b[36m[i]\x1b[0m ${msg}`);

// ============================================================
// DOSYA İNDİRME (Node.js https - wget/curl gerekmez)
// ============================================================
function dosyaIndir(url, hedefYol) {
    return new Promise((resolve, reject) => {
        const modul = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(hedefYol);
        modul.get(url, (response) => {
            // Yönlendirme takibi
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                file.close(); fs.unlinkSync(hedefYol);
                return dosyaIndir(response.headers.location, hedefYol).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                file.close(); fs.unlinkSync(hedefYol);
                return reject(new Error(`HTTP ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => {
            if (fs.existsSync(hedefYol)) fs.unlinkSync(hedefYol);
            reject(err);
        });
    });
}

// ============================================================
// 1. SUNUCU DOSYALARINI KUR (SteamCMD'siz)
// ============================================================
async function sunucuDosyalariKontrol() {
    const hldsYolu = path.join(SUNUCU_KLASORU, 'hlds_run');

    if (fs.existsSync(hldsYolu)) {
        ok('Sunucu dosyalari mevcut.');
        return true;
    }

    hata('hlds_run bulunamadi! Kuruluma baslaniyor...');
    bilgi('CS 1.6 sunucu dosyalari dogrudan indiriliyor (SteamCMD olmadan)...');

    try {
        // EXORTEM/hlds deposundan güncel bir Linux HLDS arşivi indiriyoruz
        const arsivUrl = 'https://github.com/EXORTEM/hlds/releases/download/8684/hlds_build_8684.zip';
        const arsivYolu = path.join(process.cwd(), 'hlds-build.zip');

        bilgi('HLDS build indiriliyor (GitHub)...');
        await dosyaIndir(arsivUrl, arsivYolu);
        ok('Indirme tamamlandi.');

        bilgi('Arsiv aciliyor...');
        if (!fs.existsSync(SUNUCU_KLASORU)) {
            fs.mkdirSync(SUNUCU_KLASORU, { recursive: true });
        }
        // zip dosyasini acmak icin unzip komutu gerekli. Eger yoksa, hata verir.
        try {
            execSync(`unzip -o ${arsivYolu} -d ${SUNUCU_KLASORU}`, { stdio: 'inherit' });
        } catch (e) {
            // unzip yoksa, 7z ile deneyebiliriz
            hata('unzip komutu bulunamadi, 7z deneniyor...');
            execSync(`7z x ${arsivYolu} -o${SUNUCU_KLASORU} -y`, { stdio: 'inherit' });
        }
        fs.unlinkSync(arsivYolu);

        // hlds_run ve hlds_linux dosyalarina çalıştırma izni ver
        const hldsRun = path.join(SUNUCU_KLASORU, 'hlds_run');
        const hldsLinux = path.join(SUNUCU_KLASORU, 'hlds_linux');
        if (fs.existsSync(hldsRun)) execSync(`chmod +x ${hldsRun}`, { stdio: 'inherit' });
        if (fs.existsSync(hldsLinux)) execSync(`chmod +x ${hldsLinux}`, { stdio: 'inherit' });

        ok('Sunucu dosyalari kuruldu.');
        return true;
    } catch (e) {
        hata('Kurulum basarisiz: ' + e.message);
        hata('Ipucu: Panel yoneticinizden 32-bit kutuphanelerin kurulmasini isteyin (lib32gcc-s1, lib32stdc++6).');
        return false;
    }
}

// ============================================================
// 2. SERVER.CFG OLUŞTUR
// ============================================================
function serverCfgOlustur() {
    const cfgYolu = path.join(SUNUCU_KLASORU, 'cstrike', 'server.cfg');
    if (fs.existsSync(cfgYolu)) {
        bilgi('server.cfg zaten var.');
        return;
    }

    fs.mkdirSync(path.dirname(cfgYolu), { recursive: true });
    const icerik = `hostname "CS 1.6 Server"
rcon_password "degistir_123"
sv_allowdownload "1"
sv_allowupload "0"
sv_lan "0"
sv_region "3"
mp_timelimit "30"
mp_friendlyfire "1"
mp_autoteambalance "1"
mp_limitteams "2"
mp_freezetime "3"
mp_roundtime "3"
mp_buytime "0.25"
mp_startmoney "800"
mp_c4timer "35"
mp_flashlight "1"
mp_footsteps "1"
mp_falldamage "1"
echo "Server config yuklendi."
`;
    fs.writeFileSync(cfgYolu, icerik, 'utf8');
    ok('server.cfg olusturuldu.');
}

// ============================================================
// 3. DURUM YAZDIR
// ============================================================
function durumYaz() {
    if (!sunucuProcess) {
        bilgi('Durum: 🔴 Sunucu calismiyor.');
        return;
    }
    const sure = Math.floor((Date.now() - baslangicZamani) / 1000);
    const dk = Math.floor(sure / 60);
    const sn = sure % 60;
    bilgi(`Durum: 🟢 Calisiyor | PID: ${sunucuProcess.pid} | Sure: ${dk}dk ${sn}sn | Map: ${MAP} | Oyuncu: ${MAXPLAYERS}`);
}

// ============================================================
// 4. SUNUCUYU BAŞLAT
// ============================================================
function sunucuBaslat() {
    if (sunucuProcess) {
        bilgi('Sunucu zaten calisiyor.');
        return;
    }

    const hldsYolu = path.join(SUNUCU_KLASORU, 'hlds_run');

    if (!fs.existsSync(hldsYolu)) {
        hata('hlds_run yok, once kurulum yapilmali.');
        return;
    }

    log('🚀 Sunucu baslatiliyor...');
    log(`   Klasor: ${SUNUCU_KLASORU}`);
    log(`   Map: ${MAP} | Oyuncu limiti: ${MAXPLAYERS} | Port: ${PORT}`);

    sunucuProcess = spawn(hldsYolu, [
        '-console',
        '-game', 'cstrike',
        '-port', PORT,
        '+maxplayers', MAXPLAYERS,
        '+map', MAP,
        '+exec', 'server.cfg'
    ], { cwd: SUNUCU_KLASORU });

    baslangicZamani = Date.now();

    sunucuProcess.stdout.on('data', (data) => {
        process.stdout.write(`\x1b[90m[SUNUCU]\x1b[0m ${data}`);
    });
    sunucuProcess.stderr.on('data', (data) => {
        process.stdout.write(`\x1b[31m[HATA]\x1b[0m ${data}`);
    });

    sunucuProcess.on('close', (code) => {
        hata(`Sunucu kapandi (kod: ${code}). 5 saniye icinde yeniden baslatiliyor...`);
        sunucuProcess = null;
        baslangicZamani = null;
        setTimeout(sunucuBaslat, 5000);
    });

    sunucuProcess.on('error', (err) => {
        hata(`Sunucu baslatilamadi: ${err.message}`);
        sunucuProcess = null;
    });

    setTimeout(() => {
        if (sunucuProcess) ok(`Sunucu ayakta! PID: ${sunucuProcess.pid}`);
    }, 3000);
}

// ============================================================
// 5. SUNUCUYU DURDUR
// ============================================================
function sunucuDurdur() {
    if (!sunucuProcess) {
        bilgi('Sunucu zaten calismiyor.');
        return;
    }
    bilgi('Sunucu durduruluyor...');
    sunucuProcess.kill('SIGTERM');
    sunucuProcess = null;
    ok('Sunucu durduruldu.');
}

// ============================================================
// 6. KONSOL KOMUTLARI
// ============================================================
function yazKomutlar() {
    console.log(`
==========================================
  KONSOL KOMUTLARI
==========================================
  baslat   - Sunucuyu baslat
  durdur   - Sunucuyu durdur
  durum    - Anlik durumu goster
  yardim   - Bu listeyi goster
  cikis    - Botu kapat ve cik
==========================================
`);
}

function komutDinle() {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (data) => {
        const cmd = data.trim().toLowerCase();
        switch (cmd) {
            case 'durum': case 'status': durumYaz(); break;
            case 'baslat': case 'start': sunucuBaslat(); break;
            case 'durdur': case 'stop': sunucuDurdur(); break;
            case 'cikis': case 'exit': case 'quit':
                bilgi('Cikiliyor...'); sunucuDurdur();
                setTimeout(() => process.exit(0), 1000); break;
            case 'yardim': case 'help': yazKomutlar(); break;
            default:
                if (cmd) console.log(`Bilinmeyen komut: "${cmd}" (yardim icin "yardim" yaz)`);
        }
    });
}

// ============================================================
// ANA AKIŞ
// ============================================================
(async () => {
    console.log('==========================================');
    console.log('  CS 1.6 SUNUCU - KONSOL VERSIYONU (v3)');
    console.log('==========================================\n');

    const kurulumOk = await sunucuDosyalariKontrol();
    if (!kurulumOk) {
        hata('Sunucu dosyalari kurulamadi. Cikiliyor.');
        process.exit(1);
    }

    serverCfgOlustur();

    yazKomutlar();
    komutDinle();

    sunucuBaslat();
    setInterval(durumYaz, 30000);
})();
