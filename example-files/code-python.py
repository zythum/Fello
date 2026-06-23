# ── 测试文件 4：Python 代码 ──────────────────────────────

from dataclasses import dataclass
from typing import Optional, List, TypeAlias
from abc import ABC, abstractmethod
import json
import time


@dataclass
class Task:
    """任务数据类"""
    id: str
    title: str
    completed: bool = False
    priority: int = 0


class TaskManager:
    """任务管理器"""

    def __init__(self):
        self._tasks: List[Task] = []

    def add_task(self, title: str, priority: int = 0) -> Task:
        """添加一个新任务"""
        task = Task(
            id=f"task_{int(time.time())}",
            title=title,
            priority=priority,
        )
        self._tasks.append(task)
        return task

    def complete_task(self, task_id: str) -> Optional[Task]:
        """完成任务"""
        for task in self._tasks:
            if task.id == task_id:
                task.completed = True
                return task
        return None

    def get_pending_tasks(self) -> List[Task]:
        """获取所有未完成的任务，按优先级排序"""
        return sorted(
            [t for t in self._tasks if not t.completed],
            key=lambda t: (-t.priority, t.title),
        )

    def export_to_json(self, filepath: str) -> None:
        """导出任务列表到 JSON 文件"""
        data = [
            {"id": t.id, "title": t.title, "completed": t.completed, "priority": t.priority}
            for t in self._tasks
        ]
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


def parse_tasks_from_json(filepath: str) -> List[Task]:
    """从 JSON 文件解析任务列表"""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [Task(**item) for item in data]


def format_task_summary(tasks: List[Task]) -> str:
    """格式化任务摘要文本"""
    lines = [f"共 {len(tasks)} 个任务"]
    for task in tasks:
        status = "\u2705" if task.completed else "\u2b1c"
        lines.append(f"  {status} [{task.priority}] {task.title}")
    return "\n".join(lines)


# ── 以下为补充的复杂性语法 ──

JSONDict: TypeAlias = dict[str, "JSONValue"]
JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | JSONDict


class DataExporter(ABC):
    """抽象基类：数据导出器"""

    @abstractmethod
    def export(self, data: list[Task], path: str) -> None:
        """导出数据"""
        ...

    @abstractmethod
    def supported_formats(self) -> list[str]:
        """支持的文件格式列表"""
        ...


class CsvExporter(DataExporter):
    """CSV 格式导出器"""

    def export(self, data: list[Task], path: str) -> None:
        """导出为 CSV"""
        with open(path, "w", encoding="utf-8") as f:
            f.write("id,title,completed,priority\n")
            for t in data:
                f.write(f"{t.id},{t.title},{t.completed},{t.priority}\n")

    def supported_formats(self) -> list[str]:
        return ["csv"]


class ReportGenerator:
    """报告生成器 - 含嵌套函数"""

    def generate(self, tasks: list[Task]) -> str:
        """生成完整报告"""

        def _format_line(task: Task, index: int) -> str:
            """内部辅助：格式化单行"""
            status = "\u2705" if task.completed else "\u2b1c"
            return f"  {index}. {status} [{task.priority}] {task.title}"

        lines = [f"报告：共 {len(tasks)} 个任务"]
        for i, task in enumerate(tasks, 1):
            lines.append(_format_line(task, i))
        return "\n".join(lines)


class Temperature:
    """使用 property 的类"""

    def __init__(self, celsius: float = 0):
        self._celsius = celsius

    @property
    def celsius(self) -> float:
        """获取摄氏温度"""
        return self._celsius

    @celsius.setter
    def celsius(self, value: float) -> None:
        if value < -273.15:
            raise ValueError("温度不能低于绝对零度")
        self._celsius = value

    @property
    def fahrenheit(self) -> float:
        """获取华氏温度（只读）"""
        return self._celsius * 9 / 5 + 32

    @staticmethod
    def from_fahrenheit(f: float) -> "Temperature":
        """静态工厂方法：从华氏度创建"""
        return Temperature((f - 32) * 5 / 9)

    @classmethod
    def absolute_zero(cls) -> "Temperature":
        """类方法：返回绝对零度"""
        return cls(-273.15)


async def fetch_data(url: str) -> dict:
    """模拟异步 HTTP 请求"""
    await asyncio.sleep(1)
    return {"url": url, "status": 200}


async def process_batch(urls: list[str]) -> list[dict]:
    """异步批处理"""
    import asyncio
    tasks = [fetch_data(url) for url in urls]
    return await asyncio.gather(*tasks)


def outer_function(x: int) -> callable:
    """闭包：返回嵌套函数"""
    def inner(y: int) -> int:
        return x + y
    return inner


# ── 补充：Enum、match/case、上下文管理器、迭代器 ──

from enum import Enum


class HttpStatus(Enum):
    """HTTP 状态码枚举"""
    OK = 200
    CREATED = 201
    BAD_REQUEST = 400
    NOT_FOUND = 404
    SERVER_ERROR = 500

    @property
    def is_success(self) -> bool:
        return 200 <= self.value < 300


def handle_status(code: int) -> str:
    """模拟 match/case 模式匹配"""
    match code:
        case 200 | 201:
            return "Success"
        case 400:
            return "Bad Request"
        case 404:
            return "Not Found"
        case 500:
            return "Server Error"
        case _:
            return "Unknown"


class FileManager:
    """上下文管理器：自动关闭文件"""

    def __init__(self, path: str, mode: str = "r"):
        self.path = path
        self.mode = mode
        self.file = None

    def __enter__(self):
        print(f"Opening {self.path}")
        self.file = open(self.path, self.mode)
        return self.file

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.file:
            print(f"Closing {self.path}")
            self.file.close()
        return False


class NumberRange:
    """迭代器：生成数字范围"""

    def __init__(self, start: int, end: int):
        self.current = start
        self.end = end

    def __iter__(self):
        return self

    def __next__(self) -> int:
        if self.current > self.end:
            raise StopIteration
        value = self.current
        self.current += 1
        return value
