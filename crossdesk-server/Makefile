# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2026 lianzeliu
#
# CrossDesk Server: prebuilt musl aarch64 binary.
#
# The binary is NOT built here. It is built by the cloud workflow
# .github/workflows/build-openwrt.yml in lianzeliu/crossdesk-server
# (custom-id branch, includes the change_device_id custom-ID support),
# using the ImmortalWrt snapshot SDK + xmake, and published as a GitHub
# release tarball. This package only downloads that tarball and installs
# the binary + the admin web UI.
#
# After the workflow publishes a new release, update PKG_RELEASE_TAG
# and PKG_HASH below with the new tag and the tarball's real sha256
# (shown in the workflow log and on the release page).

include $(TOPDIR)/rules.mk

PKG_NAME:=crossdesk-server
PKG_VERSION:=1.7.7
PKG_RELEASE:=1

# Versioned release tag from the cloud workflow, e.g. openwrt-1.7.7-a1b2c3d.
# Deliberately NOT a rolling tag: a rolling tag would change the tarball
# under the same URL and invalidate PKG_HASH on every rebuild.
PKG_RELEASE_TAG:=openwrt-1.7.7-XXXXXXX

PKG_SOURCE:=crossdesk-server-openwrt-mediatek-filogic-arm64-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://github.com/lianzeliu/crossdesk-server/releases/download/$(PKG_RELEASE_TAG)/
# PLACEHOLDER: fill in the real sha256 of the release tarball after the
# cloud workflow runs for the first time. Do NOT invent a hash, and do
# not compute it from a locally built binary (cloud builds may differ
# byte-for-byte). The build will fail checksum verification until this
# is replaced, which is intentional.
PKG_HASH:=0000000000000000000000000000000000000000000000000000000000000000

PKG_MAINTAINER:=zeliu <134698307+lianzeliu@users.noreply.github.com>
PKG_LICENSE:=LGPL-3.0-only
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/crossdesk-server
  SECTION:=net
  CATEGORY:=Network
  TITLE:=CrossDesk Server Program (self-hosted, musl aarch64)
  DEPENDS:=@(aarch64) +libstdcpp
  URL:=https://github.com/lianzeliu/crossdesk-server
endef

define Package/crossdesk-server/description
  Self-hosted CrossDesk signaling server (custom-ID build).
  Serves the desktop/mobile clients, issues ICE (STUN/TURN)
  configuration and hosts the admin web UI.
  Runs on aarch64 musl routers (ImmortalWrt mediatek/filogic).
endef

define Package/crossdesk-server/conffiles
/etc/config/crossdesk-server
/etc/crossdesk
endef

define Build/Compile
	# Prebuilt binary from the cloud workflow release, nothing to compile.
	true
endef

define Package/crossdesk-server/install
	$(INSTALL_DIR) $(1)/usr/bin/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/crossdesk_server $(1)/usr/bin/crossdesk_server
	$(INSTALL_DIR) $(1)/usr/share/crossdesk/admin/
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/admin/index.html $(PKG_BUILD_DIR)/admin/admin.js $(PKG_BUILD_DIR)/admin/admin.css $(PKG_BUILD_DIR)/admin/crossdesk-logo.png $(1)/usr/share/crossdesk/admin/
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/crossdesk-server.conf $(1)/etc/config/crossdesk-server
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/crossdesk-server.init $(1)/etc/init.d/crossdesk-server
endef

$(eval $(call BuildPackage,crossdesk-server))
