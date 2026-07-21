# homebridge-ninebot

<p align="center">
  <strong>将 Ninebot / Segway 电动车以简洁、高级的 HomeKit 配件方式呈现。</strong><br>
  电量、充电、锁状态、续航、骑行能耗和远程操作集中在一个 Homebridge 动态平台中。
</p>

> 通过与 **NinePlus LiveRide** 相同的 Ninebot Proxy API 工作；不保存九号账号密码，也不会向任何第三方上传数据。

## HomeKit 中显示的主要功能

| HomeKit 服务 | 显示或控制内容 |
| --- | --- |
| 电瓶车电池 | 电量、低电量提醒，以及标准 HomeKit 的“是否正在充电”状态 |
| 充电器 | 以标准插座显示。开关代表“已连接充电器”；“使用中”代表“正在充电”。该状态只读，不会控制车辆或市电。 |
| 电池温度 | BMS / 电池温度 |
| 车辆电源 | 远程启动、关闭发动机 |
| 车辆锁状态 | 是否已锁车；目前为只读，避免错误控制 |
| 寻车响铃 | 点击后向车辆发送响铃命令并自动复位 |
| 打开坐桶 | 点击后向车辆发送坐桶命令并自动复位 |
| 车辆状态与骑行数据 | 电池电压、预估充满剩余时间、车辆纬度/经度、预计续航、总里程、本月和最近一次骑行的能耗数据 |

旧版本把“车辆已上电”错误地注册为 `OccupancySensor`，所以 Apple 家庭 App 将其显示为人体传感器。升级后插件会在启动时自动删除该旧服务，不再创建人体传感器。

“车辆状态与骑行数据”使用 HomeKit 自定义特征，因此在 **Eve、Controller for HomeKit、Home+** 等高级客户端可完整查看电压、剩余充电时间和坐标；Apple 家庭 App 对自定义数值特征的显示有限，但会正常显示标准的电池、充电器、温度和锁状态。车辆位置由 Proxy 返回的经纬度提供；家庭 App 没有原生的车辆地图服务。

## 安装

### Homebridge UI

1. 在 Homebridge UI 的 **插件** 页面安装 `homebridge-ninebot`。
2. 打开插件设置，填写 `baseUrl` 和（如需要）`bearerToken`。
3. 保存后重启 Homebridge。
4. 在 Home App 中使用 Homebridge Bridge 的二维码配对；如果该 Bridge 已经配对，只需等待配件刷新出现。

> HomeKit 不会为单个插件单独生成二维码：所有插件配件均由现有的 Homebridge Bridge 统一配对和管理。

### 配置示例

```json
{
  "platform": "Ninebot",
  "name": "Ninebot",
  "baseUrl": "http://192.168.1.20:18009",
  "bearerToken": "",
  "pollIntervalSeconds": 30,
  "requestTimeoutSeconds": 30,
  "allowInsecureHttp": true,
  "showLockStatus": true,
  "vehicles": []
}
```

- `baseUrl`：Ninebot Proxy 或 NinePlus Platform 的地址。省略协议时会默认使用 `http://`。
- `bearerToken`：仅当你的代理/平台启用了 Bearer Token 时填写。
- `vehicles`：留空自动发现全部车辆；也可以按 SN 固定指定车辆并自定义 HomeKit 名称。
- `pollIntervalSeconds`：建议保留 `30` 秒，范围是 15–3600 秒。
- `requestTimeoutSeconds`：单次连接 Ninebot Proxy 的最长等待时间；默认 `30` 秒，范围是 3–120 秒。若日志提示连接超时，可先设为 `60` 秒；若仍超时，请检查 Homebridge 主机到 Proxy 的网络连通性和 Proxy 服务状态。
- 所有 HomeKit 读取都只返回插件缓存，不会在用户打开家庭 App 时并发请求 Proxy；因此 Proxy 离线或缓慢时不会触发“读取处理器过慢/未响应”错误。电量或温度首次缺失时会暂时隐藏对应服务而不是显示 `0`，收到有效值后会自动显示。
- `allowInsecureHttp`：局域网内常用 HTTP 代理时保持 `true`；公网环境建议使用 HTTPS 并改为 `false`。

指定单台车的示例：

```json
{
  "platform": "Ninebot",
  "name": "Ninebot",
  "baseUrl": "https://ninebot.example.com",
  "bearerToken": "请在 Homebridge UI 私密字段中填写",
  "vehicles": [
    {
      "sn": "N2GXXXXXXXXX",
      "name": "我的九号"
    }
  ]
}
```

## 支持的 Ninebot Proxy API

```text
GET  /vehicles
GET  /vehicles/:sn/status
GET  /vehicles/:sn/battery
GET  /vehicles/:sn/travel?month=YYYYMM
POST /vehicles/:sn/bell
POST /vehicles/:sn/buck
POST /vehicles/:sn/engine/start
POST /vehicles/:sn/engine/stop
```

插件兼容 NinePlus LiveRide 已实现的常见字段别名，并会对不同固件返回的电压、温度、Wh / kWh 类能耗单位进行归一化，避免“本次用电”或“能耗”空白、量级错误。

## 安全与隐私

- 不要把 Bearer Token、九号账号密码或 Homebridge 管理员密码提交到 GitHub。
- 插件只从你在 Homebridge 配置中填写的地址读取或发送命令。
- 锁车接口尚未包含在当前 Proxy API 中，因此插件**只展示是否已锁车**，不会伪造“锁车/解锁成功”。
- 若 Proxy 没有返回 `chargerConnected` 一类字段，插件只能把“正在充电”作为充电器状态的后备判断；充满后仍插着充电器时，连接状态可能无法由该 Proxy 区分。
- 远程启动、响铃、开坐桶会真实向车辆发送命令；请在安全环境中使用。

## 本地开发

```bash
npm install
npm test
npm pack
```

运行 `npm pack` 会生成可在 Homebridge 主机上离线安装的 `homebridge-ninebot-*.tgz` 文件。

## 许可证

MIT
