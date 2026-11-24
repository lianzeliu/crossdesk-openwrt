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

const CERT_FILE = '/etc/crossdesk/certs/api.crossdesk.cn_bundle.crt';

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

function getCertInfo() {
	return L.resolveDefault(fs.exec('openssl', ['x509', '-in', CERT_FILE, '-noout', '-enddate']), {}).then(function(res) {
		if (!res || res.code !== 0 || !res.stdout)
			return null;
		const m = res.stdout.match(/notAfter=(.+)/);
		if (!m)
			return null;
		const date = new Date(m[1].trim());
		if (isNaN(date.getTime()))
			return null;
		return date;
	});
}

function formatCertInfo(date) {
	if (!date)
		return _('未生成证书（请先在下方生成自签证书或申请 Let\'s Encrypt 证书，否则服务无法启动）');
	const days = Math.floor((date.getTime() - Date.now()) / 86400000);
	const ds = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
	if (days < 0)
		return _('证书已过期（到期日 %s）').format(ds);
	if (days === 0)
		return _('证书今天到期（%s）').format(ds);
	return _('证书有效期至 %s（剩余 %d 天）').format(ds, days);
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
		return Promise.all([
			uci.load('crossdesk-server'),
			getCertInfo()
		]);
	},

	render: function(data) {
		let m, s, o;
		const certDate = data[1];
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
				E('p', {}, _('监听端口（配置值）: %s').format(port)),
				E('p', {}, formatCertInfo(certDate))
			]);
		};

		s = m.section(form.NamedSection, 'global', 'crossdesk-server', _('基本设置'));

		o = s.option(form.Flag, 'enabled', _('启用'));
		o.rmempty = false;

		o = s.option(form.Value, 'port', _('监听端口'));
		o.datatype = 'port';
		o.placeholder = '9090';

		o = s.option(form.Value, 'domain', _('域名'),
			_('客户端连接用的域名，例如 1688.goip.de。证书的 SAN 就是这个域名；Let\'s Encrypt 申请也要用它。'));
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

		s = m.section(form.NamedSection, 'cert', 'crossdesk-server', _('证书'));

		o = s.option(form.ListValue, 'mode', _('证书模式'),
			_('自签：免费、立刻可用，但客户端要装根证书或用跳过校验的版本；Let\'s Encrypt：公开可信，任何客户端直接认，但需要域名解析到本机且 80 端口能从互联网访问。'));
		o.value('selfsigned', _('自签证书'));
		o.value('letsencrypt', _('Let\'s Encrypt'));

		o = s.option(form.Value, 'acme_email', _('ACME 邮箱'),
			_('Let\'s Encrypt 账号邮箱（可空）。'));
		o.datatype = 'email';
		o.optional = true;
		o.depends('mode', 'letsencrypt');

		o = s.option(form.ListValue, 'acme_method', _('Let\'s Encrypt 验证方式'),
			_('Webroot：用 uhttpd 的 /www 目录验证，LuCI 不中断；Standalone：申请期间临时停 uhttpd（会短暂断开 LuCI），80 端口被别的服务占着时用这个。'));
		o.value('webroot', _('Webroot（uhttpd /www）'));
		o.value('standalone', _('Standalone（临时停 uhttpd）'));
		o.depends('mode', 'letsencrypt');

		o = s.option(form.Button, '_gen_selfsigned', _('生成自签证书'),
			_('用 SAN=DNS:域名 生成自签 CA + 服务器证书（有效期 10 年），写进 /etc/crossdesk/certs。根证书也留在同目录，可装到客户端上信任。点按钮前先保存上方改好的域名。'));
		o.inputstyle = 'apply';
		o.depends('mode', 'selfsigned');
		o.onclick = function() {
			return runHelper(m, '/usr/libexec/crossdesk-server/cert-selfsigned.sh', [],
				_('生成自签证书'), _('自签证书已生成，服务已重启（如正在运行）。'));
		};

		o = s.option(form.Button, '_acme_issue', _('申请证书'),
			_('用 acme.sh 向 Let\'s Encrypt 申请证书并安装到 /etc/crossdesk/certs，成功后重启服务。acme.sh 会自己装 cron 做自动续签，续签后同样重启服务。'));
		o.inputstyle = 'apply';
		o.depends('mode', 'letsencrypt');
		o.onclick = function() {
			return runHelper(m, '/usr/libexec/crossdesk-server/cert-acme.sh', ['issue'],
				_('申请证书'), _('证书已申请并安装，服务已重启（如正在运行）。'));
		};

		o = s.option(form.Button, '_acme_renew', _('续签证书'),
			_('立刻跑一次 acme.sh 续签（没到期会跳过）。正常情况下不用点，acme.sh 的 cron 会自动续。'));
		o.inputstyle = 'apply';
		o.depends('mode', 'letsencrypt');
		o.onclick = function() {
			return runHelper(m, '/usr/libexec/crossdesk-server/cert-acme.sh', ['renew'],
				_('续签证书'), _('续签完成（未到期则跳过）。'));
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
