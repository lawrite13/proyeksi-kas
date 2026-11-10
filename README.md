# Proyeksi Saldo Kas (PWA)

Aplikasi HP untuk memproyeksikan saldo kas pada tanggal tertentu.
- **Tampilan**: file statis, di-hosting di GitHub Pages (akun GitHub lu sendiri).
- **Database + login**: Google Sheet + Google Apps Script (akun Google lu sendiri).
- **Hak akses**: 2 editor (bisa ubah angka), sisanya viewer (hanya lihat). Dipaksa di server, bukan cuma disembunyikan di layar.

## Langkah 1 – Sheet dan Apps Script (±10 menit)
1. Buat Google Sheet baru, misal "Proyeksi Saldo Kas DB".
2. Menu **Ekstensi → Apps Script**. Hapus isi file, tempel seluruh isi `apps-script/Code.gs`.
3. Di bagian atas `Code.gs`, ubah array `PENGGUNA`: nama, PIN (minimal 6 karakter), peran. **Maksimal 2 `editor`.** PIN contoh `GANTI-PIN-x` akan ditolak.
4. Pilih fungsi `setup` lalu **Jalankan**, setujui izin. Tab `Pengguna`, `Data`, `Log`, `Ringkasan` akan muncul. PIN disimpan sebagai hash.
5. **Hapus PIN dari kode** (ganti jadi teks kosong/contoh) lalu simpan. Kode tidak perlu menyimpan PIN lagi.
6. **Deploy → Deployment baru → Web app**. Execute as: **Me**. Who has access: **Anyone**. Salin URL yang berakhiran `/exec`.
   - Setiap kali `Code.gs` diubah, deploy ulang sebagai **versi baru** (URL tetap sama).

## Langkah 2 – GitHub Pages
1. Edit `config.js`, ganti `API_URL` dengan URL `/exec` tadi.
2. Buat repo di GitHub lu (misal `proyeksi-kas`), upload semua file **kecuali folder `apps-script/`** (opsional, boleh ikut tapi pastikan tidak ada PIN di dalamnya).
3. Repo → **Settings → Pages** → Branch `main`, folder `/ (root)` → Save.
4. Alamat aplikasi: `https://<username>.github.io/proyeksi-kas/`

## Langkah 3 – Pasang di HP
- Android (Chrome): buka alamatnya, menu ⋮ → **Instal aplikasi / Tambahkan ke layar utama**.
- iPhone (Safari): tombol Bagikan → **Tambah ke Layar Utama**.
Bagikan alamat + nama + PIN masing-masing orang lewat chat pribadi, jangan di grup.

## Kelola pengguna
Ubah `PENGGUNA` di `Code.gs` (atau langsung di tab `Pengguna`: kolom peran), jalankan `aturPengguna()`. PIN lupa = isi ulang lewat `aturPengguna()`.

## Cara kerja proyeksi
- **Saldo awal** diisi per rekening kas/bank, per satu tanggal.
- **Arus kas rutin** diisi per rekening, masuk dan keluar terpisah, selalu **per hari kerja** (Senin–Sabtu). Hari Minggu libur dan tidak ada arus rutin. Tidak ada opsi mingguan atau bulanan. Ada satu tanggal "Berlaku mulai" untuk semua rekening; arus rutin tidak dihitung sebelum tanggal itu. Kalau dikosongkan, arus dihitung sejak tanggal saldo awal.
- **Kalender kejadian** menampilkan tiap bulan lengkap dengan nominal dan keterangan kejadian. Kejadian bulanan muncul di tiap bulan, tanggal 31 otomatis jadi hari terakhir bulan pendek. Kejadian yang bertanggal sebelum/pada tanggal saldo awal atau lewat tanggal target ditampilkan pudar karena tidak ikut dihitung.
- **Tanggal yang kosong ditandai** merah dengan peringatan di bagian atas: tanggal saldo awal (proyeksi tidak bisa dihitung dan simpan ditahan), tanggal target, tanggal berlaku arus rutin, dan tanggal tiap kejadian (kejadian tanpa tanggal tidak dihitung).
- **Impor riwayat harian** (panel Arus kas rutin, bagian "Isi dari riwayat harian"): tempel data dari Excel/Google Sheet atau pilih file CSV, tanpa perlu mengetik per tanggal. Baris pertama harus berisi judul kolom.
  - Rekening bawaan: Kas Toko, Kas Umum, BRI, Ewallet, BMT (nama bisa diubah dan rekening bisa ditambah di panel Saldo awal). Pencocokan judul kolom tidak peka huruf besar, spasi, tanda baca, dan awalan "Bank": "BRI Masuk", "Bank BRI Masuk", dan "E-Wallet keluar" semuanya terbaca. File contoh: `template-riwayat-arus-kas.csv`.
  - Format yang dikenali: satu kolom per rekening (judul memuat nama rekening dan kata Masuk/Keluar, misal "Bank BRI Masuk"), atau satu kolom rekening dengan kolom Masuk dan Keluar terpisah. Pemetaan kolom bisa diubah manual.
  - Tanggal: 2026-01-02, 02/01/2026 (hari dulu), 2 Jan 2026, atau nomor seri Excel. Angka: 1.250.000 atau 1,250,000. File .xlsx belum bisa dibaca langsung: simpan sebagai CSV atau salin-tempel.
  - Hitungannya: total masuk dan keluar tiap rekening dibagi jumlah hari kerja (Senin–Sabtu) di periode yang dipilih, termasuk hari yang tidak ada barisnya. Uang yang tercatat di hari Minggu tetap dijumlahkan.
  - "Keluarkan nilai harian di atas (Rp)" membuang pembayaran besar yang tidak rutin dari rata-rata, dan menampilkan daftarnya supaya bisa dicatat sebagai kejadian.
  - Hasilnya hanya usulan. Tekan "Terapkan ke arus kas rutin", cek angkanya, lalu "Simpan semua". Data riwayat tidak dikirim atau disimpan di mana pun.
- **Skenario** mengalikan seluruh arus rutin dengan persen masuk dan persen keluar (konservatif, dasar, optimis). Kejadian tidak ikut dikali.
- **Kejadian** (pelunasan hutang, piutang besar, gaji) dicatat di tanggalnya dan dibebankan ke rekening yang dipilih. Jangan masukkan hal yang sama ke arus rutin dan ke kejadian.
- Hasilnya: saldo total, saldo per rekening pada tanggal target, grafik per rekening, dan peringatan kalau ada rekening yang saldonya di bawah nol walaupun total masih positif. Uang tidak otomatis pindah antar rekening.
- Saldo nyata lebih bergelombang dari proyeksi rata-rata. Lihat saldo terendah, bukan hanya saldo akhir.
- **Tombol "Simpan semua"** ada di tiap panel (Saldo awal, Arus kas rutin, Skenario, Kejadian). Semuanya memanggil fungsi yang sama dan menyimpan seluruh data, bukan hanya panel tempat tombolnya berada. Tidak ada bilah simpan di bawah layar.
- Data tersimpan sebagai satu versi. Kalau 2 editor menyimpan bersamaan, yang kedua ditolak dan harus muat data terbaru dulu.

## Keamanan – yang perlu lu tahu
- Repo publik = kode publik. Data tetap di Sheet, tidak ada di repo.
- URL Apps Script bisa diakses siapa saja, tapi tanpa nama+PIN tidak dapat data. Akun terkunci 15 menit setelah 5 kali salah.
- Ini PIN, bukan login Google. Cukup untuk data internal kecil, bukan pengganti sistem akses penuh. Pakai PIN unik, jangan sama dengan PIN bank.
- Sheet-nya sendiri jangan dibagikan ke viewer: tab `Pengguna` berisi hash PIN.
- Sesi login 6 jam. Offline: tampil salinan terakhir, tidak bisa edit.
