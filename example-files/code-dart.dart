// ── 测试文件：Dart ──────────────────────────────

import 'dart:async';
import 'dart:collection';

export 'src/models.dart' show User, UserRole;

/// 用户角色枚举
enum UserRole {
  admin,
  editor,
  viewer;

  String get displayName {
    switch (this) {
      case UserRole.admin:
        return 'Administrator';
      case UserRole.editor:
        return 'Editor';
      case UserRole.viewer:
        return 'Viewer';
    }
  }
}

/// 用户数据类
class User {
  final String id;
  final String name;
  final String email;
  final UserRole role;

  const User({
    required this.id,
    required this.name,
    required this.email,
    this.role = UserRole.viewer,
  });

  /// 创建管理员用户
  factory User.admin(String id, String name, String email) {
    return User(id: id, name: name, email: email, role: UserRole.admin);
  }

  User copyWith({String? name, String? email, UserRole? role}) {
    return User(
      id: id,
      name: name ?? this.name,
      email: email ?? this.email,
      role: role ?? this.role,
    );
  }

  @override
  String toString() => 'User($name, $role)';
}

/// 用户仓库接口 - 抽象类
abstract class UserRepository {
  Future<User?> findById(String id);
  Future<List<User>> findAll();
  Future<void> save(User user);
  Future<void> deleteById(String id);
}

/// 内存用户仓库实现
class InMemoryUserRepository implements UserRepository {
  final Map<String, User> _store = {};

  @override
  Future<User?> findById(String id) async => _store[id];

  @override
  Future<List<User>> findAll() async => _store.values.toList();

  @override
  Future<void> save(User user) async {
    _store[user.id] = user;
  }

  @override
  Future<void> deleteById(String id) async {
    _store.remove(id);
  }
}

/// 用户服务
class UserService {
  final UserRepository _repository;

  UserService(this._repository);

  Future<List<User>> getAdminUsers() async {
    final users = await _repository.findAll();
    return users.where((u) => u.role == UserRole.admin).toList();
  }

  Future<User> createUser({
    required String name,
    required String email,
    UserRole role = UserRole.viewer,
  }) async {
    final user = User(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      name: name,
      email: email,
      role: role,
    );
    await _repository.save(user);
    return user;
  }
}

// ── Mixin ──

/// 日志混入
mixin LoggableMixin {
  void log(String message) {
    print('[${DateTime.now()}] $message');
  }

  void logError(String message, [Object? error]) {
    print('[ERROR] $message: $error');
  }
}

/// 可序列化混入
mixin SerializableMixin {
  Map<String, dynamic> toJson();

  String toJsonString() {
    return toJson().toString();
  }
}

// ── Extension ──

/// String 扩展方法
extension StringExtensions on String {
  String capitalize() {
    if (isEmpty) return this;
    return '${this[0].toUpperCase()}${substring(1)}';
  }

  bool get isEmail => RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(this);

  String truncate(int maxLength, {String suffix = '...'}) {
    if (length <= maxLength) return this;
    return '${substring(0, maxLength - suffix.length)}$suffix';
  }
}

/// List 扩展方法
extension ListExtensions<T> on List<T> {
  List<T> sortedBy(Comparable Function(T) keyExtractor) {
    return [...this]..sort((a, b) => keyExtractor(a).compareTo(keyExtractor(b)));
  }

  Map<K, List<T>> groupBy<K>(K Function(T) keyExtractor) {
    final map = <K, List<T>>{};
    for (final item in this) {
      final key = keyExtractor(item);
      map.putIfAbsent(key, () => []).add(item);
    }
    return map;
  }
}

// ── Extension Type (Dart 3.3+) ──

/// 强类型 ID 包装
extension type UserId(String value) {
  factory UserId.generate() => UserId(DateTime.now().millisecondsSinceEpoch.toString());

  bool get isValid => value.isNotEmpty;
}

// ── Typedef ──

/// 事件回调类型
typedef EventCallback<T> = void Function(T event);

/// JSON Map 类型
typedef JsonMap = Map<String, dynamic>;

/// 异步验证器
typedef AsyncValidator<T> = Future<bool> Function(T value);

// ── Top-level Functions ──

/// 获取所有管理员用户
Future<List<User>> fetchAdminUsers(UserRepository repository) async {
  final users = await repository.findAll();
  return users.where((u) => u.role == UserRole.admin).toList();
}

/// 验证邮箱格式
bool isValidEmail(String email) {
  return RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(email);
}

/// 重试异步操作
Future<T> retry<T>(
  Future<T> Function() operation, {
  int maxAttempts = 3,
  Duration delay = const Duration(seconds: 1),
}) async {
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      if (attempt == maxAttempts) rethrow;
      await Future.delayed(delay * attempt);
    }
  }
  throw StateError('Unreachable');
}

// ── Sealed class (Dart 3.0+) ──

/// 网络请求结果
sealed class Result<T> {
  const Result();
}

class Success<T> extends Result<T> {
  final T data;
  const Success(this.data);
}

class Failure<T> extends Result<T> {
  final String message;
  final Object? error;
  const Failure(this.message, [this.error]);
}

class Loading<T> extends Result<T> {
  const Loading();
}

// ── Getter / Setter at top level ──

/// 应用配置单例
AppConfig? _config;

/// 获取全局配置
AppConfig get appConfig => _config ??= AppConfig._();

/// 设置全局配置
set appConfig(AppConfig config) => _config = config;

class AppConfig {
  final String appName = 'Fello';
  final String version = '1.0.0';

  AppConfig._();
}

// ══════════════════════════════════════════════════
// ── Flutter 代码特征 ──
// ══════════════════════════════════════════════════

import 'package:flutter/material.dart' show
  BuildContext,
  InheritedWidget,
  StatelessWidget,
  StatefulWidget,
  State,
  Widget,
  Theme,
  MediaQuery,
  Scaffold,
  AppBar,
  Text,
  Center,
  ElevatedButton,
  EdgeInsets,
  Navigator,
  MaterialPageRoute,
  ChangeNotifier,
  ListenableBuilder,
  TextEditingController;

// ── StatelessWidget ──

/// 用户资料卡片（无状态组件）
class UserProfileCard extends StatelessWidget {
  final User user;
  final VoidCallback? onTap;

  const UserProfileCard({super.key, required this.user, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.all(8.0),
      child: ListTile(
        leading: CircleAvatar(child: Text(user.name[0])),
        title: Text(user.name),
        subtitle: Text(user.email),
        trailing: Text(user.role.displayName),
        onTap: onTap,
      ),
    );
  }
}

// ── StatefulWidget ──

/// 登录表单（有状态组件）
class LoginForm extends StatefulWidget {
  final UserRepository repository;

  const LoginForm({super.key, required this.repository});

  @override
  State<LoginForm> createState() => _LoginFormState();
}

class _LoginFormState extends State<LoginForm> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    setState(() => _isLoading = true);
    try {
      final user = await widget.repository.findById(_emailController.text);
      if (user != null && mounted) {
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => UserProfileCard(user: user)),
        );
      }
    } catch (e) {
      setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Login')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            TextField(controller: _emailController, decoration: const InputDecoration(labelText: 'Email')),
            TextField(controller: _passwordController, decoration: const InputDecoration(labelText: 'Password'), obscureText: true),
            if (_errorMessage != null) Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _isLoading ? null : _handleLogin,
              child: _isLoading ? const CircularProgressIndicator() : const Text('Login'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── InheritedWidget ──

/// 主题提供者（继承型组件）
class AppThemeProvider extends InheritedWidget {
  final AppConfig config;

  const AppThemeProvider({
    super.key,
    required this.config,
    required super.child,
  });

  static AppThemeProvider of(BuildContext context) {
    final result = context.dependOnInheritedWidgetOfExactType<AppThemeProvider>();
    assert(result != null, 'No AppThemeProvider found in context');
    return result!;
  }

  @override
  bool updateShouldNotify(AppThemeProvider oldWidget) => config != oldWidget.config;
}

// ── ChangeNotifier + ListenableBuilder ──

/// 应用状态管理
class AppState extends ChangeNotifier {
  User? _currentUser;
  bool _isDarkMode = false;

  User? get currentUser => _currentUser;
  bool get isDarkMode => _isDarkMode;

  void login(User user) {
    _currentUser = user;
    notifyListeners();
  }

  void logout() {
    _currentUser = null;
    notifyListeners();
  }

  void toggleDarkMode() {
    _isDarkMode = !_isDarkMode;
    notifyListeners();
  }
}

/// 使用 ListenableBuilder 监听状态
class ThemeToggleButton extends StatelessWidget {
  final AppState appState;

  const ThemeToggleButton({super.key, required this.appState});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: appState,
      builder: (context, _) {
        return Switch(
          value: appState.isDarkMode,
          onChanged: (_) => appState.toggleDarkMode(),
        );
      },
    );
  }
}

// ── BuildContext Extension ──

/// BuildContext 扩展方法
extension BuildContextExtensions on BuildContext {
  /// 主题色
  Color get primaryColor => Theme.of(this).primaryColor;

  /// 屏幕宽度
  double get screenWidth => MediaQuery.of(this).size.width;

  /// 屏幕高度
  double get screenHeight => MediaQuery.of(this).size.height;

  /// 是否深色模式
  bool get isDarkMode => Theme.of(this).brightness == Brightness.dark;

  /// 安全区域顶部高度
  double get topPadding => MediaQuery.of(this).padding.top;

  /// 获取 AppThemeProvider
  AppConfig get appConfig => AppThemeProvider.of(this).config;

  /// 弹出 SnackBar
  void showSnackBar(String message) {
    ScaffoldMessenger.of(this).showSnackBar(SnackBar(content: Text(message)));
  }
}

// ── Widget 测试辅助 ──

/// Widget 测试：查找条件枚举
enum FindCondition {
  exactlyOne,
  atLeastOne,
  none,
}

/// Widget 测试 finder 扩展（模拟 flutter_test API）
extension WidgetTestExtensions on Widget {
  /// 模拟查找特定类型子组件（简化版）
  Iterable<Widget> findWidgets(Type type) sync* {
    if (runtimeType == type) yield this;
  }
}
