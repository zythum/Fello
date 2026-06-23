// ── 测试文件：C++ ──────────────────────────────

#include <iostream>
#include <string>
#include <vector>
#include <memory>
#include <optional>
#include <algorithm>
#include <chrono>
#include <functional>

/**
 * 用户角色枚举
 */
enum class UserRole {
    Admin,
    Editor,
    Viewer
};

/**
 * 用户类
 */
class User {
private:
    std::string id_;
    std::string name_;
    std::string email_;
    UserRole role_;

public:
    User(std::string id, std::string name, std::string email, UserRole role = UserRole::Viewer)
        : id_(std::move(id))
        , name_(std::move(name))
        , email_(std::move(email))
        , role_(role) {}

    const std::string& id() const { return id_; }
    const std::string& name() const { return name_; }
    const std::string& email() const { return email_; }
    UserRole role() const { return role_; }

    void setRole(UserRole role) { role_ = role; }

    virtual std::string describe() const {
        return "User: " + name_ + " <" + email_ + ">";
    }
};

/**
 * 管理员子类（继承 User）
 */
class AdminUser : public User {
public:
    AdminUser(std::string id, std::string name, std::string email)
        : User(std::move(id), std::move(name), std::move(email), UserRole::Admin) {}

    std::string describe() const override {
        return "Admin: " + name() + " <" + email() + "> [superuser]";
    }
};

/**
 * 用户仓库模板类
 */
template<typename T>
class Repository {
public:
    virtual ~Repository() = default;
    virtual std::optional<T> findById(const std::string& id) const = 0;
    virtual std::vector<T> findAll() const = 0;
    virtual void save(const T& item) = 0;
    virtual void remove(const std::string& id) = 0;
};

/**
 * 内存用户仓库实现
 */
class InMemoryUserRepository : public Repository<User> {
private:
    std::vector<User> users_;

public:
    std::optional<User> findById(const std::string& id) const override {
        auto it = std::find_if(users_.begin(), users_.end(),
            [&id](const User& u) { return u.id() == id; });
        if (it != users_.end()) return *it;
        return std::nullopt;
    }

    std::vector<User> findAll() const override {
        return users_;
    }

    void save(const User& user) override {
        auto it = std::find_if(users_.begin(), users_.end(),
            [&user](const User& u) { return u.id() == user.id(); });
        if (it != users_.end()) {
            *it = user;
        } else {
            users_.push_back(user);
        }
    }

    void remove(const std::string& id) override {
        std::erase_if(users_, [&id](const User& u) { return u.id() == id; });
    }
};

/**
 * 命名空间：工具函数
 */
namespace Utils {
    /**
     * 格式化时间戳为字符串
     */
    std::string formatTimestamp() {
        auto now = std::chrono::system_clock::now();
        auto time_t = std::chrono::system_clock::to_time_t(now);
        char buf[32];
        std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", std::localtime(&time_t));
        return std::string(buf);
    }
}

// ── 以下为补充的复杂性语法 ──

/**
 * constexpr 函数：编译期计算阶乘
 */
constexpr int factorial(int n) {
    return (n <= 1) ? 1 : n * factorial(n - 1);
}

/**
 * 别名模板
 */
template<typename T>
using ResultOrError = std::optional<T>;

/**
 * lambda 表达式存储在变量中
 */
auto make_adder = [](int x) {
    return [x](int y) { return x + y; };
};

/**
 * 运算符重载：输出 User 对象
 */
std::ostream& operator<<(std::ostream& os, const User& user) {
    os << user.name() << " <" << user.email() << ">";
    return os;
}

/**
 * 嵌套类：迭代器
 */
class TaskQueue {
public:
    class Iterator {
    public:
        explicit Iterator(int pos) : pos_(pos) {}
        int operator*() const { return pos_; }
        Iterator& operator++() { ++pos_; return *this; }
        bool operator!=(const Iterator& other) const { return pos_ != other.pos_; }
    private:
        int pos_;
    };

    Iterator begin() { return Iterator(0); }
    Iterator end() { return Iterator(10); }
};

/**
 * 结构化绑定测试（C++17）
 */
struct Point {
    double x, y;
};

/**
 * 简单结构体（非 class）
 */
struct Vec2 {
    float x, y;

    Vec2 operator+(const Vec2& other) const {
        return {x + other.x, y + other.y};
    }
};

// ── 补充：变参模板、if constexpr、noexcept/移动语义 ──

/**
 * 变参模板：打印任意数量参数
 */
template<typename... Args>
void printAll(Args... args) {
    (std::cout << ... << args) << std::endl;
}

/**
 * 变参模板：求和
 */
template<typename T>
T sum(T t) {
    return t;
}

template<typename T, typename... Args>
T sum(T first, Args... rest) {
    return first + sum(rest...);
}

/**
 * constexpr if：编译期分支
 */
template<typename T>
constexpr const char* typeName() {
    if constexpr (std::is_integral_v<T>) {
        return "integer";
    } else if constexpr (std::is_floating_point_v<T>) {
        return "float";
    } else {
        return "other";
    }
}

/**
 * noexcept 和移动语义
 */
class Buffer {
public:
    Buffer() : data_(nullptr), size_(0) {}

    // 移动构造函数
    Buffer(Buffer&& other) noexcept
        : data_(other.data_), size_(other.size_) {
        other.data_ = nullptr;
        other.size_ = 0;
    }

    // 移动赋值运算符
    Buffer& operator=(Buffer&& other) noexcept {
        if (this != &other) {
            delete[] data_;
            data_ = other.data_;
            size_ = other.size_;
            other.data_ = nullptr;
            other.size_ = 0;
        }
        return *this;
    }

    ~Buffer() noexcept {
        delete[] data_;
    }

    void allocate(size_t size) {
        data_ = new char[size];
        size_ = size;
    }

private:
    char* data_;
    size_t size_;
};

// ── 入口函数 ──
int main() {
    auto repo = std::make_unique<InMemoryUserRepository>();

    repo->save(User("1", "Alice", "alice@example.com", UserRole::Admin));
    repo->save(User("2", "Bob", "bob@example.com"));

    auto user = repo->findById("1");
    if (user.has_value()) {
        std::cout << user->describe() << std::endl;
    }

    std::cout << "Timestamp: " << Utils::formatTimestamp() << std::endl;

    // lambda
    auto add5 = make_adder(5);
    std::cout << "5 + 3 = " << add5(3) << std::endl;

    return 0;
}
