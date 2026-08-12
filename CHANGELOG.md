# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 的结构，并计划在首次公开发布后采用语义化版本。

## [Unreleased]

### Added

- 开源协作、安全政策和路线图文档。
- 统一的语法、测试和 Renderer 构建检查。

### Changed

- 开发与构建脚本改用标准 npm 命令。
- CI 使用锁文件安装，并在 Node.js 20 与 22 上执行同一套验证。
- 项目许可证元数据与 Apache-2.0 许可证文件保持一致。
- Axios 升级到包含当前安全修复的版本范围。

### Removed

- 开发启动时自动强制终止占用端口的进程。
