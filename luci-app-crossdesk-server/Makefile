# SPDX-License-Identifier: Apache-2.0
#
# Copyright (C) 2026 lianzeliu

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for CrossDesk Server
LUCI_DEPENDS:=+crossdesk-server +acme +openssl-util +coturn

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=zeliu <134698307+lianzeliu@users.noreply.github.com>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
