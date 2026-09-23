---
name: compose-recomp-audit
description: Kiểm toán và tối ưu hóa hiện tượng Recomposition thừa trong Jetpack Compose, hướng tới tốc độ hiển thị 120 FPS không giật lag. Tự động kích hoạt khi chỉnh sửa giao diện Jetpack Compose, State, ViewModel, LazyColumn/LazyRow, hoặc khi phát hiện UI Jank / đơ khung hình trên Android.
---

# Jetpack Compose Recomposition & 120 FPS Audit

Kỹ năng chuyên sâu kiểm toán vòng lặp vẽ lại (Recomposition Loop), tối ưu hóa tính ổn định của tham số (Parameter Stability) và loại bỏ hiện tượng giật khung hình (Jank/Stutter) trong Jetpack Compose.

## Nguyên Tắc Vàng 120 FPS
1. **Ngân sách khung hình cực hạn:** Màn hình 120Hz chỉ có **8.33ms** cho mỗi khung hình (so với 16.6ms ở 60Hz). Mọi tính toán thừa hoặc recomposition không cần thiết đều dẫn đến drop frame.
2. **Khái niệm Stable & Immutable:** Compose Compiler bỏ qua recomposition (`skipping`) nếu tất cả tham số của `@Composable` là Stable hoặc Immutable. Một tham số Unstable (ví dụ: `List<T>`, interface không chú thích `@Immutable`, lambda không remember) sẽ kéo theo việc recompose toàn bộ cây con.
3. **Đọc trạng thái ở tầng muộn nhất (Defer State Reads):** Đọc state trong layout phase hoặc draw phase (`Modifier.offset { ... }` hoặc `Modifier.drawWithContent { ... }`) thay vì composition phase.

---

## 🔍 Danh Mục Kiểm Toán Mã Nguồn (Audit Checklist)

### 1. Ổn Định Hóa Bộ Sưu Tập & Models (Collections & Models Stability)
- ❌ **Anti-Pattern:** Dùng `List<Item>` hoặc `Set<Item>` làm tham số `@Composable`. Trình biên dịch Compose mặc định coi `List` là Unstable vì implementation có thể là mutable (`ArrayList`).
- ✅ **Chuẩn Senior:** 
  - Sử dụng thư viện `kotlinx.collections.immutable` (`ImmutableList<Item>`, `PersistentList<Item>`).
  - Hoặc bọc danh sách trong một data class được chú thích `@Immutable`:
    ```kotlin
    @Immutable
    data class ItemListState(val items: List<Item>)
    ```

### 2. Lambda Stability & Event Hoisting
- ❌ **Anti-Pattern:** Truyền lambda inline tạo mới mỗi lần recomposition:
  ```kotlin
  MyButton(onClick = { viewModel.onAction(item.id) }) // Lambda mới mỗi lần -> Recompose!
  ```
- ✅ **Chuẩn Senior:**
  - Nhớ lambda qua `remember(item.id) { { viewModel.onAction(item.id) } }`
  - Hoặc truyền trực tiếp function reference: `onClick = viewModel::onButtonClick`

### 3. Tối Ưu Hóa LazyList (LazyColumn / LazyRow)
- ❌ **Anti-Pattern:** Không khai báo `key` tường minh hoặc dùng `index` làm key:
  ```kotlin
  items(items) { item -> ... } // Khi thêm/xóa phần tử, toàn bộ danh sách bị recompose
  ```
- ✅ **Chuẩn Senior:**
  - Luôn cung cấp `key` ổn định và duy nhất: `items(items, key = { it.id }) { ... }`
  - Khai báo `contentType` cho các kiểu view khác nhau để Compose tái sử dụng layout slot hiệu quả.

### 4. Kiểm Soát Tính Toán Phụ Thuộc (derivedStateOf)
- ❌ **Anti-Pattern:** Đọc `listState.firstVisibleItemIndex` trực tiếp trong Composable khiến Composable chạy lại mỗi khi cuộn 1 pixel.
- ✅ **Chuẩn Senior:**
  - Sử dụng `derivedStateOf` để chỉ phát tín hiệu khi điều kiện logic thay đổi (ví dụ: nút "Back to Top" xuất hiện khi index > 0):
    ```kotlin
    val showButton by remember {
        derivedStateOf { listState.firstVisibleItemIndex > 0 }
    }
    ```

### 5. Dời Thời Điểm Đọc State (Defer Reads to Layout/Draw)
- ❌ **Anti-Pattern:** Thay đổi offset hoặc alpha qua composition:
  ```kotlin
  Box(Modifier.offset(y = scrollOffset.dp)) // Kích hoạt composition liên tục
  ```
- ✅ **Chuẩn Senior:**
  - Sử dụng lambda modifiers để chỉ chạy lại layout/draw phase mà không kích hoạt recomposition:
    ```kotlin
    Box(Modifier.offset { IntOffset(0, scrollOffset.roundToInt()) })
    Box(Modifier.graphicsLayer { alpha = animatedAlpha })
    ```

---

## 🛠️ Công Cụ Đo Lường & Xác Thực Thực Tế

1. **Bật Compose Compiler Metrics trong Gradle (`build.gradle.kts`):**
   ```kotlin
   kotlinOptions {
       freeCompilerArgs += listOf(
           "-P", "plugin:androidx.compose.compiler.plugins.kotlin:reportsDestination=$buildDir/compose_metrics",
           "-P", "plugin:androidx.compose.compiler.plugins.kotlin:metricsDestination=$buildDir/compose_metrics"
       )
   }
   ```
   Kiểm tra tệp `<module>-composables.txt`: Đảm bảo các hàm Composable quan trọng đạt trạng thái `restartable skippable`.

2. **Đo FPS & Jank với Script DevKit:**
   ```bash
   ./profiles/android/scripts/qa/adb-fps-measure.sh <package_name> 10
   ```
   - Tiêu chuẩn: Tốc độ khung hình trung bình $\ge 115\text{ FPS}$ trên màn hình 120Hz, tỷ lệ jank $\le 2\%$.
