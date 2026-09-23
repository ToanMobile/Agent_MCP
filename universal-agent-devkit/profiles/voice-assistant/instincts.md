# Instincts & Failure Memory — Voice Assistant Repository Lessons Learned

> **Quy định Vận hành cho AI Agent trên dự án Trợ lý Giọng nói / Audio AI:**
> Tệp này ghi nhận các "bẫy mã nguồn" (traps), sai lầm trong quá khứ hoặc lỗi hồi quy từng xảy ra trên dự án xử lý giọng nói.
> Trước khi sửa code hoặc đề xuất giải pháp, AI Agent BẮT BUỘC phải đọc lướt qua các bẫy dưới đây để **tuyệt đối không đi vào vết xe đổ**.
> Quy chuẩn gốc: `rules/voice-assistant-rules.md`. Ma trận hồi quy: `regression_matrix.json` (REG-VOICE-01, REG-VOICE-02).

---

## 1. Bẫy Thường Gặp & Bài Học Kinh Nghiệm Voice (Active Instincts)

### [INSTINCT-VOICE-01] Bẫy Thực Thi Lệnh Nguy Hiểm Khi Độ Tin Cậy Thấp
- **Hiện tượng lỗi:** Trợ lý tự gọi điện, gửi tin nhắn hoặc đổi thiết lập khi người dùng chỉ nói bâng quơ hoặc môi trường ồn.
- **Nguyên nhân gốc rễ:** Lấy intent có điểm cao nhất mà không so với ngưỡng tin cậy; không phân biệt tác vụ an toàn và tác vụ có hậu quả.
- **Quy tắc bắt buộc:**
  1. Intent Confidence Score `< 0.85` → hỏi lại hoặc im lặng, KHÔNG thực thi (Graceful Silence over Wrong Execution).
  2. Tác vụ có hậu quả (thanh toán, gọi điện, mở khoá, gửi tin) luôn cần xác nhận rõ ràng.
  3. Có test cho nhánh low-confidence (REG-VOICE-01), không chỉ nhánh happy path.

---

### [INSTINCT-VOICE-02] Bẫy Giữ Micro Khi Mất Audio Focus
- **Hiện tượng lỗi:** Ứng dụng khác (cuộc gọi, điều hướng) không thu được âm; pin tụt vì micro vẫn mở khi app ở background.
- **Nguyên nhân gốc rễ:** Không nhả `AudioRecord`/`MediaRecorder` trong callback mất Audio Focus hoặc khi vòng đời chuyển sang background.
- **Quy tắc bắt buộc:** Nhả micro ngay khi mất focus hoặc vào background; mở lại tường minh khi được cấp focus.

---

### [INSTINCT-VOICE-03] Bẫy Rò Rỉ Bộ Nhớ Bộ Đệm Âm Thanh
- **Hiện tượng lỗi:** RAM tăng đều sau vài phút lắng nghe liên tục rồi crash OOM.
- **Nguyên nhân gốc rễ:** Cộng dồn frame audio vào list/`ByteArrayOutputStream` không giới hạn thay vì bộ đệm vòng cố định.
- **Quy tắc bắt buộc:** Dùng Ring Buffer kích thước cố định; giải phóng đoạn đã xử lý ngay.

---

### [INSTINCT-VOICE-04] Bẫy Tiếng Vọng Tự Kích Hoạt (Thiếu AEC)
- **Hiện tượng lỗi:** Trợ lý nghe lại chính câu trả lời của nó từ loa và tự kích hoạt lệnh tiếp theo.
- **Nguyên nhân gốc rễ:** Vừa phát loa vừa thu micro mà không bật Acoustic Echo Cancellation hoặc không tạm ngắt nhận dạng khi đang phát.
- **Quy tắc bắt buộc:** Bật AEC khi full-duplex; kiểm chứng bằng mẫu WAV thu từ thiết bị thật, không chỉ bằng text.

---

### [INSTINCT-VOICE-05] Bẫy Đo Độ Trễ Sai Mốc
- **Hiện tượng lỗi:** Báo cáo độ trễ "< 300ms" nhưng người dùng vẫn thấy chậm.
- **Nguyên nhân gốc rễ:** Đo từ lúc có transcript cuối thay vì từ End-of-Speech (VAD phát hiện im lặng) tới tín hiệu phản hồi đầu tiên.
- **Quy tắc bắt buộc:** Mốc đo là End-of-Speech → phản hồi đầu tiên; ghi số đo thật từ thiết bị (REG-VOICE-02), không ước lượng.
