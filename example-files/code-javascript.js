// ── 测试文件：JavaScript（纯 JS，无 TS 类型标注） ────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';

export { debounce, throttle };
export { SimpleCache as Cache };

/**
 * 格式化日期为 yyyy-MM-dd 格式
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 生成指定范围内的随机整数
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 深拷贝对象
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 防抖函数
 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * 节流函数
 */
function throttle(fn, interval) {
  let lastTime = 0;
  return (...args) => {
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
class SimpleCache {
  #cache = new Map();

  /**
   * 设置缓存项，可指定 TTL（毫秒）
   */
  set(key, value, ttlMs = 60000) {
    this.#cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * 获取缓存项，过期返回 undefined
   */
  get(key) {
    const entry = this.#cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.#cache.clear();
  }

  get size() {
    return this.#cache.size;
  }
}

// ── 补充：各种函数形式 ──

/**
 * 异步函数：模拟延迟
 */
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成器函数：斐波那契数列
 */
function* fibonacci(limit) {
  let a = 0, b = 1;
  while (a <= limit) {
    yield a;
    [a, b] = [b, a + b];
  }
}

/**
 * 箭头函数表达式（const 声明）
 */
const safeParse = (input) => {
  try { return JSON.parse(input); }
  catch { return {}; }
};

/**
 * 使用私有字段的类
 */
class Counter {
  #count = 0;

  increment() {
    this.#count++;
    return this.#count;
  }

  get value() {
    return this.#count;
  }
}

/**
 * 闭包：返回嵌套函数的高阶函数
 */
function createMultiplier(factor) {
  return function multiply(x) {
    return x * factor;
  };
}

/**
 * 默认导出函数
 */
export default function greet(name) {
  return `Hello, ${name}!`;
}

/**
 * 具名导出函数
 */
export function add(a, b) {
  return a + b;
}

/**
 * const 箭头函数导出
 */
export const subtract = (a, b) => a - b;

/**
 * Generator 委托
 */
function* countUpTo(max) {
  let i = 0;
  while (i <= max) {
    yield i++;
  }
}

/**
 * var 声明（传统方式）
 */
var version = '1.0.0';

/**
 * let 声明（块级作用域）
 */
let currentId = 0;

// ── 补充：类继承、静态成员 ──

/**
 * 自定义错误类（继承内置 Error）
 */
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }

  /** 格式化错误信息 */
  format() {
    return `[${this.field}] ${this.message}`;
  }
}

/**
 * 配置管理器（静态成员 + 静态初始化块）
 */
class ConfigManager {
  static #instances = new Map();

  static {
    console.log('ConfigManager 初始化');
    this.#instances.set('default', new ConfigManager({}));
  }

  constructor(config) {
    this.config = config;
  }

  static getDefault() {
    return this.#instances.get('default');
  }

  static create(name, config) {
    const instance = new ConfigManager(config);
    this.#instances.set(name, instance);
    return instance;
  }
}
