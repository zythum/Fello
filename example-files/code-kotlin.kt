// ── 测试文件：Kotlin ──────────────────────────────

package com.example.test

import kotlinx.coroutines.*

/**
 * 用户数据类
 */
data class User(
    val id: String,
    var name: String,
    val email: String,
    val role: UserRole
)

/**
 * 用户角色枚举
 */
enum class UserRole {
    ADMIN,
    EDITOR,
    VIEWER
}

/**
 * 用户仓库接口
 */
interface UserRepository {
    suspend fun findById(id: String): User?
    suspend fun findAll(): List<User>
    suspend fun save(user: User): User
    suspend fun deleteById(id: String)
}

/**
 * 内存用户仓库实现
 */
class InMemoryUserRepository : UserRepository {
    private val users = mutableMapOf<String, User>()

    override suspend fun findById(id: String): User? {
        delay(10) // 模拟 IO
        return users[id]
    }

    override suspend fun findAll(): List<User> {
        return users.values.toList()
    }

    override suspend fun save(user: User): User {
        users[user.id] = user
        return user
    }

    override suspend fun deleteById(id: String) {
        users.remove(id)
    }
}

/**
 * 用户服务 - 使用协程
 */
class UserService(private val repository: UserRepository) {

    suspend fun getAdminUsers(): List<User> = coroutineScope {
        val allUsers = async { repository.findAll() }
        allUsers.await().filter { it.role == UserRole.ADMIN }
    }

    suspend fun createUser(name: String, email: String): User {
        val user = User(
            id = "usr_${System.currentTimeMillis()}",
            name = name,
            email = email,
            role = UserRole.VIEWER
        )
        return repository.save(user)
    }
}

/**
 * 顶层扩展函数：String 转为 UserRole
 */
fun String.toUserRole(): UserRole? {
    return try {
        UserRole.valueOf(this.uppercase())
    } catch (e: IllegalArgumentException) {
        null
    }
}

// ── 以下为补充的复杂性语法 ──

/**
 * 类型别名
 */
typealias UserMap = Map<String, User>
typealias Callback<T> = (T) -> Unit

/**
 * 密封类：操作结果
 */
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Error(val message: String, val exception: Throwable? = null) : Result<Nothing>()
}

/**
 * 密封接口：UI 状态
 */
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Loaded<T>(val data: T) : UiState<T>
    data class Failed(val message: String) : UiState<Nothing>
}

/**
 * 伴生对象
 */
class AppConfig private constructor() {
    companion object Factory {
        private var instance: AppConfig? = null

        fun getInstance(): AppConfig {
            if (instance == null) {
                instance = AppConfig()
            }
            return instance!!
        }
    }
}

/**
 * 运算符重载：复数
 */
data class Complex(val real: Double, val imag: Double) {
    operator fun plus(other: Complex): Complex {
        return Complex(real + other.real, imag + other.imag)
    }

    operator fun minus(other: Complex): Complex {
        return Complex(real - other.real, imag - other.imag)
    }

    operator fun times(other: Complex): Complex {
        return Complex(
            real * other.real - imag * other.imag,
            real * other.imag + imag * other.real
        )
    }
}

/**
 * Infix 函数
 */
data class Point(val x: Int, val y: Int) {
    infix fun distanceTo(other: Point): Double {
        val dx = x - other.x
        val dy = y - other.y
        return Math.sqrt((dx * dx + dy * dy).toDouble())
    }
}

/**
 * 高阶函数
 */
fun <T> List<T>.customFilter(predicate: (T) -> Boolean): List<T> {
    val result = mutableListOf<T>()
    for (item in this) {
        if (predicate(item)) result.add(item)
    }
    return result
}

/**
 * 内联函数
 */
inline fun <T> measureTime(label: String, block: () -> T): T {
    val start = System.currentTimeMillis()
    val result = block()
    val elapsed = System.currentTimeMillis() - start
    println("[$label] 耗时: ${elapsed}ms")
    return result
}

/**
 * 数据对象
 */
data object DefaultConfig {
    const val TIMEOUT_MS: Long = 5000
    const val MAX_RETRIES: Int = 3
}


// ── 补充：值类、作用域函数、解构、对象表达式 ──

/**
 * 行内值类：Email 封装
 */
@JvmInline
value class Email(val value: String) {
    init {
        require(value.contains("@")) { "Invalid email: $value" }
    }

    val domain: String get() = value.substringAfter("@")

    fun masked(): String {
        val (name, domain) = value.split("@")
        return "${name.first()}***@$domain"
    }
}

/**
 * 使用作用域函数的链式处理
 */
data class Order(val id: String, var amount: Double, var status: String = "pending")

fun processOrder(order: Order): String {
    return order.let {
        it.amount *= 1.1 // 加税
        it.status = "processed"
        it
    }.run {
        "订单 ${this.id} 已处理，金额: ${this.amount}"
    }.also { log ->
        println(log)
    }.let {
        it.uppercase()
    }
}

/**
 * 解构声明 + 数据转换
 */
data class Person(val firstName: String, val lastName: String, val age: Int)

fun describePerson(person: Person): String {
    val (first, last, age) = person
    return "$first $last 今年 $age 岁"
}

fun sortPeople(people: List<Person>): List<String> {
    return people
        .filter { (_, _, age) -> age >= 18 }
        .map { (first, last, _) -> "$first $last" }
        .sorted()
}

/**
 * 对象表达式（匿名对象）
 */
interface ClickListener {
    fun onClick(x: Int, y: Int)
    fun onLongPress(x: Int, y: Int)
}

fun createClickListener(): ClickListener {
    return object : ClickListener {
        private var lastClickTime = 0L

        override fun onClick(x: Int, y: Int) {
            lastClickTime = System.currentTimeMillis()
            println("Clicked at ($x, $y)")
        }

        override fun onLongPress(x: Int, y: Int) {
            println("Long press at ($x, $y)")
        }
    }
}
