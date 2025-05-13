# ComfyUI-QueueManager

ComfyUI 的任务队列管理插件，提供更直观的任务管理界面。

## 功能特点

- 实时显示任务队列状态
- 支持暂停/恢复任务队列
- 支持删除等待中的任务
- 支持任务优先级调整
- 显示任务创建时间
- 美观的用户界面

## 安装方法

1. 将此仓库克隆到 ComfyUI 的 `custom_nodes` 目录：
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/your-username/ComfyUI-QueueManager.git
```

2. 重启 ComfyUI 服务器

## 使用方法

1. 启动 ComfyUI 后，在界面右上角会出现队列管理按钮
2. 点击按钮打开队列管理面板
3. 在面板中可以：
   - 查看当前运行和等待中的任务
   - 暂停/恢复任务队列
   - 删除选中的任务
   - 调整任务优先级

## 注意事项

- 插件需要 ComfyUI 最新版本
- 确保服务器有足够的权限访问文件系统
- 如果遇到问题，请查看服务器控制台的错误日志

## 许可证

MIT License 