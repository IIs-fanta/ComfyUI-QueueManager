// 添加调试日志
console.log("QueueManager.js 开始加载...");

// 加载CSS
function injectCSS() {
    console.log("开始注入CSS样式...");
    const link = document.createElement('link');
    link.id = 'QueueManager-css';
    link.rel = 'stylesheet';
    link.href = '/queue-manager/queueManager.css';
    
    // 检查是否已存在
    if (!document.getElementById('QueueManager-css')) {
        document.head.appendChild(link);
        console.log("CSS样式已注入到文档中");
    } else {
        console.log("CSS样式已存在，跳过注入");
    }
}

// 立即注入CSS
injectCSS();

// 等待ComfyUI加载完成
function waitForComfyUI() {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 100; // 10秒
        
        const check = () => {
            attempts++;
            console.log(`等待 ComfyUI 加载... (尝试 ${attempts}/${maxAttempts})`);
            
            // 检查ComfyUI是否已加载
            if (window.app) {
                console.log("ComfyUI app 已加载");
                // 尝试从app中获取api
                if (window.app.api) {
                    console.log("从app中获取到api对象");
                    window.api = window.app.api;
                    resolve();
                    return;
                }
            }
            
            // 检查是否达到最大尝试次数
            if (attempts >= maxAttempts) {
                console.log("ComfyUI 加载超时，尝试继续执行");
                resolve();
                return;
            }
            
            setTimeout(check, 100);
        };
        
        check();
    });
}

// 主函数
async function init() {
    try {
        console.log("开始初始化 QueueManager...");
        await waitForComfyUI();
        
        // 检查全局变量
        console.log("检查全局变量:", {
            hasApp: !!window.app,
            hasApi: !!window.api,
            appApi: window.app ? !!window.app.api : false
        });

        // 尝试从app中获取api
        if (!window.api && window.app && window.app.api) {
            console.log("从app中获取api对象");
            window.api = window.app.api;
        }

        if (!window.api) {
            console.error("API对象未找到，无法初始化任务管理器");
            return;
        }

        const { app } = window;
        const { api } = window;

        console.log("QueueManager.js 导入完成");

        const ID_PREFIX = "QueueManager";

        // --- UI Elements ---
        let queueManagerPanel;
        let tasksListElement;
        let pauseButton;
        let prioritizeButton;
        let deleteButton;
        let refreshButton;
        let minimizeButton;
        let isMinimized = false;

        function createTaskRow(task) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <input type="checkbox" class="task-checkbox" data-task-id="${task.id}" ${task.selected ? 'checked' : ''}>
                </td>
                <td>${task.title}</td>
                <td>${task.status}</td>
                <td>${task.created_at}</td>
            `;
            
            // 添加复选框事件监听器
            const checkbox = row.querySelector('.task-checkbox');
            checkbox.addEventListener('change', async (e) => {
                try {
                    const response = await fetch('/api/queue-manager/toggle-task-selection', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            task_id: task.id
                        })
                    });
                    
                    if (!response.ok) {
                        console.error('切换选中状态失败:', await response.text());
                    }
                } catch (error) {
                    console.error('切换选中状态时出错:', error);
                }
            });
            
            return row;
        }

        async function fetchAndUpdateTasks() {
            if (isMinimized) return;
            
            try {
                // 确保api对象存在
                if (!window.api) {
                    console.error("API对象未找到");
                    tasksListElement.innerHTML = '<tr><td colspan="4" style="color:red;">API未初始化</td></tr>';
                    return;
                }

                const resp = await window.api.fetchApi("/queue-manager/get-tasks", { cache: "no-store" });
                if (!resp.ok) {
                    console.error("获取任务失败:", resp.status, await resp.text());
                    tasksListElement.innerHTML = '<tr><td colspan="4" style="color:red;">加载任务时出错</td></tr>';
                    return;
                }
                const tasks = await resp.json();
                tasksListElement.innerHTML = "";

                if (tasks.length === 0) {
                    tasksListElement.innerHTML = '<tr><td colspan="4">任务队列为空</td></tr>';
                } else {
                    tasks.forEach(task => {
                        tasksListElement.appendChild(createTaskRow(task));
                    });
                }
            } catch (error) {
                console.error("获取或渲染任务时出错:", error);
                tasksListElement.innerHTML = '<tr><td colspan="4" style="color:red;">加载任务时出错</td></tr>';
            }
        }

        async function fetchAndUpdatePauseState() {
            if (isMinimized) return;
            
            try {
                // 确保api对象存在
                if (!window.api) {
                    console.error("API对象未找到");
                    return;
                }

                const resp = await window.api.fetchApi("/queue-manager/get-pause-state", { cache: "no-store" });
                if (!resp.ok) {
                    console.error("获取暂停状态失败:", resp.status, await resp.text());
                    return;
                }
                const data = await resp.json();
                updatePauseButtonText(data.paused);
            } catch (error) {
                console.error("获取暂停状态时出错:", error);
            }
        }

        function updatePauseButtonText(isPaused) {
            if (pauseButton) {
                if (isPaused) {
                    pauseButton.textContent = "▶️ 开始运行";
                    pauseButton.title = "恢复任务队列执行";
                    pauseButton.classList.add(`${ID_PREFIX}-paused-state`);
                } else {
                    pauseButton.textContent = "⏸️ 暂停任务";
                    pauseButton.title = "暂停任务队列执行";
                    pauseButton.classList.remove(`${ID_PREFIX}-paused-state`);
                }
            }
        }

        function getSelectedTaskIds() {
            const selected = [];
            document.querySelectorAll('.task-checkbox:checked').forEach(cb => {
                selected.push(cb.dataset.taskId);
            });
            return selected;
        }

        // --- Event Handlers ---
        async function handleTogglePause() {
            try {
                // 确保api对象存在
                if (!window.api) {
                    console.error("API对象未找到");
                    alert("API未初始化，无法切换暂停状态");
                    return;
                }

                const resp = await window.api.fetchApi("/queue-manager/toggle-pause", { method: "POST" });
                if (!resp.ok) {
                    const errorData = await resp.json();
                    alert(`切换暂停状态时出错: ${errorData.message || resp.statusText}`);
                    return;
                }
                const data = await resp.json();
                updatePauseButtonText(data.paused);
                await fetchAndUpdateTasks();
            } catch (error) {
                alert(`切换暂停状态时出错: ${error.message}`);
                console.error("切换暂停状态时出错:", error);
            }
        }

        async function handlePrioritizeTasks() {
            const taskIds = getSelectedTaskIds();
            if (taskIds.length === 0) {
                alert("请先选择要优先执行的任务");
                return;
            }
            if (!confirm(`确定要将选中的 ${taskIds.length} 个任务设置为优先执行吗？`)) {
                return;
            }
            try {
                // 确保api对象存在
                if (!window.api) {
                    console.error("API对象未找到");
                    alert("API未初始化，无法优先处理任务");
                    return;
                }

                const resp = await window.api.fetchApi("/queue-manager/prioritize-tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ task_ids: taskIds }),
                });
                const data = await resp.json();
                if (data.success) {
                    await fetchAndUpdateTasks();
                } else {
                    alert(`优先处理失败: ${data.message || "未知错误"}`);
                }
            } catch (error) {
                alert(`优先处理错误: ${error.message}`);
                console.error("优先处理任务时出错:", error);
            }
        }

        async function handleDeleteTasks() {
            const taskIds = getSelectedTaskIds();
            if (taskIds.length === 0) {
                alert("请先选择要删除的任务");
                return;
            }
            if (!confirm(`确定要删除选中的 ${taskIds.length} 个任务吗？此操作不可恢复！`)) {
                return;
            }
            try {
                // 确保api对象存在
                if (!window.api) {
                    console.error("API对象未找到");
                    alert("API未初始化，无法删除任务");
                    return;
                }

                const resp = await window.api.fetchApi("/queue-manager/delete-tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ task_ids: taskIds }),
                });
                const data = await resp.json();
                if (data.success) {
                    await fetchAndUpdateTasks();
                } else {
                    alert(`删除失败: ${data.message || "未知错误"}`);
                }
            } catch (error) {
                alert(`删除错误: ${error.message}`);
                console.error("删除任务时出错:", error);
            }
        }

        function toggleMinimize() {
            isMinimized = !isMinimized;
            const content = queueManagerPanel.querySelector(`.${ID_PREFIX}-content`);
            const minimizeIcon = minimizeButton.querySelector('span');
            
            if (isMinimized) {
                content.style.display = 'none';
                minimizeIcon.textContent = '⬆️';
                minimizeButton.title = '展开面板';
                queueManagerPanel.style.height = '40px';
            } else {
                content.style.display = 'flex';
                minimizeIcon.textContent = '⬇️';
                minimizeButton.title = '最小化面板';
                queueManagerPanel.style.height = 'auto';
                fetchAndUpdateTasks();
                fetchAndUpdatePauseState();
            }
        }

        // --- Setup UI ---
        window.setupQueueManagerUI = function() {
            console.log("开始设置 QueueManager UI...");
            
            // 检查是否已存在面板
            const existingPanel = document.getElementById(`${ID_PREFIX}-panel`);
            if (existingPanel) {
                console.log("面板已存在，移除旧面板");
                existingPanel.remove();
            }

            // 创建面板
            queueManagerPanel = document.createElement("div");
            queueManagerPanel.id = `${ID_PREFIX}-panel`;
            queueManagerPanel.className = `${ID_PREFIX}-panel-class`;
            
            // 强制设置样式
            Object.assign(queueManagerPanel.style, {
                position: 'fixed',
                right: '20px',
                bottom: '20px',
                width: '550px',
                maxHeight: '70vh',
                backgroundColor: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '8px',
                zIndex: '9999',
                boxShadow: '0 5px 15px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                color: '#fff',
                fontSize: '14px',
                opacity: '1',
                visibility: 'visible'
            });
            
            // 添加面板内容
            queueManagerPanel.innerHTML = `
                <div class="${ID_PREFIX}-header">
                    <span class="${ID_PREFIX}-title">任务队列管理器</span>
                    <div class="${ID_PREFIX}-header-buttons">
                        <button id="${ID_PREFIX}-minimizeButton" class="${ID_PREFIX}-header-button" title="最小化面板"><span>⬇️</span></button>
                    </div>
                </div>
                <div class="${ID_PREFIX}-content">
                    <div class="${ID_PREFIX}-controls">
                        <button id="${ID_PREFIX}-pauseButton" class="${ID_PREFIX}-button" title="暂停任务队列执行">⏸️ 暂停任务</button>
                        <button id="${ID_PREFIX}-prioritizeButton" class="${ID_PREFIX}-button" title="将选中任务移到队列顶端">🔼 优先执行</button>
                        <button id="${ID_PREFIX}-deleteButton" class="${ID_PREFIX}-button ${ID_PREFIX}-delete-button" title="从队列中删除选中任务">🗑️ 删除任务</button>
                        <button id="${ID_PREFIX}-refreshButton" class="${ID_PREFIX}-button" title="刷新任务列表">🔄 刷新</button>
                    </div>
                    <div class="${ID_PREFIX}-table-container">
                        <table class="${ID_PREFIX}-task-table">
                            <thead>
                                <tr>
                                    <th><input type="checkbox" id="${ID_PREFIX}-selectAllCheckbox" title="全选/取消全选"></th>
                                    <th>任务名称/ID</th>
                                    <th>状态</th>
                                    <th>创建时间</th>
                                </tr>
                            </thead>
                            <tbody id="${ID_PREFIX}-tasksListBody">
                                <tr><td colspan="4">正在加载...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            // 添加到文档中
            document.body.appendChild(queueManagerPanel);
            console.log("面板已添加到文档中");

            // 获取元素
            tasksListElement = document.getElementById(`${ID_PREFIX}-tasksListBody`);
            pauseButton = document.getElementById(`${ID_PREFIX}-pauseButton`);
            prioritizeButton = document.getElementById(`${ID_PREFIX}-prioritizeButton`);
            deleteButton = document.getElementById(`${ID_PREFIX}-deleteButton`);
            refreshButton = document.getElementById(`${ID_PREFIX}-refreshButton`);
            minimizeButton = document.getElementById(`${ID_PREFIX}-minimizeButton`);
            const selectAllCheckbox = document.getElementById(`${ID_PREFIX}-selectAllCheckbox`);

            console.log("UI元素已获取");

            // 添加事件监听器
            pauseButton.addEventListener("click", handleTogglePause);
            prioritizeButton.addEventListener("click", handlePrioritizeTasks);
            deleteButton.addEventListener("click", handleDeleteTasks);
            minimizeButton.addEventListener("click", toggleMinimize);
            refreshButton.addEventListener("click", async () => {
                await fetchAndUpdateTasks();
                await fetchAndUpdatePauseState();
            });
            selectAllCheckbox.addEventListener("change", (event) => {
                document.querySelectorAll(`.${ID_PREFIX}-task-checkbox`).forEach(cb => {
                    cb.checked = event.target.checked;
                });
            });

            console.log("事件监听器已添加");

            // 初始加载
            fetchAndUpdateTasks();
            fetchAndUpdatePauseState();

            // 自动刷新
            setInterval(async () => {
                await fetchAndUpdateTasks();
                await fetchAndUpdatePauseState();
            }, 5000);

            // 使面板可拖动
            let isDragging = false;
            let offsetX, offsetY;
            const header = queueManagerPanel.querySelector(`.${ID_PREFIX}-header`);
            if(header) {
                header.addEventListener('mousedown', (e) => {
                    if (e.target === minimizeButton || e.target === minimizeButton.querySelector('span')) return;
                    isDragging = true;
                    offsetX = e.clientX - queueManagerPanel.offsetLeft;
                    offsetY = e.clientY - queueManagerPanel.offsetTop;
                    queueManagerPanel.style.cursor = 'grabbing';
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    queueManagerPanel.style.left = (e.clientX - offsetX) + 'px';
                    queueManagerPanel.style.top = (e.clientY - offsetY) + 'px';
                });

                document.addEventListener('mouseup', () => {
                    if(isDragging) {
                        isDragging = false;
                        queueManagerPanel.style.cursor = 'grab';
                    }
                });
                header.style.cursor = 'grab';
            }

            console.log("QueueManager UI 设置完成");
        };

        // 注册扩展
        console.log("开始注册 QueueManager 扩展...");

        if (!app) {
            console.error("app 对象未找到，无法注册扩展");
            return;
        }

        app.registerExtension({
            name: "Comfy.QueueManager",
            async setup() {
                console.log("QueueManager 扩展 setup 开始...");
                createMenuButton();
            },
            async loaded() {
                console.log("QueueManager 扩展已加载");
            }
        });

        function createMenuButton() {
            console.log("开始创建菜单按钮...");
            
            // 检查是否已存在按钮
            if (document.getElementById('QueueManager-button')) {
                console.log("菜单按钮已存在，跳过创建");
                return;
            }

            const menuButton = document.createElement("button");
            menuButton.id = 'QueueManager-button';
            menuButton.textContent = "任务管理器";
            menuButton.style.cssText = `
                color: var(--descrip-text);
                background-color: var(--comfy-menu-bg);
                border: 1px solid var(--border-color);
                padding: 5px 10px;
                cursor: pointer;
                margin: 0 5px;
            `;
            menuButton.onclick = () => {
                console.log("任务管理器按钮被点击");
                if (!window.api) {
                    console.error("API对象未找到，无法打开任务管理器");
                    alert("系统未就绪，请稍后再试");
                    return;
                }
                // 检查面板是否已存在
                const existingPanel = document.getElementById('QueueManager-panel');
                if (existingPanel) {
                    console.log("面板已存在，移除旧面板");
                    existingPanel.remove();
                }
                console.log("开始创建新面板");
                window.setupQueueManagerUI();
            };

            const comfyMenu = document.querySelector(".comfy-menu");
            if (comfyMenu) {
                console.log("找到 ComfyUI 菜单，添加按钮");
                const queuePromptButton = document.getElementById("queue-button");
                if (queuePromptButton && queuePromptButton.parentNode) {
                    queuePromptButton.parentNode.insertBefore(menuButton, queuePromptButton.nextSibling);
                } else {
                    comfyMenu.appendChild(menuButton);
                }
            } else {
                console.warn("未找到 ComfyUI 菜单，等待菜单加载...");
                // 等待菜单加载
                const checkMenu = setInterval(() => {
                    const menu = document.querySelector(".comfy-menu");
                    if (menu) {
                        clearInterval(checkMenu);
                        console.log("ComfyUI 菜单已加载，添加按钮");
                        menu.appendChild(menuButton);
                    }
                }, 100);
            }
        }

        // 创建菜单按钮
        createMenuButton();

        // 自动创建面板
        console.log("自动创建面板...");
        window.setupQueueManagerUI();

        console.log("QueueManager.js 加载完成");
    } catch (error) {
        console.error("QueueManager 初始化失败:", error);
    }
}

// 启动初始化
init(); 