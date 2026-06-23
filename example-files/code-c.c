// ── 测试文件：C ──────────────────────────────

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define MAX_NAME_LEN 64
#define MAX_TASKS 1024

/**
 * 任务状态枚举
 */
typedef enum {
    TASK_PENDING,
    TASK_IN_PROGRESS,
    TASK_COMPLETED,
    TASK_CANCELLED
} TaskStatus;

/**
 * 任务结构体
 */
typedef struct {
    int id;
    char title[MAX_NAME_LEN];
    TaskStatus status;
    int priority;
    time_t created_at;
} Task;

/**
 * 任务管理器
 */
typedef struct {
    Task tasks[MAX_TASKS];
    int count;
} TaskManager;

/**
 * 初始化任务管理器
 */
void tm_init(TaskManager* tm) {
    tm->count = 0;
}

/**
 * 添加任务
 */
int tm_add_task(TaskManager* tm, const char* title, int priority) {
    if (tm->count >= MAX_TASKS) return -1;

    Task* t = &tm->tasks[tm->count];
    t->id = tm->count + 1;
    strncpy(t->title, title, MAX_NAME_LEN - 1);
    t->title[MAX_NAME_LEN - 1] = '\0';
    t->status = TASK_PENDING;
    t->priority = priority;
    t->created_at = time(NULL);

    return tm->count++;
}

/**
 * 完成任务
 */
int tm_complete_task(TaskManager* tm, int task_id) {
    for (int i = 0; i < tm->count; i++) {
        if (tm->tasks[i].id == task_id) {
            tm->tasks[i].status = TASK_COMPLETED;
            return 0;
        }
    }
    return -1; // 未找到
}

/**
 * 打印所有任务
 */
void tm_print_all(const TaskManager* tm) {
    printf("=== Task List (%d items) ===\n", tm->count);
    for (int i = 0; i < tm->count; i++) {
        const Task* t = &tm->tasks[i];
        printf("[%d] %s (prio: %d, status: %d)\n",
               t->id, t->title, t->priority, (int)t->status);
    }
}

/**
 * 释放管理器（非必需，当前实现使用静态数组）
 */
void tm_destroy(TaskManager* tm) {
    tm->count = 0;
}

// ── 以下为补充的复杂性语法 ──

/**
 * 联合体：多种数据类型表示
 */
typedef union {
    int int_value;
    double float_value;
    char* string_value;
} DataValue;

/**
 * 简单枚举（不借助 typedef）
 */
enum Color { RED, GREEN, BLUE };

/**
 * 函数指针类型
 */
typedef int (*Comparator)(const void*, const void*);

/**
 * 回调函数：符合函数指针签名
 */
int compare_by_id(const void* a, const void* b) {
    const Task* ta = (const Task*)a;
    const Task* tb = (const Task*)b;
    return ta->id - tb->id;
}

/**
 * 内联函数
 */
static inline int max(int a, int b) {
    return a > b ? a : b;
}

/**
 * 取最大值（测试函数名中含有指针参数）
 */
const char* longest_string(const char* a, const char* b) {
    return strlen(a) >= strlen(b) ? a : b;
}

/**
 * 嵌套结构体：分类信息
 */
typedef struct {
    char name[32];
    struct {
        int x;
        int y;
    } position;
} TaggedItem;

/**
 * 静态函数：文件内部使用
 */
static void internal_cleanup(TaskManager* tm) {
    for (int i = 0; i < tm->count; i++) {
        tm->tasks[i].status = TASK_CANCELLED;
    }
}

// ── 补充：函数指针变量、位域 ──

/**
 * 函数指针变量（非 typedef）
 */
int (*current_handler)(const char*); // NOLINT

/**
 * 注册回调函数
 */
void set_handler(int (*handler)(const char*)) {
    current_handler = handler;
}

/**
 * 激活回调
 */
int invoke_handler(const char* data) {
    if (current_handler) {
        return current_handler(data);
    }
    return -1;
}

/**
 * 位域结构体：设备标志位
 */
typedef struct {
    unsigned int powered : 1;
    unsigned int connected : 1;
    unsigned int has_error : 1;
    unsigned int reserved : 5;
} DeviceFlags;

/**
 * 解析位域
 */
const char* describe_flags(DeviceFlags flags) {
    if (flags.powered && flags.connected && !flags.has_error) {
        return "正常运行";
    }
    return "异常状态";
}
