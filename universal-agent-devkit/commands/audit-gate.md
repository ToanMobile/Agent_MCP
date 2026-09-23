# /audit-gate — Post-Fix Audit & TIA Regression Gate

Chạy cổng kiểm toán sau khi sửa lỗi trên các file thay đổi của dự án (working tree, hoặc `--diff <ref>`).

**Chặn thật (quyết định verdict):**
1. 5 kiểm tra tĩnh bằng regex:
   - bí mật (key/token/password, tên file cấm như `*.jks`, `*.key`, `.env`)
   - placeholder lười biếng (`// ... existing code ...`)
   - anti-pattern hiệu năng
   - nuốt lỗi (`catch {}`, `except: pass`)
   - log thô
2. Test hồi quy TIA với `--run-tests`:
   - Gate chạy thật các lệnh trong `regression_matrix.json`.
   - Lệnh được đọc từ bản đã commit (`HEAD`, hoặc ref của `--diff`), không đọc từ working copy.
   - Nếu matrix hoặc file test đã có bị sửa/xoá trong chính thay đổi, verdict là CHƯA XÁC MINH.

**Chỉ nhắc (gate không xác minh, không ảnh hưởng verdict):**
- DESIGN.md / a11y: gate chỉ kiểm file tồn tại.
- Bằng chứng RED → GREEN.
- Ảnh minh chứng: chỉ tính ảnh trong phiên của chính dự án này.
- Thiết bị qua `adb`.
- Immutable Guards.
- OpenCodeReview (`ocr`).

## Sử dụng
```bash
# Lệnh có sẵn trên PATH sau khi chạy `make install` trong thư mục DevKit
postfix-gate --run-tests

# Nếu chưa có trên PATH: gọi thẳng script trong thư mục DevKit
python3 <DevKit dir>/bin/post-fix-gate.py --run-tests
```

Exit code:
- `0`: PASS. Chỉ exit `0` mới được coi là đạt.
- `1`: REJECT.
- `2`: CHƯA XÁC MINH. Các trường hợp:
  - dry-run;
  - file không đọc được;
  - matrix chưa commit hoặc bị sửa;
  - test đã có bị sửa;
  - không test hồi quy nào khớp (thêm `--allow-no-tests` nếu chấp nhận);
  - `--diff` không hợp lệ.
- `3`: không có thay đổi để kiểm. Các link và state do DevKit cài không tính là thay đổi.

`--record-lesson` chỉ ghi vào `.agents/instincts.md` khi verdict là PASS.
