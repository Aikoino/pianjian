/**
 * 同步功能自动化测试
 * 运行方式: node test-sync.js
 * 不依赖 Electron GUI，纯 Node.js 环境
 */

const { createServer } = require('./server/ws-server');
const { connect } = require('./server/ws-client');

// ---- 测试工具 ----
const results = { passed: 0, failed: 0 };
const errors = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests(tests) {
  for (const t of tests) {
    process.stdout.write(`  ${t.name}... `);
    try {
      await t.fn();
      results.passed++;
      process.stdout.write('✓\n');
    } catch (e) {
      results.failed++;
      errors.push(`  ${t.name}: ${e.message}`);
      process.stdout.write('✗\n');
    }
  }
}

// 创建可替换回调的服务端
async function makeServer(code) {
  const cbs = { onMessage: () => {}, onPeerConnected: () => {}, onPeerDisconnected: () => {}, onError: () => {} };
  const server = await createServer(code,
    (msg) => cbs.onMessage(msg),
    (info) => cbs.onPeerConnected(info),
    () => cbs.onPeerDisconnected(),
    (err) => cbs.onError(err)
  );
  if (!server || !server.port) throw new Error(`服务端创建失败 (code=${code})`);
  return { server, cbs };
}

// ---- 开始测试 ----
(async function main() {
  try {
  // 1. mergeNotes 合并逻辑
  console.log('\n1. mergeNotes 合并逻辑');

  function mergeNotes(localNotes, remoteNotes) {
    const merged = new Map();
    for (const n of localNotes) merged.set(n.id, n);
    for (const rn of remoteNotes) {
      const existing = merged.get(rn.id);
      if (!existing) {
        merged.set(rn.id, rn);
      } else {
        const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
        const remoteTime = new Date(rn.updatedAt || rn.createdAt || 0).getTime();
        if (remoteTime > existingTime) {
          merged.set(rn.id, rn);
        }
      }
    }
    return Array.from(merged.values());
  }

  await runTests([
      { name: '空数据合并', fn: () => {
        const r = mergeNotes([], []);
        assertEqual(r.length, 0, '应返回空数组');
      }},
      { name: '远程有数据本地无', fn: () => {
        const remote = [{ id: '1', content: 'hello', updatedAt: '2025-01-01T00:00:00Z' }];
        const r = mergeNotes([], remote);
        assertEqual(r.length, 1);
        assertEqual(r[0].content, 'hello');
      }},
      { name: '远程 updatedAt 更新胜出', fn: () => {
        const r = mergeNotes(
          [{ id: '1', content: 'old', updatedAt: '2025-01-01T00:00:00Z' }],
          [{ id: '1', content: 'new', updatedAt: '2025-01-02T00:00:00Z' }]
        );
        assertEqual(r[0].content, 'new');
      }},
      { name: '本地 updatedAt 更新保留', fn: () => {
        const r = mergeNotes(
          [{ id: '1', content: 'new', updatedAt: '2025-01-02T00:00:00Z' }],
          [{ id: '1', content: 'old', updatedAt: '2025-01-01T00:00:00Z' }]
        );
        assertEqual(r[0].content, 'new');
      }},
      { name: '多便签混合合并', fn: () => {
        const r = mergeNotes(
          [
            { id: '1', content: 'a-old', updatedAt: '2025-01-01T00:00:00Z' },
            { id: '2', content: 'b', updatedAt: '2025-01-01T00:00:00Z' }
          ],
          [
            { id: '1', content: 'a-new', updatedAt: '2025-01-02T00:00:00Z' },
            { id: '3', content: 'c', updatedAt: '2025-01-01T00:00:00Z' }
          ]
        );
        assertEqual(r.length, 3);
        assert(r.find(n => n.id === '1' && n.content === 'a-new'));
        assert(r.find(n => n.id === '2'));
        assert(r.find(n => n.id === '3'));
      }},
      { name: '无 updatedAt 用 createdAt', fn: () => {
        const r = mergeNotes(
          [{ id: '1', content: 'old', createdAt: '2025-01-01T00:00:00Z' }],
          [{ id: '1', content: 'new', createdAt: '2025-01-02T00:00:00Z' }]
        );
        assertEqual(r[0].content, 'new');
      }},
      { name: '无时间戳保留本地', fn: () => {
        const r = mergeNotes(
          [{ id: '1', content: 'local' }],
          [{ id: '1', content: 'remote' }]
        );
        assertEqual(r[0].content, 'local');
      }},
    ]);

  // 2. WebSocket 认证测试
  console.log('\n2. WebSocket 配对认证');

  await runTests([

    { name: '正确配对码连接成功', fn: async () => {
      const { server, cbs } = await makeServer('123456');
      const connected = new Promise((resolve, reject) => {
        const t = setTimeout(() => { server.stop(); reject(new Error('超时')); }, 4000);
        cbs.onPeerConnected = (info) => {
          clearTimeout(t);
          try {
            assert(info.deviceName, '应有设备名');
            assertEqual(info.deviceId, 'device-a', '设备ID');
            client.disconnect();
            server.stop();
            resolve();
          } catch (e) { server.stop(); reject(e); }
        };
        cbs.onError = (err) => { clearTimeout(t); server.stop(); reject(new Error('不应onError: ' + err)); };
      });
      const client = connect('127.0.0.1', server.port, '123456',
        () => {}, () => {}, () => {}, () => {}, '设备A', 'device-a');
      await connected;
    }},

    { name: '错误配对码连接拒绝', fn: async () => {
      const { server, cbs } = await makeServer('123456');
      const result = await new Promise((resolve, reject) => {
        const t = setTimeout(() => { server.stop(); resolve('timeout'); }, 4000);
        cbs.onPeerConnected = () => { clearTimeout(t); server.stop(); resolve('connected'); };
        const client = connect('127.0.0.1', server.port, '000000',
          () => {},
          () => {},
          () => { clearTimeout(t); server.stop(); resolve('disconnected'); },
          () => { clearTimeout(t); server.stop(); resolve('error'); },
          '坏设备', 'bad-device'
        );
      });
      assert(result !== 'connected', '错误码不应连接成功');
    }},

    { name: '消息双向收发', fn: async () => {
      const { server, cbs } = await makeServer('789012');
      const gotMsg = new Promise((resolve, reject) => {
        const t = setTimeout(() => { server.stop(); reject(new Error('收消息超时')); }, 4000);
        cbs.onMessage = (msg) => {
          clearTimeout(t);
          try {
            assertEqual(msg.type, 'note_add');
            assertEqual(msg.note.id, 'n1');
            client.disconnect();
            server.stop();
            resolve();
          } catch (e) { server.stop(); reject(e); }
        };
      });
      const client = connect('127.0.0.1', server.port, '789012',
        () => {},
        () => { client.send({ type: 'note_add', note: { id: 'n1', content: 'test' } }); },
        () => {}, () => {}, '设备B', 'device-b'
      );
      await gotMsg;
    }},
  ]);

  // 3. 端到端同步测试
  console.log('\n3. 端到端同步流程');

  await runTests([

    { name: '双向全量同步', fn: async () => {
      const { server, cbs } = await makeServer('654321');
      const notesA = [
        { id: 'a1', content: 'A的笔记1', updatedAt: new Date().toISOString() },
        { id: 'a2', content: 'A的笔记2', updatedAt: new Date().toISOString() }
      ];
      const notesB = [
        { id: 'b1', content: 'B的笔记1', updatedAt: new Date().toISOString() }
      ];

      // B 连接后，A 广播自己的全量数据
      cbs.onPeerConnected = () => {
        server.broadcast({ type: 'sync_full', notes: notesA, deviceId: 'device-a' });
      };

      await new Promise((resolve, reject) => {
        const t = setTimeout(() => { server.stop(); reject(new Error('全量同步超时')); }, 6000);
        const client = connect('127.0.0.1', server.port, '654321',
          (msg) => {
            if (msg.type === 'sync_full') {
              try {
                // B 收到 A 的笔记，做合并验证
                const merged = new Map();
                for (const n of notesB) merged.set(n.id, n);
                for (const rn of msg.notes) {
                  const existing = merged.get(rn.id);
                  if (!existing) merged.set(rn.id, rn);
                  else {
                    const et = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
                    const rt = new Date(rn.updatedAt || rn.createdAt || 0).getTime();
                    if (rt > et) merged.set(rn.id, rn);
                  }
                }
                const result = Array.from(merged.values());
                assertEqual(result.length, 3, '合并后有 3 条');
                assert(result.find(n => n.id === 'a1'), '有 a1');
                assert(result.find(n => n.id === 'a2'), '有 a2');
                assert(result.find(n => n.id === 'b1'), '有 b1');
                clearTimeout(t);
                client.disconnect();
                server.stop();
                resolve();
              } catch (e) { clearTimeout(t); server.stop(); reject(e); }
            }
          },
          () => {
            // B 连接成功，发送自己的全量数据
            client.send({ type: 'sync_full', notes: notesB, deviceId: 'device-b' });
          },
          () => {}, () => {}, '设备B', 'device-b'
        );
      });
    }},

    { name: '增量同步：新增', fn: async () => {
      const { server, cbs } = await makeServer('111222');
      const gotMsg = new Promise((resolve, reject) => {
        const t = setTimeout(() => { server.stop(); reject(new Error('超时')); }, 4000);
        cbs.onMessage = (msg) => {
          if (msg.type === 'note_add') {
            clearTimeout(t);
            try {
              assertEqual(msg.note.id, 'new-note');
              client.disconnect();
              server.stop();
              resolve();
            } catch (e) { server.stop(); reject(e); }
          }
        };
      });
      const client = connect('127.0.0.1', server.port, '111222',
        () => {},
        () => { client.send({ type: 'note_add', note: { id: 'new-note', content: '新笔记', updatedAt: new Date().toISOString() } }); },
        () => {}, () => {}, '设备B', 'device-b'
      );
      await gotMsg;
    }},

    { name: '增量同步：更新', fn: async () => {
      const { server, cbs } = await makeServer('333444');
      const gotMsg = new Promise((resolve, reject) => {
        const t = setTimeout(() => { server.stop(); reject(new Error('超时')); }, 4000);
        cbs.onMessage = (msg) => {
          if (msg.type === 'note_update') {
            clearTimeout(t);
            assertEqual(msg.id, 'note-1');
            assertEqual(msg.changes.content, '更新后的内容');
            client.disconnect();
            server.stop();
            resolve();
          }
        };
      });
      const client = connect('127.0.0.1', server.port, '333444',
        () => {},
        () => { client.send({ type: 'note_update', id: 'note-1', changes: { content: '更新后的内容' }, updatedAt: new Date().toISOString() }); },
        () => {}, () => {}, '设备B', 'device-b'
      );
      await gotMsg;
    }},

    { name: '增量同步：删除', fn: async () => {
      const { server, cbs } = await makeServer('555666');
      const gotMsg = new Promise((resolve, reject) => {
        const t = setTimeout(() => { server.stop(); reject(new Error('超时')); }, 4000);
        cbs.onMessage = (msg) => {
          if (msg.type === 'note_delete') {
            clearTimeout(t);
            assertEqual(msg.id, 'delete-note');
            client.disconnect();
            server.stop();
            resolve();
          }
        };
      });
      const client = connect('127.0.0.1', server.port, '555666',
        () => {},
        () => { client.send({ type: 'note_delete', id: 'delete-note' }); },
        () => {}, () => {}, '设备B', 'device-b'
      );
      await gotMsg;
    }},

  ]);

  // 报告
  console.log(`\n${'='.repeat(40)}`);
  console.log(`总计: ${results.passed + results.failed}  |  通过: ${results.passed}  |  失败: ${results.failed}`);
  console.log(`${'='.repeat(40)}`);
  if (errors.length) {
    console.log('\n失败详情:');
    errors.forEach(e => console.log(e));
  }
  if (results.failed > 0) process.exit(1);

  } catch (e) {
    console.error('\n测试框架异常:', e);
    process.exit(1);
  }
})();
