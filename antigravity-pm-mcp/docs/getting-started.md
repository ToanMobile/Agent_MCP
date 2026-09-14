# Bắt đầu

## 1. Cài server

```bash
git clone https://github.com/ToanMobile/Agent_MCP.git   # monorepo Agent_MCP, cong cu nay o thu muc antigravity-pm-mcp/
cd Agent_MCP/antigravity-pm-mcp
npm install
npm test        # phải xanh hết (offline)
```

## 2. Nối vào Claude Code

```bash
claude mcp add antigravity-pm --scope user -- node "$PWD/bin/antigravity-pm-mcp.js"
claude mcp list      # phải thấy "antigravity-pm: ✔ Connected"
```

## 3. Khai cấu hình cho project đích

```bash
cp examples/antigravity-pm.minimal.json /duong/dan/project/.antigravity-pm.json
$EDITOR /duong/dan/project/.antigravity-pm.json
```

Ít nhất phải khai `testCommand` và một cách chụp ảnh (`proof.providers`) — thiếu hai thứ này thì cổng nghiệm thu **không bao giờ đạt**, đúng như thiết kế.

Thêm vào `.gitignore` của project đích nếu không muốn commit hồ sơ task:

```gitignore
.antigravity-pm/
```

## 4. Kiểm tra đường dây

```bash
npm run doctor -- /duong/dan/project
```

Hoặc từ trong Claude Code: `pm_doctor { project: "/duong/dan/project" }`.

Muốn chắc chắn đường dây thông cả hai chiều:

```
pm_doctor { project: "...", ping: true }
```

Mở Antigravity, thấy một hội thoại "[PM] ping duong day" trả lời `PONG` rồi `PONG2` ⇒ xong.

!!! warning "Project phải được Antigravity đăng ký một lần"
    `new-conversation` **bắt buộc có project id**. Server lấy id từ sổ đăng ký `~/.gemini/config/projects/`,
    nơi Antigravity tự ghi khi bạn mở project lần đầu. Chưa có ⇒ `pm_dispatch` báo đỏ kèm danh sách project đang có.
    Sau khi tạo hội thoại, server vẫn kiểm lại workspace thật của nó — lưới an toàn để không giao việc nhầm repo.

## 5. Giao task đầu tiên

```
pm_task_create {
  project: "/duong/dan/project",
  title: "Thêm xác nhận khi hạ kính",
  brief: "Hiện trạng: lệnh hạ kính chạy thẳng. Cần: hỏi xác nhận trước khi hạ. Được sửa: WindowController.kt và test của nó. CẤM sửa: AcProgramRunner, VoiceService.",
  definitionOfDone: [
    "Có unit test cho nhánh xác nhận và nhánh huỷ",
    "Không đổi hành vi các lệnh kính khác",
    "Ảnh cho thấy hộp xác nhận hiện trên xe"
  ]
}

pm_plan { taskId: "T0001-them-xac-nhan-khi-ha-kinh", content: "# Kế hoạch\n1. Thêm hộp xác nhận vào WindowController.kt\n2. Thêm test cho nhánh xác nhận và nhánh huỷ" }
pm_dispatch { taskId: "T0001-them-xac-nhan-khi-ha-kinh", kind: "plan_review" }
```

Rồi đi theo [quy trình 7 giai đoạn](workflow.md).

## Mẹo viết `brief` để ít phải trả việc

| Viết thế này | Đừng viết thế này |
| --- | --- |
| "Được sửa: `WindowController.kt`. CẤM sửa: `VoiceService.kt`" | "Sửa cho nó hoạt động" |
| "Ảnh cho thấy hộp xác nhận hiện trên xe" | "Test kỹ" |
| "Hiện trạng: dòng 120 gọi thẳng `setWindow()`" | "Có bug ở phần kính" |
