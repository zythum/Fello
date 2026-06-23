// ── 测试文件：Swift ──────────────────────────────

import Foundation

/// 用户模型
struct User: Codable {
    let id: String
    var name: String
    var email: String
    var role: UserRole
}

/// 用户角色枚举
enum UserRole: String, Codable {
    case admin
    case editor
    case viewer
}

/// 用户管理器
class UserManager {
    private var users: [String: User] = [:]
    private let queue = DispatchQueue(label: "com.example.usermanager", attributes: .concurrent)

    /// 添加用户
    func addUser(_ user: User) {
        queue.async(flags: .barrier) {
            self.users[user.id] = user
        }
    }

    /// 根据 ID 获取用户
    func getUser(by id: String) -> User? {
        queue.sync {
            return self.users[id]
        }
    }

    /// 获取所有管理员
    func getAdmins() -> [User] {
        queue.sync {
            return self.users.values.filter { $0.role == .admin }
        }
    }

    /// 删除用户
    func deleteUser(_ id: String) {
        queue.async(flags: .barrier) {
            self.users.removeValue(forKey: id)
        }
    }
}

/// 协议：可导出为 JSON
protocol JSONExportable {
    func toJSON() -> String
}

extension User: JSONExportable {
    func toJSON() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        if let data = try? encoder.encode(self),
           let json = String(data: data, encoding: .utf8) {
            return json
        }
        return "{}"
    }
}

/// 泛型函数：交换两个值
func swapValues<T>(_ a: inout T, _ b: inout T) {
    let temp = a
    a = b
    b = temp
}

// ── 以下为补充的复杂性语法 ──

/// 类型别名
typealias JSONDictionary = [String: Any]

/// 包含计算属性和下标的结构体
struct Matrix {
    private var data: [[Int]]
    let rows: Int
    let columns: Int

    init(rows: Int, columns: Int, defaultValue: Int = 0) {
        self.rows = rows
        self.columns = columns
        self.data = Array(repeating: Array(repeating: defaultValue, count: columns), count: rows)
    }

    /// 下标访问
    subscript(row: Int, column: Int) -> Int {
        get { return data[row][column] }
        set { data[row][column] = newValue }
    }

    /// 计算属性：转置矩阵
    var transposed: Matrix {
        var result = Matrix(rows: columns, columns: rows)
        for i in 0..<rows {
            for j in 0..<columns {
                result[j, i] = self[i, j]
            }
        }
        return result
    }

    /// 计算属性：矩阵描述
    var description: String {
        return data.map { row in row.map(String.init).joined(separator: " ") }.joined(separator: "\n")
    }
}

/// 嵌套枚举：网络状态
enum NetworkState {
    case idle
    case loading(progress: Double)
    case success(data: Data)
    case failure(error: Error)

    /// 嵌套类型
    enum Error: Swift.Error {
        case timeout
        case serverError(code: Int)
        case noConnection
    }
}

/// 遵守多个协议的扩展
extension User: Equatable {
    static func == (lhs: User, rhs: User) -> Bool {
        return lhs.id == rhs.id
    }
}

/// 泛型类型 + WHERE 子句
protocol Container {
    associatedtype Item
    var count: Int { get }
    mutating func append(_ item: Item)
}

struct Stack<Element>: Container {
    private var items: [Element] = []

    var count: Int { items.count }

    mutating func append(_ item: Element) {
        items.append(item)
    }

    mutating func pop() -> Element? {
        return items.popLast()
    }
}

/// 扩展泛型类型：仅当 Element 为 Equatable 时可用
extension Stack where Element: Equatable {
    func contains(_ element: Element) -> Bool {
        return items.contains(element)
    }
}

/// 闭包类型别名
typealias CompletionHandler = (Bool) -> Void

/// 使用闭包作为参数的函数
func performAsync(task: String, completion: @escaping CompletionHandler) {
    DispatchQueue.global().async {
        // 模拟工作
        completion(true)
    }
}

// ── 补充：actor、async/await、属性观察器、guard+defer ──

import _Concurrency

/// 用户数据管理器（Actor 隔离）
actor UserActor {
    private var cache: [String: User] = [:]
    private var accessCount = 0

    func getUser(id: String) async -> User? {
        accessCount += 1
        return cache[id]
    }

    func setUser(_ user: User) async {
        cache[user.id] = user
    }

    nonisolated func statistics() -> String {
        return "UserActor with \(accessCount) accesses"
    }
}

/// 异步下载器
class Downloader {
    func fetchData(from url: URL) async throws -> Data {
        let (data, _) = try await URLSession.shared.data(from: url)
        return data
    }

    func fetchMultiple(urls: [URL]) async throws -> [Data] {
        var results: [Data] = []
        for url in urls {
            let data = try await fetchData(from: url)
            results.append(data)
        }
        return results
    }
}

/// 温度传感器（含属性观察器）
class TemperatureSensor {
    var current: Double = 0 {
        willSet {
            print("温度将从 \(current) 变为 \(newValue)")
        }
        didSet {
            print("温度已从 \(oldValue) 变为 \(current)")
            if current > 100 {
                print("警告：温度过高！")
            }
        }
    }
}

/// 带 guard 和 defer 的文件处理器
class FileProcessor {
    func process(path: String) -> Bool {
        guard let fileHandle = FileHandle(forReadingAtPath: path) else {
            print("无法打开文件: \(path)")
            return false
        }

        defer {
            fileHandle.closeFile()
            print("文件已关闭")
        }

        let data = fileHandle.readDataToEndOfFile()
        print("读取了 \(data.count) 字节")
        return true
    }
}
