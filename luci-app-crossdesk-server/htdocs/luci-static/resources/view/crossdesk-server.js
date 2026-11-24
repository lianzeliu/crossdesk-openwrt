// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';

const callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

function getServiceStatus() {
	return L.resolveDefault(callServiceList('crossdesk-server'), {}).then(function(res) {
		return !!res?.['crossdesk-server']?.['instances']?.['crossdesk-server']?.['running'];
	});
}

function getTurnserverStatus() {
	return L.resolveDefault(callServiceList('turnserver'), {}).then(function(res) {
		const inst = res?.['turnserver']?.['instances'];
		if (!inst)
			return false;
		for (const k in inst) {
			if (inst[k]?.['running'])
				return true;
		}
		return false;
	});
}

function serviceLine(name, running) {
	const color = running ? 'green' : 'red';
	const text = running ? _('RUNNING') : _('NOT RUNNING');
	return '<em><span style="color:%s"><strong>%s %s</strong></span></em>'.format(color, name, text);
}

function runHelper(map, script, args, title, successMsg) {
	ui.showModal(title, [
		E('p', { 'class': 'spinning' }, _('正在执行，请稍候…'))
	]);
	return map.save().then(function() {
		return fs.exec(script, args || []);
	}).then(function(res) {
		ui.hideModal();
		if (res.code === 0) {
			ui.addNotification(null, E('p', successMsg));
			return true;
		}
		else {
			ui.addNotification(null, E('p', _('执行失败：') + (res.stderr || res.stdout || _('未知错误'))), 'error');
			return false;
		}
	}).catch(function(err) {
		ui.hideModal();
		ui.addNotification(null, E('p', _('操作失败：') + (err.message || err)), 'error');
		return false;
	});
}

return view.extend({
	load: function() {
		return uci.load('crossdesk-server');
	},

	render: function(data) {
		let m, s, o;
		const port = uci.get('crossdesk-server', 'global', 'port') || '9090';

		m = new form.Map('crossdesk-server', _('CrossDesk Server'));

		s = m.section(form.TypedSection);
		s.anonymous = true;
		s.render = function() {
			poll.add(function() {
				return Promise.all([
					L.resolveDefault(getServiceStatus()),
					L.resolveDefault(getTurnserverStatus())
				]).then(function(results) {
					const el = document.getElementById('crossdesk_status');
					if (el)
						el.innerHTML = serviceLine(_('CrossDesk Server'), results[0]);
					const tel = document.getElementById('turnserver_status');
					if (tel)
						tel.innerHTML = serviceLine(_('TURN 中转 (coturn)'), results[1]);
				});
			});

			return E('div', { 'class': 'cbi-section', 'id': 'status_bar' }, [
				E('p', { 'id': 'crossdesk_status' }, _('Collecting data…')),
				E('p', { 'id': 'turnserver_status' }, _('Collecting data…')),
				E('p', {}, _('监听端口（配置值）: %s').format(port))
			]);
		};

		s = m.section(form.NamedSection, 'global', 'crossdesk-server', _('基本设置'));

		o = s.option(form.Flag, 'enabled', _('启用'));
		o.rmempty = false;

		o = s.option(form.Value, 'port', _('监听端口'));
		o.datatype = 'port';
		o.placeholder = '9090';

		o = s.option(form.Value, 'domain', _('域名'),
			_('客户端连接用的域名，例如 1688.goip.de。'));
		o.datatype = 'hostname';
		o.placeholder = '1688.goip.de';

		o = s.option(form.Flag, 'auto_fw', _('允许从互联网连接'),
			_('在防火墙上放行信号端口（TCP）。如果路由器 WAN 口本来就放行了，不用勾。'));

		s = m.section(form.NamedSection, 'ice', 'crossdesk-server', _('ICE / STUN'));

		o = s.option(form.DynamicList, 'stun', _('自定义 STUN 服务器'),
			_('每行一个，格式 stun:主机:端口。STUN 只帮客户端打洞，直连失败时仍需 TURN 中转。留空则不下发 STUN。'));
		o.placeholder = 'stun:stun.qq.com:3478';
		o.validate = function(section_id, value) {
			if (!value)
				return true;
			const mm = value.match(/^(stun|turn):(.+)$/);
			if (!mm)
				return _('格式不对，应为 stun:主机:端口 或 turn:主机:端口');
			if (mm[1] === 'stun' && value.indexOf('?') !== -1)
				return _('STUN 地址不支持 ?transport= 参数');
			return true;
		};

		s = m.section(form.NamedSection, 'turn', 'crossdesk-server', _('TURN（中转）'));

		o = s.option(form.Value, 'host', _('TURN 服务器地址'),
			_('直连失败时客户端走这个中转。用本机 coturn 时，点“应用中转配置”后自动填为域名；用第三方 TURN 时手动填。'));
		o.datatype = 'hostname';
		o.optional = true;
		o.placeholder = '1688.goip.de';

		o = s.option(form.Value, 'port', _('TURN 端口'));
		o.datatype = 'port';
		o.placeholder = '3478';

		o = s.option(form.Value, 'secret', _('TURN 共享密钥'),
			_('本机 coturn 和服务端共用这一个 secret，只填一次：写进 coturn 的 static-auth-secret，服务端用它给每个客户端派发临时账号密码。必须和 coturn 的配置一致。'));
		o.password = true;
		o.optional = true;

		o = s.option(form.Value, 'credential_ttl', _('TURN 凭证有效期（秒）'),
			_('服务端给客户端派发的 TURN 临时凭证的有效期。'));
		o.datatype = 'range(60,86400)';
		o.placeholder = '3600';

		o = s.option(form.Flag, 'use_local', _('使用本机 coturn 中转'),
			_('勾上后用本机跑的 coturn 做中转，secret 只填一次，服务端 TURN 地址自动同步为“域名:监听端口”。取消则用上面手动填的第三方 TURN（本机 coturn 不动）。'));
		o.rmempty = false;

		o = s.option(form.Value, 'local_port', _('本机 coturn 监听端口'));
		o.datatype = 'port';
		o.placeholder = '3478';
		o.depends('use_local', '1');

		o = s.option(form.Value, 'realm', _('Realm'),
			_('留空则用域名。'));
		o.datatype = 'hostname';
		o.optional = true;
		o.placeholder = _('默认与域名相同');
		o.depends('use_local', '1');

		o = s.option(form.Value, 'relay_min_port', _('中转端口范围下限'));
		o.datatype = 'port';
		o.placeholder = '50000';
		o.depends('use_local', '1');

		o = s.option(form.Value, 'relay_max_port', _('中转端口范围上限'));
		o.datatype = 'port';
		o.placeholder = '50100';
		o.depends('use_local', '1');

		o = s.option(form.Value, 'external_ip', _('外网地址'),
			_('留空则用域名。应用时会把域名解析成当前公网 IP 写进 coturn 配置（coturn 只认 IP）；公网 IP 变了要重新点一次“应用中转配置”。'));
		o.datatype = 'hostname';
		o.optional = true;
		o.placeholder = _('默认与域名相同');
		o.depends('use_local', '1');

		o = s.option(form.Button, '_relay_apply', _('应用中转配置'),
			_('按上方配置生成 /etc/turnserver.conf，把服务端 TURN 地址同步为“域名:监听端口”，添加防火墙规则（监听端口 + 中转端口段），然后启用并重启 coturn、重启服务端。改了监听端口后，旧端口的防火墙规则不会自动删，要去防火墙里手动删。'));
		o.inputstyle = 'apply';
		o.depends('use_local', '1');
		o.onclick = function() {
			return runHelper(m, '/usr/libexec/crossdesk-server/turnserver-apply.sh', [],
				_('应用中转配置'), _('中转配置已应用，coturn 与服务已重启。')).then(function(ok) {
				if (ok)
					window.location.reload();
			});
		};

		o = s.option(form.Button, '_relay_start', _('启动中转'),
			_('启动本机 coturn（用当前 /etc/turnserver.conf）。第一次用请先点“应用中转配置”，否则 coturn 可能因未启用而拒绝启动。'));
		o.inputstyle = 'apply';
		o.onclick = function() {
			return runHelper(m, '/etc/init.d/turnserver', ['start'],
				_('启动中转'), _('coturn 已启动。'));
		};

		o = s.option(form.Button, '_relay_stop', _('停止中转'),
			_('停止本机 coturn。'));
		o.inputstyle = 'apply';
		o.onclick = function() {
			return runHelper(m, '/etc/init.d/turnserver', ['stop'],
				_('停止中转'), _('coturn 已停止。'));
		};

		s = m.section(form.NamedSection, 'advanced', 'crossdesk-server', _('高级设置'));

		o = s.option(form.Value, 'max_connections', _('最大连接数'));
		o.datatype = 'range(1,65536)';
		o.placeholder = '8192';

		o = s.option(form.Value, 'auth_workers', _('认证工作线程数'));
		o.datatype = 'range(1,32)';
		o.placeholder = '2';

		o = s.option(form.Value, 'auth_timeout', _('认证超时（秒）'));
		o.datatype = 'range(15,900)';
		o.placeholder = '600';

		o = s.option(form.Value, 'auth_queue', _('认证队列容量'));
		o.datatype = 'range(1,16384)';
		o.placeholder = '4096';

		o = s.option(form.Value, 'auth_source_capacity', _('单来源认证并发上限'));
		o.datatype = 'range(1,4096)';
		o.placeholder = '256';

		o = s.option(form.Value, 'auth_source_per_minute', _('单来源每分钟认证上限'));
		o.datatype = 'range(1,6000)';
		o.placeholder = '60';

		o = s.option(form.Value, 'log_retention', _('日志保留天数'));
		o.datatype = 'range(1,3650)';
		o.placeholder = '185';

		o = s.option(form.Value, 'offline_retention', _('离线设备保留天数'));
		o.datatype = 'range(1,3650)';
		o.placeholder = '180';

		o = s.option(form.Value, 'retention_interval', _('清理间隔（秒）'));
		o.datatype = 'range(60,86400)';
		o.placeholder = '3600';

		return m.render();
	}
});
