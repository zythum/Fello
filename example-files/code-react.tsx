// ── 测试文件 3：React 组件（TSX） ──────────────────────────

import React, { useState, useEffect, useCallback } from 'react';

/** 组件 Props */
interface UserCardProps {
  userId: string;
  name: string;
  avatar?: string;
  onFollow?: (userId: string) => void;
}

/**
 * 用户名片组件
 */
const UserCard: React.FC<UserCardProps> = ({ userId, name, avatar, onFollow }) => {
  const [isFollowed, setIsFollowed] = useState(false);

  const handleFollow = useCallback(() => {
    setIsFollowed(!isFollowed);
    onFollow?.(userId);
  }, [userId, isFollowed, onFollow]);

  return (
    <div className="user-card">
      <img src={avatar ?? '/default-avatar.png'} alt={name} />
      <span>{name}</span>
      <button onClick={handleFollow}>
        {isFollowed ? '已关注' : '关注'}
      </button>
    </div>
  );
};

/** 组件 Props */
interface UserListProps {
  users: UserCardProps[];
  loading?: boolean;
}

/**
 * 用户列表组件
 */
const UserList: React.FC<UserListProps> = ({ users, loading }) => {
  if (loading) return <div>加载中...</div>;

  return (
    <div className="user-list">
      {users.map(user => (
        <UserCard key={user.userId} {...user} />
      ))}
    </div>
  );
};

// ── 以下为补充的复杂性语法 ──

/** 泛型列表组件 Props */
interface ListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  emptyText?: string;
}

/**
 * 泛型函数组件（带显式类型参数）
 */
function GenericList<T>({ items, renderItem, emptyText = '暂无数据' }: ListProps<T>) {
  if (items.length === 0) return <div>{emptyText}</div>;
  return <ul>{items.map((item, i) => <li key={i}>{renderItem(item, i)}</li>)}</ul>;
}

/**
 * 自定义 Hook：倒计时
 */
export function useCountdown(initial: number): [number, () => void] {
  const [count, setCount] = useState(initial);
  const reset = useCallback(() => setCount(initial), [initial]);

  useEffect(() => {
    if (count <= 0) return;
    const timer = setInterval(() => setCount(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [count]);

  return [count, reset];
}

/**
 * 默认导出的函数组件
 */
export default function App() {
  return <UserList users={[]} />;
}

export { UserCard, UserList };
export type { UserCardProps, UserListProps };

// ── 补充：类组件、HOC、动态导入 ──

/** 计数器 Props */
interface CounterProps {
  initialValue?: number;
}

/** 计数器 State */
interface CounterState {
  count: number;
}

/**
 * 类组件
 */
class CounterDisplay extends React.Component<CounterProps, CounterState> {
  constructor(props: CounterProps) {
    super(props);
    this.state = { count: props.initialValue ?? 0 };
  }

  componentDidMount(): void {
    console.log('CounterDisplay mounted');
  }

  render(): React.ReactNode {
    return (
      <div>
        <p>Count: {this.state.count}</p>
        <button onClick={() => this.setState(s => ({ count: s.count + 1 }))}>
          Increment
        </button>
      </div>
    );
  }
}

/** 用户卡片 Props（简化，用于 memo） */
interface MemoCardProps {
  name: string;
  avatar?: string;
}

/**
 * React.memo 包裹的组件
 */
const MemoUserCard = React.memo<MemoCardProps>(({ name, avatar }) => {
  return (
    <div>
      <img src={avatar ?? '/default.png'} alt={name} />
      <span>{name}</span>
    </div>
  );
});

/**
 * forwardRef 组件
 */
const FancyInput = React.forwardRef<HTMLInputElement, { label: string }>(
  ({ label }, ref) => {
    return (
      <div>
        <label>{label}</label>
        <input ref={ref} />
      </div>
    );
  }
);

/**
 * 动态导入 + Suspense
 */
const LazyDashboard = React.lazy(() =>
  import('./Dashboard').then(module => ({ default: module.Dashboard }))
);
