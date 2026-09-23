# Instincts & Failure Memory — iOS Repository Lessons Learned

> **Quy định Vận hành cho AI Agent trên dự án iOS:**
> Tệp này ghi nhận lại các "bẫy mã nguồn" (traps), sai lầm trong quá khứ hoặc lỗi hồi quy từng xảy ra trên dự án iOS / Swift.
> Trước khi sửa code hoặc đề xuất giải pháp, AI Agent BẮT BUỘC phải đọc lướt qua các bẫy dưới đây để **tuyệt đối không đi vào vết xe đổ**.

---

## 1. Bẫy Thường Gặp & Bài Học Kinh Nghiệm iOS (Active Instincts)

### [INSTINCT-IOS-01] Bẫy Rò Rỉ Bộ Nhớ Vòng Lặp Tham Chiếu (Retain Cycle In Closures)
- **Hiện tượng lỗi:** Người dùng mở màn hình chi tiết rồi back ra nhiều lần, bộ nhớ RAM tăng liên tục từ 100MB lên 500MB+ dẫn tới crash OOM (Out Of Memory) hoặc thông báo terminate từ hệ điều hành.
- **Nguyên nhân gốc rễ:** Capture strong `self` trong escaping closures của Network call, Combine sink, NotificationCenter hoặc Timer, làm ViewController / ViewModel không bao giờ được dealloc.
- **Quy tắc bắt buộc:** 
  1. Mọi escaping closure có truy cập thuộc tính của lớp phải dùng `[weak self]` và kiểm tra `guard let self else { return }`.
  2. Mọi delegate protocol phải là `weak var delegate: MyDelegate?`.

---

### [INSTINCT-IOS-02] Bẫy Cập Nhật Giao Diện Ngoài `@MainActor` (Data Race Crash)
- **Hiện tượng lỗi:** Ứng dụng thi thoảng bị crash bí ẩn với lỗi `EXC_BAD_INSTRUCTION` hoặc `Main Thread Checker: UI API called on a background thread` khi cập nhật label hoặc show alert.
- **Nguyên nhân gốc rễ:** Nhận kết quả từ background task hoặc URLSession dataTask rồi gán trực tiếp vào biến state của UI mà không điều phối về Main Thread.
- **Quy tắc bắt buộc:** 
  1. Toàn bộ ViewModel liên kết với SwiftUI View phải được khai báo `@MainActor`.
  2. Bật cờ Strict Concurrency Checking (`-strict-concurrency=complete`) trong build settings của Xcode để bắt lỗi data race ngay lúc compile.

---

### [INSTINCT-IOS-03] Bẫy Tính Toán Nặng Trong SwiftUI `body` Gây Tụt Frame 120 FPS
- **Hiện tượng lỗi:** Màn hình cuộn bị khựng giật (Drop frame xuống 30–45 FPS trên màn hình ProMotion 120Hz).
- **Nguyên nhân gốc rễ:** Khởi tạo `DateFormatter()`, `NumberFormatter()`, gọi hàm sort mảng lớn hoặc đọc UserDefaults trực tiếp bên trong `var body: some View`. Vì SwiftUI gọi lại `body` liên tục mỗi khi state thay đổi, các phép toán này lặp lại hàng trăm lần.
- **Quy tắc bắt buộc:** 
  1. Thuộc tính `body` chỉ chứa khai báo View thuần túy.
  2. Toàn bộ logic định dạng và xử lý dữ liệu phải được tiền xử lý và cache trong ViewModel.

---

### [INSTINCT-IOS-04] Bẫy Xung Đột Luồng CoreData / SwiftData (Concurrency Violation)
- **Hiện tượng lỗi:** Sập app bất ngờ với lỗi `CoreData: Concurrency violation` hoặc `EXC_BAD_ACCESS` khi ghi dữ liệu nền.
- **Nguyên nhân gốc rễ:** Dùng `NSManagedObject` hoặc `ModelContext` tạo từ Main Thread trên background thread mà không gọi `performBackgroundTask` hoặc background context riêng.
- **Quy tắc bắt buộc:** Mỗi thread hoặc background task phải có context riêng biệt; chỉ truyền `NSManagedObjectID` hoặc PersistentIdentifier giữa các luồng.

---

### [INSTINCT-IOS-05] Vùng Chạm Dưới Chuẩn Apple HIG (< 44pt) & Chống Spam Chạm
- **Hiện tượng lỗi:** Nút bấm quá nhỏ, người dùng bấm trượt hoặc bấm 2 lần liên tiếp gây trùng đơn hàng.
- **Nguyên nhân gốc rễ:** Frame nút bấm nhỏ hơn $44\times 44\text{pt}$, không có debounce.
- **Quy tắc bắt buộc:**
  1. Áp dụng `.frame(minWidth: 44, minHeight: 44)` hoặc `.contentShape(Rectangle())` mở rộng vùng chạm.
  2. Khóa tức thì trạng thái nút với `.disabled(isSubmitting)` sau cú chạm đầu tiên.
