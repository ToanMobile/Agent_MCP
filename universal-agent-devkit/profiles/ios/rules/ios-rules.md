# 🍏 iOS Native Mobile Engineering Standards & Rules (Swift / SwiftUI)

Quy chuẩn kỹ thuật bắt buộc dành cho AI Agent khi phát triển, tối ưu và sửa lỗi ứng dụng iOS (Swift 6, SwiftUI, Swift Concurrency, XCTest).

---

## 1. Quản Trị Bộ Nhớ & Triệt Tiêu Vòng Lặp Tham Chiếu ARC (Zero Retain Cycles)

1. **Bắt buộc `[weak self]` trong Escaping Closures:**
   - Mọi closure bất đồng bộ, callback mạng (URLSession / Alamofire), Combine pipeline, hoặc completion handler dài hạn **BẮT BUỘC** phải sử dụng capture list `[weak self]` để tránh giữ chặt reference cycle:
     ```swift
     // CHUẨN MỰC:
     viewModel.fetchData { [weak self] result in
         guard let self else { return }
         self.updateUI(with: result)
     }
     ```
   - Tuyệt đối cấm capture strong `self` bên trong closures của NotificationCenter, Timer publisher hoặc async Task sống lâu.
2. **Delegate References Phải Là `weak var`:**
   - Mọi protocol delegate bắt buộc phải kế thừa `AnyObject` và khai báo dưới dạng `weak var delegate: MyDelegate?`.
3. **Giải Phóng Bộ Nhớ Hình Ảnh & Tài Nguyên Nặng:**
   - Bắt buộc kiểm tra và giải phóng UIImage / CGImage lớn khi view biến mất (`viewDidDisappear` hoặc `onDisappear`).
   - Sử dụng `autoreleasepool { ... }` khi xử lý hàng loạt tệp hoặc ảnh trong vòng lặp lớn.

---

## 2. Quản Trị Luồng & Swift Concurrency (@MainActor & Data Race Safety)

1. **Bảo Vệ Giao Diện Trên `@MainActor`:**
   - Mọi lớp ViewModel gắn với UI (hoặc `@Observable` class), hàm cập nhật trạng thái hiển thị, và navigation coordinator bắt buộc phải được gắn nhãn `@MainActor`:
     ```swift
     @MainActor
     @Observable
     final class OrderDetailViewModel {
         var state: ViewState = .idle
         // ...
     }
     ```
2. **Triệt Tiêu Data Race (Swift 6 Concurrency):**
   - Không chia sẻ đối tượng mutable reference type giữa các Task không cùng Actor.
   - Các class chia sẻ đa luồng phải là `actor` hoặc cấu trúc bất biến `struct` tuân thủ `Sendable`.
3. **Structured Concurrency & Hủy Bỏ Tác Vụ (Cancellation):**
   - Ưu tiên sử dụng `async/await` và `withTaskGroup` thay vì callback lồng nhau.
   - Luôn kiểm tra `Task.isCancelled` trong các vòng lặp tính toán nặng hoặc tải dữ liệu để dừng ngay khi người dùng rời màn hình.

---

## 3. Tối Ưu Hóa Hiệu Năng SwiftUI & Tránh Redraw Thừa (Frame Budget 120 FPS)

1. **Ngăn Ngừa Redraw Toàn Bộ View Hierarchy:**
   - Tránh lưu trữ trạng thái khổng lồ trong một biến `@State` duy nhất khiến toàn bộ `body` phải tính toán lại mỗi khi một trường nhỏ thay đổi.
   - Áp dụng macro `@Observable` (iOS 17+) để SwiftUI tự động track chính xác từng thuộc tính riêng lẻ, chỉ vẽ lại đúng View con phụ thuộc.
2. **Giữ Cho `body` Thuần Túy (Pure Computation):**
   - Tuyệt đối **KHÔNG** thực hiện đọc ghi tệp (Disk I/O), tính toán thuật toán nặng $O(N^2)$, hoặc khởi tạo đối tượng phức tạp bên trong `var body: some View`.
   - Mọi phép định dạng ngày tháng (`DateFormatter`) hoặc số tiền (`NumberFormatter`) phải được cache tái sử dụng ở ViewModel / singleton, không khởi tạo mới trong `body`.
3. **Độ Rộng Vùng Chạm & Chống Spam Nút Bấm:**
   - Nút bấm phải có vùng chạm tối thiểu $\ge 44\times 44\text{pt}$ (chuẩn Apple Human Interface Guidelines).
   - Nút bấm kích hoạt giao dịch / thanh toán / ký số bắt buộc phải có biến `isLoading` để disable ngay lập tức sau cú chạm đầu tiên (`.disabled(isLoading)`).

---

## 4. Kỷ Luật Kiểm Thử XCTest & Đo Đạc Rò Rỉ Bộ Nhớ

1. **Paired Executable Oracle Bắt Buộc (XCTest):**
   - Viết bài test thất bại (**RED**) mô phỏng chính xác lỗi logic hoặc crash trước khi sửa code:
     ```bash
     xcodebuild test -scheme AppTests -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:AppTests/OrderTests/testDiscountCalculation_RED
     ```
   - Sửa code tối giản và chạy lại đúng bài test đó để xác nhận thành công (**GREEN**).
2. **Kiểm Tra Rò Rỉ Bộ Nhớ Bằng `leaks` CLI:**
   - Chạy lệnh kiểm tra rò rỉ bộ nhớ trên binary test:
     ```bash
     leaks -atExit -- ./build/Build/Products/Debug-iphonesimulator/App.app/App
     ```
   - Đảm bảo 0 memory leaks, 0 retain cycles được báo cáo.
