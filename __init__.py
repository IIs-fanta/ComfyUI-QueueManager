import server
import execution
import os
import json
from aiohttp import web
from datetime import datetime, timezone

# 用于存储任务创建时间
TASK_CREATION_TIMES = {}

# 用于存储恢复后的任务ID
RESTORED_TASK_IDS = set()

# 用于存储恢复时间
RESTORE_TIME = 0

# 用于存储选中状态
SELECTED_TASKS = set()

# --- Helper Functions ---
def format_datetime(dt_str):
    """将ISO格式的时间字符串转换为月日时分秒格式"""
    try:
        dt = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
        return dt.strftime('%m-%d %H:%M:%S')
    except:
        return dt_str

def get_prompt_title(index_id, prompt_data):
    index_id = str(index_id)
    """尝试从prompt数据中获取一个可读的标题"""
    try:
        if isinstance(prompt_data, tuple):
            prompt_data = prompt_data[2] if len(prompt_data) > 2 else {}
            
        for node_id, node_data in prompt_data.get("output", {}).items():
            if node_data.get("class_type") == "CheckpointLoaderSimple":
                return node_data.get("inputs", {}).get("ckpt_name", f"任务 {prompt_data.get('prompt_id', index_id)[:8]}")
        return f"任务 {prompt_data.get('prompt_id', index_id)[:8]}"
    except:
        return f"任务 {prompt_data.get('prompt_id', index_id)[:8]}"

# --- API Endpoints ---
async def get_tasks(request):
    try:
        prompt_queue = server.PromptServer.instance.prompt_queue
        if not prompt_queue:
            print("错误: prompt_queue 未找到")
            return web.json_response({"error": "队列未初始化"}, status=500)

        tasks_to_display = []
        is_paused = PAUSE_STATE.get("paused", False)

        if is_paused and PAUSE_STATE.get("original_queue"):
            # 在暂停状态下显示保存的队列
            current_queue = PAUSE_STATE["original_queue"]
        else:
            # 正常显示当前队列
            current_queue = prompt_queue.get_current_queue()

        if not current_queue:
            print("错误: 无法获取当前队列")
            return web.json_response({"error": "无法获取队列信息"}, status=500)

        # 正在运行的任务
        if current_queue[0] and len(current_queue[0]) > 0:
            try:
                running_task = current_queue[0][0]
                if isinstance(running_task, tuple):
                    running_index_id = running_task[0]
                    running_prompt_id = running_task[1] if len(running_task) > 1 else 'unknown'
                    running_prompt_data = running_task[2] if len(running_task) > 2 else {}
                else:
                    running_index_id = running_task[0]
                    running_prompt_id = running_task.get('prompt_id', 'unknown')
                    running_prompt_data = running_task.get('prompt', {})

                if running_prompt_id not in TASK_CREATION_TIMES:
                    TASK_CREATION_TIMES[running_prompt_id] = datetime.now(timezone.utc).isoformat()

                tasks_to_display.append({
                    "id": running_prompt_id,
                    "title": get_prompt_title(running_index_id, running_prompt_data),
                    "status": "running",
                    "created_at": format_datetime(TASK_CREATION_TIMES.get(running_prompt_id, "N/A")),
                    "data": running_prompt_data,
                    "selected": running_prompt_id in SELECTED_TASKS
                })
            except Exception as e:
                print(f"处理运行中任务时出错: {str(e)}")

        # 等待中的任务
        if current_queue[1]:
            try:
                for item in current_queue[1]:
                    if isinstance(item, tuple) and len(item) >= 3:
                        index_id = item[0]
                        prompt_id = item[1]
                        prompt_data = item[2]
                        if prompt_id not in TASK_CREATION_TIMES:
                            TASK_CREATION_TIMES[prompt_id] = datetime.now(timezone.utc).isoformat()

                        tasks_to_display.append({
                            "id": prompt_id,
                            "title": get_prompt_title(index_id, prompt_data),
                            "status": "paused" if is_paused else "pending",
                            "created_at": format_datetime(TASK_CREATION_TIMES.get(prompt_id, "N/A")),
                            "data": prompt_data,
                            "selected": prompt_id in SELECTED_TASKS
                        })
            except Exception as e:
                print(f"处理等待中任务时出错: {str(e)}")
        return web.json_response(tasks_to_display)
    except Exception as e:
        print(f"获取任务列表时出错: {str(e)}")
        return web.json_response({"error": str(e)}, status=500)

async def prioritize_tasks(request):
    prompt_queue = server.PromptServer.instance.prompt_queue
    try:
        data = await request.json()
        task_ids = data.get("task_ids", [])
        if not task_ids:
            return web.json_response({"success": False, "message": "未提供任务ID"}, status=400)

        # 获取当前队列
        current_queue = prompt_queue.get_current_queue()
        if not current_queue or not current_queue[1]:
            return web.json_response({"success": False, "message": "队列为空"}, status=400)

        # 重新排序队列
        pending_tasks = list(current_queue[1])
        prioritized_tasks = []
        other_tasks = []

        # 分离优先任务和其他任务
        for task in pending_tasks:
            if isinstance(task, tuple) and len(task) >= 3:
                task_id = task[1]
                if task_id in task_ids:
                    prioritized_tasks.append(task)
                else:
                    other_tasks.append(task)

        # 清空当前队列
        prompt_queue.queue.clear()

        # 重新添加任务，优先任务在前
        for task in prioritized_tasks + other_tasks:
            prompt_queue.queue.append(task)

        return web.json_response({
            "success": True,
            "message": f"已优先处理 {len(prioritized_tasks)} 个任务",
            "prioritized_count": len(prioritized_tasks)
        })

    except Exception as e:
        print(f"优先处理任务时出错: {e}")
        return web.json_response({"success": False, "message": str(e)}, status=500)

async def delete_tasks(request):
    prompt_queue = server.PromptServer.instance.prompt_queue
    try:
        data = await request.json()
        task_ids = data.get("task_ids", [])
        if not task_ids:
            return web.json_response({"success": False, "message": "未提供任务ID"}, status=400)

        count = 0
        for task_id_to_delete in task_ids:
            # 处理等待队列
            temp_pending = list(prompt_queue.queue)
            prompt_queue.queue.clear()
            for item in temp_pending:
                if item[1] != task_id_to_delete:
                    prompt_queue.queue.append(item)
                else:
                    count += 1
                    if task_id_to_delete in TASK_CREATION_TIMES:
                        del TASK_CREATION_TIMES[task_id_to_delete]

        if count > 0:
            return web.json_response({"success": True, "message": f"成功删除 {count} 个任务"})
        else:
            return web.json_response({"success": False, "message": "未在等待队列中找到选中的任务"})

    except Exception as e:
        print(f"删除任务时出错: {e}")
        return web.json_response({"success": False, "message": str(e)}, status=500)

PAUSE_STATE = {
    "paused": False,
    "saved_queue": [],
    "original_queue": None
}

async def toggle_pause_execution(request):
    try:
        print("开始处理暂停/恢复请求...")
        prompt_queue = server.PromptServer.instance.prompt_queue
        if not prompt_queue:
            print("错误: prompt_queue 未初始化")
            return web.json_response({"success": False, "message": "队列未初始化"}, status=500)
            
        is_currently_paused = PAUSE_STATE.get("paused", False)
        print(f"当前暂停状态: {is_currently_paused}")
        
        new_pause_state = not is_currently_paused
        print(f"新的暂停状态: {new_pause_state}")
        
        try:
            if new_pause_state:
                # 暂停：保存当前队列并阻止新任务执行
                current_queue = prompt_queue.get_current_queue()
                if current_queue:
                    # 保存原始队列
                    PAUSE_STATE["original_queue"] = current_queue
                    # 保存等待中的任务，但不包括当前正在执行的任务
                    if current_queue[1]:
                        PAUSE_STATE["saved_queue"] = list(current_queue[1])
                    
                    # 阻止新任务执行
                    if hasattr(prompt_queue, 'queue'):
                        # 保存当前队列的引用
                        PAUSE_STATE["queue_reference"] = prompt_queue.queue
                        # 替换为空的队列
                        prompt_queue.queue = []
                        print("已暂停队列执行")
            else:
                # 恢复：恢复原始队列
                if PAUSE_STATE.get("original_queue"):
                    try:
                        # 恢复原始队列
                        if hasattr(prompt_queue, 'queue') and PAUSE_STATE.get("queue_reference"):
                            # 恢复队列引用
                            prompt_queue.queue = PAUSE_STATE["queue_reference"]
                            
                            # 重新添加保存的任务
                            if PAUSE_STATE["saved_queue"]:
                                for task in PAUSE_STATE["saved_queue"]:
                                    if isinstance(task, tuple) and len(task) >= 3:
                                        # 使用ComfyUI的方式重新添加任务
                                        if hasattr(server.PromptServer.instance, 'prompt_queue'):
                                            # 获取当前队列
                                            current_queue = server.PromptServer.instance.prompt_queue.get_current_queue()
                                            if current_queue and current_queue[1] is not None:
                                                # 添加到等待队列
                                                current_queue[1].append(task)
                                                print(f"已重新添加任务到队列")
                            
                            print("已恢复队列执行")
                        else:
                            print("无法恢复队列：队列引用无效")
                    except Exception as e:
                        print(f"恢复队列时出错: {str(e)}")
                        return web.json_response({"success": False, "message": f"恢复队列失败: {str(e)}"}, status=500)
                else:
                    print("没有保存的队列可恢复")

            PAUSE_STATE["paused"] = new_pause_state
            message = "任务队列已暂停" if new_pause_state else "任务队列已恢复"
            print(f"操作完成: {message}")
            
            return web.json_response({"success": True, "paused": PAUSE_STATE["paused"], "message": message})
        except Exception as e:
            print(f"设置暂停状态时出错: {str(e)}")
            return web.json_response({"success": False, "message": f"设置暂停状态失败: {str(e)}"}, status=500)
    except Exception as e:
        print(f"切换暂停状态时出错: {str(e)}")
        return web.json_response({"success": False, "message": str(e)}, status=500)

async def get_pause_state(request):
    prompt_queue = server.PromptServer.instance.prompt_queue
    actual_paused_state = getattr(prompt_queue, 'paused', PAUSE_STATE["paused"])
    return web.json_response({"paused": actual_paused_state})

async def toggle_task_selection(request):
    try:
        data = await request.json()
        task_id = data.get("task_id")
        if not task_id:
            return web.json_response({"success": False, "message": "未提供任务ID"}, status=400)

        if task_id in SELECTED_TASKS:
            SELECTED_TASKS.remove(task_id)
            print(f"取消选中任务: {task_id}")
        else:
            SELECTED_TASKS.add(task_id)
            print(f"选中任务: {task_id}")

        return web.json_response({
            "success": True,
            "selected": task_id in SELECTED_TASKS,
            "message": "任务选中状态已更新"
        })
    except Exception as e:
        print(f"切换任务选中状态时出错: {str(e)}")
        return web.json_response({"success": False, "message": str(e)}, status=500)

# --- ComfyUI Registration ---
WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.realpath(__file__)), "js")
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

print("ComfyUI-QueueManager 正在初始化...")

# 注册API路由
try:
    app = server.PromptServer.instance.app
    
    # 注册静态文件目录
    app.router.add_static('/queue-manager', WEB_DIRECTORY)
    app.router.add_static('/manager', WEB_DIRECTORY)
    
    # 添加特定的静态文件路由
    async def badge_mode_handler(request):
        try:
            badge_mode_path = os.path.join(WEB_DIRECTORY, 'badge_mode')
            if not os.path.exists(badge_mode_path):
                print(f"错误: badge_mode 文件不存在: {badge_mode_path}")
                return web.Response(status=404)
            
            with open(badge_mode_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return web.Response(
                text=content,
                content_type='application/json',
                headers={
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                }
            )
        except Exception as e:
            print(f"读取 badge_mode 文件时出错: {str(e)}")
            return web.Response(status=500)
        
    async def monitor_css_handler(request):
        try:
            css_path = os.path.join(WEB_DIRECTORY, 'queueManager.css')
            if not os.path.exists(css_path):
                print(f"错误: CSS 文件不存在: {css_path}")
                return web.Response(status=404)
            
            with open(css_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return web.Response(
                text=content,
                content_type='text/css',
                headers={
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                }
            )
        except Exception as e:
            print(f"读取 CSS 文件时出错: {str(e)}")
            return web.Response(status=500)
    
    # 使用正确的路由注册方式
    app.router.add_get('/manager/badge_mode', badge_mode_handler)
    app.router.add_get('/monitor.css', monitor_css_handler)
    
    print(f"已注册静态文件目录: {WEB_DIRECTORY}")
    
    # 添加CORS头
    @web.middleware
    async def cors_middleware(request, handler):
        try:
            response = await handler(request)
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
            return response
        except Exception as e:
            print(f"CORS中间件错误: {str(e)}")
            return web.json_response({"error": str(e)}, status=500)
    
    app.middlewares.append(cors_middleware)
    print("已添加CORS中间件")
    
    # 注册API路由
    app.router.add_get("/api/queue-manager/get-tasks", get_tasks)
    app.router.add_post("/api/queue-manager/prioritize-tasks", prioritize_tasks)
    app.router.add_post("/api/queue-manager/delete-tasks", delete_tasks)
    app.router.add_post("/api/queue-manager/toggle-pause", toggle_pause_execution)
    app.router.add_get("/api/queue-manager/get-pause-state", get_pause_state)
    app.router.add_post("/api/queue-manager/toggle-task-selection", toggle_task_selection)
    
    # 添加JavaScript文件到ComfyUI
    js_path = os.path.join(WEB_DIRECTORY, "queueManager.js")
    if os.path.exists(js_path):
        with open(js_path, 'r', encoding='utf-8') as f:
            js_content = f.read()
        app.router.add_get('/queue-manager/queueManager.js', lambda request: web.Response(text=js_content, content_type='application/javascript'))
        print(f"已注册JavaScript文件: {js_path}")
    else:
        print(f"警告: JavaScript文件不存在: {js_path}")
    
    print("ComfyUI-QueueManager API路由注册完成")
except Exception as e:
    print(f"注册 API 路由时出错: {str(e)}")

# 在启动时清空任务创建时间记录
TASK_CREATION_TIMES.clear() 