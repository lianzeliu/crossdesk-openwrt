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
# below with the new tag (shown in the workflow log and on the release
# page). PKG_HASH is intentionally 'skip' (user choice, 2026-11-24):
# hash verification is disabled, so only the tag needs updating per release.

include $(TOPDIR)/rules.mk

PKG_NAME:=crossdesk-server
PKG_VERSION:=1.7.7
PKG_RELEASE:=1

# Versioned release tag from the cloud workflow, e.g. openwrt-1.7.7-a1b2c3d.
# Deliberately NOT a rolling tag: a rolling tag would change the tarball
# under the same URL and invalidate PKG_HASH on every rebuild.
PKG_RELEASE_TAG:=openwrt-1.7.7-be2aa62

PKG_SOURCE:=crossdesk-server-openwrt-mediatek-filogic-arm64-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://github.com/lianzeliu/crossdesk-server/releases/download/$(PKG_RELEASE_TAG)/
# Hash verification disabled by user choice: the feed downloads the
# release tarball without checksum verification.
PKG_HASH:=skip

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

# The release tarball is flat (no top-level directory): crossdesk_server,
# admin/ and LICENSE sit at the top level. The default unpack extracts to
# $(PKG_BUILD_DIR)/.., which would spill them into the parent build dir
# (that's why the install step could not find crossdesk_server). Extract
# directly into $(PKG_BUILD_DIR) instead. Keep the workflow producing a
# flat tarball; if it ever gains a top-level directory, remove this.
define Build/Prepare
	tar -xzf $(DL_DIR)/$(PKG_SOURCE) -C $(PKG_BUILD_DIR)
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
