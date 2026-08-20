# 青梧 发布流程

本文是版本发布的唯一操作说明。普通分支推送只做质量检查；只有推送 `v*` 版本标签才会自动打包并创建 GitHub Release。

## 发布步骤

1. 确认本次版本范围：
   - 将 `docs/TODO.md` 中本次已打勾的 `[x]` 待办项，剪切归档至 `docs/TODO-ARCHIVE.md` 顶部的 `## vX.Y.Z（YYYY-MM-DD）` 小节。
   - 更新 `package.json` 和 `package-lock.json` 中的版本号。
2. 运行 `npm run check`，确认语法与代码门禁全部通过。
3. 提交版本改动并推送 `master`，等待 Quality workflow 通过。
4. 创建与包版本一致的标签（例如 `v0.0.1`），并将标签推送到远端：
   ```bash
   git tag v0.0.1
   git push origin v0.0.1
   ```
5. **跟踪 Release workflow**：推送标签后，GitHub Actions 会自动在云端 Windows 环境中执行依赖安装、质量检查、打包构建、生成中文发布说明，并将安装包（`.exe`）、差分文件（`.blockmap`）与更新元数据（`latest.yml`）自动上传至 GitHub Releases。
6. 确认 GitHub Release 页面已成功生成该版本，且包含完整发布产物。

完成标准：GitHub Actions Release 工作流成功执行、GitHub Release 发布成功且产物完整、发布说明与 CHANGELOG 自动更新。
