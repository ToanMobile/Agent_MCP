---
name: unity-gc-audit
description: Kiểm toán và triệt tiêu cấp phát bộ nhớ rác (Garbage Collection - GC Allocation) trong Unity 6, hướng tới Zero-GC per frame trong Update loop. Tự động kích hoạt khi chỉnh sửa C# scripts, game loop, physics update, LINQ trong game, hoặc khi phát hiện game bị khựng (GC Spike Freeze / Hitching).
---

# Unity C# Zero-GC Allocation & Memory Leak Audit

Kỹ năng chuyên sâu kiểm toán mã nguồn C# trong Unity 6, triệt tiêu triệt để các hành vi cấp phát bộ nhớ rác (GC Alloc) trong vòng lặp từng khung hình, loại bỏ hiện tượng khựng game do Garbage Collector dọn dẹp bộ nhớ (GC Spikes).

## Nguyên Tắc Vàng Zero-GC
1. **Vòng lặp từng khung hình là vùng cấm cấp phát (Frame Loops are Zero-Alloc Zones):** Các hàm `Update()`, `LateUpdate()`, `FixedUpdate()`, coroutines chạy liên tục và callbacks render không được phép sinh ra dù chỉ 1 byte GC Allocation.
2. **GC Spike = Giết chết trải nghiệm người dùng:** Trong Unity Mono/IL2CPP, việc GC thu gom bộ nhớ sẽ tạm dừng toàn bộ game thread (Stop-The-World), gây tụt khung hình đột ngột (Spike Drop) từ 60/120 FPS về 0 FPS trong vài mili-giây.
3. **Tái sử dụng & Tiền cấp phát (Pre-allocate & Pool):** Mọi đối tượng, bộ đệm, mảng, danh sách phải được tạo sẵn khi tải màn chơi (Loading Phase) hoặc sử dụng Object Pooling.

---

## 🔍 Danh Mục Kiểm Toán Mã Nguồn (Audit Checklist)

### 1. Triệt Tiêu LINQ & Foreach Trên Collection Không Có Struct Enumerator
- ❌ **Anti-Pattern:** Dùng LINQ (`.Where()`, `.Select()`, `.ToList()`, `.Any()`) hoặc `foreach` trên interfaces trong frame update:
  ```csharp
  void Update() {
      var enemies = allUnits.Where(u => u.IsAlive).ToList(); // Cấp phát Iterator & List mới mỗi frame!
  }
  ```
- ✅ **Chuẩn Senior:** Dùng vòng lặp `for` theo chỉ số với danh sách đã cấp phát sẵn hoặc dùng mảng:
  ```csharp
  void Update() {
      aliveUnits.Clear();
      for (int i = 0; i < allUnits.Count; i++) {
          if (allUnits[i].IsAlive) aliveUnits.Add(allUnits[i]);
      }
  }
  ```

### 2. Triệt Tiêu Boxing / Unboxing
- ❌ **Anti-Pattern:** Ép kiểu struct sang `object`, format chuỗi string trong Update, hoặc dùng `string.Format`:
  ```csharp
  void Update() {
      scoreText.text = "Score: " + score; // Tạo string mới trên Heap mỗi frame!
  }
  ```
- ✅ **Chuẩn Senior:** 
  - Dùng `StringBuilder` tĩnh hoặc bộ đệm ký tự không cấp phát.
  - Sử dụng enum comparator không boxing hoặc `EqualityComparer<T>.Default`.

### 3. Bộ Đệm Vật Lý Không Cấp Phát (NonAlloc Physics APIs)
- ❌ **Anti-Pattern:** Gọi `Physics.RaycastAll()` hoặc `Physics.OverlapSphere()`:
  ```csharp
  RaycastHit[] hits = Physics.RaycastAll(ray, distance); // Trả về mảng mới mỗi lần gọi!
  ```
- ✅ **Chuẩn Senior:** Sử dụng phiên bản NonAlloc với mảng kết quả tiền cấp phát:
  ```csharp
  private static readonly RaycastHit[] s_HitBuffer = new RaycastHit[16];
  int hitCount = Physics.RaycastNonAlloc(ray, s_HitBuffer, distance);
  ```

### 4. Tối Ưu Hóa Coroutines & Yield Instructions
- ❌ **Anti-Pattern:** `yield return new WaitForSeconds(0.5f);` tạo instance mới mỗi lần lặp:
  ```csharp
  IEnumerator PulseRoutine() {
      while (true) {
          yield return new WaitForSeconds(1.0f); // 20-30 bytes GC Alloc mỗi giây
      }
  }
  ```
- ✅ **Chuẩn Senior:** Cache instance hoặc dùng biến thời gian tĩnh:
  ```csharp
  private static readonly WaitForSeconds s_WaitOneSecond = new WaitForSeconds(1.0f);
  IEnumerator PulseRoutine() {
      while (true) {
          yield return s_WaitOneSecond; // Zero GC Alloc
      }
  }
  ```

### 5. Hủy Đăng Ký C# Events & Delegates (Chống Rò Rỉ Khi Chuyển Scene)
- ❌ **Anti-Pattern:** Đăng ký sự kiện tĩnh nhưng không hủy khi `GameObject` bị hủy:
  ```csharp
  void OnEnable() { GameManager.OnScoreChanged += UpdateUI; }
  // Thiếu OnDisable -> GameManager giữ tham chiếu tới instance đã Destroy -> Memory Leak!
  ```
- ✅ **Chuẩn Senior:** Luôn hủy đăng ký đối xứng trong `OnDisable()` hoặc `OnDestroy()`:
  ```csharp
  void OnDisable() { GameManager.OnScoreChanged -= UpdateUI; }
  ```

---

## 🛠️ Công Cụ Kiểm Tra Hồi Quy & Đánh Giá Tự Động

1. **Unity Profiler CPU / Memory Allocation Audit:**
   ```bash
   ./scripts/unity-test.sh EditMode --filter "Category=MemoryProfiler"
   ```
   - Tiêu chuẩn: `GC.Alloc` trong hàm `Update()` ghi nhận bằng **0 B** (Zero Bytes).

2. **Kiểm Tra Rò Rỉ Chuyển Scene (Scene Load/Unload):**
   ```bash
   ./scripts/unity-test.sh PlayMode --filter "Category=SceneTransition"
   ```
   - Tiêu chuẩn: Sau khi dỡ bỏ màn chơi (`Resources.UnloadUnusedAssets()`), không còn tham chiếu tĩnh nào trỏ đến đối tượng đã bị phá hủy.
