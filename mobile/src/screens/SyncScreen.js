import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import * as syncManager from '../sync/syncManager';
import { getLogs, onLog, clearLogs } from '../utils/logger';
import { Network } from 'expo-network';

const STATUS_COLORS = {
  idle: '#999', pairing: '#FF9800', discovering: '#2196F3',
  connecting: '#2196F3', connected: '#4CAF50', error: '#F44336',
};

async function getPhoneIP() {
  try {
    const info = await Network.getIpAddressAsync();
    return info.address || '未知';
  } catch (e) {
    return '未知';
  }
}

export default function SyncScreen() {
  const [mode, setMode] = useState('choose');
  const [code, setCode] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [ip, setIp] = useState('');
  const [wsPort, setWsPort] = useState('48484');
  const [status, setStatus] = useState(syncManager.getStatus());
  const [logs, setLogs] = useState(getLogs());
  const [phoneIP, setPhoneIP] = useState('');
  const [lastError, setLastError] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    getPhoneIP().then(ip => setPhoneIP(ip));
  }, []);

  useEffect(() => {
    const unsub = syncManager.onStatusChange((s) => setStatus(s));
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onLog((l) => {
      setLogs(l);
      setTimeout(() => logRef.current?.scrollToEnd({ animated: false }), 100);
    });
    return unsub;
  }, []);

  async function handleStartPairing() {
    clearLogs();
    setLastError('');
    try {
      const result = await syncManager.startPairing();
      if (result) setPairingCode(result.code);
    } catch (e) {
      const msg = '启动失败: ' + (e.message || e);
      setLastError(msg);
      console.error('[SyncScreen]', msg, e);
    }
  }

  function handleJoin() {
    if (code.length !== 6) { alert('请输入 6 位配对码'); return; }
    clearLogs();
    setLastError('');
    syncManager.joinWithCode(code);
  }

  function handleDirectConnect() {
    if (!ip.trim()) { alert('请输入 IP 地址'); return; }
    if (!code.trim()) { alert('请输入配对码'); return; }
    clearLogs();
    setLastError('');
    syncManager.connectByIP(ip.trim(), wsPort.trim() || '48484', code.trim());
  }

  const isWorking = ['pairing', 'discovering', 'connecting'].includes(status.status);
  const isConnected = status.status === 'connected';

  return (
    <View style={styles.container}>
      <View style={styles.header}><Text style={styles.title}>局域网同步</Text></View>

      {/* 状态栏 */}
      <View style={styles.statusSection}>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[status.status] }]} />
        <Text style={styles.statusText}>
          {isConnected ? '已连接' : isWorking ? '连接中...' : '未连接'}
          {status.peerName ? ` · ${status.peerName}` : ''}
        </Text>
        {status.role && <Text style={styles.roleTag}>{status.role === 'authority' ? '主设备' : '从设备'}</Text>}
      </View>
      {status.error && <Text style={styles.errorText}>{status.error}</Text>}
      {lastError !== '' && <Text style={[styles.errorText, { fontWeight: 'bold' }]}>{lastError}</Text>}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

        {/* === 已连接 === */}
        {isConnected && (
          <View style={styles.section}>
            <Text style={styles.hint}>两端便签自动实时同步中</Text>
            <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => syncManager.disconnect()}>
              <Text style={styles.btnText}>断开连接</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === 等待中：显示配对码 === */}
        {status.status === 'pairing' && pairingCode && (
          <View style={styles.section}>
            <Text style={styles.codeLabel}>配对码</Text>
            <Text style={styles.codeValue}>{pairingCode}</Text>
            {status.expiresAt && <CountdownText expiresAt={status.expiresAt} />}
            <Text style={styles.codeHint}>在电脑端点击同步 → 输入配对码</Text>
            {phoneIP && phoneIP !== '未知' && (
              <Text style={styles.ipHint}>手机 IP: {phoneIP}（若自动发现失败，可在电脑端手动输入）</Text>
            )}
          </View>
        )}

        {/* === 等待中：正在搜索 === */}
        {(status.status === 'discovering' || status.status === 'connecting') && (
          <View style={styles.section}>
            <Text style={styles.hint}>
              {status.status === 'discovering' ? '正在搜索电脑...' : '正在连接...'}
            </Text>
          </View>
        )}

        {/* === 取消按钮 === */}
        {isWorking && (
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => syncManager.cancelPairing()}>
            <Text style={{ color: '#666', fontSize: 15 }}>取消</Text>
          </TouchableOpacity>
        )}

        {/* === 选择模式 === */}
        {!isWorking && !isConnected && mode === 'choose' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>选择连接方式</Text>
            <TouchableOpacity style={styles.chooseBtn} onPress={() => setMode('initiate')}>
              <Text style={styles.chooseBtnTitle}>1. 发起配对</Text>
              <Text style={styles.chooseBtnDesc}>手机生成配对码，电脑端输入</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.chooseBtn} onPress={() => setMode('join')}>
              <Text style={styles.chooseBtnTitle}>2. 输入配对码</Text>
              <Text style={styles.chooseBtnDesc}>电脑已发起配对，我来加入</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.chooseBtn} onPress={() => setMode('directIP')}>
              <Text style={styles.chooseBtnTitle}>3. 手动输入 IP</Text>
              <Text style={styles.chooseBtnDesc}>直接输入电脑 IP 地址连接</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === 发起配对 === */}
        {!isWorking && !isConnected && mode === 'initiate' && (
          <View style={styles.section}>
            <BackBtn onPress={() => setMode('choose')} />
            <Text style={styles.hint}>点击按钮生成配对码，然后在电脑端输入</Text>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleStartPairing}>
              <Text style={styles.btnText}>生成配对码</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === 输入配对码 === */}
        {!isWorking && !isConnected && mode === 'join' && (
          <View style={styles.section}>
            <BackBtn onPress={() => setMode('choose')} />
            <Text style={styles.hint}>在电脑端发起配对，获取 6 位配对码</Text>
            <TextInput style={styles.codeInput} placeholder="6 位配对码" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleJoin}>
              <Text style={styles.btnText}>连接</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === 手动 IP === */}
        {!isWorking && !isConnected && mode === 'directIP' && (
          <View style={styles.section}>
            <BackBtn onPress={() => setMode('choose')} />
            <Text style={styles.hint}>在电脑端发起配对后，查看电脑 IP 和端口</Text>
            <TextInput style={styles.codeInput} placeholder="电脑 IP（如 192.168.1.100）" value={ip} onChangeText={setIp} autoCapitalize="none" />
            <TextInput style={[styles.codeInput, { marginTop: 8 }]} placeholder="端口（默认 48484）" keyboardType="number-pad" value={wsPort} onChangeText={setWsPort} />
            <TextInput style={[styles.codeInput, { marginTop: 8 }]} placeholder="6 位配对码" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleDirectConnect}>
              <Text style={styles.btnText}>直接连接</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === 调试日志 === */}
        <View style={styles.logSection}>
          <Text style={styles.logTitle}>调试日志 ({logs.length})</Text>
          <ScrollView style={styles.logBox} ref={logRef}>
            {logs.length === 0 && <Text style={styles.logEmpty}>暂无日志</Text>}
            {logs.map((l, i) => (
              <Text key={i} style={styles.logLine}>{l.full}</Text>
            ))}
          </ScrollView>
        </View>

      </ScrollView>
    </View>
  );
}

function CountdownText({ expiresAt }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setText(left <= 0 ? '已超时' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return <Text style={styles.countdown}>{text}</Text>;
}

function BackBtn({ onPress }) {
  return <TouchableOpacity onPress={onPress} style={{ marginBottom: 12 }}><Text style={{ fontSize: 15, color: '#1a73e8' }}>← 返回</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { paddingTop: 48, paddingBottom: 12, paddingHorizontal: 16, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  statusSection: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, backgroundColor: '#fff', marginTop: 8, marginHorizontal: 12, borderRadius: 10,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, color: '#333', fontWeight: '500', flex: 1 },
  roleTag: { fontSize: 12, color: '#fff', backgroundColor: '#1a73e8', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  errorText: { color: '#F44336', fontSize: 13, paddingHorizontal: 16, marginTop: 6 },
  body: { flex: 1 },
  bodyContent: { paddingBottom: 20 },
  section: { padding: 16 },
  sectionTitle: { fontSize: 15, color: '#666', marginBottom: 12 },
  hint: { fontSize: 14, color: '#666', marginBottom: 16 },
  chooseBtn: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2,
  },
  chooseBtnTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  chooseBtnDesc: { fontSize: 13, color: '#999', marginTop: 3 },
  codeInput: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 18, letterSpacing: 6, textAlign: 'center',
  },
  codeLabel: { fontSize: 14, color: '#666', textAlign: 'center' },
  codeValue: { fontSize: 36, fontWeight: 'bold', letterSpacing: 12, color: '#333', marginVertical: 12, textAlign: 'center' },
  codeHint: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  ipHint: { fontSize: 12, color: '#1a73e8', textAlign: 'center', marginTop: 6, fontFamily: 'monospace' },
  countdown: { fontSize: 14, color: '#FF9800', textAlign: 'center' },
  btn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  btnPrimary: { backgroundColor: '#1a73e8' },
  btnSecondary: { backgroundColor: '#f0f0f0', marginHorizontal: 16 },
  btnDanger: { backgroundColor: '#F44336' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  logSection: { margin: 12, padding: 10, backgroundColor: '#1e1e1e', borderRadius: 8 },
  logTitle: { fontSize: 13, color: '#999', marginBottom: 6 },
  logBox: { maxHeight: 200 },
  logEmpty: { color: '#666', fontSize: 12 },
  logLine: { color: '#4CAF50', fontSize: 11, fontFamily: 'monospace', lineHeight: 18 },
});
