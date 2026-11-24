# crossdesk-openwrt

OpenWrt feed:自建 CrossDesk 服务端 + LuCI 界面。服务端是
[lianzeliu/crossdesk-server](https://github.com/lianzeliu/crossdesk-server)
的 `custom-id` 分支（带自定义 ID 功能），由云编译编成 musl aarch64
预编译包发布到 GitHub Release，本 feed 下载那个包做成 ipk。

目标机：ImmortalWrt SNAPSHOT，mediatek/filogic（MT7986A，aarch64）。
别的 aarch64 目标理论上也能装（只依赖路由器自带的 libstdc++ /
libgcc_s / libc），但只在 filogic 上验证过。

## 包含的包

| 包 | 说明 |
|---|---|
| `crossdesk-server` | 服务端二进制 + 管理页面（`/usr/share/crossdesk/admin`）+ procd 服务 + 默认配置 |
| `luci-app-crossdesk-server` | LuCI 界面：基本设置、自定义 STUN、TURN（含本机 coturn 中转）、高级设置。装它时会一起装上 `coturn`（中转） |

> `coturn` 来自 telephony feed。ImmortalWrt 默认 feeds 里有
> telephony；如果你的 feeds 里没有，先加
> `src-git telephony https://git.openwrt.org/feed/telephony.git`，
> 再 `./scripts/feeds update telephony`。

## 加进 OpenWrt 编译

在 buildroot（ImmortalWrt 源码）目录里：

```sh
# feeds.conf.default 里加一行（或 feeds.conf）
echo 'src-git crossdesk-openwrt https://github.com/lianzeliu/crossdesk-openwrt.git' >> feeds.conf.default

./scripts/feeds update crossdesk-openwrt
./scripts/feeds install -a -p crossdesk-openwrt
make menuconfig
#   Network ---> <*> crossdesk-server
#   LuCI ---> Applications ---> <*> luci-app-crossdesk-server
make -j$(nproc)
```

只想编 ipk 不进固件：

```sh
make package/crossdesk-server/compile V=s
make package/luci-app-crossdesk-server/compile V=s
```

编好后装到路由器：`opkg install crossdesk-server_*.ipk
luci-app-crossdesk-server_*.ipk`，或直接编进固件。

## 首次使用

1. LuCI → 服务 → CrossDesk Server。
2. 先确认证书在位（没有证书服务起不来，会直接拒绝启动并记一条日志）。证书是 `/etc/crossdesk/certs/` 下的 `api.crossdesk.cn_bundle.crt` + `api.crossdesk.cn.key`，用 openssl 手动生成、SAN=DNS:域名；客户端要么把根证书装进受信任根，要么用跳过自建校验的客户端版本。LuCI 里不提供证书生成功能。
3. 配 STUN（默认已填 `stun.qq.com` 和 `stun.miwifi.com`）和
   TURN（直连失败才用得上，需要另外跑一个 coturn，见下节）。
4. 勾“启用”，保存并应用，服务即启动。管理页面在
   `https://域名:端口/`（和信号端口同一个）。

## 中转（TURN，coturn）

服务端本身不带中转，只给客户端下发 ICE 配置；真正的中转靠
coturn。LuCI 里不用再手工配：

1. TURN 一节勾“使用本机 coturn 中转”，填好 secret（只填一次，
   本机 coturn 和服务端共用），监听端口默认 3478，中转端口段
   默认 50000-50100，realm 和外网地址留空就是域名。
2. 点“应用中转配置”，它一次做完：
   - 按 UCI 生成 `/etc/turnserver.conf`；
   - 把服务端 TURN 地址同步为“域名:监听端口”（之前手填的
     第三方地址会先存到 `turn.host_backup` / `turn.port_backup`，
     取消本机中转时自动恢复）；
   - 添加防火墙规则（监听端口 + 中转端口段，TCP+UDP），已有的
     不重复加；
   - 启用并重启 coturn（`/etc/init.d/turnserver`），重启服务端。
3. 状态栏里能看到 coturn 的运行状态；界面上也有启动/停止按钮。

注意两点：

- coturn 的 `external-ip` 只认 IP 不认域名，应用时会把外网
  地址（默认就是域名）解析成当前公网 IP 写进去。公网 IP 变
  了（重拨号）要重新点一次“应用中转配置”，否则中转会报一
  个旧 IP。
- 改了监听端口后，旧端口的防火墙规则不会自动删，要去
  LuCI → 网络 → 防火墙里手动删掉旧的
  `Allow-crossdesk-turn` 规则。
- 不想用本机 coturn 时取消勾选，上面手动填第三方 TURN 地址
  和 secret 即可，本机 coturn 不动（想停它就点“停止中转”）。

## 证书说明

服务端启动时只读两个文件：

- `/etc/crossdesk/certs/api.crossdesk.cn_bundle.crt`（证书链）
- `/etc/crossdesk/certs/api.crossdesk.cn.key`（私钥）

缺一个就 Fatal 退出。init 脚本在启动前会先检查，缺证书时拒绝
启动并写日志，不会死循环重启。

## /var 是内存盘

路由器重启后 `/var` 会清空。证书、设备数据库是持久数据，所以
init 脚本把它们实存在 `/etc/crossdesk/certs` 和
`/etc/crossdesk/db`，再用软链挂到服务端写死的路径上：

- `/var/lib/crossdesk/certs` → `/etc/crossdesk/certs`
- `/var/lib/crossdesk/db` → `/etc/crossdesk/db`

`/etc/crossdesk` 已写进 conffiles，sysupgrade 会保留。

## 升级流程

服务端更新后（`lianzeliu/crossdesk-server` 的 `custom-id` 分支
有新提交）：

1. 云编译工作流自动跑，发布一个新 release，tag 是
   `openwrt-1.7.7-<短 commit sha>`（每次提交一个新 tag，不滚动
   覆盖，见该仓库的 `.github/workflows/build-openwrt.yml`）。
2. 到 release 页面抄新 tag 和 tar 包的 sha256。
3. 改本仓库 `crossdesk-server/Makefile` 里的 `PKG_RELEASE_TAG`
   和 `PKG_HASH`（版本号变了也改 `PKG_VERSION`）。
4. 提交并推本仓库，路由器上 `./scripts/feeds update
   crossdesk-openwrt` 后重新编译。

## 注意

- 服务端监听端口默认 9090，客户端自建默认端口是 9099，两边要
  对上（要么客户端改 9090，要么改这里的端口）。
- STUN 只帮打洞。两个客户端都在 NAT 后面且打洞失败时，没有
  TURN 就连不上；TURN 用本机 coturn（装 LuCI 应用时一起装
  好），见“中转”一节。
- `turns:`（TLS TURN）服务端不支持，别配。
