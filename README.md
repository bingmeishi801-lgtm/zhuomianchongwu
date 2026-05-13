# Desktop Pet

跨平台桌面宠物（Windows + macOS），基于 Electron。支持 GIF、PNG 序列帧、Lottie 动画；拖拽；右键菜单（退出/隐藏/切换动作/切换宠物）；动作系统（idle / 走路 / 睡觉 / 撒娇 / 跳舞…）。

## 目录结构

```
.
├── main.js              # 主进程：透明置顶窗口 + 托盘 + 右键菜单
├── preload.js           # 渲染进程桥
├── renderer/
│   ├── index.html
│   ├── style.css
│   ├── pet.js           # 动画引擎 + 状态机 + 拖拽
│   └── vendor/lottie.min.js
└── assets/
    ├── tray.png         # 可选：托盘图标
    └── pets/
        └── default/     # 一个宠物包
            ├── config.json
            ├── idle.gif
            ├── walk.gif
            ├── sleep.gif
            ├── cuddle/01.png 02.png 03.png 04.png
            └── dance.json   # Lottie
```

## 安装 & 运行

```bash
npm install
npm start
```

首次运行前，把真实 GIF / PNG / Lottie JSON 放进 `assets/pets/default/`，并确保 `config.json` 里的路径对得上。

## 添加新宠物

在 `assets/pets/` 下再建一个目录（例如 `mika`），拷一份 `config.json` 进去改路径即可，右键菜单 → 宠物 → 切换。

## 动作配置

`config.json` 的 `actions` 支持三种 `type`：

- `gif`：`src` 指向 `.gif`
- `sequence`：`frames` 为 PNG 路径数组，`fps` 帧率，`loop` 是否循环
- `lottie`：`src` 指向 Lottie `.json`

可选 `behavior`：
- `walk`：开启自动走动，`speed` 为每秒像素
- `idle-random`：每 5–15 秒随机切到其它动作

## 打包

```bash
# Windows 上出 .exe 安装包和便携版
npm run build:win

# macOS 上出 .dmg
npm run build:mac
```

产物在 `dist/` 下。交叉编译（在 Windows 上打 Mac 包）官方不推荐，最好各自的机器上打包。

## 注意

- `renderer/vendor/lottie.min.js` 目前是占位符。要用 Lottie 的话，从 [lottie-web](https://github.com/airbnb/lottie-web) 下一份 UMD 构建替换进去。
- macOS 上透明置顶窗口在全屏 App 上也可见（已设置 `visibleOnFullScreen: true`）。
- 托盘图标缺失时用空图；想要图标就在 `assets/tray.png` 放一张 16x16 或 32x32 的 PNG。
