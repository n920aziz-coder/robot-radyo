// Robot Radyo: Valetudo arayüzünü olduğu gibi aktarır ve sağ kenara bir radyo paneli ekler.
// Adres: http://<robot>:8080  (Valetudo'nun kendisi 80'de aynen çalışmaya devam eder)
// Giriş: Valetudo'nun kullanıcı adı/şifresi. Şifre diske yazılmaz; hata takibi için yalnızca bellekte tutulur.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(WEB, '..');
const PORT = Number(process.env.PORT || 8080);
const UPSTREAM = { host: '127.0.0.1', port: Number(process.env.UPSTREAM_PORT || 80) };
const VALETUDO = `http://127.0.0.1:${UPSTREAM.port}`;
const SETTINGS_FILE = path.join(WEB, 'ayarlar.json');
const RUNTIME_FILE = process.env.RUNTIME_FILE || '/tmp/robot-radyo-calan.json'; // /tmp robot yeniden başlayınca silinir
const FAV_FILE = path.join(WEB, 'favoriler.json');
const AMIXER = path.join(BIN, 'amixer');
const RATE = 22050;
const DUCK_LEVEL = 15;           // robot konuşurken "Radyo" kanalı (%), yaklaşık -30 dB
const RAMP = [35, 60, 80, 100];  // konuşma bitince yavaşça geri açılma
const VERSION = '1.0.1';
const RB_UA = `RobotRadyo/${VERSION} (Valetudo radio panel)`;
const LOG_FILE = process.env.LOG_FILE || '/tmp/robot-radyo.log'; // /tmp bellekte durur: boyutu sınırlı tutulur
const RSS_LIMIT_MB = 100;        // olağan kullanım ~45 MB; bunu aşarsa sunucu kendini yeniden başlatır
const LOW_MEM_MB = 40;           // robotun kullanılabilir belleği bunun altına inerse radyo kendini kapatır

function log(...a) { console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a); }
// kod: panelin hata metnini kullanıcının dilinde göstermesi için (i18n.js'de "e_" + kod)
function httpError(status, message, kod) { const e = new Error(message); e.status = status; if (kod) e.kod = kod; return e; }

// ---------- favori radyolar ----------
// Her radyo radio-browser.info'daki kalıcı kimliğiyle (uuid) tutulur; adres değişirse kimlikten yenisi bulunur.
// Dizinde olmayan radyolar (uuid: null) kullanıcının verdiği sabit adresle çalar.
function loadFavorites() {
  try { const f = JSON.parse(fs.readFileSync(FAV_FILE, 'utf8')); if (Array.isArray(f)) return f; } catch { /* ilk çalıştırma */ }
  try { // eski sürümün sabit listesinden taşı
    return JSON.parse(fs.readFileSync(path.join(WEB, 'radyolar.json'), 'utf8'))
      .map((s) => ({ id: s.id, uuid: s.uuid || null, ad: s.ad, grup: s.grup || null, url: s.url }));
  } catch { return []; }
}
let favorites = loadFavorites();
function saveFavorites() {
  const tmp = FAV_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(favorites, null, 1));
  fs.renameSync(tmp, FAV_FILE);
}
const findFavorite = (id) => favorites.find((s) => s.id === id) || null;
const findByUuid = (uuid) => (uuid ? favorites.find((s) => s.uuid === uuid) || null : null);

// ---------- radio-browser.info (açık radyo dizini) ----------
let rbHosts = ['de1.api.radio-browser.info'];
let rbHostsAt = 0;
async function rbRefreshHosts() {
  rbHostsAt = Date.now();
  try {
    const r = await fetch('https://all.api.radio-browser.info/json/servers', { headers: { 'User-Agent': RB_UA }, signal: AbortSignal.timeout(6000) });
    const names = [...new Set((await r.json()).map((s) => s.name).filter((n) => /^[a-z0-9.-]+$/i.test(n || '')))];
    if (names.length) rbHosts = names;
  } catch { /* yedek sunucu listesi kalır */ }
}
async function rb(p) {
  if (Date.now() - rbHostsAt > 6 * 3600e3) await rbRefreshHosts();
  const hosts = [...rbHosts].sort(() => Math.random() - 0.5).slice(0, 3);
  if (hosts.length === 1) hosts.push(hosts[0]); // dizinin tek sunucusu varsa, anlık takılmalara karşı bir kez daha dene
  for (let i = 0; i < hosts.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, 800));
    try {
      const r = await fetch(`https://${hosts[i]}${p}`, { headers: { 'User-Agent': RB_UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) return await r.json();
    } catch { /* sıradaki deneme */ }
  }
  throw httpError(502, 'Radyo dizinine (radio-browser.info) ulaşılamadı', 'dizin');
}
// Önbellek küçük tutulur: yalnızca kullanılan alanlar saklanır, süresi dolanlar atılır, en fazla 30 sorgu
const SLIM_KEYS = ['stationuuid', 'name', 'url', 'url_resolved', 'countrycode', 'tags', 'codec', 'bitrate', 'clickcount',
  'votes', 'lastcheckok', 'language', 'homepage', 'iso_3166_1', 'stationcount'];
const slim = (o) => { const r = {}; for (const k of SLIM_KEYS) if (o[k] !== undefined) r[k] = o[k]; return r; };
const rbCache = new Map();
async function rbCached(p, ttl) {
  const now = Date.now();
  const c = rbCache.get(p);
  if (c && c.exp > now) return c.d;
  const raw = await rb(p);
  const d = Array.isArray(raw) ? raw.map(slim) : raw;
  for (const [k, v] of rbCache) if (v.exp <= now) rbCache.delete(k);
  rbCache.delete(p);
  rbCache.set(p, { exp: now + ttl, d });
  while (rbCache.size > 30) rbCache.delete(rbCache.keys().next().value);
  return d;
}
const compact = (s) => ({
  uuid: s.stationuuid, ad: String(s.name || '').trim().slice(0, 80), ulke: s.countrycode || '',
  etiketler: String(s.tags || '').split(',').filter(Boolean).slice(0, 3).join(', '), codec: s.codec || '', bitrate: s.bitrate || 0,
  tiklama: s.clickcount || 0, calisiyor: s.lastcheckok === 1, favori: Boolean(findByUuid(s.stationuuid)),
});
// Kullanıcı bir radyoyu dinlemeye başlayınca radio-browser'a bildirilir (dizinin uygulamalardan istediği "tıklama")
// ve güncel adres alınır. Arka plandaki denemeler ve adres yenileme tıklama saymaz (rbFresh).
async function rbResolve(uuid) {
  try { const r = await rb(`/json/url/${encodeURIComponent(uuid)}`); return r && r.url ? String(r.url) : null; } catch { return null; }
}
async function rbFresh(uuid) {
  try { const [s] = await rb(`/json/stations/byuuid/${encodeURIComponent(uuid)}`); return s ? String(s.url_resolved || s.url || '') || null : null; } catch { return null; }
}
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
// Yalnızca http(s) adresleri çalınır
const safeUrl = (u) => { try { const x = new URL(String(u || '').trim()); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; } };
// ffmpeg yalnızca ağ protokollerini açabilir: yayın listelerinin (ör. HLS) içinden yerel dosya ya da başka protokol açılamaz.
// (Yetkisiz kullanıcıyla çalıştırmak bu robot yazılımında mümkün değil: ffmpeg rastgele sayı kaynağını açamayıp çöküyor.)
const FF_SAFE = ['-protocol_whitelist', 'http,https,tls,tcp,crypto'];
const ffTls = (url) => (url.startsWith('https:') ? ['-ca_file', path.join(BIN, 'cacert.pem'), '-tls_verify', '1'] : []);

// ---------- ülkeye göre hazır başlangıç listesi ----------
// Dizindeki etiketler dağınık: radyo, etiketlerinin en çok hangi gruba uyduğuna göre gruplanır; eşitlikte bu sıra öncelikli.
// Dini ve haber radyoları Popüler'e girmez. Noel gibi mevsimlik radyolar başlangıç listesine alınmaz.
const GROUPS = [
  { key: 'dini', tags: ['religious', 'religion', 'islamic', 'islam', 'christian', 'gospel', 'quran', 'kuran', 'catholic', 'spiritual', 'worship'] },
  { key: 'haber', tags: ['news', 'talk', 'sport', 'haber', 'spor', 'information', 'politics'] },
  { key: 'yerel', tags: ['folk', 'traditional', 'folklore', 'türkü', 'turku', 'halk', 'arabesk', 'fantezi', 'sanat', 'ethnic', 'regional', 'schlager', 'chanson', 'flamenco', 'fado', 'latin', 'country', 'world'] },
  { key: 'caz', tags: ['jazz', 'blues', 'soul', 'classical', 'opera', 'baroque', 'symphon', 'klasik', 'caz'] },
  { key: 'nostalji', tags: ['oldies', '80s', '90s', '70s', '60s', 'retro', 'classic hits', 'nostalgi', 'nostalji', 'golden'] },
  { key: 'sakin', tags: ['chill', 'lounge', 'relax', 'easy listening', 'smooth', 'slow', 'ambient', 'romantic', 'love songs'] },
  { key: 'rock', tags: ['rock', 'alternative', 'metal', 'indie', 'punk'] },
  { key: 'pop', tags: ['pop', 'hits', 'top 40', 'top40', 'charts', 'dance', 'edm', 'house', 'r&b', 'rnb', 'hip hop', 'hiphop', 'rap'] },
];
const SEASONAL = ['christmas', 'xmas', 'weihnacht', 'navidad', 'natale', 'noel'];
const DISPLAY_ORDER = ['pop', 'rock', 'nostalji', 'sakin', 'yerel', 'caz', 'haber', 'dini'];
// Grup adları panelden, kullanıcının dilinde gelir (etiketler); gelmezse İngilizce kullanılır
const STARTER_LABELS_EN = {
  populer: 'Popular', dil: 'Same language', yabanci: 'International (Jazz, Classical, Chill)',
  pop: 'Pop & Hits', rock: 'Rock', nostalji: 'Oldies & Classics', sakin: 'Chill & Easy', yerel: 'Folk & Local',
  caz: 'Jazz, Blues & Classical', haber: 'News & Sports', dini: 'Religious',
};
// Dizinde pek çok radyo yanlışlıkla tek etiket olarak "classical" almış (ör. bazı pop radyoları);
// adı klasik müziği çağrıştırmıyorsa bu etiket yok sayılır
const CLASSICAL_NAME = /classi|clásic|klassi|klasik|klasyk|класси|sinfon|symph|opera|barok|baroque|piano|musique|mozart|bach|beethoven|chopin|vivaldi|クラシック|古典/i;
function tagsOf(s) {
  const tags = String(s.tags || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
  if (tags.length === 1 && tags[0] === 'classical' && !CLASSICAL_NAME.test(String(s.name || ''))) return [];
  return tags;
}
const groupScores = (s) => {
  const tags = tagsOf(s);
  return GROUPS.map((g) => ({ key: g.key, score: tags.filter((t) => g.tags.some((k) => t === k || t.includes(k))).length }));
};
const groupOf = (s) => {
  const text = (String(s.name || '') + ',' + String(s.tags || '')).toLowerCase();
  if (SEASONAL.some((k) => text.includes(k))) return 'sezon';
  let best = null, bestScore = 0;
  for (const { key, score } of groupScores(s)) if (score > bestScore) { best = key; bestScore = score; }
  return best;
};
// Etiketleri ağırlıklı olarak istenen türde mi (ör. "anime, rock, trance, jazz" etiketli radyo caz sayılmaz)
const focused = (s, keys) => {
  let mine = 0, other = 0;
  for (const { key, score } of groupScores(s)) if (keys.includes(key)) mine += score; else other += score;
  return mine > other;
};

// Görünen ad: dizindeki adlar çok dağınık olabiliyor ("# TOP 100 … || Pop, Rock", "Radyo X mp3 128k", "[aac]").
// Etiket listesi, kalite bilgisi ve süs karakterleri atılır; TAMAMI BÜYÜK ya da tamamı küçük harfli adlar düzeltilir
// (kısa kısaltmalar olduğu gibi kalır: FM, TRT, BBC). Çince, Japonca, Arapça gibi harf büyüklüğü olmayan yazılara dokunulmaz.
const QUALITY = String.raw`(?:mp3|aac\+?|ogg|opus|flac|hls)`;
const RE_QPAREN = new RegExp(String.raw`\((?=[^)]*(?:\d\s?k(?:bit|bps)?\b|kbps|kbit|mhz|\b\d{3,4}p\b|\bhq\b|\bhd\b|\b${QUALITY}\b))[^)]*\)`, 'gi');
const RE_QTAIL = new RegExp(String.raw`(?:[\s-]+${QUALITY})?[\s-]+\d{2,3}\s?k(?:bit\/s|bps)?(?:\s+${QUALITY})?\s*$`, 'i');
const RE_QWORD = new RegExp(String.raw`\s+${QUALITY}\s*$`, 'i');
const RE_JUNK = /^[\s#_*~|:,–—-]+|[\s#_*~|:,–—-]+$/g;
const ABBR = new Set(['fm', 'am', 'tv', 'dj', 'hd', 'eu', 'uk', 'usa', 'bbc', 'trt', 'ntv', 'cnn', 'npr', 'rtl', 'ndr', 'wdr', 'swr', 'mdr', 'rbb',
  'orf', 'srf', 'rai', 'rtp', 'rne', 'kbs', 'sbs', 'mbc', 'nhk']);
function cleanName(name, lang) {
  const loc = /^[a-z]{2}$/.test(lang || '') ? lang : 'en';
  const raw = String(name || '').replace(/[​-‏﻿]/g, '').replace(/\s+/g, ' ').trim();
  let n = raw.replace(/\[[^\]]*\]/g, ' ').replace(RE_QPAREN, ' ');
  // "Ad || etiketler", "Ad -- …", "Ad @ …", "Ad : …": ilk anlamlı parça (çok kısaysa sonraki: "Pop | Radio Swiss Pop")
  const parts = n.split(/\s(?:\|{1,2}|-{2,}|@|::|:|~|\/\/)\s|_\s/).map((p) => p.replace(RE_JUNK, '').trim()).filter(Boolean);
  n = parts.find((p) => p.length >= 5) || parts[0] || '';
  const dash = n.split(/\s[-–—]\s/);
  if (dash.length > 1 && (dash.slice(1).join(' ').match(/,/g) || []).length >= 2) n = dash[0]; // "Ad - Pop, Rock, Dance"
  n = n.replace(RE_QTAIL, '').replace(RE_QWORD, '').replace(RE_JUNK, '').replace(/\s+/g, ' ').trim();
  const fix = (f) => n.split(' ').map((w) => (/\p{Lo}/u.test(w) ? w : f(w))).join(' ');
  if (n.length > 4 && n === n.toLocaleUpperCase(loc) && /\p{Lu}/u.test(n)) {
    n = fix((w) => (w.length <= 3 ? w : w.charAt(0) + w.slice(1).toLocaleLowerCase(loc)));
  } else if (n === n.toLocaleLowerCase(loc) && /\p{Ll}/u.test(n)) {
    n = fix((w) => (ABBR.has(w) ? w.toUpperCase() : w.charAt(0).toLocaleUpperCase(loc) + w.slice(1)));
  }
  if (n.length > 48) n = n.slice(0, 47).replace(/\s+\S*$/, '') + '…';
  return n || raw.slice(0, 48) || 'Radio';
}
// Aynı radyonun farklı kalite/adres kopyalarını tanımak için sade ad (her alfabede çalışır: Kiril, Arap, Çin…)
const normName = (s) => cleanName(s, 'en').toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
  .replace(/\b(\d{2,3}\s?k(bps)?|mp3|aac\+?|ogg|opus|flac|hls|hd|hq|lq|stream|live|online|canli|official|resmi|fm|radio|radyo|turkiye|turkey|tr)\b/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, '');
// Aynı ağın kanalları (ör. dinamo.fm caffe / sleep / legacy) aynı internet sitesini paylaşır
const hostOf = (s) => {
  try { const h = new URL(String(s.homepage || '')).hostname.replace(/^www\./, ''); if (h) return h; } catch { /* site adresi yok */ }
  return 'ad:' + normName(s.name).slice(0, 6);
};
// "# TOP 100 … || Pop, Rock …" gibi süslü, etiket dolu adlı radyolar sıranın sonuna (tıklamaları şişirilmiş olabiliyor)
const spammy = (s) => {
  const n = String(s.name || '');
  return (n.match(/[#_*|@~]/g) || []).length + (n.length > 50 ? 2 : 0) + ((n.match(/,/g) || []).length >= 3 ? 2 : 0) >= 2;
};
const tidy = (list) => [...list.filter((s) => !spammy(s)), ...list.filter(spammy)];
function languageName(dil) {
  const code = String(dil || '').split('-')[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(code)) return null;
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code).toLowerCase(); } catch { return null; }
}

const starterReserve = new Map(); // grup adı -> yedek adaylar (bozuk çıkanların yerine)
async function buildStarter(ulke, dil, lang, labels = {}) {
  const L = {};
  for (const k of Object.keys(STARTER_LABELS_EN)) {
    const v = labels && typeof labels[k] === 'string' ? labels[k].trim().slice(0, 50) : '';
    L[k] = v || STARTER_LABELS_EN[k];
  }
  const seen = new Set();
  const used = new Set();
  const keyOf = new Map();
  const dedupe = (list) => list.filter((s) => {
    const n = normName(s.name) || cleanName(s.name, 'en').toLowerCase(), u = s.url_resolved || s.url;
    if (!n || !u || seen.has('n:' + n) || seen.has('u:' + u)) return false;
    seen.add('n:' + n); seen.add('u:' + u); return true;
  });
  // tekrarlar atılır, süslü adlılar sona, mevsimlikler dışarı
  const usable = (list) => tidy(dedupe(list)).filter((s) => { const k = groupOf(s); keyOf.set(s.stationuuid, k); return k !== 'sezon'; });
  // bir grupta aynı ağdan en fazla perHost radyo: liste çeşitli olsun
  const pick = (cands, n, perHost = 2) => {
    const out = [], hosts = new Map();
    for (const s of cands) {
      if (out.length >= n) break;
      if (used.has(s.stationuuid)) continue;
      const h = hostOf(s);
      if ((hosts.get(h) || 0) >= perHost) continue;
      hosts.set(h, (hosts.get(h) || 0) + 1); used.add(s.stationuuid); out.push(s);
    }
    return out;
  };
  const q = (o) => new URLSearchParams({ hidebroken: 'true', reverse: 'true', ...o });
  const groups = [];
  const local = ulke ? usable(await rb(`/json/stations/search?${q({ countrycode: ulke, order: 'clickcount', limit: '300' })}`)) : [];

  const popular = local.filter((s) => !['haber', 'dini'].includes(keyOf.get(s.stationuuid)));
  groups.push({ key: 'populer', label: L.populer, items: pick(popular, 11), reserve: popular });
  for (const key of DISPLAY_ORDER) {
    const cands = local.filter((s) => keyOf.get(s.stationuuid) === key);
    const items = pick(cands, 4);
    if (items.length) groups.push({ key, label: L[key], items, reserve: cands });
  }
  if (local.length < 15) { // az radyolu ülke: aynı dildeki radyolarla tamamla
    const langName = languageName(dil);
    if (langName) {
      const same = usable(await rb(`/json/stations/search?${q({ language: langName, order: 'clickcount', limit: '120' })}`)).filter((s) => s.countrycode !== ulke);
      const items = pick(same, 8);
      if (items.length) groups.push({ key: 'dil', label: L.dil, items, reserve: same });
    }
  }
  // Yabancı: dünyada en çok dinlenen caz, klasik ve sakin müzik radyoları (oy yerine dinlenme sayısı: daha güvenilir)
  const intl = [], intlReserve = [];
  for (const [tag, keys] of [['jazz', ['caz', 'sakin']], ['classical', ['caz', 'sakin']], ['chillout', ['sakin', 'caz']]]) {
    const list = usable(await rbCached(`/json/stations/search?${q({ tag, tagExact: 'true', order: 'clickcount', bitrateMin: '64', limit: '40' })}`, 24 * 3600e3))
      .filter((s) => s.countrycode !== ulke && !spammy(s) && focused(s, keys));
    intl.push(...pick(list, 2, 1));
    intlReserve.push(...list);
  }
  if (intl.length) groups.push({ key: 'yabanci', label: L.yabanci, items: intl, reserve: intlReserve });

  // grupKey: panel grup adını kullanıcının seçtiği dilde gösterir (grup = oluşturulduğu dildeki ad)
  starterReserve.clear();
  const out = [];
  for (const g of groups) {
    starterReserve.set(g.label, { key: g.key, list: g.reserve.filter((s) => !used.has(s.stationuuid)).slice(0, 15).map((s) => ({ s: slim(s), lang })) });
    for (const s of g.items) {
      out.push({ id: s.stationuuid, uuid: s.stationuuid, ad: cleanName(s.name, lang), grup: g.label, grupKey: g.key, url: s.url_resolved || s.url, kontrol: 'bekliyor' });
    }
  }
  return out;
}
function nextReserve(grup) {
  const r = starterReserve.get(grup);
  const list = r ? r.list : [];
  while (list.length) {
    const { s, lang } = list.shift();
    if (!findByUuid(s.stationuuid)) {
      return { id: s.stationuuid, uuid: s.stationuuid, ad: cleanName(s.name, lang), grup, grupKey: r.key, url: s.url_resolved || s.url, kontrol: 'bekliyor' };
    }
  }
  return null;
}

// Yeni eklenen hazır listeyi robotta tek tek dener (ses kartını kullanmadan); çalışmayanın yerine aynı gruptan yenisini koyar
function probe(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) return Promise.resolve(false);
  return new Promise((resolve) => {
    const c = spawn(path.join(BIN, 'ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-rw_timeout', '10000000', ...FF_SAFE, ...ffTls(url),
      '-t', '3', '-i', url, '-vn', '-f', 'null', '-'], { stdio: 'ignore' });
    try { os.setPriority(c.pid, 19); } catch { /* */ }
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* */ } }, 25000);
    c.on('close', (code) => { clearTimeout(t); resolve(code === 0); });
    c.on('error', () => { clearTimeout(t); resolve(false); });
  });
}
// İnternete (radyo dizinine) ulaşılabiliyor mu: bağlantı yokken hiçbir radyo "bozuk" sayılmaz
async function online() {
  try { await rb('/json/stats'); return true; } catch { return false; }
}
let checking = false;
let validateRetry = null;
async function validateLoop() {
  if (checking) return;
  checking = true;
  clearTimeout(validateRetry); validateRetry = null;
  let ok = 0, replaced = 0, kept = 0, offline = false;
  try {
    for (;;) {
      const fav = favorites.find((f) => f.kontrol === 'bekliyor');
      if (!fav) break;
      let good = await probe(fav.url);
      if (!good && fav.uuid) {
        const fresh = await rbFresh(fav.uuid);
        if (fresh && fresh !== fav.url) { fav.url = fresh; good = await probe(fresh); }
      }
      // Çalmadıysa önce bağlantıya bak: internet yoksa sorun istasyonda değil; hiçbir şeyi değiştirme, sonra yeniden dene
      if (!good && !(await online())) { offline = true; break; }
      const i = favorites.indexOf(fav);
      if (good) { fav.kontrol = 'tamam'; ok++; }
      else if (i >= 0) {
        const rep = nextReserve(fav.grup);
        if (rep) {
          log('hazır liste: çalışmayan radyo değiştirildi:', fav.ad, '->', rep.ad);
          favorites.splice(i, 1, rep);
          if (settings.istasyon === fav.id) { settings.istasyon = rep.id; saveSettings(); } // seçili radyo da yenisi olsun
          replaced++;
        } else {
          // Yerine konacak aday yok (ör. sunucu bu arada yeniden başladı): silme, listede kalsın; kullanıcı karar verir
          log('hazır liste: çalışmayan radyo listede bırakıldı (yerine konacak aday yok):', fav.ad);
          fav.kontrol = 'calismiyor';
          kept++;
        }
      }
      saveFavorites();
    }
  } finally {
    checking = false;
    if (ok + replaced + kept) log(`hazır liste denendi: ${ok} çalışıyor, ${replaced} değiştirildi, ${kept} çalışmıyor (listede bırakıldı)`);
    if (offline) {
      log('hazır liste: internete ulaşılamıyor; hiçbir radyo değiştirilmedi, 10 dakika sonra yeniden denenecek');
      validateRetry = setTimeout(() => validateLoop().catch(() => {}), 10 * 60e3);
    }
  }
}
// Seçili radyo listede yoksa (silindi ya da değiştirildi) listedeki ilk çalışan radyoya geç
function selectedStation() {
  if (!findFavorite(settings.istasyon)) {
    settings.istasyon = (favorites.find((f) => f.kontrol !== 'calismiyor') || favorites[0])?.id ?? null;
    saveSettings();
  }
  return settings.istasyon;
}

// ---------- ayarlar ----------
// zamanli: Valetudo'nun zamanlayıcısıyla başlayan temizliklerde de otomatik çalsın mı (varsayılan: hayır, ev boş olabilir)
const settings = { istasyon: favorites[0]?.id ?? null, ses: 60, sessiz: false, otomatik: false, zamanli: false, ulke: null, kurulum: false };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch { /* ilk çalıştırma */ }
if (!findFavorite(settings.istasyon)) settings.istasyon = favorites[0]?.id ?? null;
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(SETTINGS_FILE + '.tmp', JSON.stringify(settings)); fs.renameSync(SETTINGS_FILE + '.tmp', SETTINGS_FILE); }
    catch (e) { log('ayar yazılamadı', e.message); }
  }, 800);
}

// ---------- radyo ----------
const radio = { playing: false, station: null, title: '', error: '', errorKod: '', since: 0, withCleaning: false, restartTimes: [], pipe: null, timer: null };

// Ses ayarı ses kartının hemen önündeki "Radyo Ses" kanalıyla yapılır (anında etki eder).
// Kanal -60..0 dB; kulağa doğal gelsin diye ayar = 40·log10(ses/100) dB.
function volumePercent() {
  if (settings.sessiz || settings.ses <= 0) return 0;
  const dB = 40 * Math.log10(Math.min(100, settings.ses) / 100);
  return Math.max(0, Math.min(100, Math.round(((dB + 60) / 60) * 100)));
}
const applyVolume = () => setCtl('Radyo Ses', volumePercent());

// amixer çağrıları: her kanal için en son istenen değer sırayla uygulanır, başarısızsa tekrar denenir
const ctlState = new Map();
function amixerSet(name, pct) {
  return new Promise((resolve) => {
    const once = (n) => {
      const c = spawn(AMIXER, ['-c', '0', '-q', 'sset', name, `${pct}%`], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => (err += d));
      c.on('error', () => resolve(false));
      c.on('close', (code) => {
        if (code === 0) return resolve(true);
        if (n < 4) return setTimeout(() => once(n + 1), 150);
        log('ses kanalı ayarlanamadı:', name, pct + '%', err.trim());
        resolve(false);
      });
    };
    once(1);
  });
}
// Önemli: softvol kanalını ilk açan süreç, kanalın "sahibi" olur ve o süreç çalıştıkça başkası (amixer) kanalı
// değiştiremez (EPERM). Bu yüzden kanalları kısa ömürlü sessiz bir çalmayla önceden oluşturuyoruz; süreç bitince
// kanallar sahipsiz kalır ve radyo çalarken de ses ayarı/kısma çalışır.
let warmedUp = false;
function warmUpControls() {
  return new Promise((resolve) => {
    const c = spawn(path.join(BIN, 'aplay'), ['-q', '-D', 'radyo', '-t', 'raw', '-f', 'S16_LE', '-r', String(RATE), '-c', '1'],
      { stdio: ['pipe', 'ignore', 'ignore'] });
    c.on('close', (code) => { if (code === 0) warmedUp = true; resolve(); });
    c.on('error', () => resolve());
    c.stdin.on('error', () => {});
    c.stdin.end(Buffer.alloc(Math.round(RATE / 10) * 2)); // 0,1 sn sessizlik
    setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* */ } }, 5000);
  });
}

function setCtl(name, pct) {
  let s = ctlState.get(name);
  if (!s) { s = { want: null, busy: false }; ctlState.set(name, s); }
  s.want = pct;
  if (s.busy) return;
  s.busy = true;
  (async () => {
    while (s.want !== null) { const v = s.want; s.want = null; await amixerSet(name, v); }
    s.busy = false;
  })();
}

let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

// target: favori kimliği ya da { id, uuid, ad, url } (aramadan önizleme)
function startRadio(target, withCleaning = false) {
  const st = typeof target === 'string' ? findFavorite(target) : target;
  if (!st || (!st.url && !st.uuid)) throw httpError(400, 'Bilinmeyen radyo', 'yok');
  return serial(async () => {
    // Adresi henüz bilinmeyen radyo (aramadan önizleme): çalan radyoya dokunmadan ÖNCE adresi bul. Bulunamazsa çalan
    // radyo (varsa) çalmaya devam eder, durum tutarlı kalır ve kullanıcıya hata döner.
    let clicked = false;
    if (!st.url && st.uuid) { st.url = await rbResolve(st.uuid); clicked = true; }
    if (!st.url) {
      if (!radio.playing) { radio.error = 'Yayın adresi bulunamadı'; radio.errorKod = 'baglanti'; }
      throw httpError(502, 'Yayın adresi bulunamadı', 'baglanti');
    }
    clearTimeout(radio.timer); radio.timer = null;
    Object.assign(radio, { playing: true, station: st, title: '', error: '', errorKod: '', since: Date.now(), withCleaning, restartTimes: [], healed: false });
    duck.errorStop = false;
    if (findFavorite(st.id)) { settings.istasyon = st.id; saveSettings(); }
    saveRuntime();
    await spawnPipe();
    log('radyo açıldı:', st.ad, withCleaning ? '(temizlikle)' : '', findFavorite(st.id) ? '' : '(önizleme)');
    if (st.uuid && !clicked) rbResolve(st.uuid); // radio-browser'a "dinlendi" bildirimi (bir kez)
  });
}

// Hata gösterecek çağıranlar hata metnini stopRadio'dan SONRA yazar; normal kapanışta eski hata temizlenir
function stopRadio(reason = '') {
  clearTimeout(radio.timer); radio.timer = null;
  if (radio.playing) log('radyo kapandı', reason ? `(${reason})` : '');
  radio.playing = false; radio.withCleaning = false; radio.title = '';
  radio.error = ''; radio.errorKod = '';
  duck.errorStop = false;
  saveRuntime();
  return serial(() => killPipe());
}

let shuttingDown = false; // sunucu kapanırken "radyo kapalı" diye kaydetme: yeniden başlayınca kaldığı yerden sürsün
function saveRuntime() {
  if (shuttingDown) return;
  try { fs.writeFileSync(RUNTIME_FILE, JSON.stringify({ caliyor: radio.playing, istasyon: radio.station?.id, temizlikle: radio.withCleaning })); } catch { /* */ }
}

function killPipe() {
  const p = radio.pipe; radio.pipe = null;
  if (!p) return Promise.resolve();
  p.dead = true;
  try { p.ff.stdout?.destroy(); } catch { /* */ }
  try { p.ap.stdin?.destroy(); } catch { /* */ }
  const waitExit = (c) => new Promise((resolve) => {
    if (c.exitCode !== null || c.signalCode !== null) return resolve();
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* */ } }, 2000);
    c.once('close', () => { clearTimeout(t); resolve(); });
    try { c.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
  });
  return Promise.all([waitExit(p.ff), waitExit(p.ap)]);
}

async function spawnPipe() {
  await killPipe();
  if (!radio.playing) return;
  if (!warmedUp) await warmUpControls();
  const st = radio.station;
  const url = safeUrl(st.url);
  if (!url) { stopRadio('geçersiz adres'); radio.error = 'Geçersiz yayın adresi'; radio.errorKod = 'baglanti'; return; }
  const ff = spawn(path.join(BIN, 'ffmpeg'), ['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '10', '-rw_timeout', '15000000',
    ...FF_SAFE, ...ffTls(url), '-i', url, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  // "radyo" cihazı /etc/asound.conf içinde: robotla paylaşılan karıştırıcı + kısılabilen "Radyo" kanalı.
  // Ses verisi ffmpeg'den aplay'e doğrudan akar, node'un içinden geçmez (işlemciyi yormamak için).
  let ap;
  try {
    ap = spawn(path.join(BIN, 'aplay'), ['-q', '-D', 'radyo', '-t', 'raw', '-f', 'S16_LE', '-r', String(RATE), '-c', '1'],
      { stdio: [ff.stdout, 'ignore', 'pipe'] });
  } catch (e) {
    try { ff.kill('SIGKILL'); } catch { /* */ }
    log('ses çıkışı başlatılamadı:', e.message);
    stopRadio('ses çıkışı yok');
    radio.error = 'Ses çıkışı başlatılamadı'; radio.errorKod = 'ses';
    return;
  }
  try { ff.stdout.destroy(); } catch { /* */ } // bizdeki kopya kapanır, veriyi yalnızca aplay okur
  const p = { ff, ap, dead: false, gotAudio: false };
  radio.pipe = p;
  for (const c of [ff, ap]) { try { os.setPriority(c.pid, 10); } catch { /* */ } }
  // Kanallar ilk açılışta oluşur: biraz sonra ses ayarını ve (robot konuşmuyorsa) tam seviyeyi uygula
  for (const ms of [600, 1500, 4000]) {
    setTimeout(() => { if (radio.pipe === p) { applyVolume(); if (!duck.active) setRadioChannel(100); } }, ms);
  }

  let errTail = '';
  let lineBuf = '';
  ff.stderr.on('data', (d) => {
    lineBuf += d.toString('utf8');
    const lines = lineBuf.split(/\r?\n|\r/);
    lineBuf = lines.pop();
    for (const line of lines) {
      if (/^(Output #0|Stream mapping)/.test(line)) { // yayın açıldı, ses akmaya başlıyor
        p.gotAudio = true;
        if (!radio.errorKod) radio.error = ''; // kısa kesintiden sonra yeniden bağlandı
      }
      const m = line.match(/StreamTitle\s*:\s*(.*)$/);
      if (m) radio.title = m[1].trim().replace(/^'|';?$/g, '').slice(0, 120);
      if (/error|failed|refused|not found|forbidden|timed out/i.test(line)) errTail = line.trim().slice(0, 160);
    }
  });
  ap.stderr.on('data', (d) => { errTail = d.toString().trim().slice(0, 160); });

  const onExit = (who) => () => {
    if (p.dead || radio.pipe !== p || !radio.playing) return;
    p.dead = true; // ffmpeg ve aplay aynı kesinti için iki kez haber verir: bir kez ele al
    const now = Date.now();
    radio.restartTimes = radio.restartTimes.filter((t) => now - t < 120000);
    radio.restartTimes.push(now);
    radio.error = errTail || `${who} durdu`; radio.errorKod = '';
    log('yayın kesildi:', radio.station.ad, '-', radio.error);
    // Yayın hiç açılmadıysa adres değişmiş olabilir: radio-browser'dan güncel adresi alıp bir kez onu dene
    if (!p.gotAudio && radio.station.uuid && !radio.healed) {
      radio.healed = true;
      const st = radio.station;
      serial(async () => {
        await killPipe();
        const fresh = await rbFresh(st.uuid);
        if (fresh && fresh !== st.url) {
          log('yayın adresi değişmiş, yenisi deneniyor:', st.ad);
          st.url = fresh;
          if (findFavorite(st.id)) saveFavorites();
        }
        if (radio.playing && radio.station === st) await spawnPipe();
      });
      return;
    }
    // 2 dakikada 5'ten fazla kesinti (ör. biten bir kayıt ya da kapanmış yayın): sonsuza kadar denemek yerine dur
    if (radio.restartTimes.length > 5) {
      const why = radio.error;
      stopRadio('bağlanılamadı');
      radio.error = 'Yayına bağlanılamıyor: ' + why; radio.errorKod = 'baglanti';
      return;
    }
    serial(() => killPipe());
    clearTimeout(radio.timer);
    const wait = Math.min(30000, 3000 * radio.restartTimes.length); // her kesintide biraz daha uzun bekle
    radio.timer = setTimeout(() => { if (radio.playing) serial(() => spawnPipe()); }, wait);
  };
  ff.on('close', onExit('ffmpeg'));
  ap.on('close', onExit('aplay'));
  ff.on('error', onExit('ffmpeg'));
  ap.on('error', onExit('aplay'));
}

// ---------- robot konuşurken radyoyu kısma ----------
// Robotun ses kütüphanesi kartı yalnızca konuşurken açar; kartı tutan başka bir süreç varsa robot konuşuyordur.
const duck = { active: false, lastSpeak: 0, rampTimer: null, errorStop: false, errorSince: 0 };
let candidates = [];
let candidatesAt = 0;

const setRadioChannel = (pct) => setCtl('Radyo', pct);

function refreshCandidates() {
  candidatesAt = Date.now();
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
      if (!['RoboController', 'wlanmgr', 'WatchDoge', 'aplay', 'bootring'].includes(comm)) continue;
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const threads = Number((fs.readFileSync(`/proc/${d}/status`, 'utf8').match(/Threads:\s*(\d+)/) || [])[1] || 1);
      if (ppid === 1 && threads === 1) continue; // karıştırıcının yardımcı süreci olabilir
      if (ppid === process.pid) continue;        // radyonun kendi (eski ya da yeni) çalma süreci
      out.push(Number(d));
    } catch { /* süreç kapanmış */ }
  }
  candidates = out;
  for (const pid of fdSeen.keys()) if (!out.includes(pid)) fdSeen.delete(pid);
}

// Robot konuşmaya başlayınca ses kartı için yeni bir dosya tanıtıcısı (fd) açar. Her turda yalnızca yeni açılan
// fd'lere bakılır (eskiden her seferinde hepsine bakılıyordu); saniyede bir de tamamı baştan denetlenir.
const fdSeen = new Map(); // pid -> Map(fd -> ses kartı mı)
let fullCheckAt = 0;
function holdsSoundCard(pid, full) {
  let fds;
  try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { fdSeen.delete(pid); return false; }
  const prev = full ? null : fdSeen.get(pid);
  const next = new Map();
  let found = false;
  for (const fd of fds) {
    let snd = prev ? prev.get(fd) : undefined;
    if (snd !== false) { // yeni fd ya da az önce ses kartıydı: nereye bağlı olduğuna bak
      try { snd = fs.readlinkSync(`/proc/${pid}/fd/${fd}`).startsWith('/dev/snd/pcmC0D0p'); } catch { snd = false; }
    }
    next.set(fd, snd);
    if (snd) found = true;
  }
  fdSeen.set(pid, next);
  return found;
}

setInterval(() => {
  if (!radio.playing) { duck.active = false; if (fdSeen.size) fdSeen.clear(); return; }
  const now = Date.now();
  if (now - candidatesAt > 5000) refreshCandidates();
  const full = now - fullCheckAt > 1000;
  if (full) fullCheckAt = now;
  const own = radio.pipe?.ap?.pid;
  const talking = [];
  for (const pid of candidates) if (pid !== own && holdsSoundCard(pid, full)) talking.push(pid);
  if (talking.length) {
    duck.lastSpeak = now;
    if (!duck.active) {
      duck.active = true;
      clearInterval(duck.rampTimer); duck.rampTimer = null;
      setRadioChannel(DUCK_LEVEL);
      const who = talking.map((pid) => { try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return pid; } });
      log('robot konuşuyor: radyo kısıldı', `(${who.join(', ')})`);
    }
  } else if (duck.active && now - duck.lastSpeak > 700) {
    duck.active = false;
    if (duck.errorStop) { errorStopNow(); return; }
    let i = 0;
    clearInterval(duck.rampTimer);
    duck.rampTimer = setInterval(() => { setRadioChannel(RAMP[i++]); if (i >= RAMP.length) { clearInterval(duck.rampTimer); duck.rampTimer = null; } }, 300);
    log('robot sustu: radyo eski seviyesine dönüyor');
  }
  if (duck.errorStop && !duck.active && now - duck.errorSince > 3000) errorStopNow();
}, 100);

function errorStopNow() {
  stopRadio('robot hata verdi');
  radio.error = 'Robot hata verdi (ör. fırça takıldı), radyo kapatıldı'; radio.errorKod = 'hata';
}

// ---------- temizlikte otomatik radyo, istasyona varınca ve hata olunca kapatma ----------
// Robotun durumu Valetudo'dan okunur (temizliyor / dönüyor / istasyonda / hata). Valetudo'nun girişi kapalıysa
// (Valetudo'nun varsayılanı) doğrudan, hemen; açıksa sayfayı 8080'den açan tarayıcının gönderdiği girişle.
// Şifre hiçbir yerden okunmaz; tarayıcının gönderdiği giriş yalnızca bellekte tutulur ve yalnızca 127.0.0.1'e gider.
let lastAuth = null;
let robotStatus = null;
let tracking = false;   // robotun durumu şu an okunabiliyor mu
let authWaitUntil = 0;  // girişsiz okuma reddedildiyse bir dakika bekle (Valetudo'yu boş yere yorma)
let seenOnce = false;
// Valetudo'nun zamanlayıcıları UTC saatiyle, dakikası dakikasına çalışır (Pazar = 0). Temizlik bir zamanlayıcının
// dakikasında (ya da en fazla 3 dakika sonra) başladıysa zamanlanmış sayılır.
async function scheduledCleaning(auth) {
  try {
    const timers = await valetudo('GET', '/api/v2/timers', auth);
    const now = Date.now();
    for (const t of Object.values(timers || {})) {
      if (!t || !t.enabled || !Array.isArray(t.dow)) continue;
      for (let back = 0; back <= 3; back++) {
        const d = new Date(now - back * 60000);
        if (t.dow.includes(d.getUTCDay()) && t.hour === d.getUTCHours() && t.minute === d.getUTCMinutes()) return true;
      }
    }
  } catch { /* zamanlayıcılar okunamadı: elle başlatılmış say */ }
  return false;
}

const AWAY = ['cleaning', 'returning', 'moving', 'paused', 'manual_control'];
// Başlangıçta robot istasyonda varsayılır: sunucu yeni açıldıktan sonra ilk görülen "temizliyor" yeni temizlik sayılır
// (ör. robot yeniden başladıktan sonra temizlik Valetudo'dan başlatılınca oturum bilgisi ancak o anda gelir).
export function makeRobotTracker(initial = 'docked') {
  let prev = initial, away = false, dockedSeen = 0;
  return (st) => {
    const events = [];
    if (!st) return events;
    if (AWAY.includes(st)) away = true;
    // Yeni temizlik: istasyondan/beklemeden "temizliyor"a geçiş (duraklat-devam etkilemez)
    if (st === 'cleaning' && prev !== null && !['cleaning', 'paused', 'returning'].includes(prev)) events.push('temizlik-basladi');
    if (st === 'error' && prev !== 'error') events.push('hata');
    // İstasyona varış: dışarıdan döndükten sonra iki okuma üst üste "istasyonda"
    if (st === 'docked') { dockedSeen++; if (away && dockedSeen >= 2) { away = false; events.push('vardi'); } } else dockedSeen = 0;
    prev = st;
    return events;
  };
}
const robotTracker = makeRobotTracker();

async function pollRobot() {
  if (!lastAuth && Date.now() < authWaitUntil) return;
  const auth = lastAuth || undefined;
  let st;
  try {
    const attrs = await valetudo('GET', '/api/v2/robot/state/attributes', auth);
    st = (Array.isArray(attrs) ? attrs : []).find((a) => a.__class === 'StatusStateAttribute')?.value ?? null;
  } catch (e) {
    tracking = false;
    if (e.status === 401) { if (auth) lastAuth = null; else authWaitUntil = Date.now() + 60000; }
    return;
  }
  tracking = true;
  robotStatus = st;
  const events = robotTracker(st);
  // Girişsiz Valetudo'da durum sunucu açılır açılmaz okunur: ilk okuma başlangıç durumudur, olay sayılmaz
  // (sunucu temizlik sırasında yeniden başlarsa radyo kendiliğinden açılmasın)
  if (!seenOnce) { seenOnce = true; if (!auth) return; }
  for (const ev of events) {
    if (ev === 'temizlik-basladi') {
      if (!settings.otomatik || radio.playing) { log('temizlik başladı'); continue; }
      // Zamanlanmış temizlikte ev çoğu zaman boştur: radyo yalnızca kullanıcı izin verdiyse açılır
      const planned = await scheduledCleaning(auth);
      if (planned && !settings.zamanli) { log('zamanlanmış temizlik başladı: radyo kendiliğinden açılmadı'); continue; }
      log('temizlik başladı' + (planned ? ' (zamanlanmış)' : ''));
      const failed = (e) => log('temizlikte radyo açılamadı:', e.message);
      try { startRadio(selectedStation(), true).catch(failed); } catch (e) { failed(e); }
    } else if (ev === 'hata') {
      log('robot hata verdi' + (radio.playing ? ': uyarısını söyledikten sonra radyo kapanacak' : ''));
      if (radio.playing && !duck.errorStop) { duck.errorStop = true; duck.errorSince = Date.now(); }
    } else if (ev === 'vardi') {
      log('robot istasyona vardı');
      if (radio.playing) stopRadio('robot istasyona vardı'); // nasıl açılmış olursa olsun
    }
  }
}
// Radyo çalarken ya da robot dışarıdayken 2 sn'de bir, istasyonda beklerken 4 sn'de bir bakılır.
// Bir sonraki sorgu öncekinin bitmesini bekler (Valetudo yavaşlarsa üst üste binmez).
(function pollLoop() {
  pollRobot().catch(() => {}).finally(() => {
    const busy = radio.playing || AWAY.includes(robotStatus) || robotStatus === 'error';
    setTimeout(pollLoop, busy ? 2000 : 4000);
  });
})();

// ---------- robotu yormama: kaynak izleme ----------
// 10 sn'de bir: sistemin ve radyonun işlemci kullanımı (4 çekirdeğin toplamına göre %), bellek.
// Temizlik sırasındaki en yüksek değerler ayrıca tutulur. Robotun belleği azalırsa radyo kendini kapatır;
// sunucunun kendi belleği olağandışı büyürse yeniden başlar (başlatıcı 5 sn sonra açar, radyo kaldığı yerden sürer).
const usage = { sistemCpu: null, radyoCpu: null, radyoRamMB: null, kullanilabilirRamMB: null,
  temizlikteEnYuksekSistemCpu: null, temizlikteEnYuksekRadyoCpu: null };
const USER_HZ = 100;
function procTicks(pid) {
  try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); const f = s.slice(s.lastIndexOf(')') + 2).split(' '); return Number(f[11]) + Number(f[12]); } catch { return 0; }
}
function procRssKB(pid) {
  try { return Number((fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s*(\d+)/) || [])[1] || 0); } catch { return 0; }
}
function systemTicks() {
  const v = fs.readFileSync('/proc/stat', 'utf8').split('\n', 1)[0].trim().split(/\s+/).slice(1).map(Number);
  return { total: v.reduce((a, b) => a + b, 0), idle: v[3] + (v[4] || 0) };
}
function trimLog() {
  try {
    const size = fs.statSync(LOG_FILE).size;
    if (size < 256 * 1024) return;
    const keep = Buffer.alloc(64 * 1024);
    const fd = fs.openSync(LOG_FILE, 'r');
    try { fs.readSync(fd, keep, 0, keep.length, size - keep.length); } finally { fs.closeSync(fd); }
    fs.writeFileSync(LOG_FILE + '.1', keep);
    fs.truncateSync(LOG_FILE, 0); // başlatıcı dosyayı ekleme kipinde açtığı için yazmaya baştan devam eder
  } catch { /* kayıt dosyası yoksa sorun değil */ }
}
let lastSample = null;
let sampleCount = 0;
setInterval(() => {
  try {
    const sys = systemTicks();
    const cpu = process.cpuUsage();
    const kids = radio.pipe ? [radio.pipe.ff.pid, radio.pipe.ap.pid].filter(Boolean) : [];
    const cur = { sys, ownUs: cpu.user + cpu.system, kidTicks: kids.reduce((a, pid) => a + procTicks(pid), 0), kids: kids.join(',') };
    if (lastSample) {
      const dt = sys.total - lastSample.sys.total;
      if (dt > 0) {
        const ownTicks = ((cur.ownUs - lastSample.ownUs) / 1e6) * USER_HZ;
        const kidTicks = cur.kids === lastSample.kids ? Math.max(0, cur.kidTicks - lastSample.kidTicks) : 0;
        usage.sistemCpu = Math.round(((dt - (sys.idle - lastSample.sys.idle)) / dt) * 1000) / 10;
        usage.radyoCpu = Math.round(((ownTicks + kidTicks) / dt) * 1000) / 10;
        if (robotStatus === 'cleaning') {
          usage.temizlikteEnYuksekSistemCpu = Math.max(usage.temizlikteEnYuksekSistemCpu ?? 0, usage.sistemCpu);
          if (radio.playing) usage.temizlikteEnYuksekRadyoCpu = Math.max(usage.temizlikteEnYuksekRadyoCpu ?? 0, usage.radyoCpu);
        }
      }
    }
    lastSample = cur;
    const mi = fs.readFileSync('/proc/meminfo', 'utf8');
    const kb = (k) => Number((mi.match(new RegExp(`^${k}:\\s*(\\d+)`, 'm')) || [])[1] || 0);
    const avail = kb('MemAvailable') || (kb('MemFree') + kb('Buffers') + kb('Cached') - kb('Shmem'));
    const rss = process.memoryUsage.rss() / 1048576;
    usage.kullanilabilirRamMB = Math.round(avail / 1024);
    usage.radyoRamMB = Math.round(rss + kids.reduce((a, pid) => a + procRssKB(pid), 0) / 1024);
    if (radio.playing && avail > 0 && avail < LOW_MEM_MB * 1024) {
      log(`robotun kullanılabilir belleği azaldı (${usage.kullanilabilirRamMB} MB): radyo kapatılıyor`);
      stopRadio('bellek az');
      radio.error = 'Robotun belleği azaldı, radyo kapatıldı'; radio.errorKod = 'bellek';
    }
    if (rss > RSS_LIMIT_MB) { log(`sunucunun belleği olağandışı büyüdü (${Math.round(rss)} MB): yeniden başlatılıyor`); shutdown(); }
    if (++sampleCount % 60 === 0) trimLog(); // 10 dakikada bir
  } catch { /* ölçüm yapılamadıysa bir sonrakini bekle */ }
}, 10000);

// ---------- Valetudo ----------
async function valetudo(method, p, auth, body) {
  const headers = {};
  if (auth) headers.Authorization = auth;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(VALETUDO + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* */ }
  if (res.status === 401) throw httpError(401, 'Giriş gerekli');
  if (!res.ok) throw httpError(502, `Valetudo hata verdi (${res.status})`);
  return data;
}

const authCache = new Map();
async function authorized(req) {
  const h = req.headers.authorization || '';
  const key = crypto.createHash('sha256').update(h).digest('hex');
  const exp = authCache.get(key);
  if (exp && exp > Date.now()) return true;
  try {
    await valetudo('GET', '/api/v2/robot', h || undefined);
    authCache.set(key, Date.now() + (h ? 5 * 60e3 : 60e3));
    if (authCache.size > 20) for (const [k, v] of authCache) if (v <= Date.now()) authCache.delete(k);
    if (h) lastAuth = h;
    return true;
  } catch (e) {
    if (e.status === 401) { authCache.delete(key); return false; }
    if (exp) return true; // Valetudo anlık yanıt vermiyor: kısa süre önce doğrulanmış girişi kabul et (radyo durdurulabilsin)
    throw httpError(503, 'Valetudo yanıt vermiyor', 'valetudo');
  }
}
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
// Valetudo'daki "yalnızca ev ağından erişim" kuralının aynısı
function isPrivate(ip = '') {
  ip = ip.replace(/^::ffff:/, '');
  return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1' || /^(fc|fd|fe80)/i.test(ip);
}

// ---------- HTTP ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 16384) throw httpError(413, 'İstek çok büyük'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'Geçersiz istek'); }
}

function state() {
  return {
    radyo: { caliyor: radio.playing, istasyon: radio.station?.id ?? settings.istasyon, istasyonAd: radio.station?.ad ?? null, baslik: radio.title,
      hata: radio.error, hataKod: radio.errorKod || null, temizlikle: radio.withCleaning, kisik: radio.playing && duck.active, sure: radio.playing ? Math.round((Date.now() - radio.since) / 1000) : 0,
      onizleme: Boolean(radio.station && !findFavorite(radio.station.id)), uuid: radio.station?.uuid ?? null },
    ses: settings.ses, sessiz: settings.sessiz, otomatik: settings.otomatik, ulke: settings.ulke, robotDurumu: robotStatus,
    kurulum: Boolean(settings.kurulum || favorites.length), kontrolBekleyen: favorites.filter((f) => f.kontrol === 'bekliyor').length,
    istasyonda: robotStatus ? robotStatus === 'docked' : null, durumTakibi: tracking, otomatikZamanli: Boolean(settings.zamanli),
    kaynak: usage, surum: VERSION,
  };
}

// Panel dosyaları: tarayıcı her açılışta "değişti mi" diye sorar, değişmediyse yeniden indirmez
function sendScript(req, res, name) {
  const file = path.join(WEB, name);
  const st = fs.statSync(file);
  const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  const headers = { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  return send(res, 200, fs.readFileSync(file), headers);
}
const SCRIPT_TAGS = '<script src="/robot-radyo/i18n.js" defer></script><script src="/robot-radyo/panel.js" defer></script>';
const PREVIEW = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Robot Radyo</title><style>body{margin:0;min-height:100vh;font:16px system-ui;background:#1e1e1e;color:#ddd;display:grid;place-items:center}</style></head>
<body><p>Robot Radyo &rarr;</p>${SCRIPT_TAGS}</body></html>`;

// Başka bir sitenin, ev ağındaki bir tarayıcı üzerinden radyoyu yönetmesini engeller (CSRF): değişiklik yapan istekler
// yalnızca JSON olarak ve aynı sayfadan kabul edilir (panel zaten böyle gönderir).
function assertSameSite(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw httpError(415, 'JSON bekleniyor');
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw httpError(403, 'Başka bir siteden gelen istek reddedildi');
  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* "null" ya da bozuk */ }
    if (host !== req.headers.host) throw httpError(403, 'Başka bir siteden gelen istek reddedildi');
  }
}

async function handleRadyo(req, res, p) {
  if (req.method === 'GET' && p === '/robot-radyo/panel.js') return sendScript(req, res, 'panel.js');
  if (req.method === 'GET' && p === '/robot-radyo/i18n.js') return sendScript(req, res, 'i18n.js');
  if (req.method === 'POST') assertSameSite(req);
  // Buradan sonrası Valetudo girişi ister (robotun içinden gelen istekler hariç)
  if (!(isLocal(req) || await authorized(req))) return send(res, 401, { hata: 'Giriş gerekli' });

  if (req.method === 'GET' && p === '/robot-radyo/onizleme') return send(res, 200, PREVIEW);
  if (req.method === 'GET' && p === '/robot-radyo/api/radyolar') {
    return send(res, 200, favorites.map(({ id, ad, grup, grupKey, uuid, kontrol }) => ({
      id, ad, grup: grup || null, grupKey: grupKey || null, dizinde: Boolean(uuid), calismiyor: kontrol === 'calismiyor' })));
  }
  // Radyo dizininde arama
  if (req.method === 'GET' && p === '/robot-radyo/api/ara') {
    const u = new URL(req.url, 'http://x').searchParams;
    const q = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '60' });
    const ulke = String(u.get('ulke') || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(ulke)) q.set('countrycode', ulke);
    const tur = String(u.get('tur') || '').slice(0, 40).trim();
    if (tur) { q.set('tag', tur); q.set('tagExact', 'false'); }
    const ad = String(u.get('ad') || '').slice(0, 60).trim();
    if (ad) q.set('name', ad);
    const list = await rbCached('/json/stations/search?' + q, 10 * 60e3);
    return send(res, 200, list.map(compact));
  }
  if (req.method === 'GET' && p === '/robot-radyo/api/ulkeler') {
    const list = await rbCached('/json/countries?hidebroken=true', 24 * 3600e3);
    return send(res, 200, list.filter((c) => c.iso_3166_1 && c.stationcount > 0)
      .map((c) => ({ kod: c.iso_3166_1, ad: c.name, sayi: c.stationcount })));
  }
  if (req.method === 'GET' && p === '/robot-radyo/api/durum') return send(res, 200, state());
  if (req.method === 'POST' && p === '/robot-radyo/api/radyo/cal') {
    const b = await readJson(req);
    const keep = Boolean(radio.playing && radio.withCleaning); // temizlik sırasında istasyon değişirse "dönünce kapan" korunur
    if (isUuid(b.uuid)) {
      const fav = findByUuid(b.uuid);
      if (fav) await startRadio(fav.id, keep);
      else await startRadio({ id: b.uuid, uuid: b.uuid, ad: String(b.ad || 'Radyo').slice(0, 80), url: null }, keep); // önizleme
    } else {
      await startRadio(b.istasyon || selectedStation(), keep);
    }
    return send(res, 200, state());
  }
  if (req.method === 'POST' && p === '/robot-radyo/api/favori/ekle') {
    const { uuid } = await readJson(req);
    if (!isUuid(uuid)) throw httpError(400, 'Geçersiz radyo', 'yok');
    if (!findByUuid(uuid)) {
      const [s] = await rb(`/json/stations/byuuid/${encodeURIComponent(uuid)}`);
      if (!s) throw httpError(404, 'Radyo dizinde bulunamadı', 'yok');
      const ad = String(s.name || 'Radyo').trim().slice(0, 80);
      // Şu an önizlemesi çalıyorsa aynı nesneyi favoriye çevir (çalan radyo listede seçili görünsün)
      const playing = radio.station && radio.station.uuid === uuid ? radio.station : null;
      const fav = Object.assign(playing || {}, { id: uuid, uuid, ad, grup: null, url: (playing && playing.url) || s.url_resolved || s.url });
      favorites.push(fav);
      saveFavorites();
      if (playing) { settings.istasyon = uuid; saveSettings(); }
      log('favori eklendi:', ad);
    }
    return send(res, 200, { tamam: true });
  }
  if (req.method === 'POST' && p === '/robot-radyo/api/favori/ekle-url') {
    const b = await readJson(req);
    const url = String(b.url || '').trim();
    const ad = String(b.ad || '').trim().slice(0, 60);
    if (!/^https?:\/\/[^\s]{4,500}$/i.test(url)) throw httpError(400, 'Geçersiz yayın adresi (http:// ya da https:// ile başlamalı)', 'url');
    if (!ad) throw httpError(400, 'Radyonun adını yazın', 'ad');
    const id = 'ozel-' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
    if (!findFavorite(id)) { favorites.push({ id, uuid: null, ad, grup: null, url }); saveFavorites(); log('özel radyo eklendi:', ad); }
    return send(res, 200, { tamam: true, id });
  }
  if (req.method === 'POST' && p === '/robot-radyo/api/favori/sil') {
    const { id } = await readJson(req);
    const i = favorites.findIndex((s) => s.id === id);
    if (i >= 0) { log('favori silindi:', favorites[i].ad); favorites.splice(i, 1); saveFavorites(); }
    if (!findFavorite(settings.istasyon)) { settings.istasyon = favorites[0]?.id ?? null; saveSettings(); }
    return send(res, 200, { tamam: true });
  }
  // Ülkeye göre hazır liste: mod "degistir" (listeyi bununla değiştir), "ekle" (mevcutlara ekle), "onizle" (kaydetmeden göster)
  if (req.method === 'POST' && p === '/robot-radyo/api/baslangic') {
    const b = await readJson(req);
    const ulke = String(b.ulke || '').toUpperCase();
    if (ulke && !/^[A-Z]{2}$/.test(ulke)) throw httpError(400, 'Geçersiz ülke');
    const lang = /^[a-z]{2}$/.test(b.lang || '') ? b.lang : 'en';
    const mode = ['ekle', 'onizle'].includes(b.mod) ? b.mod : 'degistir';
    const list = await buildStarter(ulke, b.dil, lang, b.etiketler);
    if (mode === 'onizle') return send(res, 200, { liste: list.map(({ ad, grup }) => ({ ad, grup })) });
    if (mode === 'degistir') favorites = list;
    else for (const f of list) if (!findByUuid(f.uuid)) favorites.push(f);
    saveFavorites();
    settings.ulke = ulke || null; settings.kurulum = true;
    if (!findFavorite(settings.istasyon)) settings.istasyon = favorites[0]?.id ?? null;
    saveSettings();
    log(`hazır liste (${ulke || 'tüm ülkeler'}, ${mode}): ${list.length} radyo`);
    validateLoop().catch((e) => log('hazır liste denenemedi:', e.message));
    return send(res, 200, { tamam: true, eklenen: list.length });
  }
  if (req.method === 'POST' && p === '/robot-radyo/api/ulke') {
    const k = String((await readJson(req)).ulke || '').toUpperCase();
    settings.ulke = /^[A-Z]{2}$/.test(k) ? k : null; saveSettings();
    return send(res, 200, { tamam: true });
  }
  if (req.method === 'POST' && p === '/robot-radyo/api/radyo/dur') { await stopRadio('kullanıcı'); return send(res, 200, state()); }
  if (req.method === 'POST' && p === '/robot-radyo/api/ses') {
    const v = Number((await readJson(req)).ses);
    if (!Number.isFinite(v)) throw httpError(400, 'Geçersiz ses');
    settings.ses = Math.round(Math.max(0, Math.min(100, v))); settings.sessiz = false; saveSettings();
    applyVolume();
    return send(res, 200, state());
  }
  if (req.method === 'POST' && p === '/robot-radyo/api/sessiz') {
    settings.sessiz = Boolean((await readJson(req)).sessiz); saveSettings();
    applyVolume();
    return send(res, 200, state());
  }
  if (req.method === 'POST' && p === '/robot-radyo/api/otomatik') {
    const b = await readJson(req);
    if ('acik' in b) settings.otomatik = Boolean(b.acik);
    if ('zamanli' in b) settings.zamanli = Boolean(b.zamanli);
    saveSettings();
    log('temizlikte otomatik radyo:', settings.otomatik ? 'açık' : 'kapalı', '| zamanlanmış temizliklerde:', settings.zamanli ? 'açık' : 'kapalı');
    return send(res, 200, state());
  }
  return send(res, 404, { hata: 'Bulunamadı' });
}

// ---------- Valetudo'yu aktarma (panel eklenerek) ----------
const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];
const PANEL_TAG = SCRIPT_TAGS;

function proxy(req, res) {
  const headers = { ...req.headers, host: `${UPSTREAM.host}:${UPSTREAM.port}` };
  for (const h of HOP) delete headers[h];
  const pathOnly = req.url.split('?')[0];
  const isPage = req.method === 'GET' && !pathOnly.startsWith('/api/')
    && (pathOnly === '/' || pathOnly.endsWith('.html') || (req.headers.accept || '').includes('text/html'));
  if (isPage) { delete headers['accept-encoding']; delete headers['if-none-match']; delete headers['if-modified-since']; }

  const up = http.request({ ...UPSTREAM, agent, method: req.method, path: req.url, headers }, (ur) => {
    if (req.headers.authorization && ur.statusCode !== 401) lastAuth = req.headers.authorization;
    const h = { ...ur.headers };
    for (const x of HOP) delete h[x];
    const ct = String(h['content-type'] || '');
    if (isPage && ur.statusCode === 200 && ct.includes('text/html') && !h['content-encoding']) {
      const chunks = [];
      ur.on('data', (c) => chunks.push(c));
      ur.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        html = html.includes('</body>') ? html.replace('</body>', `${PANEL_TAG}</body>`) : html + PANEL_TAG;
        delete h.etag;
        h['content-length'] = Buffer.byteLength(html);
        h['cache-control'] = 'no-store';
        res.writeHead(200, h);
        res.end(html);
      });
      return;
    }
    res.writeHead(ur.statusCode, h);
    res.flushHeaders();
    ur.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) send(res, 502, '<meta charset="utf-8"><p>Valetudo\'ya ulaşılamıyor.</p>'); else res.destroy(); });
  res.on('close', () => { if (!res.writableFinished) up.destroy(); }); // canlı akışlar (SSE) kapanınca bağlantıyı bırak
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  if (!isPrivate(req.socket.remoteAddress)) return send(res, 403, '<meta charset="utf-8"><p>Yalnızca ev ağından erişilebilir.</p>');
  const p = new URL(req.url, 'http://x').pathname;
  if (p.startsWith('/robot-radyo/')) {
    handleRadyo(req, res, p).catch((e) => {
      if (!e.status || e.status >= 500) log('hata:', req.method, p, e.message);
      if (!res.headersSent) send(res, e.status || 500, { hata: e.message || 'Hata', kod: e.kod || null });
    });
    return;
  }
  proxy(req, res);
});
// Önceki çalıştırmadan sahipsiz kalmış ffmpeg (sunucu aniden kapandıysa çalmaya devam eder ve durdurulamaz).
// Yalnızca bu kurulumun ffmpeg'i ve yalnızca sahipsiz olanlar (üst süreci 1): başka bir örneğin çalan radyosuna dokunmaz.
// ffmpeg kapanınca ona bağlı aplay de kendiliğinden biter.
function killOrphans() {
  const ff = path.join(BIN, 'ffmpeg');
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      if (fs.readlinkSync(`/proc/${d}/exe`) !== ff) continue;
      const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      if (stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1] !== '1') continue;
      process.kill(Number(d), 'SIGKILL');
      log('önceki çalıştırmadan kalan ses süreci kapatıldı:', d);
    } catch { /* süreç yok ya da bizim değil */ }
  }
}
process.on('unhandledRejection', (e) => log('beklenmeyen hata:', e?.message || e));
server.requestTimeout = 0;
server.on('error', (e) => {
  log('sunucu başlatılamadı:', e.code === 'EADDRINUSE' ? `${PORT} portu başka bir program tarafından kullanılıyor` : e.message);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', async () => {
  if (!fs.existsSync(FAV_FILE) && favorites.length) { try { saveFavorites(); } catch { /* */ } }
  trimLog();
  killOrphans();
  log(`Robot Radyo ${VERSION} hazır: http://0.0.0.0:${PORT}  (${favorites.length} favori radyo)`);
  if (favorites.some((f) => f.kontrol === 'bekliyor')) setTimeout(() => validateLoop().catch(() => {}), 20000); // yarım kalan denemeyi sürdür
  await warmUpControls();
  applyVolume();
  setRadioChannel(100);
  try {
    const r = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
    if (r.caliyor && r.istasyon) startRadio(r.istasyon, Boolean(r.temizlikle)).catch(() => {});
  } catch { /* radyo kapalı başlar */ }
});

const shutdown = () => { shuttingDown = true; server.close(); stopRadio('kapanış').finally(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
