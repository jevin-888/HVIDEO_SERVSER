window.currentBillingSessionId = null;
let cashierLanguage = 'zh';
const cashierTranslations = {
    '正在查询账单，请稍候': { id: 'Memuat tagihan, harap tunggu', vi: 'Đang tải hóa đơn, vui lòng chờ', th: 'กำลังโหลดบิล โปรดรอสักครู่', en: 'Loading bill, please wait' },
    '重新查询账单': { id: 'Muat ulang tagihan', vi: 'Tải lại hóa đơn', th: 'โหลดบิลใหม่', en: 'Reload bill' },
    '账单查询失败，请重试': { id: 'Gagal memuat tagihan. Coba lagi.', vi: 'Không tải được hóa đơn. Hãy thử lại.', th: 'โหลดบิลไม่สำเร็จ โปรดลองอีกครั้ง', en: 'Could not load the bill. Please retry.' },
    '账单数据不完整或房间不匹配，请重试': { id: 'Data tagihan tidak lengkap atau kamar tidak cocok. Coba lagi.', vi: 'Dữ liệu hóa đơn thiếu hoặc không đúng phòng. Hãy thử lại.', th: 'ข้อมูลบิลไม่ครบหรือห้องไม่ตรงกัน โปรดลองอีกครั้ง', en: 'Bill data is incomplete or belongs to another room. Please retry.' },
    '账单已结清或不可结账，请返回刷新': { id: 'Tagihan sudah dibayar atau tidak dapat dibayar. Kembali dan segarkan.', vi: 'Hóa đơn đã thanh toán hoặc không thể thanh toán. Hãy quay lại và làm mới.', th: 'บิลชำระแล้วหรือไม่สามารถชำระได้ โปรดกลับไปรีเฟรช', en: 'This bill is settled or unavailable for payment. Go back and refresh.' },
    '密码支持 4–8 位数字或字母，可混合使用。': { id: 'Kata sandi mendukung 4–8 huruf atau angka, termasuk kombinasi keduanya.', vi: 'Mật khẩu gồm 4–8 chữ cái hoặc chữ số, có thể kết hợp cả hai.', th: 'รหัสผ่านรองรับตัวอักษรหรือตัวเลข 4–8 ตัว สามารถใช้ผสมกันได้', en: 'Passwords support 4–8 letters or digits, including a mix of both.' },
    '4–8 位数字或字母': { id: '4–8 huruf atau angka', vi: '4–8 chữ cái hoặc chữ số', th: 'ตัวอักษรหรือตัวเลข 4–8 ตัว', en: '4–8 letters or digits' },
    '请输入新密码（4–8 位数字或字母）': { id: 'Masukkan kata sandi baru (4–8 huruf atau angka)', vi: 'Nhập mật khẩu mới (4–8 chữ cái hoặc chữ số)', th: 'กรอกรหัสผ่านใหม่ (ตัวอักษรหรือตัวเลข 4–8 ตัว)', en: 'Enter new password (4–8 letters or digits)' },
    '密码必须为 4–8 位数字或字母': { id: 'Kata sandi harus terdiri dari 4–8 huruf atau angka', vi: 'Mật khẩu phải gồm 4–8 chữ cái hoặc chữ số', th: 'รหัสผ่านต้องมีตัวอักษรหรือตัวเลข 4–8 ตัว', en: 'Password must contain 4–8 letters or digits' },
    '房间操作': { id: 'Operasi kamar', vi: 'Thao tác phòng', th: 'จัดการห้อง', en: 'Room actions' },
    '实收金额': { id: 'Uang diterima', vi: 'Tiền thực nhận', th: 'จำนวนเงินที่รับ', en: 'Cash received' },
    '按应收金额收款': { id: 'Terima sesuai tagihan', vi: 'Thu đúng số tiền phải trả', th: 'รับเงินตามยอดที่ต้องชำระ', en: 'Receive the amount due' },
    '找零：': { id: 'Kembalian:', vi: 'Tiền thừa:', th: 'เงินทอน:', en: 'Change:' },
    '清空金额': { id: 'Hapus jumlah', vi: 'Xóa số tiền', th: 'ล้างจำนวนเงิน', en: 'Clear amount' },
    '请选择会员': { id: 'Pilih anggota', vi: 'Chọn hội viên', th: 'เลือกสมาชิก', en: 'Select a member' },
    '实收金额不能少于应收金额': { id: 'Uang diterima kurang dari tagihan', vi: 'Tiền nhận không được ít hơn số tiền phải trả', th: 'เงินที่รับต้องไม่น้อยกว่ายอดที่ต้องชำระ', en: 'Cash received must cover the amount due' },
    'HVideo 收银系统': { id: 'Sistem Kasir HVideo', vi: 'Hệ thống thu ngân HVideo', th: 'ระบบแคชเชียร์ HVideo', en: 'HVideo Cashier System' },
    '员工账号登录': { id: 'Login akun karyawan', vi: 'Đăng nhập tài khoản nhân viên', th: 'เข้าสู่ระบบพนักงาน', en: 'Employee login' },
    '登录账号/工号': { id: 'Akun/Nomor karyawan', vi: 'Tài khoản/Mã nhân viên', th: 'บัญชี/รหัสพนักงาน', en: 'Account/Employee No.' },
    '密码': { id: 'Kata sandi', vi: 'Mật khẩu', th: 'รหัสผ่าน', en: 'Password' },
    '登录': { id: 'Masuk', vi: 'Đăng nhập', th: 'เข้าสู่ระบบ', en: 'Log in' },
    '修改密码': { id: 'Ubah kata sandi', vi: 'Đổi mật khẩu', th: 'เปลี่ยนรหัสผ่าน', en: 'Change password' },
    '白班 12:00-00:00': { id: 'Shift siang 12:00-00:00', vi: 'Ca ngày 12:00-00:00', th: 'กะกลางวัน 12:00-00:00', en: 'Day shift 12:00-00:00' },
    '夜班 00:00-12:00': { id: 'Shift malam 00:00-12:00', vi: 'Ca đêm 00:00-12:00', th: 'กะกลางคืน 00:00-12:00', en: 'Night shift 00:00-12:00' },
    '全天班': { id: 'Sehari penuh', vi: 'Cả ngày', th: 'เต็มวัน', en: 'Full day' },
    '收银系统': { id: 'Sistem kasir', vi: 'Hệ thống thu ngân', th: 'ระบบแคชเชียร์', en: 'Cashier' },
    '前台收银': { id: 'Kasir depan', vi: 'Thu ngân', th: 'แคชเชียร์หน้าร้าน', en: 'Front desk' },
    '预定管理': { id: 'Reservasi', vi: 'Quản lý đặt chỗ', th: 'จัดการการจอง', en: 'Reservations' },
    '会员管理': { id: 'Anggota', vi: 'Quản lý hội viên', th: 'จัดการสมาชิก', en: 'Members' },
    '库存管理': { id: 'Persediaan', vi: 'Quản lý kho', th: 'จัดการคลังสินค้า', en: 'Inventory' },
    '财务报表': { id: 'Laporan keuangan', vi: 'Báo cáo tài chính', th: 'รายงานการเงิน', en: 'Finance' },
    '基础设置': { id: 'Pengaturan dasar', vi: 'Cài đặt cơ bản', th: 'การตั้งค่าพื้นฐาน', en: 'Basic settings' },
    '系统管理': { id: 'Manajemen sistem', vi: 'Quản lý hệ thống', th: 'จัดการระบบ', en: 'System' },
    '退出登录': { id: 'Keluar', vi: 'Đăng xuất', th: 'ออกจากระบบ', en: 'Log out' },
    '全部类型': { id: 'Semua tipe', vi: 'Tất cả loại', th: 'ทุกประเภท', en: 'All types' },
    '全部': { id: 'Semua', vi: 'Tất cả', th: 'ทั้งหมด', en: 'All' },
    '区域': { id: 'Area', vi: 'Khu vực', th: 'พื้นที่', en: 'Areas' },
    '结账台': { id: 'Kasir pembayaran', vi: 'Quầy thanh toán', th: 'เคาน์เตอร์ชำระเงิน', en: 'Checkout desk' },
    '搜索房间': { id: 'Cari ruangan', vi: 'Tìm phòng', th: 'ค้นหาห้อง', en: 'Search rooms' },
    '刷新': { id: 'Segarkan', vi: 'Làm mới', th: 'รีเฟรช', en: 'Refresh' },
    '请点击包厢查看点单和账单': { id: 'Klik ruangan untuk melihat pesanan dan tagihan', vi: 'Bấm vào phòng để xem món và hóa đơn', th: 'คลิกห้องเพื่อดูรายการและบิล', en: 'Click a room to view orders and bill' },
    '快捷进入业务子页面': { id: 'Akses cepat ke halaman bisnis', vi: 'Truy cập nhanh trang nghiệp vụ', th: 'เข้าหน้าธุรกิจอย่างรวดเร็ว', en: 'Quick business access' },
    '开房': { id: 'Buka kamar', vi: 'Mở phòng', th: 'เปิดห้อง', en: 'Open room' },
    '打印账单': { id: 'Cetak tagihan', vi: 'In hóa đơn', th: 'พิมพ์บิล', en: 'Print bill' },
    '点单': { id: 'Pesan', vi: 'Gọi món', th: 'สั่งอาหาร', en: 'Order' },
    '结账': { id: 'Bayar', vi: 'Thanh toán', th: 'ชำระเงิน', en: 'Checkout' },
    '现金': { id: 'Tunai', vi: 'Tiền mặt', th: 'เงินสด', en: 'Cash' },
    '微信': { id: 'WeChat', vi: 'WeChat', th: 'WeChat', en: 'WeChat' },
    '支付宝': { id: 'Alipay', vi: 'Alipay', th: 'Alipay', en: 'Alipay' },
    '银行卡': { id: 'Kartu bank', vi: 'Thẻ ngân hàng', th: 'บัตรธนาคาร', en: 'Bank card' },
    '会员余额支付': { id: 'Bayar dengan saldo anggota', vi: 'Thanh toán bằng số dư hội viên', th: 'ชำระด้วยยอดสมาชิก', en: 'Pay with member balance' },
    '总房间': { id: 'Total kamar', vi: 'Tổng số phòng', th: 'ห้องทั้งหมด', en: 'Total rooms' },
    '空闲': { id: 'Kosong', vi: 'Trống', th: 'ว่าง', en: 'Available' },
    '使用': { id: 'Digunakan', vi: 'Đang sử dụng', th: 'กำลังใช้', en: 'In use' },
    '预订': { id: 'Dipesan', vi: 'Đã đặt', th: 'จองแล้ว', en: 'Reserved' },
    '维护': { id: 'Pemeliharaan', vi: 'Bảo trì', th: 'บำรุงรักษา', en: 'Maintenance' },
    '未选择房间': { id: 'Belum memilih kamar', vi: 'Chưa chọn phòng', th: 'ยังไม่ได้เลือกห้อง', en: 'No room selected' },
    '新增预定': { id: 'Tambah reservasi', vi: 'Thêm đặt chỗ', th: 'เพิ่มการจอง', en: 'New reservation' },
    '新增人员': { id: 'Tambah staf', vi: 'Thêm nhân viên', th: 'เพิ่มพนักงาน', en: 'New employee' },
    '预定信息': { id: 'Info reservasi', vi: 'Thông tin đặt chỗ', th: 'ข้อมูลการจอง', en: 'Reservation information' },
    '预定包厢': { id: 'Kamar reservasi', vi: 'Phòng đặt', th: 'ห้องที่จอง', en: 'Reserved room' },
    '预定时间': { id: 'Waktu reservasi', vi: 'Thời gian đặt', th: 'เวลาจอง', en: 'Reservation time' },
    '会员号': { id: 'Nomor anggota', vi: 'Mã hội viên', th: 'หมายเลขสมาชิก', en: 'Member No.' },
    '客人姓名': { id: 'Nama tamu', vi: 'Tên khách', th: 'ชื่อแขก', en: 'Guest name' },
    '联系电话': { id: 'Telepon', vi: 'Điện thoại', th: 'โทรศัพท์', en: 'Phone' },
    '人数': { id: 'Jumlah orang', vi: 'Số người', th: 'จำนวนคน', en: 'Guests' },
    '预付费': { id: 'Uang muka', vi: 'Tiền trả trước', th: 'เงินมัดจำ', en: 'Prepayment' },
    '备注': { id: 'Catatan', vi: 'Ghi chú', th: 'หมายเหตุ', en: 'Notes' },
    '保存预定': { id: 'Simpan reservasi', vi: 'Lưu đặt chỗ', th: 'บันทึกการจอง', en: 'Save reservation' },
    '预定列表': { id: 'Daftar reservasi', vi: 'Danh sách đặt chỗ', th: 'รายการจอง', en: 'Reservation list' },
    '会员列表': { id: 'Daftar anggota', vi: 'Danh sách hội viên', th: 'รายชื่อสมาชิก', en: 'Member list' },
    '卡号': { id: 'Nomor kartu', vi: 'Số thẻ', th: 'หมายเลขบัตร', en: 'Card No.' },
    '会员': { id: 'Anggota', vi: 'Hội viên', th: 'สมาชิก', en: 'Member' },
    '手机号': { id: 'Nomor ponsel', vi: 'Số điện thoại', th: 'เบอร์มือถือ', en: 'Mobile' },
    '级别': { id: 'Level', vi: 'Hạng', th: 'ระดับ', en: 'Level' },
    '余额': { id: 'Saldo', vi: 'Số dư', th: 'ยอดคงเหลือ', en: 'Balance' },
    '积分': { id: 'Poin', vi: 'Điểm', th: 'คะแนน', en: 'Points' },
    '生日': { id: 'Ulang tahun', vi: 'Sinh nhật', th: 'วันเกิด', en: 'Birthday' },
    '保存会员': { id: 'Simpan anggota', vi: 'Lưu hội viên', th: 'บันทึกสมาชิก', en: 'Save member' },
    '商品库存': { id: 'Stok produk', vi: 'Tồn kho sản phẩm', th: 'สต็อกสินค้า', en: 'Product inventory' },
    '商品入库': { id: 'Barang masuk', vi: 'Nhập hàng', th: 'รับสินค้าเข้า', en: 'Stock in' },
    '入库记录': { id: 'Riwayat barang masuk', vi: 'Lịch sử nhập', th: 'ประวัติรับเข้า', en: 'Stock-in records' },
    '出库记录': { id: 'Riwayat barang keluar', vi: 'Lịch sử xuất', th: 'ประวัติจ่ายออก', en: 'Stock-out records' },
    '搜索商品': { id: 'Cari produk', vi: 'Tìm sản phẩm', th: 'ค้นหาสินค้า', en: 'Search products' },
    '低库存阈值': { id: 'Batas stok rendah', vi: 'Ngưỡng tồn thấp', th: 'เกณฑ์สต็อกต่ำ', en: 'Low stock threshold' },
    '查询': { id: 'Cari', vi: 'Tra cứu', th: 'ค้นหา', en: 'Query' },
    '新增商品': { id: 'Tambah produk', vi: 'Thêm sản phẩm', th: 'เพิ่มสินค้า', en: 'New product' },
    '商品名称': { id: 'Nama produk', vi: 'Tên sản phẩm', th: 'ชื่อสินค้า', en: 'Product name' },
    '商品类别': { id: 'Kategori produk', vi: 'Loại sản phẩm', th: 'หมวดสินค้า', en: 'Product category' },
    '销售价格': { id: 'Harga jual', vi: 'Giá bán', th: 'ราคาขาย', en: 'Sale price' },
    '库存': { id: 'Stok', vi: 'Tồn kho', th: 'สต็อก', en: 'Stock' },
    '状态': { id: 'Status', vi: 'Trạng thái', th: 'สถานะ', en: 'Status' },
    '操作': { id: 'Aksi', vi: 'Thao tác', th: 'การดำเนินการ', en: 'Actions' },
    '人员列表': { id: 'Daftar staf', vi: 'Danh sách nhân viên', th: 'รายชื่อพนักงาน', en: 'Employee list' },
    '角色': { id: 'Peran', vi: 'Vai trò', th: 'บทบาท', en: 'Role' },
    '工号': { id: 'Nomor staf', vi: 'Mã nhân viên', th: 'รหัสพนักงาน', en: 'Employee No.' },
    '姓名': { id: 'Nama', vi: 'Tên', th: 'ชื่อ', en: 'Name' },
    '模块权限': { id: 'Izin modul', vi: 'Quyền mô-đun', th: 'สิทธิ์โมดูล', en: 'Module permissions' },
    '保存': { id: 'Simpan', vi: 'Lưu', th: 'บันทึก', en: 'Save' },
    '取消': { id: 'Batal', vi: 'Hủy', th: 'ยกเลิก', en: 'Cancel' },
    '确认': { id: 'Konfirmasi', vi: 'Xác nhận', th: 'ยืนยัน', en: 'Confirm' },
    '关闭': { id: 'Tutup', vi: 'Đóng', th: 'ปิด', en: 'Close' },
    '待处理服务呼叫': { id: 'Panggilan layanan tertunda', vi: 'Yêu cầu dịch vụ đang chờ', th: 'การเรียกบริการที่รอดำเนินการ', en: 'Pending service calls' },
    '暂无待处理呼叫': { id: 'Tidak ada panggilan tertunda', vi: 'Không có yêu cầu đang chờ', th: 'ไม่มีการเรียกที่รอดำเนินการ', en: 'No pending calls' },
};

function cashierTranslationKey(value) {
    const text = String(value ?? '').trim();
    if (Object.prototype.hasOwnProperty.call(cashierTranslations, text)) return text;
    return Object.keys(cashierTranslations).find(key => Object.values(cashierTranslations[key]).includes(text)) || text;
}

function cashierTranslate(value) {
    const key = cashierTranslationKey(value);
    return cashierTranslations[key]?.[cashierLanguage] || key;
}

const cashierTextSources = new WeakMap();
const cashierAttributeSources = new WeakMap();
function translateRemembered(value, previous) {
    const key = previous?.translated === value ? previous.key : cashierTranslationKey(value);
    return { key, translated: cashierTranslations[key]?.[cashierLanguage] || key };
}

function applyCashierLanguage(language = 'zh') {
    cashierLanguage = ['zh', 'id', 'vi', 'th', 'en'].includes(language) ? language : 'zh';
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
        if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) return;
        const value = node.nodeValue.trim();
        const state = translateRemembered(value, cashierTextSources.get(node));
        cashierTextSources.set(node, state);
        const translated = state.translated;
        if (translated !== value && value) node.nodeValue = node.nodeValue.replace(value, translated);
    });
    document.querySelectorAll('input[placeholder], textarea[placeholder], [title], [aria-label]').forEach(element => {
        const states = cashierAttributeSources.get(element) || {};
        for (const attribute of ['placeholder', 'title', 'aria-label']) {
            if (element.hasAttribute(attribute)) {
                states[attribute] = translateRemembered(element.getAttribute(attribute), states[attribute]);
                element.setAttribute(attribute, states[attribute].translated);
            }
        }
        cashierAttributeSources.set(element, states);
    });
    document.documentElement.lang = cashierLanguage === 'zh' ? 'zh-CN' : cashierLanguage;
}

window.hvideoSetLanguage = applyCashierLanguage;
let cashierLanguageObserver;
function watchCashierLanguage() {
    cashierLanguageObserver?.disconnect();
    cashierLanguageObserver = new MutationObserver(() => applyCashierLanguage(cashierLanguage));
    cashierLanguageObserver.observe(document.body, { childList: true, subtree: true });
    applyCashierLanguage(cashierLanguage);
}

let currentEmployee = null;
let currentCashierShift = '白班';
let warehouseInboundProducts = [];
let warehouseInventoryRows = [];
let currentWarehouseOutboundProduct = null;
let warehouseCategoryEditMode = false;
let warehouseLocationEditMode = false;
let warehouseSelectedCategoryId = '';
let warehouseSelectedLocationId = 'main';
let cashierRealtimeSocket = null;
let cashierRealtimeReconnectTimer = null;
let cashierRealtimeRefreshTimer = null;
let cashierRealtimeEnabled = false;
let packageConfigsDraft = [];
let editingPackageConfigIndex = -1;

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = cashierTranslate(message);
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2500);
}

function cashierDialog({ title = '提示', message = '', input = false, defaultValue = '', html = '', wide = false } = {}) {
    return new Promise(resolve => {
        const dialog = document.getElementById('cashier-dialog');
        const titleEl = document.getElementById('cashier-dialog-title');
        const messageEl = document.getElementById('cashier-dialog-message');
        const inputWrap = document.getElementById('cashier-dialog-input-wrap');
        const inputEl = document.getElementById('cashier-dialog-input');
        const panelEl = document.getElementById('cashier-dialog-panel');
        const cancelBtn = document.getElementById('cashier-dialog-cancel');
        const confirmBtn = document.getElementById('cashier-dialog-confirm');
        titleEl.textContent = cashierTranslate(title);
        panelEl.className = `w-full ${wide ? 'max-w-5xl' : 'max-w-md'} bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden`;
        if (html) {
            messageEl.innerHTML = html;
        } else {
            messageEl.textContent = cashierTranslate(message);
        }
        inputWrap.classList.toggle('hidden', !input);
        inputEl.value = defaultValue;
        dialog.classList.remove('hidden');
        dialog.classList.add('flex');
        const close = value => {
            dialog.classList.add('hidden');
            dialog.classList.remove('flex');
            cancelBtn.onclick = null;
            confirmBtn.onclick = null;
            inputEl.onkeydown = null;
            resolve(value);
        };
        cancelBtn.onclick = () => close(input ? null : false);
        confirmBtn.onclick = () => close(input ? inputEl.value : true);
        inputEl.onkeydown = event => {
            if (event.key === 'Enter') confirmBtn.click();
            if (event.key === 'Escape') cancelBtn.click();
        };
        if (input) setTimeout(() => inputEl.focus(), 0);
    });
}

function cashierConfirm(message, title = '确认操作') {
    return cashierDialog({ title, message });
}

function cashierPrompt(message, defaultValue = '', title = '请输入') {
    return cashierDialog({ title, message, input: true, defaultValue });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function formatMoney(value) {
    return `¥${Number(value || 0).toFixed(2)}`;
}

async function cashierRequest(path, options = {}) {
    try {
        return await apiService.request(path, options);
    } catch (error) {
        if ((error.message || '').includes('登录已过期') || (error.message || '').includes('Token')) {
            clearCashierLogin();
        }
        throw error;
    }
}

async function employeeLogin(employee_no, password) {
    if (apiService.detectionPromise) await apiService.detectionPromise;
    const response = await fetch(`${apiService.baseUrl}/auth/employee/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeNo: employee_no, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message || '账号或密码错误');
    }
    return data;
}

async function changeEmployeePassword(employee_no, old_password, new_password) {
    if (apiService.detectionPromise) await apiService.detectionPromise;
    const response = await fetch(`${apiService.baseUrl}/auth/employee/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeNo: employee_no, old_password, new_password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message || '修改密码失败');
    }
    return data;
}

async function openChangePasswordDialog() {
    const employeeNo = await cashierPrompt('请输入工号', document.getElementById('cashier-login-no')?.value || '', '修改密码');
    if (!employeeNo) return;
    const oldPassword = await cashierPrompt('请输入旧密码', '', '修改密码');
    if (!oldPassword) return;
    const newPassword = await cashierPrompt('请输入新密码（4–8 位数字或字母）', '', '修改密码');
    if (!newPassword) return;
    if (!/^[A-Za-z0-9]{4,8}$/.test(newPassword)) return showToast('密码必须为 4–8 位数字或字母');
    try {
        await changeEmployeePassword(employeeNo.trim(), oldPassword, newPassword);
        showToast('密码修改成功，请使用新密码登录');
    } catch (error) {
        showToast(error.message || '修改密码失败');
    }
}

function showPage(page) {
    if (!employeeCanAccessModule(page === 'checkout-desk' ? 'cashier' : page)) return false;
    document.querySelectorAll('.cashier-page').forEach(el => el.classList.add('hidden'));
    document.getElementById(`page-${page}`)?.classList.remove('hidden');
    document.querySelectorAll('.cashier-nav').forEach(btn => {
        btn.classList.remove('bg-red-600');
        btn.classList.add('hover:bg-gray-700');
    });
    const active = document.querySelector(`.cashier-nav[data-page="${page}"]:not([data-warehouse-tab])`);
    if (active) {
        active.classList.add('bg-red-600');
        active.classList.remove('hover:bg-gray-700');
    }
    if (page === 'cashier') loadCashierRooms();
    if (page === 'reservation') loadReservations();
    if (page === 'member') loadMembers();
    if (page === 'warehouse') {
        loadWarehouseInventory();
        switchWarehouseTab('inventory');
    }
    if (page === 'finance') {
        setDefaultFinanceBusinessDay();
        loadFinanceReport();
    }
    if (page === 'checkout-desk') loadCheckoutDesk();
    if (page === 'base-settings') {
        loadBillingBaseSettings();
        loadPrinterConfigs();
    }
    if (page === 'system') loadEmployees();
}

const CASHIER_MODULES = [
    ['cashier', '前台收银'], ['reservation', '预定管理'], ['member', '会员管理'],
    ['warehouse', '库存管理'], ['finance', '财务报表'], ['base-settings', '基础设置'], ['system', '系统管理']
];

function employeeIsAdmin() {
    return currentEmployee?.roleId === 'admin';
}

function employeeModules(employee = currentEmployee) {
    let configured = employee?.extraPermissions || [];
    if (typeof configured === 'string') {
        try { configured = JSON.parse(configured); } catch (_) { configured = []; }
    }
    return Array.isArray(configured) ? configured : [];
}

function employeeCanAccessModule(module) {
    return !!currentEmployee && (employeeIsAdmin() || employeeModules().includes(module));
}

function applyEmployeeModulePermissions() {
    document.querySelectorAll('.cashier-nav[data-page]').forEach(btn => {
        btn.classList.toggle('hidden', !employeeCanAccessModule(btn.dataset.page));
    });
    const active = document.querySelector('.cashier-page:not(.hidden)')?.id.replace('page-', '');
    if (active && employeeCanAccessModule(active)) return;
    document.querySelectorAll('.cashier-page').forEach(page => page.classList.add('hidden'));
    const first = CASHIER_MODULES.find(([id]) => employeeCanAccessModule(id));
    if (first) showPage(first[0]);
    else showToast('当前账号未授权任何模块，请联系管理员');
}

function startCashierRealtimeSync() {
    cashierRealtimeEnabled = true;
    if (cashierRealtimeSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(cashierRealtimeSocket.readyState)) return;
    if (!apiService?.baseUrl) return;
    const wsBase = apiService.baseUrl.replace(/^http/i, 'ws').replace(/\/api\/v1\/?$/, '');
    cashierRealtimeSocket = new WebSocket(`${wsBase}/ws/admin-cashier?client_type=admin`);
    cashierRealtimeSocket.onmessage = event => {
        const data = JSON.parse(event.data || '{}');
        if (data.type === 'cashier_customers_changed') {
            refreshCustomerData().then(() => {
                renderMembers(); renderReservations(); loadCashierRooms(false);
            }).catch(error => showToast(error.message));
            return;
        }
        if (['cashier_room_changed', 'billing_session_opened', 'billing_session_closed', 'billing_session_paid', 'cashier_order_created', 'service_call_new', 'service_call_completed'].includes(data.type)) {
            if (data.type === 'service_call_new' && typeof addCashierServiceCall === 'function') addCashierServiceCall(data.data || data);
            if (data.type === 'service_call_completed' && typeof removeCashierServiceCall === 'function') removeCashierServiceCall(data.data || data);
            scheduleCashierRealtimeRefresh(data);
        }
    };
    cashierRealtimeSocket.onclose = () => {
        cashierRealtimeSocket = null;
        if (!cashierRealtimeEnabled) return;
        if (cashierRealtimeReconnectTimer) clearTimeout(cashierRealtimeReconnectTimer);
        cashierRealtimeReconnectTimer = setTimeout(startCashierRealtimeSync, 3000);
    };
    cashierRealtimeSocket.onerror = () => cashierRealtimeSocket?.close();
}

function scheduleCashierRealtimeRefresh(data = {}) {
    if (cashierRealtimeRefreshTimer) clearTimeout(cashierRealtimeRefreshTimer);
    cashierRealtimeRefreshTimer = setTimeout(async () => {
        if (typeof loadCashierRooms === 'function') await loadCashierRooms(true);
        if (typeof renderReservations === 'function') renderReservations();
        if (!document.getElementById('page-checkout-desk')?.classList.contains('hidden')) await loadCheckoutDesk();
        const currentRoomId = document.getElementById('cashier-room-id')?.value;
        if (currentRoomId && (!data.roomId || String(data.roomId) === String(currentRoomId))) {
            if (typeof loadRoomBill === 'function') loadRoomBill();
        }
    }, 250);
}

function loginWithStoredEmployee() {
    if (window.hvideoDesktop) return false;
    const raw = localStorage.getItem('cashier_employee');
    if (!raw || !apiService.token) {
        clearCashierLogin(false);
        return false;
    }
    try {
        currentEmployee = JSON.parse(raw);
        currentCashierShift = localStorage.getItem('cashier_shift') || '白班';
    } catch (_) {
        return false;
    }
    document.getElementById('cashier-login').classList.add('hidden');
    document.getElementById('cashier-app').classList.remove('hidden');
    document.getElementById('cashier-employee-name').textContent = `${currentEmployee.name || currentEmployee.employeeNo} ${currentCashierShift || '白班'} 已登录`;
    applyEmployeeModulePermissions();
    startCashierRealtimeSync();
    showPage('cashier');
    return true;
}

function clearCashierLogin(reload = true) {
    cashierRealtimeEnabled = false;
    if (cashierRealtimeReconnectTimer) clearTimeout(cashierRealtimeReconnectTimer);
    if (cashierRealtimeSocket) cashierRealtimeSocket.close();
    cashierRealtimeSocket = null;
    if (window.hvideoDesktop) {
        window.hvideoDesktopExpired();
        return;
    }
    apiService.clearToken();
    localStorage.removeItem('cashier_employee');
    localStorage.removeItem('cashier_shift');
    if (reload) location.reload();
}

document.addEventListener('DOMContentLoaded', () => {
    setupCashierDatePickers();
    watchCashierLanguage();
    document.querySelectorAll('.cashier-nav').forEach(btn => btn.addEventListener('click', async () => {
        showPage(btn.dataset.page);
        if (btn.dataset.warehouseTab) {
            btn.classList.add('bg-red-600');
            btn.classList.remove('hover:bg-gray-700');
            await switchWarehouseTab(btn.dataset.warehouseTab);
        }
    }));
    document.getElementById('cashier-logout').addEventListener('click', () => {
        clearCashierLogin(true);
    });
    document.getElementById('cashier-login-form').addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const employee_no = document.getElementById('cashier-login-no').value.trim();
            const password = document.getElementById('cashier-login-password').value;
            const shiftName = document.getElementById('cashier-login-shift')?.value || '白班';
            const res = await employeeLogin(employee_no, password);
            if (res.data?.token) apiService.setToken(res.data.token);
            currentEmployee = res.data.employee;
            currentEmployee.permissions = res.data.permissions || [];
            currentCashierShift = shiftName;
            localStorage.setItem('cashier_employee', JSON.stringify(currentEmployee));
            localStorage.setItem('cashier_shift', currentCashierShift);
            loginWithStoredEmployee();
            showToast('登录成功');
        } catch (error) {
            showToast(error.message || '登录失败');
        }
    });
    loginWithStoredEmployee();
});

function setupCashierDatePickers() {
    document.querySelectorAll('input[type="date"], input[type="datetime-local"]').forEach(input => {
        if (input.dataset.cashierDateBound === '1') return;
        input.dataset.cashierDateBound = '1';
        const field = document.createElement('span');
        field.className = 'cashier-date-field';
        field.style.marginTop = getComputedStyle(input).marginTop;
        input.parentNode.insertBefore(field, input);
        field.appendChild(input);
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'cashier-date-open';
        button.title = '选择日期'; button.setAttribute('aria-label', '选择日期');
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M15 15h2M7 18h2"/></svg>';
        button.addEventListener('click', event => { event.preventDefault(); openCashierDatePicker(input); });
        field.appendChild(button);
        input.addEventListener('click', event => { event.preventDefault(); openCashierDatePicker(input); });
    });
}

function openCashierDatePicker(input) {
    if (input.disabled || input.readOnly) return;
    document.querySelector('.cashier-date-picker')?.remove();
    const isDateTime = input.type === 'datetime-local';
    // Date-only values represent local calendar days, not UTC timestamps.
    const current = input.value ? new Date(isDateTime ? input.value : `${input.value}T00:00`) : new Date();
    let month = new Date(current.getFullYear(), current.getMonth(), 1);
    let selected = new Date(current);
    const overlay = document.createElement('div'); overlay.className = 'cashier-date-picker';
    const panel = document.createElement('div'); panel.className = 'cashier-date-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', '选择日期');
    overlay.appendChild(panel); document.body.appendChild(overlay);
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { overlay.remove(); input.focus(); } });
    const render = () => {
        const year = month.getFullYear(), mon = month.getMonth();
        const firstDay = new Date(year, mon, 1).getDay();
        const days = new Date(year, mon + 1, 0).getDate();
        const locale = { zh: 'zh-CN', id: 'id-ID', vi: 'vi-VN', th: 'th-TH', en: 'en-GB' }[cashierLanguage];
        const weeks = Array.from({ length: 7 }, (_, day) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 0, 4 + day)));
        panel.innerHTML = `<div class="cashier-date-head"><button type="button" data-prev>‹</button><span>${new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", calendar: "gregory" }).format(month)}</span><button type="button" data-next>›</button></div><div class="cashier-date-grid">${weeks.map(day => `<span class="cashier-date-week">${day}</span>`).join('')}</div><div class="cashier-date-grid" data-days></div>${isDateTime ? `<label class="block mt-3 text-sm text-slate-300">时间<input data-time type="time" value="${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}" class="w-full mt-1 px-2 py-2 bg-slate-700 border border-slate-600 rounded text-white"></label>` : ''}<div class="cashier-date-actions"><button type="button" data-cancel>取消</button><button type="button" data-confirm>确定</button></div>`;
        const daysEl = panel.querySelector('[data-days]');
        for (let i = 0; i < firstDay; i++) daysEl.insertAdjacentHTML('beforeend', '<span></span>');
        for (let day = 1; day <= days; day++) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = day;
            button.className = selected.getFullYear() === year && selected.getMonth() === mon && selected.getDate() === day ? 'selected' : '';
            button.addEventListener('click', () => { selected = new Date(year, mon, day, selected.getHours(), selected.getMinutes()); render(); });
            daysEl.appendChild(button);
        }
        panel.querySelector('[data-prev]').onclick = () => { month.setMonth(month.getMonth() - 1); render(); };
        panel.querySelector('[data-next]').onclick = () => { month.setMonth(month.getMonth() + 1); render(); };
        const timeInput = panel.querySelector('[data-time]');
        if (timeInput) {
            timeInput.style.colorScheme = 'dark';
            timeInput.addEventListener('input', () => {
                if (timeInput.value) { const [hour, minute] = timeInput.value.split(':').map(Number); selected.setHours(hour, minute); }
            });
        }
        panel.querySelector('[data-cancel]').onclick = () => overlay.remove();
        panel.querySelector('[data-confirm]').onclick = () => {
            const time = panel.querySelector('[data-time]')?.value;
            if (time) { const [hour, minute] = time.split(':').map(Number); selected.setHours(hour, minute); }
            const date = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`;
            input.value = isDateTime ? `${date}T${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}` : date;
            input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); overlay.remove();
        };
    };
    render();
    panel.querySelector('[data-confirm]').focus();
}

async function quickOpenOrBill(roomId, inUse) {
    selectCashierRoom(roomId);
    if (inUse) await loadRoomBill(); else await openBillingSession();
}

async function openBillingSession() {
    const roomId = document.getElementById('cashier-room-id').value.trim();
    if (!roomId) return showToast('请先选择房间');
    try {
        const billingMode = document.getElementById('open-billing-mode')?.value || 'minute';
        const payTiming = document.getElementById('open-pay-timing')?.value || 'postpaid';
        const prepayAmount = Number(document.getElementById('open-prepay')?.value || 0);
        const timerHours = Number(document.getElementById('open-timer-hours')?.value || 0);
        const timerMinutes = timerHours * 60 + Number(document.getElementById('open-timer-minutes')?.value || 0);
        const timerReminderEnabled = document.getElementById('open-timer-reminder')?.value === '1';
        const payload = { roomId, employee_id: currentEmployee?.id, shiftName: currentCashierShift, billingMode, payTiming, prepayAmount };
        if (billingMode === 'minute' && timerMinutes > 0) {
            payload.timerMinutes = timerMinutes;
            payload.timerReminderEnabled = timerReminderEnabled;
        }
        const res = await cashierRequest('/billing/sessions/open', { method: 'POST', body: JSON.stringify(payload) });
        window.currentBillingSessionId = res.data?.id || null;
        renderBillingSession(res.data);
        showToast('开房成功');
        if (typeof loadCashierRooms === 'function') await loadCashierRooms(true);
        return true;
    } catch (error) {
        showToast(error.message || '开房失败');
    }
}

async function loadRoomBill() {
    const roomId = document.getElementById('cashier-room-id')?.value;
    if (!roomId) return;
    if (typeof getSelectedRoom === 'function' && typeof getCashierRoomState === 'function') {
        const room = getSelectedRoom();
        if (room && getCashierRoomState(room) !== 'using') {
            renderBillingSession(null);
            return;
        }
    }
    try {
        const response = await fetch(`${apiService.baseUrl}/billing/room-bill?roomId=${encodeURIComponent(roomId)}`, {
            headers: apiService.getHeaders()
        });
        if (response.status === 404) {
            const data = await response.json().catch(() => ({}));
            if ((data.message || '').includes('没有活动计费会话')) {
                window.currentBillingSessionId = null;
                renderBillingSession(null);
                return;
            }
            throw new Error(data.message || '账单不存在');
        }
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || `请求失败: ${response.status}`);
        }
        const res = await response.json();
        window.currentBillingSessionId = res.data?.id || null;
        renderBillingSession(res.data);
    } catch (error) {
        const detail = document.getElementById('cashier-room-order-info') || document.getElementById('cashier-bill-detail');
        if (detail) detail.innerHTML = '<div class="text-gray-500">暂无账单，可先开房或点单</div>';
    }
}
async function printRoomBill() {
    const roomId = document.getElementById('cashier-room-id')?.value;
    if (!roomId) return showToast('请先选择房间');
    try {
        const response = await fetch(`${apiService.baseUrl}/billing/room-bill?roomId=${encodeURIComponent(roomId)}`, {
            headers: apiService.getHeaders()
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || '暂无可打印账单');
        }
        const res = await response.json();
        const session = res.data || {};
        window.currentBillingSessionId = session.id || null;
        renderBillingSession(session);

        const room = typeof getSelectedRoom === 'function' ? getSelectedRoom() : null;
        const items = Array.isArray(session.order_items) ? session.order_items : [];
        const totalAmount = Number(session.roomAmount || 0) + Number(session.beverageAmount || 0);
        const prepayAmount = Number(session.prepayAmount || 0);
        const durationText = typeof formatCashierDuration === 'function'
            ? formatCashierDuration(session.startTime, session.endTime || new Date().toISOString())
            : `${session.actual_minutes || session.billed_minutes || 0}分钟`;
        const itemRows = items.length ? items.map(item => {
            const remark = item.remark || ((Number(item.amount || 0) <= 0 && Number(item.price || 0) <= 0) ? '赠送' : '-');
            return `
            <tr>
                <td>${escapeHtml(item.productName || '-')}</td>
                <td class="center">${Number(item.quantity || 0)}</td>
                <td class="right">${formatMoney(item.price || 0)}</td>
                <td class="right">${formatMoney(item.amount || 0)}</td>
                <td class="center">${escapeHtml(remark)}</td>
            </tr>
        `;
        }).join('') : '<tr><td colspan="5" class="center muted">无点单明细</td></tr>';
        const receiptHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>账单打印</title>
<style>
@page{size:80mm auto;margin:1.5mm}
body{font-family:Arial,"Microsoft YaHei",sans-serif;width:77mm;margin:0 auto;color:#111;font-size:12px}
h2{text-align:center;margin:0 0 12px;font-size:20px}
.row{display:flex;justify-content:space-between;border-bottom:1px dashed #ccc;padding:5px 0;gap:8px}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{border-bottom:1px dashed #ccc;padding:6px 2px;text-align:left;word-break:break-all}
.center{text-align:center}.right{text-align:right}.muted{color:#777}
.strong{font-weight:700}
.total{font-size:18px;font-weight:700;margin-top:10px}
@media print{body{width:77mm;margin:0 auto}}
</style>
</head>
<body>
<h2>消费账单</h2>
<div class="row strong"><span>房间</span><span>${escapeHtml(room?.name || session.roomId || roomId)}</span></div>
<div class="row"><span>开始时间</span><span>${escapeHtml(formatFinanceDateTime(session.startTime) || '-')}</span></div>
<div class="row"><span>结束时间</span><span>${escapeHtml(formatFinanceDateTime(session.endTime || new Date().toISOString()) || '-')}</span></div>
<div class="row"><span>消费时长</span><span>${escapeHtml(durationText)}</span></div>
<table>
<thead><tr><th>品名</th><th class="center">数</th><th class="right">单价</th><th class="right">金额</th><th class="center">备注</th></tr></thead>
<tbody>${itemRows}</tbody>
</table>
<div class="row strong"><span>房费</span><span>${formatMoney(session.roomAmount || 0)}</span></div>
<div class="row strong"><span>点单</span><span>${formatMoney(session.beverageAmount || 0)}</span></div>
${prepayAmount > 0 ? `<div class="row strong"><span>预收</span><span>${formatMoney(prepayAmount)}</span></div>` : ''}
<div class="row total"><span>总计</span><span>${formatMoney(totalAmount)}</span></div>
<div class="center muted" style="margin-top:14px">打印时间：${escapeHtml(formatFinanceDateTime(new Date().toISOString()))}</div>
</body>
</html>`;
        if (window.hvideoDesktop && window.hvideoDesktopPrintBill) {
            window.hvideoDesktopPrintBill(receiptHtml);
            return true;
        }
        const printWindow = window.open('', '_blank', 'width=420,height=720');
        if (!printWindow) return showToast('浏览器阻止了打印窗口');
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 300);
    } catch (error) {
        if (window.hvideoDesktop) throw error;
        showToast(error.message || '打印账单失败');
    }
}
window.printRoomBill = printRoomBill;
async function payBillingSession(session) {
    if (!session?.id || session !== checkoutBill) return showToast('账单查询失败，请重试');
    const roomId = String(session.roomId);
    const sessionId = session.id;
    if (!await cashierConfirm('确认完成收款并关闭房间？', '收款确认')) return;
    if (session !== checkoutBill || roomId !== document.getElementById('cashier-room-id')?.value) return;
    try {
        const payment_method = checkoutPaymentMethod === 'member' ? 'member' : (document.getElementById('cashier-pay-method').value || 'cash');
        const res = await cashierRequest(`/billing/sessions/${encodeURIComponent(sessionId)}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod: payment_method, employee_id: currentEmployee?.id, shiftName: currentCashierShift, member_id: payment_method === 'member' ? currentCashierMemberId : null }) });
        resetCheckoutBill();
        renderBillingSession(res.data);
        showToast('结账成功');
        window.currentBillingSessionId = null;
        if (typeof cashierActiveBillsCache !== 'undefined' && res.data?.roomId) delete cashierActiveBillsCache[res.data.roomId];
        if (typeof loadCashierRooms === 'function') await loadCashierRooms(true);
        if (!document.getElementById('page-checkout-desk')?.classList.contains('hidden')) await loadCheckoutDesk();
        return true;
    } catch (error) {
        showToast(error.message || '结账失败');
    }
}

function getCurrentShiftRange() {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    const shift = currentCashierShift || '白班';
    if (shift === '夜班') {
        start.setHours(0, 0, 0, 0);
        end.setHours(12, 0, 0, 0);
        if (now.getHours() >= 12) {
            start.setDate(start.getDate() + 1);
            end.setDate(end.getDate() + 1);
        }
    } else if (shift === '白班') {
        start.setHours(12, 0, 0, 0);
        end.setDate(end.getDate() + 1);
        end.setHours(12, 0, 0, 0);
        if (now.getHours() < 12) start.setDate(start.getDate() - 1);
    } else {
        start.setHours(0, 0, 0, 0);
        end.setHours(24, 0, 0, 0);
    }
    return { shift, start, end };
}

function calcFinanceIncome(record) {
    const room = Number(record.roomAmount || 0);
    const beverage = Number(record.beverageAmount || 0);
    const original = room + beverage;
    const received = Math.min(original, Number(record.prepayAmount || 0) + (Number(record.paidAmount || 0) > 0 ? Number(record.paidAmount || 0) : Number(record.payableAmount || 0)));
    const ratio = original > 0 ? Math.max(0, Math.min(1, received / original)) : 0;
    return { roomIncome: room * ratio, beverageIncome: beverage * ratio };
}

function renderFinanceRows(records, options = {}) {
    const includeExtra = options.includeExtra !== false;
    const rows = (records || []).map(r => {
        const { roomIncome, beverageIncome } = calcFinanceIncome(r);
        return `<tr class="hover:bg-gray-800/80 transition-colors">
            <td class="px-4 py-3 whitespace-nowrap font-mono text-blue-200">${escapeHtml(formatFinanceSerial(r))}</td>
            <td class="px-4 py-3 whitespace-nowrap text-gray-200">${escapeHtml(formatFinanceDateTime(r.checkoutTime || r.endTime || r.startTime))}</td>
            <td class="px-4 py-3 whitespace-nowrap font-bold text-white">${escapeHtml(formatFinanceRoomNo(r))}</td>
            <td class="px-4 py-3 whitespace-nowrap text-right text-emerald-300">${formatMoney(roomIncome)}</td>
            <td class="px-4 py-3 whitespace-nowrap text-right text-yellow-300">${formatMoney(beverageIncome)}</td>
            <td class="px-4 py-3 whitespace-nowrap text-right text-red-300 font-bold">${formatMoney(roomIncome + beverageIncome)}</td>
            <td class="px-4 py-3 whitespace-nowrap text-purple-200">${escapeHtml(r.shiftName || '-')}</td>
            <td class="px-4 py-3 whitespace-nowrap text-gray-200">${escapeHtml(r.cashier_name || '-')}</td>
            ${includeExtra ? `<td class="px-4 py-3 whitespace-nowrap text-gray-300">${escapeHtml(r.waiter_name || '-')}</td><td class="px-4 py-3 whitespace-nowrap text-gray-300">${escapeHtml(r.sales_manager_name || '-')}</td>` : ''}
            <td class="px-4 py-3 whitespace-nowrap text-center"><button onclick="showFinanceDetails('${escapeHtml(r.sessionId)}')" class="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs text-white shadow">查看明细${r.orderCount ? `(${r.orderCount})` : ''}</button></td>
        </tr>`;
    }).join('');
    if (!options.totalRow || !(records || []).length) return rows;
    const totals = (records || []).reduce((acc, record) => {
        const { roomIncome, beverageIncome } = calcFinanceIncome(record);
        acc.roomIncome += roomIncome;
        acc.beverageIncome += beverageIncome;
        return acc;
    }, { roomIncome: 0, beverageIncome: 0 });
    return `${rows}<tr class="bg-gray-900/90 border-t-2 border-blue-700 font-bold">
        <td class="px-4 py-3 text-right text-white" colspan="3">合计</td>
        <td class="px-4 py-3 whitespace-nowrap text-right text-emerald-300">${formatMoney(totals.roomIncome)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right text-yellow-300">${formatMoney(totals.beverageIncome)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right text-red-300">${formatMoney(totals.roomIncome + totals.beverageIncome)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right text-red-300" colspan="${includeExtra ? 5 : 3}">总计：${formatMoney(totals.roomIncome + totals.beverageIncome)}</td>
    </tr>`;
}

async function loadCheckoutDesk() {
    const { shift, start, end } = getCurrentShiftRange();
    const rangeEl = document.getElementById('checkout-desk-range');
    if (rangeEl) rangeEl.textContent = `当前班次：${shift}　${formatFinanceDateTime(start.toISOString())} 至 ${formatFinanceDateTime(end.toISOString())}`;
    const params = new URLSearchParams();
    params.set('start', start.toISOString());
    params.set('end', end.toISOString());
    params.set('shiftName', shift);
    params.set('unreported', 'true');
    try {
        const res = await cashierRequest(`/admin/finance/report?${params.toString()}`);
        const report = res.data || { records: [] };
        document.getElementById('checkout-desk-summary').innerHTML = `<div class="bg-gray-900 p-4 rounded">房费收入：${formatMoney(report.room_income)}</div><div class="bg-gray-900 p-4 rounded">酒水收入：${formatMoney(report.beverage_income)}</div><div class="bg-gray-900 p-4 rounded">总收入：${formatMoney(report.total_income)}</div>`;
        document.getElementById('checkout-desk-records').innerHTML = renderFinanceRows(report.records || [], { includeExtra: false, totalRow: true }) || '<tr><td colspan="9" class="px-4 py-8 text-center text-gray-500">当前班次暂无结账账单</td></tr>';
    } catch (error) {
        showToast(error.message || '加载结账台失败');
    }
}

async function submitShiftReport() {
    const { shift, start, end } = getCurrentShiftRange();
    if (!await cashierConfirm(`确认交班并提交 ${shift} 数据？`, '交班确认')) return;
    try {
        const res = await cashierRequest('/admin/shifts/report', {
            method: 'POST',
            body: JSON.stringify({
                shift_date: formatDateTimeLocal(start).slice(0, 10),
                startTime: start.toISOString(),
                endTime: end.toISOString(),
                employee_id: currentEmployee?.id,
                shiftName: shift
            })
        });
        showToast(`交班成功，总收入${formatMoney(res.data?.total_income || 0)}`);
        setTimeout(() => clearCashierLogin(true), 800);
    } catch (error) {
        showToast(error.message || '交班失败');
    }
}

async function loadFinanceReport() {
    setDefaultFinanceBusinessDay();
    const params = new URLSearchParams();
    const start = document.getElementById('finance-start')?.value;
    const end = document.getElementById('finance-end')?.value;
    const roomId = document.getElementById('finance-room-id')?.value.trim();
    const incomeType = document.getElementById('finance-income-type')?.value;
    if (start) params.set('start', new Date(start).toISOString());
    if (end) params.set('end', new Date(end).toISOString());
    if (roomId) params.set('roomId', roomId);
    if (incomeType) params.set('income_type', incomeType);
    try {
        const res = await cashierRequest(`/admin/finance/report?${params.toString()}`);
        const report = res.data || { records: [] };
        document.getElementById('finance-summary').innerHTML = `<div class="bg-gray-900 p-4 rounded">房费收入：${formatMoney(report.room_income)}</div><div class="bg-gray-900 p-4 rounded">酒水收入：${formatMoney(report.beverage_income)}</div><div class="bg-gray-900 p-4 rounded">总收入：${formatMoney(report.total_income)}</div>`;
        document.getElementById('finance-records').innerHTML = renderFinanceRows(report.records || []) || '<tr><td colspan="11" class="px-4 py-8 text-center text-gray-500">暂无财务记录</td></tr>';
    } catch (error) {
        showToast(error.message || '加载财务报表失败');
    }
}

function setDefaultFinanceBusinessDay() {
    const startEl = document.getElementById('finance-start');
    const endEl = document.getElementById('finance-end');
    if (!startEl || !endEl || startEl.value || endEl.value) return;
    const now = new Date();
    const end = new Date(now);
    end.setHours(12, 0, 0, 0);
    if (now < end) end.setDate(end.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    startEl.value = formatDateTimeLocal(start);
    endEl.value = formatDateTimeLocal(end);
}

function formatDateTimeLocal(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatFinanceSerial(record) {
    if (record.voucherNo) return record.voucherNo;
    const raw = record.checkoutTime || record.endTime || record.startTime;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
        return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
    }
    return String(record.sessionId || '').slice(0, 12);
}

function formatFinanceDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').replace(/\.\d+.*$/, '');
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatFinanceRoomNo(record) {
    const value = record.roomName || record.room_code || record.room_no || record.roomId || '-';
    return String(value).includes('.') ? '-' : value;
}

async function showFinanceDetails(sessionId) {
    try {
        const res = await cashierRequest(`/admin/finance/sessions/${encodeURIComponent(sessionId)}/details`);
        const data = res.data || {};
        const session = data.session || {};
        const items = data.items || [];
        const roomAmount = Number(session.roomAmount || 0);
        const beverageAmount = Number(session.beverageAmount || 0);
        const prepayAmount = Number(session.prepayAmount || 0);
        const discountAmount = Number(session.discountAmount || 0);
        const roundingAmount = Number(session.rounding_amount || 0);
        const payableAmount = Number(session.payableAmount || 0);
        const paidAmount = Number(session.paidAmount || 0);
        const totalAmount = roomAmount + beverageAmount;
        const itemRows = items.length ? items.map(item => `<tr class="border-b border-gray-700">
            <td class="py-2 pr-3 text-gray-200">${escapeHtml(item.productName || '-')}</td>
            <td class="py-2 px-3 text-center text-gray-300">${escapeHtml(formatFinanceDateTime(item.order_time || '-'))}</td>
            <td class="py-2 px-3 text-center text-gray-300">x${escapeHtml(item.quantity || 0)}</td>
            <td class="py-2 px-3 text-center text-gray-300">${escapeHtml(item.unit || '份')}</td>
            <td class="py-2 px-3 text-right text-gray-300">${formatMoney(item.price)}</td>
            <td class="py-2 pl-3 text-right text-yellow-300">${formatMoney(item.amount)}</td>
            <td class="py-2 pl-3 text-center ${item.remark === '赠送' ? 'text-amber-300 font-bold' : 'text-gray-300'}">${escapeHtml(item.remark || '-')}</td>
            <td class="py-2 pl-3 text-center text-gray-300">${escapeHtml(item.operatorName || '-')}</td>
        </tr>`).join('') : '<tr><td colspan="8" class="py-4 text-center text-gray-500">无点单消费明细</td></tr>';
        const html = `<div class="space-y-4 text-sm min-w-[860px] max-w-[1100px]">
            <div class="grid grid-cols-2 gap-3 bg-gray-900/70 rounded p-3">
                <div>流水号：<span class="text-blue-200">${escapeHtml(session.voucherNo || session.id || '-')}</span></div>
                <div>房间：<span class="text-white font-bold">${escapeHtml(data.roomName || session.roomId || '-')}</span></div>
                <div>结账时间：<span class="text-gray-200">${escapeHtml(formatFinanceDateTime(session.paymentTime || session.endTime || session.updatedAt))}</span></div>
                <div>结束时间：<span class="text-blue-300">${escapeHtml(formatFinanceDateTime(session.endTime || session.paymentTime || session.updatedAt))}</span></div>
                <div>收银员：<span class="text-gray-200">${escapeHtml(data.cashier_name || session.operatorEmployeeId || '-')}</span></div>
                <div>班次：<span class="text-purple-200">${escapeHtml(session.shiftName || '-')}</span></div>
                <div>服务员：<span class="text-gray-200">-</span></div>
                <div>销售经理：<span class="text-gray-200">-</span></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="bg-gray-900/70 rounded p-3 space-y-2">
                    <div class="flex justify-between"><span>房间费</span><b class="text-emerald-300">${formatMoney(roomAmount)}</b></div>
                    <div class="flex justify-between"><span>点单费</span><b class="text-yellow-300">${formatMoney(beverageAmount)}</b></div>
                    <div class="flex justify-between border-t border-gray-700 pt-2"><span>消费合计</span><b class="text-white">${formatMoney(totalAmount)}</b></div>
                </div>
                <div class="bg-gray-900/70 rounded p-3 space-y-2">
                    <div class="flex justify-between"><span>预收</span><b class="text-sky-300">${formatMoney(prepayAmount)}</b></div>
                    <div class="flex justify-between"><span>折扣</span><b class="text-orange-300">${formatMoney(discountAmount)}</b></div>
                    <div class="flex justify-between"><span>抹零</span><b class="text-orange-300">${formatMoney(roundingAmount)}</b></div>
                    <div class="flex justify-between border-t border-gray-700 pt-2"><span>应收</span><b class="text-red-300">${formatMoney(payableAmount)}</b></div>
                    <div class="flex justify-between"><span>实收</span><b class="text-red-400">${formatMoney(paidAmount)}</b></div>
                </div>
            </div>
            <div class="bg-gray-900/70 rounded p-3 overflow-x-auto">
                <div class="font-bold text-white mb-2">点单明细</div>
                <table class="min-w-[900px] w-full text-xs">
                    <thead class="text-gray-400 border-b border-gray-700"><tr><th class="py-2 text-left">名称</th><th class="py-2 text-center">落单时间</th><th class="py-2 text-center">数量</th><th class="py-2 text-center">单位</th><th class="py-2 text-right">单价</th><th class="py-2 text-right">合计</th><th class="py-2 text-center">备注</th><th class="py-2 text-center">下单员</th></tr></thead>
                    <tbody>${itemRows}</tbody>
                </table>
            </div>
        </div>`;
        await cashierDialog({ title: '结账台', html, wide: true });
    } catch (error) {
        showToast(error.message || '加载消费明细失败');
    }
}

function billingSettingTextareaId(key) {
    return {
        room_type_rates: 'setting-room-type-rates',
        buyout_periods: 'setting-buyout-periods',
        activity_rules: 'setting-activity-rules',
        package_configs: 'setting-package-configs',
        room_type_gifts: 'setting-room-type-gifts'
    }[key];
}

function showBillingSettingTab(tab) {
    document.querySelectorAll('.billing-setting-panel').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.billingSettingPanel !== tab);
    });
    document.querySelectorAll('.billing-setting-tab').forEach(btn => {
        btn.classList.remove('bg-blue-700', 'text-white');
        btn.classList.add('bg-gray-700', 'text-gray-200');
    });
    const active = document.getElementById(`billing-setting-tab-${tab}`);
    active?.classList.add('bg-blue-700', 'text-white');
    active?.classList.remove('bg-gray-700', 'text-gray-200');
}

function roomTypeSelectHtml(value = '') {
    const options = cashierRoomTypes.map(type => `<option value="${escapeHtml(type.id)}" ${String(type.id) === String(value) ? 'selected' : ''}>${escapeHtml(type.name || type.id)}</option>`).join('');
    return `<select data-field="room_type_id" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1"><option value="">请选择房型</option>${options}</select>`;
}

function productSelectHtml(value = '') {
    const options = cashierProductsCache.map(product => `<option value="${escapeHtml(product.id)}" ${String(product.id) === String(value) ? 'selected' : ''}>${escapeHtml(product.name || product.id)}（库存:${product.stock ?? '-'}）</option>`).join('');
    return `<select data-field="product_id" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1"><option value="">请选择商品</option>${options}</select>`;
}

function weekDaysInputValue(rate = {}) {
    const days = rate.weekdays ?? rate.week_days ?? rate.days_of_week ?? [];
    return Array.isArray(days) ? days.join(',') : String(days || '');
}

function weekDaysSelectHtml(rate = {}) {
    const days = parseWeekdays(weekDaysInputValue(rate));
    return `<input data-field="weekdays" type="hidden" value="${escapeHtml(days.join(','))}">
        <button type="button" onclick="openWeekdaysPicker(this)" class="w-32 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded px-2 py-1 text-left">${escapeHtml(formatWeekdaysLabel(days))}</button>`;
}

function formatWeekdaysLabel(days = []) {
    if (!days.length) return '每天';
    const labels = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const normalized = Array.from(new Set(days.map(Number).filter(day => day >= 1 && day <= 7))).sort((a, b) => a - b);
    const ranges = [];
    for (let index = 0; index < normalized.length; index += 1) {
        const start = normalized[index];
        let end = start;
        while (index + 1 < normalized.length && normalized[index + 1] === end + 1) {
            end = normalized[index + 1];
            index += 1;
        }
        ranges.push(start === end ? cashierTranslate(labels[start]) : `${cashierTranslate(labels[start])} – ${cashierTranslate(labels[end])}`);
    }
    return ranges.join('、');
}

async function openWeekdaysPicker(button) {
    const row = button.closest('tr');
    const input = row?.querySelector('input[data-field="weekdays"]');
    const selected = new Set(parseWeekdays(input?.value).map(String));
    const options = [['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六'], ['7', '周日']];
    const html = `<div class="space-y-2">
        <label class="flex items-center gap-2"><input type="checkbox" value="" id="weekday-all" ${selected.size === 0 ? 'checked' : ''}>每天</label>
        <div class="grid grid-cols-2 gap-2">${options.map(([value, label]) => `<label class="flex items-center gap-2"><input class="weekday-option" type="checkbox" value="${value}" ${selected.has(value) ? 'checked' : ''}>${label}</label>`).join('')}</div>
    </div>`;
    const result = cashierDialog({ title: '选择适用星期', html });
    const all = document.getElementById('weekday-all');
    const choices = [...document.querySelectorAll('.weekday-option')];
    all.onchange = () => { if (all.checked) choices.forEach(item => item.checked = false); };
    choices.forEach(item => item.onchange = () => { all.checked = !choices.some(choice => choice.checked); });
    const ok = await result;
    if (!ok || !input) return;
    const dialog = document.getElementById('cashier-dialog');
    const values = Array.from(dialog.querySelectorAll('.weekday-option:checked')).map(item => item.value);
    input.value = values.join(',');
    button.textContent = formatWeekdaysLabel(values.map(Number));
    syncRoomTypeRatesJson();
}

function renderRoomTypeRateRows(rates = []) {
    const tbody = document.getElementById('setting-room-type-rates-rows');
    if (!tbody) return;
    tbody.innerHTML = rates.map(rate => roomTypeRateRowHtml(rate)).join('');
    syncRoomTypeRatesJson();
}

function roomTypeRateRowHtml(rate = {}) {
    return `<tr class="billing-rate-row">
        <td class="px-3 py-2">${roomTypeSelectHtml(rate.room_type_id ?? '')}</td>
        <td class="px-3 py-2">${weekDaysSelectHtml(rate)}</td>
        <td class="px-3 py-2"><input data-field="start_time" type="time" value="${escapeHtml(rate.start_time ?? '00:00')}" class="w-28 bg-gray-700 border border-gray-600 rounded px-2 py-1"></td>
        <td class="px-3 py-2"><input data-field="end_time" type="time" value="${escapeHtml(rate.end_time ?? '23:59')}" class="w-28 bg-gray-700 border border-gray-600 rounded px-2 py-1"></td>
        <td class="px-3 py-2"><input data-field="normal_price" type="number" value="${escapeHtml(rate.normal_price ?? rate.price ?? '')}" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1"></td>
        <td class="px-3 py-2"><input data-field="holiday_price" type="number" value="${escapeHtml(rate.holiday_price ?? '')}" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1"></td>
        <td class="px-3 py-2"><input data-field="member_price" type="number" value="${escapeHtml(rate.member_price ?? '')}" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1"></td>
        <td class="px-3 py-2"><input data-field="min_minutes" type="number" value="${escapeHtml(rate.min_minutes ?? 60)}" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1"></td>
        <td class="px-3 py-2 text-center"><button onclick="this.closest('tr').remove(); syncRoomTypeRatesJson();" class="bg-red-700 hover:bg-red-600 px-3 py-1 rounded">删除</button></td>
    </tr>`;
}

function addRoomTypeRateRow(rate = {}) {
    const tbody = document.getElementById('setting-room-type-rates-rows');
    tbody.insertAdjacentHTML('beforeend', roomTypeRateRowHtml(rate));
    bindSettingRowInputs(tbody.lastElementChild, syncRoomTypeRatesJson);
    syncRoomTypeRatesJson();
}

function syncRoomTypeRatesJson() {
    const rows = Array.from(document.querySelectorAll('#setting-room-type-rates-rows tr'));
    const rates = rows.map(row => {
        const data = {};
        row.querySelectorAll('[data-field]').forEach(input => {
            if (input.dataset.field === 'weekdays') {
                data.weekdays = input.selectedOptions
                    ? Array.from(input.selectedOptions).map(option => Number(option.value)).filter(day => day >= 1 && day <= 7)
                    : parseWeekdays(input.value);
                return;
            }
            if (input.value === '') return;
            if (input.dataset.field === 'start_time' || input.dataset.field === 'end_time') {
                data[input.dataset.field] = input.value;
                return;
            }
            const value = Number(input.value);
            if (!Number.isNaN(value)) data[input.dataset.field] = value;
        });
        return data;
    }).filter(item => item.room_type_id !== undefined);
    const textarea = document.getElementById('setting-room-type-rates');
    if (textarea) textarea.value = JSON.stringify(rates, null, 2);
    return rates;
}

function parseWeekdays(value) {
    const text = String(value || '').trim();
    if (!text) return [];
    const days = new Set();
    text.split(',').map(part => part.trim()).filter(Boolean).forEach(part => {
        const range = part.match(/^([1-7])\s*-\s*([1-7])$/);
        if (range) {
            const start = Number(range[1]);
            const end = Number(range[2]);
            const min = Math.min(start, end);
            const max = Math.max(start, end);
            for (let day = min; day <= max; day += 1) days.add(day);
            return;
        }
        const day = Number(part);
        if (day >= 1 && day <= 7) days.add(day);
    });
    return Array.from(days).sort((a, b) => a - b);
}

function bindSettingRowInputs(row, syncFn) {
    row?.querySelectorAll('input,select').forEach(input => input.addEventListener('input', syncFn));
    row?.querySelectorAll('select').forEach(input => input.addEventListener('change', syncFn));
}

function settingInputHtml(field, value = '', type = 'text') {
    return `<input data-field="${field}" type="${type}" value="${escapeHtml(value ?? '')}" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1">`;
}

function syncTableJson(tbodyId, textareaId, transformRow) {
    const rows = Array.from(document.querySelectorAll(`#${tbodyId} tr`));
    const value = rows.map(transformRow).filter(Boolean);
    const textarea = document.getElementById(textareaId);
    if (textarea) textarea.value = JSON.stringify(value, null, 2);
    return value;
}

function addBuyoutPeriodRow(item = {}) {
    const tbody = document.getElementById('setting-buyout-periods-rows');
    tbody.insertAdjacentHTML('beforeend', `<tr>
        <td class="px-3 py-2">${settingInputHtml('name', item.name || '')}</td>
        <td class="px-3 py-2">${roomTypeSelectHtml(item.room_type_id ?? '')}</td>
        <td class="px-3 py-2">${settingInputHtml('price', item.price ?? '', 'number')}</td>
        <td class="px-3 py-2">${settingInputHtml('duration_minutes', item.duration_minutes ?? 180, 'number')}</td>
        <td class="px-3 py-2">${settingInputHtml('overtime_rate_per_minute', item.overtime_rate_per_minute ?? 0, 'number')}</td>
        <td class="px-3 py-2 text-center"><button onclick="this.closest('tr').remove(); syncBuyoutPeriodsJson();" class="bg-red-700 hover:bg-red-600 px-3 py-1 rounded">删除</button></td>
    </tr>`);
    bindSettingRowInputs(tbody.lastElementChild, syncBuyoutPeriodsJson);
    syncBuyoutPeriodsJson();
}

function syncBuyoutPeriodsJson() {
    return syncTableJson('setting-buyout-periods-rows', 'setting-buyout-periods', row => {
        const data = getSettingRowData(row);
        if (!data.name && data.room_type_id === undefined && data.price === undefined) return null;
        data.enabled = true;
        return data;
    });
}

function addActivityRuleRow(item = {}) {
    const tbody = document.getElementById('setting-activity-rules-rows');
    tbody.insertAdjacentHTML('beforeend', `<tr>
        <td class="px-3 py-2">${settingInputHtml('name', item.name || '')}</td>
        <td class="px-3 py-2">${roomTypeSelectHtml(item.room_type_id ?? '')}</td>
        <td class="px-3 py-2">${settingInputHtml('fixed_price', item.fixed_price ?? item.price ?? '', 'number')}</td>
        <td class="px-3 py-2">${settingInputHtml('discount', item.discount ?? '', 'number')}</td>
        <td class="px-3 py-2"><select data-field="enabled" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1"><option value="true" ${item.enabled !== false ? 'selected' : ''}>启用</option><option value="false" ${item.enabled === false ? 'selected' : ''}>停用</option></select></td>
        <td class="px-3 py-2 text-center"><button onclick="this.closest('tr').remove(); syncActivityRulesJson();" class="bg-red-700 hover:bg-red-600 px-3 py-1 rounded">删除</button></td>
    </tr>`);
    bindSettingRowInputs(tbody.lastElementChild, syncActivityRulesJson);
    syncActivityRulesJson();
}

function syncActivityRulesJson() {
    return syncTableJson('setting-activity-rules-rows', 'setting-activity-rules', row => {
        const data = getSettingRowData(row);
        if (!data.name && data.room_type_id === undefined && data.fixed_price === undefined && data.discount === undefined) return null;
        return data;
    });
}

function normalizePackageConfig(item = {}) {
    return {
        name: item.name || '未命名套餐',
        room_type_id: item.room_type_id ?? '',
        price: Number(item.price || 0),
        enabled: item.enabled !== false,
        items: Array.isArray(item.items) ? item.items.map(row => ({ product_id: row.product_id || '', quantity: Number(row.quantity || 1) })) : []
    };
}

function renderPackageConfigs() {
    const list = document.getElementById('setting-package-configs-list');
    if (!list) return;
    list.innerHTML = packageConfigsDraft.map((item, index) => {
        const roomType = cashierRoomTypes.find(type => String(type.id) === String(item.room_type_id));
        const content = item.items.length ? item.items.map(row => {
            const product = cashierProductsCache.find(product => String(product.id) === String(row.product_id));
            return `${escapeHtml(product?.name || row.product_id || '未选商品')} x${Number(row.quantity || 1)}`;
        }).join('、') : '<span class="text-amber-300">未配置包含商品</span>';
        return `<div class="border border-gray-700 rounded-lg p-4 bg-gray-950/40">
            <div class="grid grid-cols-1 xl:grid-cols-[18rem_10rem_7rem_7rem_auto] gap-3 items-end">
                <label>套餐名称<input data-package-index="${index}" data-field="name" value="${escapeHtml(item.name)}" class="package-config-input w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-1"></label>
                <label>适用房型<select data-package-index="${index}" data-field="room_type_id" class="package-config-input w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-1"><option value="">全部房型</option>${cashierRoomTypes.map(type => `<option value="${escapeHtml(type.id)}" ${String(type.id) === String(item.room_type_id) ? 'selected' : ''}>${escapeHtml(type.name || type.id)}</option>`).join('')}</select></label>
                <label>套餐价格<input data-package-index="${index}" data-field="price" type="number" value="${escapeHtml(item.price)}" class="package-config-input w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-1"></label>
                <label>状态<select data-package-index="${index}" data-field="enabled" class="package-config-input w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-1"><option value="true" ${item.enabled ? 'selected' : ''}>启用</option><option value="false" ${!item.enabled ? 'selected' : ''}>停用</option></select></label>
                <div class="flex gap-2">
                    <button onclick="editPackageItems(${index})" class="bg-blue-700 hover:bg-blue-600 px-3 py-2 rounded">配置商品</button>
                    <button onclick="deletePackageConfig(${index})" class="bg-red-700 hover:bg-red-600 px-3 py-2 rounded">删除</button>
                </div>
            </div>
            <div class="mt-3 text-sm text-gray-300">包含：${content}</div>
        </div>`;
    }).join('') || '<div class="text-gray-500 text-center py-8 border border-dashed border-gray-700 rounded">暂无套餐，请点击新增套餐</div>';
    list.querySelectorAll('.package-config-input').forEach(input => input.addEventListener('input', updatePackageConfigField));
    list.querySelectorAll('select.package-config-input').forEach(input => input.addEventListener('change', updatePackageConfigField));
    syncPackageConfigsJson();
}

function updatePackageConfigField(event) {
    const index = Number(event.target.dataset.packageIndex);
    const field = event.target.dataset.field;
    if (!packageConfigsDraft[index]) return;
    if (field === 'price') packageConfigsDraft[index][field] = Number(event.target.value || 0);
    else if (field === 'enabled') packageConfigsDraft[index][field] = event.target.value === 'true';
    else packageConfigsDraft[index][field] = event.target.value;
    syncPackageConfigsJson();
}

function addPackageConfig(item = {}) {
    packageConfigsDraft.push(normalizePackageConfig(item));
    renderPackageConfigs();
}

function deletePackageConfig(index) {
    packageConfigsDraft.splice(index, 1);
    if (editingPackageConfigIndex === index) closePackageItemEditor();
    renderPackageConfigs();
}

function editPackageItems(index) {
    editingPackageConfigIndex = index;
    const editor = document.getElementById('setting-package-item-editor');
    const title = document.getElementById('setting-package-item-editor-title');
    if (title) title.textContent = `套餐包含商品：${packageConfigsDraft[index]?.name || '-'}`;
    editor?.classList.remove('hidden');
    renderPackageItemRows();
}

function closePackageItemEditor() {
    editingPackageConfigIndex = -1;
    document.getElementById('setting-package-item-editor')?.classList.add('hidden');
}

function renderPackageItemRows() {
    const tbody = document.getElementById('setting-package-items-rows');
    const packageItem = packageConfigsDraft[editingPackageConfigIndex];
    if (!tbody || !packageItem) return;
    tbody.innerHTML = packageItem.items.map((item, index) => `<tr>
        <td class="px-3 py-2">${productSelectHtml(item.product_id).replace('data-field="product_id"', `data-package-item-index="${index}" data-field="product_id"`)}</td>
        <td class="px-3 py-2"><input data-package-item-index="${index}" data-field="quantity" type="number" value="${escapeHtml(item.quantity || 1)}" class="package-item-input w-full bg-gray-700 border border-gray-600 rounded px-2 py-1"></td>
        <td class="px-3 py-2 text-center"><button onclick="deletePackageItemRow(${index})" class="bg-red-700 hover:bg-red-600 px-3 py-1 rounded">删除</button></td>
    </tr>`).join('') || '<tr><td colspan="3" class="py-6 text-center text-gray-500">暂无包含商品</td></tr>';
    tbody.querySelectorAll('input,select').forEach(input => input.addEventListener('input', updatePackageItemField));
    tbody.querySelectorAll('select').forEach(input => input.addEventListener('change', updatePackageItemField));
    syncPackageConfigsJson();
}

function updatePackageItemField(event) {
    const packageItem = packageConfigsDraft[editingPackageConfigIndex];
    const item = packageItem?.items?.[Number(event.target.dataset.packageItemIndex)];
    if (!item) return;
    if (event.target.dataset.field === 'quantity') item.quantity = Number(event.target.value || 1);
    else item[event.target.dataset.field] = event.target.value;
    renderPackageConfigs();
    editPackageItems(editingPackageConfigIndex);
}

function addPackageItemRow() {
    const packageItem = packageConfigsDraft[editingPackageConfigIndex];
    if (!packageItem) return;
    packageItem.items.push({ product_id: '', quantity: 1 });
    renderPackageItemRows();
    renderPackageConfigs();
}

function deletePackageItemRow(index) {
    const packageItem = packageConfigsDraft[editingPackageConfigIndex];
    if (!packageItem) return;
    packageItem.items.splice(index, 1);
    renderPackageItemRows();
    renderPackageConfigs();
}

function syncPackageConfigsJson() {
    const textarea = document.getElementById('setting-package-configs');
    const value = packageConfigsDraft.map(normalizePackageConfig);
    if (textarea) textarea.value = JSON.stringify(value, null, 2);
    return value;
}

function addRoomTypeGiftRow(item = {}) {
    const tbody = document.getElementById('setting-room-type-gifts-rows');
    const productId = item.product_id || item.gifts?.[0]?.product_id || '';
    const quantity = item.quantity ?? item.gifts?.[0]?.quantity ?? 1;
    tbody.insertAdjacentHTML('beforeend', `<tr>
        <td class="px-3 py-2">${roomTypeSelectHtml(item.room_type_id ?? '')}</td>
        <td class="px-3 py-2">${productSelectHtml(productId)}</td>
        <td class="px-3 py-2">${settingInputHtml('quantity', quantity, 'number')}</td>
        <td class="px-3 py-2 text-center"><button onclick="this.closest('tr').remove(); syncRoomTypeGiftsJson();" class="bg-red-700 hover:bg-red-600 px-3 py-1 rounded">删除</button></td>
    </tr>`);
    bindSettingRowInputs(tbody.lastElementChild, syncRoomTypeGiftsJson);
    syncRoomTypeGiftsJson();
}

function syncRoomTypeGiftsJson() {
    const flat = syncTableJson('setting-room-type-gifts-rows', 'setting-room-type-gifts', row => {
        const data = getSettingRowData(row);
        if (data.room_type_id === undefined || !data.product_id) return null;
        return data;
    });
    const grouped = [];
    flat.forEach(item => {
        let group = grouped.find(row => row.room_type_id === item.room_type_id);
        if (!group) {
            group = { room_type_id: item.room_type_id, gifts: [] };
            grouped.push(group);
        }
        group.gifts.push({ product_id: item.product_id, quantity: item.quantity || 1 });
    });
    document.getElementById('setting-room-type-gifts').value = JSON.stringify(grouped, null, 2);
    return grouped;
}

function getSettingRowData(row) {
    const data = {};
    row.querySelectorAll('[data-field]').forEach(input => {
        if (input.value === '') return;
        if (input.dataset.field === 'enabled') {
            data[input.dataset.field] = input.value === 'true';
        } else if (input.dataset.field === 'room_type_id') {
            const value = Number(input.value);
            if (!Number.isNaN(value)) data[input.dataset.field] = value;
        } else if (input.type === 'number') {
            const value = Number(input.value);
            if (!Number.isNaN(value)) data[input.dataset.field] = value;
        } else {
            data[input.dataset.field] = input.value.trim();
        }
    });
    return data;
}

async function loadBillingBaseSettings() {
    try {
        if (!cashierRoomTypes.length || !cashierProductsCache.length) {
            const [typesResp, productsResp] = await Promise.all([
                cashierRequest('/rooms/configs/types'),
                cashierRequest('/products')
            ]);
            if (!cashierRoomTypes.length) cashierRoomTypes = typesResp.data || [];
            if (!cashierProductsCache.length) cashierProductsCache = productsResp.data || [];
        }
        const [res, padOrderingStatusRes] = await Promise.all([
            cashierRequest('/admin/billing-settings'),
            cashierRequest('/admin/pad-ordering/status')
        ]);
        const settings = {};
        (res.data || []).forEach(item => settings[item.key] = item.value);
        const store = settings.store_info || {};
        document.getElementById('setting-store-name').value = store.name || '';
        document.getElementById('setting-store-phone').value = store.phone || '';
        document.getElementById('setting-store-address').value = store.address || '';
        document.getElementById('setting-store-receipt-footer').value = store.receipt_footer || '';
        const business = settings.business_hours || { start: '12:00', end: '12:00' };
        document.getElementById('setting-business-start').value = normalizeHalfHourTime(business.start || '12:00');
        document.getElementById('setting-business-end').value = normalizeHalfHourTime(business.end || '12:00');
        bindBusinessHourInputs();
        const trial = settings.trial_singing || { enabled: true, minutes: 15, allow_free_checkout: true };
        document.getElementById('setting-trial-enabled').value = String(trial.enabled !== false);
        document.getElementById('setting-trial-minutes').value = trial.minutes ?? 15;
        document.getElementById('setting-trial-free').value = String(trial.allow_free_checkout !== false);
        document.getElementById('setting-pad-ordering-enabled').value = String(padOrderingStatusRes.data?.enabled === true);
        renderHolidayDates((settings.holiday_dates || []).map(item => typeof item === 'string' ? item : item.date).filter(Boolean));
        renderRoomTypeRateRows(settings.room_type_rates || []);
        document.querySelectorAll('#setting-room-type-rates-rows tr').forEach(row => bindSettingRowInputs(row, syncRoomTypeRatesJson));
        document.getElementById('setting-buyout-periods-rows').innerHTML = '';
        (settings.buyout_periods || []).forEach(item => addBuyoutPeriodRow(item));
        document.getElementById('setting-activity-rules-rows').innerHTML = '';
        (settings.activity_rules || []).forEach(item => addActivityRuleRow(item));
        packageConfigsDraft = (settings.package_configs || []).map(normalizePackageConfig);
        closePackageItemEditor();
        renderPackageConfigs();
        document.getElementById('setting-room-type-gifts-rows').innerHTML = '';
        (settings.room_type_gifts || []).forEach(group => (group.gifts || []).forEach(gift => addRoomTypeGiftRow({ room_type_id: group.room_type_id, product_id: gift.product_id, quantity: gift.quantity })));
        syncBuyoutPeriodsJson();
        syncActivityRulesJson();
        syncPackageConfigsJson();
        syncRoomTypeGiftsJson();
    } catch (error) {
        if ((error.message || '').includes('404')) {
            showToast('基础设置接口不存在，请重启后端服务后再试');
            return;
        }
        showToast(error.message || '加载基础数据设置失败');
    }
}

async function saveBillingSetting(key, value) {
    await cashierRequest(`/admin/billing-settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value })
    });
}

function normalizeHalfHourTime(value, fallback = '12:00') {
    const match = String(value || '').match(/^(\d{1,2}):(\d{1,2})/);
    if (!match) return fallback;
    const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
    const minute = Number(match[2]) >= 30 ? 30 : 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function bindBusinessHourInputs() {
    ['setting-business-start', 'setting-business-end'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.dataset.halfHourBound === '1') return;
        el.dataset.halfHourBound = '1';
        el.addEventListener('change', () => {
            el.value = normalizeHalfHourTime(el.value || '12:00');
        });
    });
}

async function saveBusinessHoursSetting() {
    try {
        const startEl = document.getElementById('setting-business-start');
        const endEl = document.getElementById('setting-business-end');
        const start = normalizeHalfHourTime(startEl.value || '12:00');
        const end = normalizeHalfHourTime(endEl.value || '12:00');
        startEl.value = start;
        endEl.value = end;
        await saveBillingSetting('business_hours', {
            start,
            end
        });
        showToast('营业时间已保存');
    } catch (error) {
        showToast(error.message || '保存营业时间失败');
    }
}

async function saveStoreInfoSetting() {
    try {
        await saveBillingSetting('store_info', {
            name: document.getElementById('setting-store-name').value.trim(),
            phone: document.getElementById('setting-store-phone').value.trim(),
            address: document.getElementById('setting-store-address').value.trim(),
            receipt_footer: document.getElementById('setting-store-receipt-footer').value.trim()
        });
        showToast('门店信息已保存');
    } catch (error) {
        showToast(error.message || '保存门店信息失败');
    }
}
window.saveStoreInfoSetting = saveStoreInfoSetting;

async function loadPrinterConfigs() {
    const list = document.getElementById('setting-printer-list');
    if (!list) return;
    try {
        const res = await cashierRequest('/admin/printers');
        const printers = res.data || [];
        list.innerHTML = printers.length ? `
            <div class="border border-gray-700 rounded overflow-hidden">
                ${printers.map(item => `
                    <div class="grid grid-cols-5 gap-2 px-3 py-2 border-b border-gray-700 last:border-b-0 bg-gray-950/40 items-center">
                        <div class="font-bold text-white">${escapeHtml(item.name)}</div>
                        <div>${escapeHtml(item.printerType)}</div>
                        <div class="font-mono text-xs">${escapeHtml(item.address)}</div>
                        <div>${Number(item.enabled) === 1 ? '<span class="text-emerald-300">启用</span>' : '<span class="text-gray-500">停用</span>'}</div>
                        <div class="flex gap-2 justify-end">
                            <button onclick="editPrinterConfig('${escapeHtml(item.id)}', '${escapeHtml(item.name)}', '${escapeHtml(item.printerType)}', '${escapeHtml(item.address)}', ${Number(item.enabled)})" class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">修改</button>
                            <button onclick="togglePrinterConfig('${escapeHtml(item.id)}', '${escapeHtml(item.name)}', '${escapeHtml(item.printerType)}', '${escapeHtml(item.address)}', ${Number(item.enabled)})" class="px-2 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-xs">${Number(item.enabled) === 1 ? '停用' : '启用'}</button>
                            <button onclick="deletePrinterConfig('${escapeHtml(item.id)}')" class="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs">删除</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : '<div class="text-gray-500">暂无打印机配置</div>';
    } catch (error) {
        list.innerHTML = '<div class="text-red-400">加载打印机配置失败</div>';
    }
}

async function savePrinterConfig() {
    const id = document.getElementById('setting-printer-name')?.dataset.editingId || '';
    const name = document.getElementById('setting-printer-name')?.value.trim();
    const printer_type = document.getElementById('setting-printer-type')?.value || 'browser';
    const address = document.getElementById('setting-printer-address')?.value.trim() || 'default';
    if (!name) return showToast('请输入打印机名称');
    try {
        await cashierRequest(id ? `/admin/printers/${encodeURIComponent(id)}` : '/admin/printers', {
            method: id ? 'PUT' : 'POST',
            body: JSON.stringify({ name, printerType: printer_type, address, enabled: id ? Number(document.getElementById('setting-printer-name').dataset.editingEnabled ?? 1) : 1 })
        });
        delete document.getElementById('setting-printer-name').dataset.editingId;
        delete document.getElementById('setting-printer-name').dataset.editingEnabled;
        const saveButton = document.getElementById('setting-printer-save-btn');
        if (saveButton) saveButton.textContent = '新增打印机';
        document.getElementById('setting-printer-name').value = '';
        document.getElementById('setting-printer-address').value = '';
        showToast(id ? '打印机配置已修改' : '打印机配置已保存');
        await loadPrinterConfigs();
    } catch (error) {
        showToast(error.message || '保存打印机配置失败');
    }
}

function editPrinterConfig(id, name, printer_type, address, enabled) {
    document.getElementById('setting-printer-name').dataset.editingEnabled = String(enabled);
    document.getElementById('setting-printer-name').dataset.editingId = id;
    document.getElementById('setting-printer-name').value = name;
    document.getElementById('setting-printer-type').value = printer_type;
    document.getElementById('setting-printer-address').value = address;
    const saveButton = document.getElementById('setting-printer-save-btn');
    if (saveButton) saveButton.textContent = '保存修改';
}

async function togglePrinterConfig(id, name, printer_type, address, enabled) {
    try {
        await cashierRequest(`/admin/printers/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify({ name, printerType: printer_type, address, enabled: Number(enabled) === 1 ? 0 : 1 })
        });
        showToast(Number(enabled) === 1 ? '打印机已停用' : '打印机已启用');
        await loadPrinterConfigs();
    } catch (error) {
        showToast(error.message || '更新打印机失败');
    }
}

async function deletePrinterConfig(id) {
    if (!await cashierConfirm('确定删除这个打印机配置吗？', '删除打印机')) return;
    try {
        await cashierRequest(`/admin/printers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('打印机已删除');
        await loadPrinterConfigs();
    } catch (error) {
        showToast(error.message || '删除打印机失败');
    }
}
window.savePrinterConfig = savePrinterConfig;
window.editPrinterConfig = editPrinterConfig;
window.togglePrinterConfig = togglePrinterConfig;
window.deletePrinterConfig = deletePrinterConfig;

async function saveHolidayDatesSetting() {
    try {
        const dates = [...document.querySelectorAll('#setting-holiday-date-list [data-holiday-date]')]
            .map(item => item.dataset.holidayDate).filter(Boolean).sort();
        await saveBillingSetting('holiday_dates', dates);
        showToast('节假日已保存');
    } catch (error) {
        showToast(error.message || '保存节假日失败');
    }
}

function renderHolidayDates(dates) {
    const unique = [...new Set((dates || []).map(String).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
    const list = document.getElementById('setting-holiday-date-list');
    const hidden = document.getElementById('setting-holiday-dates');
    if (!list || !hidden) return;
    hidden.value = unique.join('\n');
    list.innerHTML = unique.length ? unique.map(date => `<span class="holiday-date-chip" data-holiday-date="${date}">${date}<button type="button" aria-label="删除 ${date}" onclick="removeHolidayDate('${date}')" class="text-red-300 hover:text-red-100">×</button></span>`).join('') : '<span class="text-gray-500 text-sm">尚未配置日期，周六和周日仍按节假日规则处理。</span>';
}

function addHolidayDate() {
    const input = document.getElementById('setting-holiday-date-input');
    if (!input?.value) return showToast('请选择节假日日期');
    const dates = [...document.querySelectorAll('#setting-holiday-date-list [data-holiday-date]')].map(item => item.dataset.holidayDate);
    renderHolidayDates([...dates, input.value]);
    input.value = '';
}

function removeHolidayDate(date) {
    const dates = [...document.querySelectorAll('#setting-holiday-date-list [data-holiday-date]')].map(item => item.dataset.holidayDate).filter(item => item !== date);
    renderHolidayDates(dates);
}
window.addHolidayDate = addHolidayDate;
window.removeHolidayDate = removeHolidayDate;

async function saveTrialSingingSetting() {
    try {
        await saveBillingSetting('trial_singing', {
            enabled: document.getElementById('setting-trial-enabled').value === 'true',
            minutes: Number(document.getElementById('setting-trial-minutes').value || 0),
            allow_free_checkout: document.getElementById('setting-trial-free').value === 'true'
        });
        showToast('试唱设置已保存');
    } catch (error) {
        showToast(error.message || '保存试唱设置失败');
    }
}

async function savePadOrderingStatus() {
    try {
        await cashierRequest('/admin/pad-ordering/status', {
            method: 'PUT',
            body: JSON.stringify({
                enabled: document.getElementById('setting-pad-ordering-enabled').value === 'true'
            })
        });
        showToast('PAD 点单设置已保存');
    } catch (error) {
        showToast(error.message || '保存 PAD 点单设置失败');
    }
}
window.savePadOrderingStatus = savePadOrderingStatus;

async function saveJsonBillingSetting(key) {
    try {
        if (key === 'room_type_rates') syncRoomTypeRatesJson();
        if (key === 'buyout_periods') syncBuyoutPeriodsJson();
        if (key === 'activity_rules') syncActivityRulesJson();
        if (key === 'package_configs') syncPackageConfigsJson();
        if (key === 'room_type_gifts') syncRoomTypeGiftsJson();
        const el = document.getElementById(billingSettingTextareaId(key));
        const value = JSON.parse(el.value || '[]');
        const saved = await saveBillingSetting(key, value);
        if (key === 'room_type_rates') {
            renderRoomTypeRateRows(saved?.data?.value || value);
            document.querySelectorAll('#setting-room-type-rates-rows tr').forEach(row => bindSettingRowInputs(row, syncRoomTypeRatesJson));
        }
        showToast('设置已保存');
    } catch (error) {
        const settingName = {
            room_type_rates: '房型价格',
            buyout_periods: '买断时段',
            activity_rules: '活动设置',
            package_configs: '套餐配置',
            room_type_gifts: '开房赠品'
        }[key] || key;
        if ((error.message || '').includes('404')) {
            showToast(`${settingName}保存失败：基础设置接口不存在，请重启后端服务`);
            return;
        }
        if ((error.message || '').includes('不支持的基础设置项')) {
            showToast(`${settingName}保存失败：后端未识别配置项 ${key}，请重启后端服务或确认已更新`);
            return;
        }
        showToast(`${settingName}保存失败：${error.message || '请检查设置内容'}`);
    }
}

async function loadWarehouseInventory() {
    const table = document.getElementById('warehouse-inventory-table');
    if (!table) return;
    await loadWarehouseMeta();
    const params = new URLSearchParams();
    const keyword = document.getElementById('warehouse-keyword')?.value.trim();
    const lowStock = document.getElementById('warehouse-low-stock')?.value;
    if (keyword) params.set('keyword', keyword);
    if (lowStock) params.set('low_stock', lowStock);
    ensureWarehouseProductFormReady();
    try {
        const res = await cashierRequest(`/admin/warehouse/inventory?${params.toString()}`);
        warehouseInventoryRows = res.data || [];
        const rows = warehouseInventoryRows.filter(item => !warehouseSelectedCategoryId || item.categoryId === warehouseSelectedCategoryId).filter(item => warehouseSelectedLocationId === 'main' || hasWarehouseLocationStockRecord(item, warehouseSelectedLocationId));
        table.innerHTML = rows.length ? rows.map(item => `<tr class="odd:bg-gray-900/20 even:bg-gray-800/30 hover:bg-gray-700/40 text-gray-200">
            <td class="px-4 py-3">${escapeHtml(item.productCode || item.id)}</td>
            <td class="px-4 py-3">${escapeHtml(item.name)}</td>
            <td class="px-4 py-3">${escapeHtml(item.categoryName)}</td>
            <td class="px-4 py-3">${escapeHtml(formatWarehouseDateTime(item.inboundTime))}</td>
            <td class="px-4 py-3">${escapeHtml(item.expiryDate || '-')}</td>
            <td class="px-4 py-3 text-right">${formatMoney(item.price)}</td>
            <td class="px-4 py-3 text-right font-semibold">${warehouseSelectedLocationId === 'main' ? item.stock : getWarehouseLocationStock(item, warehouseSelectedLocationId)}</td>
            <td class="px-4 py-3 text-center">${Number(item.enabled) === 1 ? '<span class="inline-flex px-2 py-1 rounded bg-emerald-900/60 text-emerald-300 text-xs">启用</span>' : '<span class="inline-flex px-2 py-1 rounded bg-gray-700 text-gray-300 text-xs">停用</span>'}</td>
            <td class="px-4 py-3 text-center"><div class="flex justify-center gap-2"><button onclick="openWarehouseOutbound('${escapeHtml(item.id)}')" class="bg-orange-600 hover:bg-orange-500 px-3 py-1 rounded text-xs">出库</button>${isWarehouseAdmin() ? `<button onclick="deleteWarehouseProduct('${escapeHtml(item.id)}')" class="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs">删除</button>` : ''}</div></td>
        </tr>`).join('') : `<tr><td colspan="9" class="px-4 py-6 text-center text-gray-400">${warehouseSelectedLocationId === 'main' ? '暂无库存数据' : '当前库房暂无调拨商品'}</td></tr>`;
    } catch (error) {
        table.innerHTML = '<tr><td colspan="9" class="px-4 py-6 text-center text-red-400">加载库存失败</td></tr>';
    }
}

function openWarehouseOutbound(productId) {
    currentWarehouseOutboundProduct = warehouseInventoryRows.find(item => item.id === productId);
    if (!currentWarehouseOutboundProduct) return showToast('商品不存在');
    const locations = (window.warehouseLocations || []).filter(item => String(item.id) !== 'main');
    if (!locations.length) return showToast('请先维护二级库房');
    document.getElementById('warehouse-outbound-code').value = nextWarehouseOutboundCode();
    document.getElementById('warehouse-outbound-product-name').value = `${currentWarehouseOutboundProduct.name}（库存：${currentWarehouseOutboundProduct.stock}）`;
    document.getElementById('warehouse-outbound-quantity').value = '1';
    document.getElementById('warehouse-outbound-location').innerHTML = '<option value="">请选择目标库房</option>' + locations.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    document.getElementById('warehouse-outbound-time').value = currentWarehouseDateTimeLocalValue();
    document.getElementById('warehouse-outbound-operator').value = currentEmployee?.name || currentEmployee?.employeeNo || currentEmployee?.id || '当前操作员';
    document.getElementById('warehouse-outbound-remark').value = '';
    document.getElementById('warehouse-outbound-panel').classList.remove('hidden');
}

async function deleteWarehouseProduct(productId) {
    if (!await cashierConfirm('确定删除这个商品吗？有库存或有库存流水的商品不能删除。', '删除商品')) return;
    try {
        await cashierRequest(`/admin/warehouse/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
        showToast('商品已删除');
        await loadWarehouseInventory();
        await loadWarehouseInboundProducts();
    } catch (error) {
        showToast(error.message || '删除商品失败');
    }
}

function isWarehouseAdmin() {
    return currentEmployee?.roleId === 'admin';
}

function cancelWarehouseOutbound() {
    currentWarehouseOutboundProduct = null;
    document.getElementById('warehouse-outbound-panel')?.classList.add('hidden');
}

async function submitWarehouseOutbound() {
    if (!currentWarehouseOutboundProduct) return showToast('请选择出库商品');
    const quantity = Number(document.getElementById('warehouse-outbound-quantity').value || 0);
    const target_location_id = document.getElementById('warehouse-outbound-location').value;
    const reference_no = document.getElementById('warehouse-outbound-code').value.trim() || nextWarehouseOutboundCode();
    const outbound_time = document.getElementById('warehouse-outbound-time').value || currentWarehouseDateTimeLocalValue();
    const target = (window.warehouseLocations || []).find(item => item.id === target_location_id);
    const remark = document.getElementById('warehouse-outbound-remark').value.trim() || (target ? `出库到${target.name}` : '商品出库');
    if (!Number.isInteger(quantity) || quantity <= 0) return showToast('请输入正确的出库数量');
    if (quantity > Number(currentWarehouseOutboundProduct.stock || 0)) return showToast('出库数量不能超过当前库存');
    if (!target_location_id) return showToast('请选择目标库房');
    try {
        await cashierRequest(`/admin/warehouse/products/${encodeURIComponent(currentWarehouseOutboundProduct.id)}/out`, { method: 'POST', body: JSON.stringify({ quantity, referenceNo: reference_no, targetLocationId: target_location_id, outbound_time, operatorId: currentEmployee?.id, remark }) });
        showToast('出库完成');
        cancelWarehouseOutbound();
        await loadWarehouseInventory();
        await loadWarehouseOutboundRecords();
    } catch (error) { showToast(error.message || '出库失败'); }
}

async function loadWarehouseOutboundRecords() {
    const tbody = document.getElementById('warehouse-outbound-records');
    if (!tbody) return;
    try {
        const res = await cashierRequest('/admin/warehouse/transactions?transactionType=out&limit=100');
        const rows = res.data || [];
        tbody.innerHTML = rows.length ? rows.map(item => `<tr class="hover:bg-gray-800/60">
            <td class="px-3 py-2">${escapeHtml(item.referenceNo || '-')}</td>
            <td class="px-3 py-2">${escapeHtml(formatWarehouseDateTime(item.inboundTime || item.createdAt))}</td>
            <td class="px-3 py-2">${escapeHtml(item.productName || '-')}</td>
            <td class="px-3 py-2 text-right">${item.quantity}</td>
            <td class="px-3 py-2">${escapeHtml(item.targetLocationName || item.targetLocationId || '-')}</td>
            <td class="px-3 py-2">${escapeHtml(item.operatorName || item.operatorId || '-')}</td>
            <td class="px-3 py-2">${escapeHtml(item.remark || '-')}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="px-3 py-4 text-center text-gray-400">暂无出库记录</td></tr>';
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-4 text-center text-red-400">加载出库记录失败</td></tr>';
    }
}

async function loadWarehouseInboundRecords() {
    const tbody = document.getElementById('warehouse-inbound-records');
    if (!tbody) return;
    try {
        const [stockInRes, initialRes] = await Promise.all([
            cashierRequest('/admin/warehouse/transactions?transactionType=in&limit=100'),
            cashierRequest('/admin/warehouse/transactions?transactionType=initial&limit=100')
        ]);
        const rows = [...(stockInRes.data || []), ...(initialRes.data || [])].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 100);
        tbody.innerHTML = rows.length ? rows.map(item => `<tr class="hover:bg-gray-800/60">
            <td class="px-3 py-2">${escapeHtml(item.referenceNo || '-')}</td>
            <td class="px-3 py-2">${escapeHtml(formatWarehouseDateTime(item.inboundTime || item.createdAt))}</td>
            <td class="px-3 py-2">${escapeHtml(item.productName || '-')}</td>
            <td class="px-3 py-2 text-right">${item.quantity}</td>
            <td class="px-3 py-2">${escapeHtml(item.operatorName || item.operatorId || '-')}</td>
            <td class="px-3 py-2">${escapeHtml(item.remark || '-')}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="px-3 py-4 text-center text-gray-400">暂无入库记录</td></tr>';
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-3 py-4 text-center text-red-400">加载入库记录失败</td></tr>';
    }
}

async function toggleWarehouseOutboundRecords() {
    await switchWarehouseTab('outbound');
}

async function switchWarehouseTab(tab) {
    const inventoryPanel = document.getElementById('warehouse-inventory-panel');
    const inboundFormPanel = document.getElementById('warehouse-inbound-form-panel');
    const inboundPanel = document.getElementById('warehouse-inbound-record-panel');
    const outboundPanel = document.getElementById('warehouse-outbound-record-panel');
    const inventoryTab = document.getElementById('warehouse-tab-inventory');
    const inboundFormTab = document.getElementById('warehouse-tab-inbound-form');
    const inboundTab = document.getElementById('warehouse-tab-inbound');
    const outboundTab = document.getElementById('warehouse-tab-outbound');
    if (!inventoryPanel || !inboundFormPanel || !inboundPanel || !outboundPanel) return;
    const isInventory = tab === 'inventory';
    const isInboundForm = tab === 'inbound-form';
    const isInbound = tab === 'inbound';
    const isOutbound = tab === 'outbound';
    inventoryPanel.classList.toggle('hidden', !isInventory);
    inboundFormPanel.classList.toggle('hidden', !isInboundForm);
    inboundPanel.classList.toggle('hidden', !isInbound);
    outboundPanel.classList.toggle('hidden', !isOutbound);
    inventoryTab?.classList.toggle('border-blue-500', isInventory);
    inventoryTab?.classList.toggle('text-blue-300', isInventory);
    inventoryTab?.classList.toggle('border-transparent', !isInventory);
    inventoryTab?.classList.toggle('text-gray-400', !isInventory);
    inboundFormTab?.classList.toggle('border-blue-500', isInboundForm);
    inboundFormTab?.classList.toggle('text-blue-300', isInboundForm);
    inboundFormTab?.classList.toggle('border-transparent', !isInboundForm);
    inboundFormTab?.classList.toggle('text-gray-400', !isInboundForm);
    inboundTab?.classList.toggle('border-blue-500', isInbound);
    inboundTab?.classList.toggle('text-blue-300', isInbound);
    inboundTab?.classList.toggle('border-transparent', !isInbound);
    inboundTab?.classList.toggle('text-gray-400', !isInbound);
    outboundTab?.classList.toggle('border-blue-500', isOutbound);
    outboundTab?.classList.toggle('text-blue-300', isOutbound);
    outboundTab?.classList.toggle('border-transparent', !isOutbound);
    outboundTab?.classList.toggle('text-gray-400', !isOutbound);
    if (isInboundForm) await loadWarehouseInbound();
    if (isInbound) await loadWarehouseInboundRecords();
    if (isOutbound) await loadWarehouseOutboundRecords();
}

async function loadWarehouseInbound() {
    await loadWarehouseMeta();
    await loadWarehouseInboundProducts();
    setupWarehouseInboundForm();
    if (!document.getElementById('warehouse-inbound-time')?.value) {
        document.getElementById('warehouse-inbound-time').value = currentWarehouseDateTimeLocalValue();
    }
    if (!document.getElementById('warehouse-inbound-code')?.value) {
        document.getElementById('warehouse-inbound-code').value = nextWarehouseInboundCode();
    }
    const operatorEl = document.getElementById('warehouse-inbound-operator');
    if (operatorEl) operatorEl.value = currentEmployee?.name || currentEmployee?.employeeNo || currentEmployee?.id || '当前操作员';
}

async function loadWarehouseMeta() {
    const [categoriesResp, locationsResp] = await Promise.all([
        cashierRequest('/admin/warehouse/categories').catch(() => ({ data: [] })),
        cashierRequest('/admin/warehouse/locations').catch(() => ({ data: [] }))
    ]);
    window.warehouseCategories = categoriesResp.data || [];
    window.warehouseLocations = locationsResp.data || [];
    renderWarehouseCategoryTags();
    renderWarehouseLocationTags();
    const inboundCategory = document.getElementById('warehouse-inbound-category');
    if (inboundCategory) inboundCategory.innerHTML = '<option value="">全部类别</option>' + window.warehouseCategories.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    const productCategory = document.getElementById('warehouse-new-product-category');
    if (productCategory) productCategory.innerHTML = '<option value="">请选择类别</option>' + window.warehouseCategories.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
}

function renderWarehouseCategoryTags() {
    const categoryList = document.getElementById('warehouse-category-list');
    const editBtn = document.getElementById('warehouse-category-edit-btn');
    if (editBtn) editBtn.textContent = warehouseCategoryEditMode ? '保存' : '编辑';
    if (!categoryList) return;
    const allTag = warehouseCategoryEditMode ? '' : `<button onclick="filterWarehouseCategory('')" class="px-2 py-1 rounded ${warehouseSelectedCategoryId ? 'bg-gray-700' : 'bg-blue-900/60 text-blue-200'}">全部</button>`;
    const tags = (window.warehouseCategories || []).map(item => {
        if (warehouseCategoryEditMode) {
            return `<span class="relative inline-flex items-center px-2 py-1 pr-6 rounded bg-gray-700">${escapeHtml(item.name)}<button onclick="deleteWarehouseCategory('${escapeHtml(item.id)}')" class="absolute -right-1 -top-1 bg-red-600 hover:bg-red-500 text-white rounded-full w-4 h-4 text-[10px] leading-4">×</button></span>`;
        }
        return `<button onclick="filterWarehouseCategory('${escapeHtml(item.id)}')" class="px-2 py-1 rounded ${warehouseSelectedCategoryId === item.id ? 'bg-blue-900/60 text-blue-200' : 'bg-gray-700 hover:bg-gray-600'}">${escapeHtml(item.name)}</button>`;
    }).join('');
    categoryList.innerHTML = allTag + (tags || '<span class="text-gray-500">暂无类别</span>');
}

function renderWarehouseLocationTags() {
    const locationList = document.getElementById('warehouse-location-list');
    const editBtn = document.getElementById('warehouse-location-edit-btn');
    if (editBtn) editBtn.textContent = warehouseLocationEditMode ? '保存' : '编辑';
    if (!locationList) return;
    const tags = (window.warehouseLocations || []).map(item => {
        const baseClass = Number(item.isDefault) === 1 ? 'bg-blue-900/60 text-blue-200' : 'bg-gray-700';
        if (warehouseLocationEditMode && Number(item.isDefault) !== 1) {
            return `<span class="relative inline-flex items-center px-2 py-1 pr-6 rounded ${baseClass}">${escapeHtml(item.name)}<button onclick="deleteWarehouseLocation('${escapeHtml(item.id)}')" class="absolute -right-1 -top-1 bg-red-600 hover:bg-red-500 text-white rounded-full w-4 h-4 text-[10px] leading-4">×</button></span>`;
        }
        return `<button onclick="filterWarehouseLocation('${escapeHtml(item.id)}')" class="px-2 py-1 rounded ${warehouseSelectedLocationId === item.id ? 'bg-blue-900/60 text-blue-200' : `${baseClass} hover:bg-gray-600`}">${escapeHtml(item.name)}</button>`;
    }).join('');
    locationList.innerHTML = tags || '<span class="text-gray-500">暂无库房</span>';
}

function toggleWarehouseCategoryEdit() {
    warehouseCategoryEditMode = !warehouseCategoryEditMode;
    renderWarehouseCategoryTags();
}

function toggleWarehouseLocationEdit() {
    warehouseLocationEditMode = !warehouseLocationEditMode;
    renderWarehouseLocationTags();
}

function filterWarehouseLocation(locationId) {
    warehouseSelectedLocationId = locationId || 'main';
    loadWarehouseInventory();
}

function getWarehouseLocationStock(item, locationId) {
    const row = (item.location_stocks || []).find(stock => stock.locationId === locationId);
    return Number(row?.stock || 0);
}

function hasWarehouseLocationStockRecord(item, locationId) {
    return (item.location_stocks || []).some(stock => stock.locationId === locationId);
}

function filterWarehouseCategory(categoryId) {
    warehouseSelectedCategoryId = categoryId;
    loadWarehouseInventory();
}

async function deleteWarehouseCategory(id) {
    if (!await cashierConfirm('确定删除这个商品类别吗？已被商品使用的类别不能删除。', '删除类别')) return;
    try {
        await cashierRequest(`/admin/warehouse/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('类别已删除');
        if (warehouseSelectedCategoryId === id) warehouseSelectedCategoryId = '';
        await loadWarehouseMeta();
        await loadWarehouseInventory();
    } catch (error) { showToast(error.message || '删除类别失败'); }
}

async function deleteWarehouseLocation(id) {
    if (!await cashierConfirm('确定删除这个二级库房吗？有库存的库房不能删除。', '删除库房')) return;
    try {
        await cashierRequest(`/admin/warehouse/locations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('库房已删除');
        await loadWarehouseMeta();
    } catch (error) { showToast(error.message || '删除库房失败'); }
}

async function createWarehouseCategory() {
    const input = document.getElementById('warehouse-category-name');
    const name = input?.value.trim();
    if (!name) return showToast('请输入商品类别名称');
    try {
        await cashierRequest('/admin/warehouse/categories', { method: 'POST', body: JSON.stringify({ name }) });
        input.value = '';
        await loadWarehouseMeta();
        showToast('类别已添加');
    } catch (error) { showToast(error.message || '添加类别失败'); }
}

async function createWarehouseLocation() {
    const input = document.getElementById('warehouse-location-name');
    const name = input?.value.trim();
    if (!name) return showToast('请输入二级库房名称');
    try {
        await cashierRequest('/admin/warehouse/locations', { method: 'POST', body: JSON.stringify({ name }) });
        input.value = '';
        await loadWarehouseMeta();
        showToast('库房已添加');
    } catch (error) { showToast(error.message || '添加库房失败'); }
}

function ensureWarehouseProductFormReady() {
    const codeEl = document.getElementById('warehouse-new-product-code');
    if (codeEl && !codeEl.value) codeEl.value = nextWarehouseProductCode();
}

function resetWarehouseProductForm() {
    document.getElementById('warehouse-new-product-code').value = nextWarehouseProductCode();
    document.getElementById('warehouse-new-product-name').value = '';
    document.getElementById('warehouse-new-product-price').value = '';
    document.getElementById('warehouse-new-product-image').value = '';
    document.getElementById('warehouse-new-product-stock').value = '0';
}

async function createWarehouseProduct() {
    const product_code = document.getElementById('warehouse-new-product-code')?.value.trim() || nextWarehouseProductCode();
    const name = document.getElementById('warehouse-new-product-name')?.value.trim();
    const category_id = document.getElementById('warehouse-new-product-category')?.value;
    const price = Number(document.getElementById('warehouse-new-product-price')?.value || 0);
    const image_url = document.getElementById('warehouse-new-product-image')?.value.trim();
    const initial_stock = Number(document.getElementById('warehouse-new-product-stock')?.value || 0);
    if (!name) return showToast('请输入商品名称');
    if (!category_id) return showToast('请选择商品类别');
    if (!Number.isFinite(price) || price < 0) return showToast('请输入正确的销售价格');
    if (!Number.isInteger(initial_stock) || initial_stock < 0) return showToast('请输入正确的期初数量');
    try {
        await cashierRequest('/admin/warehouse/products', { method: 'POST', body: JSON.stringify({ productCode: product_code, name, categoryId: category_id, price, imageUrl: image_url || null, initial_stock, operatorId: currentEmployee?.id }) });
        showToast('商品已新增');
        resetWarehouseProductForm();
        await loadWarehouseInventory();
    } catch (error) { showToast(error.message || '新增商品失败'); }
}

async function loadWarehouseInboundProducts() {
    const select = document.getElementById('warehouse-inbound-product');
    if (!select) return;
    const res = await cashierRequest('/admin/warehouse/inventory');
    warehouseInboundProducts = res.data || [];
    renderWarehouseInboundProductOptions();
    renderWarehouseInboundCurrentStock();
}

function renderWarehouseInboundProductOptions() {
    const select = document.getElementById('warehouse-inbound-product');
    const categoryId = document.getElementById('warehouse-inbound-category')?.value || '';
    if (!select) return;
    const rows = warehouseInboundProducts.filter(item => !categoryId || item.categoryId === categoryId);
    select.innerHTML = '<option value="">请选择商品</option>' + rows.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.productCode || item.id)} - ${escapeHtml(item.name)}（库存：${item.stock}）</option>`).join('');
}

function setupWarehouseInboundForm() {
    const form = document.getElementById('warehouse-inbound-form');
    const select = document.getElementById('warehouse-inbound-product');
    const categorySelect = document.getElementById('warehouse-inbound-category');
    if (categorySelect && !categorySelect.dataset.bound) {
        categorySelect.addEventListener('change', () => {
            renderWarehouseInboundProductOptions();
            renderWarehouseInboundCurrentStock();
        });
        categorySelect.dataset.bound = '1';
    }
    if (select && !select.dataset.bound) {
        select.addEventListener('change', renderWarehouseInboundCurrentStock);
        select.dataset.bound = '1';
    }
    if (form && !form.dataset.bound) {
        form.addEventListener('submit', submitWarehouseInbound);
        form.dataset.bound = '1';
    }
}

function renderWarehouseInboundCurrentStock() {
    const box = document.getElementById('warehouse-inbound-current-stock');
    const productId = document.getElementById('warehouse-inbound-product')?.value;
    const product = warehouseInboundProducts.find(item => item.id === productId);
    box.innerHTML = product ? `当前商品：${escapeHtml(product.name)}，当前库存：${product.stock}` : '请选择需要入库的商品';
}

async function submitWarehouseInbound(event) {
    event.preventDefault();
    const productId = document.getElementById('warehouse-inbound-product').value;
    const quantity = Number(document.getElementById('warehouse-inbound-quantity').value || 0);
    const inboundCode = document.getElementById('warehouse-inbound-code').value.trim() || nextWarehouseInboundCode();
    const reference_no = inboundCode;
    const inbound_time = document.getElementById('warehouse-inbound-time').value || null;
    const expiry_date = document.getElementById('warehouse-expiry-date').value || null;
    const documentNo = document.getElementById('warehouse-inbound-reference').value.trim();
    const remark = [documentNo ? `单据号：${documentNo}` : '', document.getElementById('warehouse-inbound-remark').value.trim() || '收银端入库'].filter(Boolean).join('；');
    if (!productId) return showToast('请选择入库商品');
    if (!Number.isFinite(quantity) || quantity <= 0) return showToast('入库数量必须大于 0');
    try {
        await cashierRequest(`/admin/warehouse/products/${encodeURIComponent(productId)}/in`, { method: 'POST', body: JSON.stringify({ quantity, referenceNo: reference_no, inboundTime: inbound_time, expiryDate: expiry_date, operatorId: currentEmployee?.id, remark }) });
        showToast('入库成功');
        resetWarehouseInboundForm();
        await loadWarehouseInboundProducts();
    } catch (error) {
        showToast(error.message || '入库失败');
    }
}

function resetWarehouseInboundForm() {
    document.getElementById('warehouse-inbound-product').value = '';
    document.getElementById('warehouse-inbound-category').value = '';
    document.getElementById('warehouse-inbound-code').value = nextWarehouseInboundCode();
    document.getElementById('warehouse-inbound-time').value = currentWarehouseDateTimeLocalValue();
    document.getElementById('warehouse-expiry-date').value = '';
    document.getElementById('warehouse-inbound-quantity').value = '';
    document.getElementById('warehouse-inbound-reference').value = '';
    document.getElementById('warehouse-inbound-remark').value = '';
    renderWarehouseInboundCurrentStock();
}

function formatWarehouseDateTime(value) {
    if (!value) return '-';
    return String(value).replace('T', ' ').slice(0, 16);
}

function currentWarehouseDateTimeLocalValue() {
    const now = new Date();
    now.setSeconds(0, 0);
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function nextWarehouseInboundCode() {
    const now = new Date();
    const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const key = `warehouse_inbound_seq_${prefix}`;
    const next = Number(localStorage.getItem(key) || 1000) + 1;
    localStorage.setItem(key, String(next));
    return `${prefix}${next}`;
}

function nextWarehouseOutboundCode() {
    const now = new Date();
    const prefix = `CK${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const key = `warehouse_outbound_seq_${prefix}`;
    const next = Number(localStorage.getItem(key) || 1000) + 1;
    localStorage.setItem(key, String(next));
    return `${prefix}${next}`;
}

function nextWarehouseProductCode() {
    const now = new Date();
    const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const key = `warehouse_product_seq_${prefix}`;
    const next = Number(localStorage.getItem(key) || 1000) + 1;
    localStorage.setItem(key, String(next));
    return `${prefix}${next}`;
}
