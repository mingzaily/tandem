# 启动与内存基线

macOS 26，arm64。Tandem 第一版，只接了 Claude Code，15 个任务。

## 启动

正式版，从启动进程到页面首次渲染并显示窗口：

| 次数 | 耗时 |
|---|---|
| 第一次（系统缓存未命中） | 905 ms |
| 第二次 | 381 ms |
| 第三次 | 364 ms |

任务列表扫描 5–16 毫秒。

## 内存（物理占用 `phys_footprint`）

调试版主进程，页面是正式构建，窗口可见。

| 状态 | 主进程 | WebContent | GPU | Network | 合计 |
|---|---:|---:|---:|---:|---:|
| 空闲，新建页 | 26 MB | 44 MB | 14 MB | 6 MB | **91 MB** |
| 打开 33 MB 的长任务，展开一个工作组 | 54 MB | 96 MB | 14 MB | 5 MB | **170 MB** |

正式版主进程的物理占用比调试版低，一次采样约 22 MB。

## 对比

Electron 这边的数字是 loom B6 的记录（[原始数据](reference/loom/measurements/b6-memory-2026-10-31.json)）：开发模式，主界面空闲，物理占用约 570–605 MB。

- **不是同等条件的对比**：Tandem 目前功能少得多，loom 是开发模式，页面也不同。功能补齐后要复测。
- 每个活跃的 `claude` 进程另占约 230–290 MB，两边相同。

## 复测方法

```bash
footprint --noCategories --format bytes -p <PID>
```

统计主进程和启动时间相同的 `WebKit.WebContent`、`GPU`、`Networking` 进程。窗口必须可见，否则 WebKit 会回收内存，结果偏低。用调试版的页面脚本打开任务，见 [Desktop 开发](dev-rules/desktop-development.md)。
