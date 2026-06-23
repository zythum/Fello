// ── 测试文件：TypeScript（接口、类型、函数、类） ──────────────

// ============ 导入 / 导出 ============

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { format as dateFormat } from 'date-fns';

export type { User, LoginRequest, LoginResponse };
export { formatDate, randomInt };

// ============ 接口与类型定义 ============

/**
 * 用户基本信息
 */
interface User {
  id: string;
  name: string;
  email: string;
  /** 用户头像 URL */
  avatar?: string;
  role: UserRole;
}

/**
 * 用户角色枚举
 */
type UserRole = 'admin' | 'editor' | 'viewer';

/**
 * 登录请求参数
 */
interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * 登录响应
 */
interface LoginResponse {
  token: string;
  user: User;
  expiresAt: number;
}

/**
 * 分页参数
 */
interface PaginationParams {
  page: number;
  pageSize: number;
  sort?: 'asc' | 'desc';
}

/**
 * API 统一响应包装
 */
interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

/**
 * 文件上传结果
 */
interface FileUploadResult {
  fileId: string;
  url: string;
  size: number;
  mimeType: string;
}

/**
 * 配置项：支持嵌套的 key-value 结构
 */
type ConfigValue = string | number | boolean | ConfigValue[] | { [key: string]: ConfigValue };

// ── 补充：复杂 TypeScript 特有类型 ──

/**
 * 泛型接口：带约束的分页查询
 */
interface PageQuery<T extends { id: string }> {
  page: number;
  pageSize: number;
  filters: Partial<T>;
}

/**
 * 接口继承合并
 */
interface AdminUser extends User {
  permissions: string[];
  department: string;
}

/**
 * 可调用接口（函数类型签名）
 */
interface SortComparator {
  (a: unknown, b: unknown): number;
  label?: string;
}

/**
 * 可构造接口
 */
interface UserConstructor {
  new (name: string, email: string): User;
}

/**
 * 索引签名接口
 */
interface StringMap<V> {
  [key: string]: V;
}

/**
 * 抽象类：基础数据服务
 */
abstract class BaseService<T, ID> {
  abstract findById(id: ID): Promise<T | null>;
  abstract save(entity: T): Promise<void>;

  async exists(id: ID): Promise<boolean> {
    const result = await this.findById(id);
    return result !== null;
  }
}

/**
 * 条件类型：提取 Promise 包裹类型
 */
type Unwrap<T> = T extends Promise<infer U> ? U : T;

/**
 * 映射类型：将所有属性设为可选
 */
type PartialDeep<T> = {
  [P in keyof T]?: T[P] extends object ? PartialDeep<T[P]> : T[P];
};

/**
 * 字符串字面量联合 + 模板字面量类型
 */
type HttpMethod2 = 'GET' | 'POST' | 'PUT' | 'DELETE';
type ApiEndpoint = `/api/${string}`;

// ============ 函数与工具类 ============

/**
 * 格式化日期为 yyyy-MM-dd 格式
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 生成指定范围内的随机整数
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 深拷贝对象
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 防抖函数
 */
function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * 节流函数
 */
function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  interval: number
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastTime >= interval) {
      lastTime = now;
      fn(...args);
    }
  };
}

/**
 * 简单的缓存管理类
 */
class SimpleCache<T> {
  private cache = new Map<string, { value: T; expiresAt: number }>();

  /**
   * 设置缓存项，可指定 TTL（毫秒）
   */
  set(key: string, value: T, ttlMs: number = 60000): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * 获取缓存项，过期返回 undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * 枚举：HTTP 方法
 */
enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
}

// ── 补充：函数增强 ──

/**
 * 异步函数：模拟延迟
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成器函数：斐波那契数列
 */
function* fibonacci(limit: number): Generator<number> {
  let a = 0, b = 1;
  while (a <= limit) {
    yield a;
    [a, b] = [b, a + b];
  }
}

/**
 * 函数重载声明
 */
function parse(input: string): Record<string, string>;
function parse(input: string, separator: string): Record<string, string>;
function parse(input: string, separator: string = '&'): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of input.split(separator)) {
    const [key, value] = pair.split('=');
    result[key] = value;
  }
  return result;
}

/**
 * 箭头函数表达式（const 声明）
 */
const safeParse = (input: string): Record<string, string> => {
  try { return parse(input); }
  catch { return {}; }
};

/**
 * 使用私有字段的类
 */
class Counter {
  #count = 0;

  increment(): number {
    this.#count++;
    return this.#count;
  }

  get value(): number {
    return this.#count;
  }
}

/** 默认导出函数 */
export default function greet(name: string): string {
  return `Hello, ${name}!`;
}

// ── 补充：更多箭头函数场景（用于测试 arrow_function 解析） ──

/**
 * 显式返回类型的箭头函数 const
 */
const calculateScore = (base: number, bonus: number): number => {
  const total = base + bonus;
  return Math.min(total, 100);
};

/**
 * 高阶箭头函数：返回另一个箭头函数
 */
const createFormatter = (prefix: string): ((val: number) => string) => {
  return (val: number): string => `${prefix}: ${val.toFixed(2)}`;
};

/**
 * 链式回调：数组方法中的内联箭头
 */
function processItems(items: number[]): number[] {
  return items
    .filter(x => x > 0)
    .map(x => x * 2)
    .sort((a, b) => b - a);
}

/**
 * 类字段初始化为箭头函数（类属性）
 */
class EventEmitter {
  onData: (payload: unknown) => void = (payload) => {
    console.log('Data:', payload);
  };

  onError: (err: Error) => void = (err) => {
    console.error('Error:', err.message);
  };
}

/**
 * 泛型箭头函数声明
 */
const identity = <T>(value: T): T => value;

/**
 * 对象方法中的箭头（作为参数）
 */
function runWithTimer<T>(fn: () => T): T {
  const start = Date.now();
  const result = fn();
  const elapsed = Date.now() - start;
  console.log(`耗时: ${elapsed}ms`);
  return result;
}

/**
 * 立即执行箭头函数表达式（IIFE）
 */
const config = (() => {
  const env = process.env.NODE_ENV || 'development';
  return { env, debug: env !== 'production' };
})();

// ── 补充：命名空间、装饰器、declare ──

/**
 * 命名空间：日志工具
 */
namespace Logger {
  export function info(msg: string): void {
    console.log(`[INFO] ${msg}`);
  }

  export function error(msg: string): void {
    console.error(`[ERROR] ${msg}`);
  }

  /** 嵌套命名空间 */
  export namespace Formatters {
    export function timestamp(): string {
      return new Date().toISOString();
    }
  }
}

/**
 * 装饰器工厂：日志记录
 */
function log(target: unknown, propertyKey: string, descriptor: PropertyDescriptor): void {
  const original = descriptor.value;
  descriptor.value = function (...args: unknown[]) {
    console.log(`Calling ${propertyKey} with`, args);
    return original.apply(this, args);
  };
}

/**
 * 使用装饰器的类
 */
class Calculator {
  @log
  add(a: number, b: number): number {
    return a + b;
  }

  @log
  multiply(a: number, b: number): number {
    return a * b;
  }
}

/**
 * 环境类型声明（模拟 .d.ts）
 */
declare module '*.json' {
  const value: Record<string, unknown>;
  export default value;
}

/**
 * 全局类型声明
 */
declare global {
  interface Window {
    __APP_VERSION__: string;
  }
}
