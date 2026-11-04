# 函数、闭包与类

## 函数

```osl
fn greet(who, punct = "!"):
    return "hello " + who + punct

greet("osl")        # hello osl!
greet("osl", "?")   # hello osl?
```

- 默认参数在**调用时**求值，且可以引用前面的参数。
- 没有关键字参数；多余实参被忽略，缺省实参为 `None`。
- 返回值缺省为 `None`。

## 匿名函数

三种写法：

```osl
let double = x => x * 2
let add = (a, b) => a + b
let make = fn(a):
    let base = a * 10
    return fn(b):
        return base + b
```

块体匿名函数（`fn(params):` 加缩进）在 1.1 中可用，之前只支持 `=>` 单表达式。

## 闭包

函数捕获定义处的作用域，并且可以读写外层变量：

```osl
fn counter():
    let n = 0
    return fn():
        n += 1
        return n

let c = counter()
print(c())   # 1
print(c())   # 2
```

## 作用域与声明规则

这是 1.1 变化最大的部分，务必记住三条：

1. **`let` 才引入名字**，作用于当前块（函数体、`if`/`for`/`try` 共用同一层）。
2. **`=` 只修改已存在的绑定**，不会隐式创建变量；找不到就报
   `Name 'x' is not defined — use 'let x = …' first`。
3. **`const` 不可重新赋值**，违反时报 `Cannot assign to constant 'x'`。

```osl
let total = 0

fn add():
    total += 1        # 修改外层变量，合法

fn bad():
    total = 0         # 也是修改外层变量（不是新建局部变量）
    # 想要局部变量请写：let total = 0
```

如果不希望影响外层，就显式声明：`let total = 0` 会遮蔽外层同名变量。

> 迁移提示：1.0 里 `x = 1` 会悄悄创建变量；1.1 起必须先用 `let` 声明。

## 类

```osl
class Point:
    fn init(x, y):          # 构造函数，self 自动注入
        self.x = x
        self.y = y

    fn length():
        return math.sqrt(self.x * self.x + self.y * self.y)

    fn move(dx, dy):
        self.x += dx
        self.y += dy

let p = Point(3, 4)
print(p.length())    # 5
p.move(1, 1)
print(p.x)           # 4
```

规则：

- 方法定义不写 `self` 参数，方法内部用 `self` 访问实例（普通函数里 `self` 为 `None`）。
- 构造函数可命名为 `init`、`__init__` 或 `constructor`。
- 字段是动态的，不需要预先声明。
- 属性读取优先返回字段，其次查找方法。

### 继承

```osl
class Shape:
    fn kind():
        return "shape"
    fn describe():
        return "a " + self.kind()

class Circle extends Shape:
    fn kind():
        return "circle"

print(Circle().describe())   # a circle
```

方法查找沿父链向上；`init` 也会沿父链查找。没有 `super` 调用，需要时请显式
`Shape.init(...)` 之类的方式并不支持，建议在子类里重新实现初始化逻辑。

## 递归

```osl
fn fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
```

递归深度上限 180 层，超出抛 `Maximum recursion depth (180) exceeded`。

## 一等函数

函数是值，可以放入列表、作为参数、从函数返回：

```osl
let ops = [x => x + 1, x => x * 2]
let value = 3
for op in ops:
    value = op(value)
print(value)   # 8
```

注意列表方法 `map` / `filter` / `sort` 接受的是函数值：

```osl
let nums = [3, 1, 2]
print(nums.map(x => x * 10))        # [30, 10, 20]
print(nums.sort((a, b) => a - b))   # 原地排序
```
