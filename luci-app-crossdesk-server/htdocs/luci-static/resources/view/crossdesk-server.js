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
	const text = running ? _('运行中') : _('未在运行');
	return '<em><span style="color:%s"><strong>%s %s</strong></span></em>'.format(color, name, text);
}

// Run a helper script. On failure, show the script's own output in the
// page, so the user can see WHY it failed without opening SSH.
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
			const detail = ((res.stderr || res.stdout || _('未知错误')).trim());
			ui.addNotification(null, E('div', [
				E('p', _('执行失败')),
				E('pre', { 'style': 'white-space:pre-wrap' }, detail)
			]), 'error');
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

		// ---- Status ----
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
					const hint = document.getElementById('turnserver_hint');
					if (hint) {
						if (!results[1])
							hint.textContent = _('中转未在运行：去下方“中转”一节勾上“启用本机中转”，点“应用并启动中转”。');
						else
							hint.textContent = '';
					}
				});
			});

			return E('div', { 'class': 'cbi-section', 'id': 'status_bar' }, [
				E('p', { 'id': 'crossdesk_status' }, _('Collecting data…')),
				E('p', { 'id': 'turnserver_status' }, _('Collecting data…')),
				E('p', { 'id': 'turnserver_hint', 'style': 'color:#888' }, ''),
				E('p', {}, _('监听端口: %s').format(port))
			]);
		};

		// ---- Basic ----
		s = m.section(form.NamedSection, 'global', 'crossdesk-server', _('基本设置'));

		o = s.option(form.Flag, 'enabled', _('启用服务'));
		o.rmempty = false;

		o = s.option(form.Value, 'port', _('监听端口'));
		o.datatype = 'port';
		o.placeholder = '9090';

		o = s.option(form.Value, 'domain', _('域名'),
			_('客户端连接用的域名，例如 1688.goip.de。'));
		o.datatype = 'hostname';
		o.placeholder = '1688.goip.de';

		o = s.option(form.Flag, 'auto_fw', _('允许从互联网连接'),
			_('在防火墙上放行信号端口（TCP）。'));

		// ---- Relay (TURN) ----
		s = m.section(form.NamedSection, 'turn', 'crossdesk-server', _('中转 (TURN)'));

		o = s.option(form.Flag, 'use_local', _('启用本机中转 (coturn)'),
			_('勾上后用路由器上的 coturn 做中转。直连失败时客户端走它继续连接。'));
		o.rmempty = false;

		o = s.option(form.Value, 'secret', _('中转密钥'),
			_('本机 coturn 和服务端共用的密钥。留空也没关系，点“应用并启动中转”时会自动生成一串随机的填回来。'));
		o.password = true;
		o.optional = true;
		o.depends('use_local', '1');

		o = s.option(form.Value, 'local_port', _('本机中转监听端口'));
		o.datatype = 'port';
		o.placeholder = '3478';
		o.depends('use_local', '1');

		o = s.option(form.Value, 'host', _('第三方 TURN 地址'),
			_('不用本机中转时，在这里填第三方的 TURN 服务器地址。'));
		o.datatype = 'hostname';
		o.optional = true;
		o.placeholder = '1688.goip.de';
		o.depends('use_local', '0');

		o = s.option(form.Value, 'port', _('第三方 TURN 端口'));
		o.datatype = 'port';
		o.placeholder = '3478';
		o.depends('use_local', '0');

		o = s.option(form.Value, 'credential_ttl', _('中转凭证有效期（秒）'));
		o.datatype = 'range(60,86400)';
		o.placeholder = '3600';

		o = s.option(form.Value, 'relay_min_port', _('中转端口范围下限'));
		o.datatype = 'port';
		o.placeholder = '50000';
		o.depends('use_local', '1');

		o = s.option(form.Value, 'relay_max_port', _('中转端口范围上限'));
		o.datatype = 'port';
		o.placeholder = '50100';
		o.depends('use_local', '1');

		o = s.option(form.Value, 'realm', _('Realm（留空用域名）'));
		o.datatype = 'hostname';
		o.optional = true;
		o.depends('use_local', '1');

		o = s.option(form.Value, 'external_ip', _('外网地址（留空自动用 WAN 口 IP）'),
			_('留空最省事：中转地址用 WAN 口 IP，每次分配时现取，公网 IP 变了不用重新应用。只有 WAN 口是私网 IP（运营商 CGNAT、前面还有一级路由）时才需要填，填域名或公网 IP；填了域名的话，IP 变了要重新点一次“应用并启动中转”。'));
		o.datatype = 'hostname';
		o.optional = true;
		o.depends('use_local', '1');

		o = s.option(form.Button, '_relay_apply', _('应用并启动中转'),
			_('只需要点这一个按钮：按上方配置生成中转配置、放行防火墙、启用并启动 coturn，然后重启服务端。不用再单独点启动。'));
		o.inputstyle = 'apply';
		o.depends('use_local', '1');
		o.onclick = function() {
			return runHelper(m, '/usr/libexec/crossdesk-server/turnserver-apply.sh', [],
				_('应用并启动中转'), _('中转已应用并启动，服务端已重启。')).then(function(ok) {
				if (ok)
					window.location.reload();
			});
		};

		o = s.option(form.Button, '_relay_stop', _('停止中转'),
			_('停止本机 coturn。'));
		o.inputstyle = 'apply';
		o.onclick = function() {
			return runHelper(m, '/etc/init.d/turnserver', ['stop'],
				_('停止中转'), _('coturn 已停止。'));
		};

		// ---- ICE / STUN ----
		s = m.section(form.NamedSection, 'ice', 'crossdesk-server', _('打洞 (STUN)'));

		o = s.option(form.DynamicList, 'stun', _('STUN 服务器'),
			_('每行一个，格式 stun:主机:端口。STUN 只帮打洞，直连失败时仍需中转。留空则不下发。'));
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

		// ---- Certificate ----
		s = m.section(form.NamedSection, 'cert', 'crossdesk-server', _('证书'));

		o = s.option(form.Button, '_gen_selfsigned', _('生成证书'),
			_('生成一对自签证书（有效期 10 年），写进 /etc/crossdesk/certs，覆盖已有证书，并重启服务。'));
		o.inputstyle = 'apply';
		o.onclick = function() {
			return runHelper(m, '/usr/libexec/crossdesk-server/cert-selfsigned.sh', [],
				_('生成证书'), _('证书已生成，服务已重启（如正在运行）。'));
		};

		o = s.option(form.Button, '_del_cert', _('删除证书'),
			_('删除 /etc/crossdesk/certs 下的证书文件。删完之后服务不会自动补证书，请再点“生成证书”重新生成。'));
		o.inputstyle = 'apply';
		o.onclick = function() {
			return runHelper(m, '/usr/libexec/crossdesk-server/cert-delete.sh', [],
				_('删除证书'), _('证书已删除。请点“生成证书”重新生成。'));
		};

		// ---- Advanced ----
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
