// ── 测试文件：Go ──────────────────────────────
// 覆盖：包定义、导入、结构体、接口、方法、泛型、goroutine、defer、error 处理等

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ============ 基础类型与常量 ============

// UserRole 用户角色枚举
type UserRole int

const (
	RoleAdmin UserRole = iota
	RoleUser
	RoleGuest
)

// ============ 结构体定义 ============

// User 用户基础结构体
type User struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Role      UserRole  `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

// String 实现 fmt.Stringer 接口
func (u User) String() string {
	return fmt.Sprintf("User(%d: %s)", u.ID, u.Name)
}

// Address 地址结构体（用于嵌套测试）
type Address struct {
	Province string `json:"province"`
	City     string `json:"city"`
	Detail   string `json:"detail"`
}

// AdminUser 内嵌结构体（模拟继承）
type AdminUser struct {
	User                  // 内嵌
	Permissions []string `json:"permissions"`
}

// ============ 接口定义 ============

// Repository 用户仓库接口（泛型）
type Repository[T any] interface {
	FindByID(ctx context.Context, id int64) (*T, error)
	Save(ctx context.Context, entity *T) error
	Delete(ctx context.Context, id int64) error
}

// JSONSerializer 序列化接口
type JSONSerializer interface {
	ToJSON() ([]byte, error)
	FromJSON(data []byte) error
}

// ============ 结构体实现接口 ============

// InMemoryRepository 内存实现
type InMemoryRepository[T any] struct {
	mu     sync.RWMutex
	items  map[int64]*T
	nextID int64
}

// NewInMemoryRepository 构造函数
func NewInMemoryRepository[T any]() *InMemoryRepository[T] {
	return &InMemoryRepository[T]{
		items:  make(map[int64]*T),
		nextID: 1,
	}
}

// FindByID 通过 ID 查找
func (r *InMemoryRepository[T]) FindByID(ctx context.Context, id int64) (*T, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if ctx.Err() != nil {
		return nil, ctx.Err()
	}

	item, ok := r.items[id]
	if !ok {
		return nil, errors.New("not found")
	}
	return item, nil
}

// Save 保存实体
func (r *InMemoryRepository[T]) Save(ctx context.Context, entity *T) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if ctx.Err() != nil {
		return ctx.Err()
	}

	r.items[r.nextID] = entity
	r.nextID++
	return nil
}

// Delete 删除实体
func (r *InMemoryRepository[T]) Delete(ctx context.Context, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if ctx.Err() != nil {
		return ctx.Err()
	}

	delete(r.items, id)
	return nil
}

// Count 额外方法（非接口方法）
func (r *InMemoryRepository[T]) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.items)
}

// ============ ToJSON 方法实现 ============

// ToJSON 序列化 User 为 JSON
func (u User) ToJSON() ([]byte, error) {
	return json.Marshal(u)
}

// FromJSON 从 JSON 反序列化 User
func (u *User) FromJSON(data []byte) error {
	return json.Unmarshal(data, u)
}

// ============ 高阶函数与闭包 ============

// Map 切片映射（泛型函数）
func Map[T, U any](items []T, fn func(T) U) []U {
	result := make([]U, len(items))
	for i, item := range items {
		result[i] = fn(item)
	}
	return result
}

// Filter 切片过滤（泛型函数）
func Filter[T any](items []T, fn func(T) bool) []T {
	var result []T
	for _, item := range items {
		if fn(item) {
			result = append(result, item)
		}
	}
	return result
}

// Reduce 切片归约（泛型函数）
func Reduce[T, U any](items []T, initial U, fn func(U, T) U) U {
	result := initial
	for _, item := range items {
		result = fn(result, item)
	}
	return result
}

// ============ goroutine 与并发 ============

// Worker 工作协程
func Worker(id int, jobs <-chan int, results chan<- int) {
	for job := range jobs {
		results <- job * 2
	}
}

// RunWorkers 启动工作池
func RunWorkers(jobCount, workerCount int) []int {
	jobs := make(chan int, jobCount)
	results := make(chan int, jobCount)

	for w := 0; w < workerCount; w++ {
		go Worker(w, jobs, results)
	}

	for j := 0; j < jobCount; j++ {
		jobs <- j
	}
	close(jobs)

	var output []int
	for i := 0; i < jobCount; i++ {
		output = append(output, <-results)
	}
	return output
}

// ============ error 处理与自定义错误 ============

// ValidationError 自定义验证错误
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("validation error: %s - %s", e.Field, e.Message)
}

// ValidateUser 验证用户字段
func ValidateUser(u *User) error {
	if u.Name == "" {
		return &ValidationError{Field: "Name", Message: "cannot be empty"}
	}
	if u.Email == "" {
		return &ValidationError{Field: "Email", Message: "cannot be empty"}
	}
	return nil
}

// ============ defer / panic / recover ============

// SafeExecutor 带 recover 的安全执行器
type SafeExecutor struct {
	LastError error
}

// Execute 安全执行函数
func (s *SafeExecutor) Execute(fn func()) {
	defer func() {
		if r := recover(); r != nil {
			s.LastError = fmt.Errorf("panic: %v", r)
		}
	}()
	fn()
}

// ============ 方法测试（值接收者 vs 指针接收者） ===========

// Greet 值接收者方法
func (u User) Greet() string {
	return fmt.Sprintf("Hello, I'm %s", u.Name)
}

// UpdateEmail 指针接收者方法
func (u *User) UpdateEmail(newEmail string) {
	u.Email = newEmail
}

// ============ 空接口与类型断言 ============

// DescribeValue 描述任意类型值
func DescribeValue(v interface{}) string {
	switch val := v.(type) {
	case int:
		return fmt.Sprintf("integer: %d", val)
	case string:
		return fmt.Sprintf("string: %s", val)
	case bool:
		return fmt.Sprintf("boolean: %v", val)
	case *User:
		return fmt.Sprintf("user: %s", val.String())
	default:
		return fmt.Sprintf("unknown type: %T", val)
	}
}

// ============ context 超时控制 ============

// FetchWithTimeout 带超时的模拟请求
func FetchWithTimeout(ctx context.Context, url string) (string, error) {
	// 模拟请求
	select {
	case <-time.After(100 * time.Millisecond):
		return fmt.Sprintf("response from %s", url), nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// ============ init 函数 ============

func init() {
	fmt.Println("code-go.go initialized")
}

// ============ main 入口 ============

func main() {
	fmt.Println("Go example file loaded successfully")
}
