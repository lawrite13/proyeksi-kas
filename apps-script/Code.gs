/**
 * Proyeksi Saldo Kas - penghubung antara aplikasi HP dan Google Sheet.
 *
 * Pasang di Google Sheet: Extensions > Apps Script, tempel seluruh isi file ini.
 * Langkah lengkap ada di README.md.
 *
 * Tab yang dipakai (dibuat otomatis oleh setup):
 *   Pengguna  : nama, salt, hash PIN, peran (editor / viewer), aktif
 *   Data      : satu baris "state" berisi seluruh data aplikasi dalam JSON + nomor versi
 *   Log       : riwayat penyimpanan
 *   Riwayat   : data harian hasil impor (satu baris per tanggal per rekening). Dibuat otomatis saat pertama kali menyimpan riwayat.
 *   Ringkasan : salinan data yang bisa dibaca manusia (ditulis ulang tiap simpan)
 */

// ====== ATUR PENGGUNA DI SINI, JALANKAN setup(), LALU HAPUS PIN DARI KODE ======
// peran: 'editor' = boleh mengubah angka (batasi maksimal 2 orang), 'viewer' = hanya melihat.
const PENGGUNA = [
  { nama: 'admin1', pin: 'GANTI-PIN-1', peran: 'editor' },
  { nama: 'admin2', pin: 'GANTI-PIN-2', peran: 'editor' },
  { nama: 'lihat1', pin: 'GANTI-PIN-3', peran: 'viewer' }
];
// ================================================================================

const TAB_PENGGUNA = 'Pengguna';
const TAB_DATA = 'Data';
const TAB_LOG = 'Log';
const TAB_RINGKASAN = 'Ringkasan';
const TAB_RIWAYAT = 'Riwayat';
const MAKS_RIWAYAT = 20000;       // maksimal baris riwayat (kira-kira 8 tahun untuk 7 rekening)
const SESI_DETIK = 6 * 60 * 60;   // login berlaku 6 jam (batas maksimum CacheService)
const MAKS_GAGAL = 5;             // salah PIN berapa kali sebelum dikunci
const KUNCI_DETIK = 15 * 60;      // lama kunci setelah salah PIN beruntun
const MAKS_EDITOR = 2;
const ZONA = 'Asia/Jakarta';

/* ---------------- pemasangan ---------------- */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  siapkanTab(ss, TAB_PENGGUNA, ['nama', 'salt', 'hash', 'peran', 'aktif']);
  siapkanTab(ss, TAB_DATA, ['key', 'value', 'versi', 'diubah_oleh', 'diubah_pada']);
  siapkanTab(ss, TAB_LOG, ['waktu', 'pengguna', 'aksi', 'keterangan']);
  siapkanTab(ss, TAB_RINGKASAN, ['Ringkasan data (hanya baca, ditulis ulang tiap simpan)']);
  const d = ss.getSheetByName(TAB_DATA);
  if (d.getLastRow() < 2) d.getRange(2, 1, 1, 5).setValues([['state', '', 0, '', '']]);
  aturPengguna();
}

function aturPengguna() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_PENGGUNA);
  const editor = PENGGUNA.filter(function (p) { return p.peran === 'editor'; }).length;
  if (editor > MAKS_EDITOR) throw new Error('Maksimal ' + MAKS_EDITOR + ' editor.');
  PENGGUNA.forEach(function (p) {
    if (!p.nama || !p.pin) throw new Error('Nama dan PIN wajib diisi.');
    if (String(p.pin).indexOf('GANTI-PIN') === 0) throw new Error('Ganti PIN contoh untuk ' + p.nama + ' dulu.');
    if (String(p.pin).length < 6) throw new Error('PIN ' + p.nama + ' minimal 6 karakter.');
    if (p.peran !== 'editor' && p.peran !== 'viewer') throw new Error('Peran ' + p.nama + ' harus editor atau viewer.');
    const salt = Utilities.getUuid();
    const baris = [String(p.nama).trim().toLowerCase(), salt, sha(salt + String(p.pin)), p.peran, true];
    const idx = cariBaris(sh, baris[0]);
    if (idx > 0) sh.getRange(idx, 1, 1, 5).setValues([baris]);
    else sh.appendRow(baris);
  });
  const semua = sh.getDataRange().getValues().slice(1);
  const nEditor = semua.filter(function (r) { return r[3] === 'editor' && r[4] !== false; }).length;
  if (nEditor > MAKS_EDITOR) throw new Error('Ada ' + nEditor + ' editor aktif di tab Pengguna. Maksimal ' + MAKS_EDITOR + '.');
}

function siapkanTab(ss, nama, header) {
  let sh = ss.getSheetByName(nama);
  if (!sh) sh = ss.insertSheet(nama);
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
}

/* ---------------- API ---------------- */

function doGet() {
  return ContentService.createTextOutput('API Proyeksi Saldo Kas aktif.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === 'login') out = login(req);
    else if (req.action === 'get') out = ambil(req);
    else if (req.action === 'save') out = simpan(req);
    else if (req.action === 'riwayat_get') out = riwayatAmbil(req);
    else if (req.action === 'riwayat_save') out = riwayatSimpan(req);
    else if (req.action === 'riwayat_hapus') out = riwayatHapus(req);
    else out = { ok: false, error: 'aksi' };
  } catch (err) {
    console.error(err);
    out = { ok: false, error: 'server' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function login(req) {
  const nm = String(req.nama || '').trim().toLowerCase().slice(0, 40);
  const pin = String(req.pin || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const kunci = 'gagal_' + nm;
  const gagal = Number(cache.get(kunci) || 0);
  if (gagal >= MAKS_GAGAL) return { ok: false, error: 'terkunci' };
  const u = cariPengguna(nm);
  if (u && sha(u.salt + pin) === u.hash) {
    cache.remove(kunci);
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    cache.put('tok_' + token, JSON.stringify({ nama: u.nama, peran: u.peran }), SESI_DETIK);
    return { ok: true, token: token, nama: u.nama, peran: u.peran };
  }
  cache.put(kunci, String(gagal + 1), KUNCI_DETIK);
  Utilities.sleep(400);
  return { ok: false, error: 'salah' };
}

function sesi(req) {
  const t = String(req.token || '');
  if (t.length < 32) return null;
  const raw = CacheService.getScriptCache().get('tok_' + t);
  return raw ? JSON.parse(raw) : null;
}

function ambil(req) {
  const s = sesi(req);
  if (!s) return { ok: false, error: 'sesi' };
  const r = bacaState();
  return { ok: true, peran: s.peran, version: r.versi, data: r.data, oleh: r.oleh, pada: r.pada };
}

function simpan(req) {
  const s = sesi(req);
  if (!s) return { ok: false, error: 'sesi' };
  if (s.peran !== 'editor') return { ok: false, error: 'dilarang' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const r = bacaState();
    if (Number(req.baseVersion) !== r.versi) {
      return { ok: false, error: 'konflik', version: r.versi, data: r.data, oleh: r.oleh, pada: r.pada };
    }
    const data = bersih(req.data || {});
    const json = JSON.stringify(data);
    if (json.length > 45000) return { ok: false, error: 'terlalu_besar' };
    const versi = r.versi + 1;
    const pada = new Date().toISOString();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.getSheetByName(TAB_DATA).getRange(2, 1, 1, 5).setValues([['state', json, versi, s.nama, pada]]);
    ss.getSheetByName(TAB_LOG).appendRow([pada, s.nama, 'simpan', 'versi ' + versi + ', total saldo awal ' + total(data)]);
    tulisRingkasan(ss, data, versi, s.nama, pada);
    return { ok: true, version: versi, oleh: s.nama, pada: pada };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- riwayat harian ---------------- */

function tglIso(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'yyyy-MM-dd');
  const t = String(v == null ? '' : v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}

function siapkanRiwayat() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  siapkanTab(ss, TAB_RIWAYAT, ['tanggal', 'rek_id', 'rek_nama', 'masuk', 'keluar', 'diubah_oleh', 'diubah_pada']);
  return ss.getSheetByName(TAB_RIWAYAT);
}

function bacaRiwayat(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const out = [];
  sh.getRange(2, 1, n, 7).getValues().forEach(function (r) {
    const d = tglIso(r[0]);
    if (!d || !r[1]) return;
    out.push({ d: d, a: String(r[1]), n: String(r[2] || ''), i: Math.round(Number(r[3])) || 0, o: Math.round(Number(r[4])) || 0, oleh: String(r[5] || ''), pada: r[6] instanceof Date ? r[6].toISOString() : String(r[6] || '') });
  });
  return out;
}

function tulisRiwayat(sh, rows) {
  rows.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : x.a < y.a ? -1 : x.a > y.a ? 1 : 0; });
  sh.clearContents();
  const isi = [['tanggal', 'rek_id', 'rek_nama', 'masuk', 'keluar', 'diubah_oleh', 'diubah_pada']]
    .concat(rows.map(function (r) { return [r.d, r.a, r.n, r.i, r.o, r.oleh, r.pada]; }));
  sh.getRange(1, 1, isi.length, 1).setNumberFormat('@');   // tanggal tetap teks, jangan diubah Sheets jadi tanggal
  sh.getRange(1, 1, isi.length, 7).setValues(isi);
  sh.getRange(1, 1, 1, 7).setFontWeight('bold');
}

function riwayatAmbil(req) {
  const s = sesi(req);
  if (!s) return { ok: false, error: 'sesi' };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_RIWAYAT);
  const rows = sh ? bacaRiwayat(sh) : [];
  return { ok: true, rows: rows.map(function (r) { return { d: r.d, a: r.a, n: r.n, i: r.i, o: r.o }; }) };
}

function riwayatSimpan(req) {
  const s = sesi(req);
  if (!s) return { ok: false, error: 'sesi' };
  if (s.peran !== 'editor') return { ok: false, error: 'dilarang' };
  const masuk = Array.isArray(req.recs) ? req.recs.slice(0, MAKS_RIWAYAT) : [];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = siapkanRiwayat();
    const peta = {};
    bacaRiwayat(sh).forEach(function (r) { peta[r.a + '|' + r.d] = r; });
    const pada = new Date().toISOString();
    let diterima = 0, minD = '9999-99-99', maxD = '0000-00-00';
    masuk.forEach(function (x) {
      x = x || {};
      const d = tglIso(x.d), a = String(x.a == null ? '' : x.a).slice(0, 24).replace(/[^A-Za-z0-9_-]/g, '');
      if (!d || !a) return;
      const i = Math.abs(Math.round(Number(x.i))) || 0, o = Math.abs(Math.round(Number(x.o))) || 0;
      if (!i && !o) return;
      peta[a + '|' + d] = { d: d, a: a, n: String(x.n == null ? '' : x.n).slice(0, 60), i: i, o: o, oleh: s.nama, pada: pada };
      diterima++; if (d < minD) minD = d; if (d > maxD) maxD = d;
    });
    const semua = Object.keys(peta).map(function (k) { return peta[k]; });
    if (semua.length > MAKS_RIWAYAT) return { ok: false, error: 'terlalu_besar' };
    if (!diterima) return { ok: false, error: 'kosong' };
    tulisRiwayat(sh, semua);
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_LOG).appendRow([pada, s.nama, 'riwayat', diterima + ' catatan, ' + minD + ' s/d ' + maxD]);
    return { ok: true, diterima: diterima, total: semua.length };
  } finally {
    lock.releaseLock();
  }
}

function riwayatHapus(req) {
  const s = sesi(req);
  if (!s) return { ok: false, error: 'sesi' };
  if (s.peran !== 'editor') return { ok: false, error: 'dilarang' };
  const dari = tglIso(req.dari), sampai = tglIso(req.sampai);
  if (!dari || !sampai || dari > sampai) return { ok: false, error: 'tanggal' };
  const a = String(req.a == null ? '' : req.a).slice(0, 24).replace(/[^A-Za-z0-9_-]/g, '');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = siapkanRiwayat();
    const ada = bacaRiwayat(sh);
    const sisa = ada.filter(function (r) { return !(r.d >= dari && r.d <= sampai && (!a || r.a === a)); });
    const hapus = ada.length - sisa.length;
    if (hapus) {
      tulisRiwayat(sh, sisa);
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_LOG).appendRow([new Date().toISOString(), s.nama, 'riwayat-hapus', hapus + ' catatan, ' + dari + ' s/d ' + sampai + (a ? ', rekening ' + a : ', semua rekening')]);
    }
    return { ok: true, dihapus: hapus, total: sisa.length };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- data ---------------- */

function bacaState() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_DATA);
  const row = sh.getRange(2, 1, 1, 5).getValues()[0];
  let data = null;
  try { data = row[1] ? JSON.parse(row[1]) : null; } catch (e) { data = null; }
  // Sheets bisa mengubah teks ISO menjadi tanggal, jadi tangani keduanya.
  const pada = row[4] instanceof Date ? row[4].toISOString() : String(row[4] || '');
  return { data: data, versi: Number(row[2]) || 0, oleh: String(row[3] || ''), pada: pada };
}

function bersih(d) {
  const num = function (v) { v = Number(v); return isFinite(v) ? Math.round(v) : 0; };
  const str = function (v, n) { return String(v == null ? '' : v).slice(0, n); };
  const tgl = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : ''; };
  const pct = function (v) { v = Number(v); return isFinite(v) ? Math.max(0, Math.min(300, v)) : 100; };
  // arus rutin satu rekening: jumlah per hari kerja (Senin-Sabtu). Tanggal mulai berlaku satu untuk semua rekening (flowFrom).
  const alir = function (f) {
    f = f || {};
    return { amt: Math.abs(num(f.amt)) };
  };
  const hariIni = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  const sc = d.sc || {};
  const skenario = function (k, i, o) {
    const x = sc[k] || {};
    return { i: x.i == null ? i : pct(x.i), o: x.o == null ? o : pct(x.o) };
  };
  return {
    anchor: tgl(d.anchor) || hariIni,
    flowFrom: tgl(d.flowFrom),
    accounts: (Array.isArray(d.accounts) ? d.accounts : []).slice(0, 30).map(function (a) {
      a = a || {};
      return { id: str(a.id, 24).replace(/[^A-Za-z0-9_-]/g, ''), n: str(a.n, 60), v: num(a.v), fi: alir(a.fi), fo: alir(a.fo) };
    }),
    sc: { kon: skenario('kon', 90, 105), dasar: skenario('dasar', 100, 100), opt: skenario('opt', 110, 95) },
    events: (Array.isArray(d.events) ? d.events : []).slice(0, 200).map(function (e) {
      e = e || {};
      return { d: tgl(e.d), l: str(e.l, 100), dir: e.dir === 'in' ? 'in' : 'out', amt: Math.abs(num(e.amt)), rep: e.rep === 'm' ? 'm' : 'o', a: str(e.a, 24).replace(/[^A-Za-z0-9_-]/g, '') };
    })
  };
}

function total(d) {
  return (d.accounts || []).reduce(function (s, a) { return s + (a.v || 0); }, 0);
}

function tulisRingkasan(ss, d, versi, oleh, pada) {
  const sh = ss.getSheetByName(TAB_RINGKASAN);
  const baris = [
    ['Versi ' + versi + ' · disimpan oleh ' + oleh + ' · ' + pada],
    [''],
    ['SALDO AWAL', 'Tanggal', d.anchor],
    ['Rekening', 'Saldo', 'Kas masuk rutin', 'Kas keluar rutin']
  ];
  const teks = function (f) {
    return f.amt ? f.amt + ' per hari kerja' : '-';
  };
  d.accounts.forEach(function (a) { baris.push([a.n, a.v, teks(a.fi), teks(a.fo)]); });
  baris.push(['Total', total(d)], ['Arus rutin berlaku mulai', d.flowFrom || '(belum diisi)'], ['Hari kerja Senin-Sabtu, Minggu libur'], [''],
    ['SKENARIO', 'Masuk %', 'Keluar %'],
    ['Konservatif', d.sc.kon.i, d.sc.kon.o], ['Dasar', d.sc.dasar.i, d.sc.dasar.o], ['Optimis', d.sc.opt.i, d.sc.opt.o], [''],
    ['KEJADIAN', 'Tanggal', 'Arah', 'Jumlah', 'Ulang', 'Rekening']);
  d.events.forEach(function (e) {
    const ak = d.accounts.filter(function (a) { return a.id === e.a; })[0];
    baris.push([e.l, e.d, e.dir === 'in' ? 'masuk' : 'keluar', e.amt, e.rep === 'm' ? 'tiap bulan' : 'sekali', ak ? ak.n : '']);
  });
  const lebar = baris.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  const rata = baris.map(function (r) { const x = r.slice(); while (x.length < lebar) x.push(''); return x; });
  sh.clearContents();
  sh.getRange(1, 1, rata.length, lebar).setValues(rata);
}

/* ---------------- pengguna & hash ---------------- */

function cariPengguna(nm) {
  if (!nm) return null;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_PENGGUNA);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]).toLowerCase() === nm && r[4] !== false && String(r[4]).toUpperCase() !== 'FALSE') {
      return { nama: String(r[0]), salt: String(r[1]), hash: String(r[2]), peran: String(r[3]) };
    }
  }
  return null;
}

function cariBaris(sh, nm) {
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]).toLowerCase() === nm) return i + 1;
  return -1;
}

function sha(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
