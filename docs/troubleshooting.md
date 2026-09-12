# Xử lý sự cố

## "Khong thay tien trinh Antigravity language_server nao dang chay"

App Antigravity chưa mở. Server này **điều khiển IDE đang mở**, nó không tự bật IDE.

## "Thay language_server nhung khong cong nao tra loi agentapi"

IDE đang khởi động, hoặc vừa cập nhật phiên bản. Chờ vài giây rồi gọi lại; không đỡ thì khởi động lại Antigravity. Cache cổng tự bị xoá và dò lại khi RPC lỗi.

## "Khong tim thay binary agentapi cua Antigravity"

Mở Antigravity một lần để nó sinh `~/.gemini/antigravity/bin/agentapi`. Cài ở chỗ khác thì trỏ biến `ANTIGRAVITY_PM_AGENTAPI` vào đúng file.

## "Antigravity chua dang ky project ..."

`new-conversation` bắt buộc có project id, mà project của bạn chưa có trong `~/.gemini/config/projects/`. Mở project đó trong app Antigravity **một lần** để nó tự đăng ký, rồi thử lại. Thông báo lỗi có liệt kê các project đang đăng ký để bạn đối chiếu.

Biết chắc id rồi thì khai thẳng:

```json
{ "antigravity": { "projectId": "355fd7f8-...-84b22fbdf41c" } }
```

## "Hoi thoai duoc mo trong workspace X chu KHONG phai Y"

Project id giải ra trỏ tới thư mục khác — thường do sổ đăng ký còn giữ đường dẫn cũ sau khi bạn di chuyển/đổi tên repo. Mở lại project trong Antigravity để nó cập nhật, hoặc khai thẳng `antigravity.projectId` đúng.

Chấp nhận lệch (không khuyến khích): đặt `antigravity.workspaceCheck: "warn"`.

## Agent im lâu, `pm_status` báo "CO THE DANG TREO"

Ba khả năng, theo thứ tự hay gặp:

1. **Đang chờ bạn bấm Accept** trong Antigravity (agent xin phép chạy lệnh) — mở IDE xem. `pm_doctor` in chính sách của project: không phải `EAGER`/`TURBO` thì khả năng này cao nhất
2. Agent đã xong nhưng **quên ghi `result.json`** — kiểm bằng `pm_diff`; nếu code đã sửa thật thì `pm_message` nhắc nó ghi đúng hợp đồng
3. Thật sự treo — `pm_message` một câu ngắn để đánh thức (đo 12/09/2026: `send-message` gọi lại được hội thoại đã im 11 phút, động tĩnh sau ~1,6 giây)

## `pm_run kind=test` báo "Chua khai testCommand"

Đúng như thiết kế: không có lệnh test thật thì không có bằng chứng, và cổng nghiệm thu sẽ không bao giờ đạt. Khai `testCommand` trong `.antigravity-pm.json`, hoặc truyền `command` cho lần chạy này.

## Ảnh nghiệm thu bị cảnh báo "rat co the man hinh dang tat"

Ảnh dưới 8 KB. Với `adb`: màn hình xe/máy ảo đang tắt hoặc đang khoá. Bật màn lên rồi chụp lại — đừng nhận ảnh đen làm bằng chứng.

## "File tao ra khong phai anh PNG/JPEG"

Lệnh chụp in text (thường là thông báo lỗi của `adb`) vào file. Thông báo lỗi có in 200 byte đầu để bạn thấy nó là gì. Kiểm `adb devices` trước.

## macOS không cho chụp màn hình

Cấp quyền Screen Recording cho tiến trình chạy MCP (thường là Terminal/iTerm hoặc chính Claude Code) trong System Settings → Privacy & Security.

## `pm_accept` cứ bị từ chối

Đọc đúng danh sách nó in ra. Bẫy hay gặp nhất: **vừa `pm_rework`** ⇒ audit/review/test/ảnh của vòng trước đều hết hiệu lực, phải làm lại đủ, và `result.json` phải được agent ghi lại sau mốc rework.

## Antigravity cập nhật rồi `agentapi` đổi giao diện

`src/agentapi.js` là chỗ duy nhất cần sửa, và nó cố ý **nổ to** ("CLI noi bo co the da doi") thay vì âm thầm cho qua. Kiểm nhanh:

```bash
~/.gemini/antigravity/bin/agentapi --help
```
