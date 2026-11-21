# 界面改进说明：功能菜单

> 日期：2026-11-21
> 基线：`a640431`（增加证据使用模式 EVIDENCE_MODE）
> 范围：仅前端界面，未改动任何业务逻辑、证据数据或 API 契约

---

## 一、改了什么

### 新增组件 `src/components/audit/feature-menu.tsx`

一个点击展开、平滑下滑的功能菜单，替代原先平铺在页面上的「目标市场 + 内容类型」选择区。

**收起时**只占一行，显示当前选择的摘要：

```
审查选项    越南 Vietnam · 广告文案                      展开 ⌄
```

**展开后**分两组可选：

| 组 | 选项 |
| --- | --- |
| 目标市场 | 越南 Vietnam（可选）／泰国、印尼（禁用，标「即将支持」） |
| 内容类型 | 广告文案／商品详情页／客服话术（带证据覆盖度提示） |

### 修改 `src/components/audit/audit-workspace.tsx`

- 引入 `FeatureMenu`，移除原先约 30 行的平铺选择区
- 新增 `MENU_GROUPS` 配置，菜单项的标题、说明、提示、禁用状态都在这里声明
- 选项变更时同步更新收起态摘要

---

## 二、动画实现

用 `grid-template-rows: 0fr → 1fr` 配合 300ms 过渡：

```tsx
className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out
  ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
```

**为什么不用 `max-height`**：写死的 `max-height` 在内容增减时会导致动画时长不稳定或提前截断。
`grid-template-rows` 方案高度自适应，后续往菜单里加选项组不需要改任何动画参数。

箭头图标同步 180° 旋转。整体遵守 `prefers-reduced-motion`，
用户系统设置为减少动画时过渡自动关闭。

---

## 三、交互与无障碍

| 能力 | 实现 |
| --- | --- |
| 点击展开／收起 | `aria-expanded` + `aria-controls` 关联面板 |
| Esc 关闭 | `keydown` 监听，实测通过 |
| 点击面板外部关闭 | `pointerdown` 监听，实测通过 |
| 键盘导航 | 原生 `fieldset` + `legend` + `radio`，单选语义完整 |
| 禁用项 | `disabled` + `aria-disabled` + `cursor-not-allowed` + 「即将支持」标签 |
| 焦点可见 | 沿用站点 `:focus-visible` 样式，`has-[:focus-visible]:outline-cite` |

---

## 四、视觉评审后的修正

第一版做完后做了一轮视觉评审，发现并修掉以下问题：

| 问题 | 修正 |
| --- | --- |
| **面板过高，小屏上「内容类型」被挤出视口** | 面板限高 `min(60vh, 28rem)` 并内部滚动。实测 390×700 窄屏下两组均可访问 |
| 触发器白底圆角，与下方输入框视觉同质，不像可点击 | 改为浅灰底 `bg-paper`，展开时上下边框连成一体 |
| 组标题与卡片左边界不对齐 | 统一缩进，实测两组标题与卡片左边界均为 109px |
| 面板与触发器左右边界不严格同宽 | 实测 1280px 下两者边界完全一致（88 / 1176） |
| 窄屏丢掉「展开／收起」文字，只剩小箭头 | 文字在所有断点保留，触发器最小高度 48px 保证点按热区 |
| 选中态靠 1px→2px 边框切换，会抖动 | 改用 `box-shadow: inset 0 0 0 2px`，不影响布局 |
| 勾号偏细偏小 | 尺寸 `h-4 w-4`，`strokeWidth` 提到 3 |
| 禁用项只靠灰度区分，原因不够显眼 | 增加「即将支持」标签，组标题补「其他市场尚未接入证据」 |

---

## 五、验证记录

```
npm run typecheck   通过
npm run lint        通过，无警告
npm test            51 项全部通过
npm run build       生产构建成功
```

**浏览器实测**（生产模式）

| 项 | 结果 |
| --- | --- |
| 展开动画 | `grid-template-rows` 0px → 571px，过渡 0.3s |
| 桌面 1280px | 两组选项均在视口内，无需滚动 |
| 窄屏 390px | 面板限高 420px，内部可滚动，两组均渲染 |
| 边界对齐 | 按钮与面板左右边界完全一致 |
| 选项切换 | 点「客服话术」后摘要同步更新 |
| Esc 关闭 | `aria-expanded` 变 false，面板高度归零 |
| 点击外部关闭 | 正常收起 |
| 禁用项 | 泰国、印尼均带「即将支持」标签 |

**功能回归**（确认 GUI 改动没影响审查）

| 案例 | 结果 |
| --- | --- |
| map-store-locator | cached_demo · high · 3 条发现 |
| skincare-ad | cached_demo · medium · 7 条发现 |
| cs-shipping-reply | cached_demo · low · 0 条发现 |
| 三种内容类型自定义输入 | 均正常返回，引用 5–6 条证据 |

---

## 六、没有改的部分

- 任何业务逻辑、证据检索、风险判断
- `EVIDENCE_MODE` 相关实现（这是队友 `a640431` 的工作，完全保留）
- 证据数据、演示缓存
- API 契约与 `/api/audit` 的请求响应结构
- 所有免责声明与合规表述

---

## 七、后续可扩展的点

`MENU_GROUPS` 是纯配置，加新的选项组只需往数组里加一项，不需要改组件：

```tsx
{
  id: "depth",
  title: "审查深度",
  items: [
    { id: "quick", label: "快速", description: "只做规则匹配" },
    { id: "full", label: "完整", description: "规则 + 模型分析" },
  ],
}
```

目标市场组目前只有越南可选。等证据库接入其他市场，把对应项的 `disabled` 去掉即可。
