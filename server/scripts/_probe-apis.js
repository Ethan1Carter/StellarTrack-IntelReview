/**
 * 不启动服务器，直接扫描 routes/* 下所有路由文件的 registered routes
 * 同时对比 src/api 下的前端 API，列出前后端不一致的项
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const routesDir = path.resolve(__dirname, '..', 'routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));

const apiRoutes = [];

for (const file of files) {
  const modPath = path.join(routesDir, file);
  try {
    const router = require(modPath);
    const base = '/' + (file.replace('.js', '') === 'index' ? '' : file.replace('.js', ''));

    if (router.stack && Array.isArray(router.stack)) {
      for (const layer of router.stack) {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(',');
          apiRoutes.push({ method: methods, path: (base + layer.route.path).replace(/\/\//g, '/'), file: file });
        }
      }
    }
  } catch (e) {
    console.error(`加载 ${file} 失败:`, e.message);
  }
}

// 打印所有后端路由
console.log('\n===== 后端已注册路由 (' + apiRoutes.length + ') =====');
apiRoutes.sort((a,b) => (a.file+a.path).localeCompare(b.file+b.path));
for (const r of apiRoutes) {
  console.log(`${r.method.padEnd(8)} /api${r.path}    [${r.file}]`);
}

// 读取前端 API 路径
console.log('\n===== 前端 src/api 下已调用路径 =====');
const apiDir = path.resolve(__dirname, '..', '..', 'src', 'api');
if (fs.existsSync(apiDir)) {
  const frontPaths = [];
  for (const file of fs.readdirSync(apiDir).filter(f => f.endsWith('.js'))) {
    const content = fs.readFileSync(path.join(apiDir, file), 'utf-8');
    const matches = content.matchAll(/url:\s*['"`]([^'"`]+)['"`]/g);
    for (const m of matches) {
      const m2 = [...content.matchAll(/method:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/gi)];
      frontPaths.push({ file, path: m[1], matchIdx: m.index });
    }
  }
  const frontSet = new Set(frontPaths.map(x => x.path));
  const backSet = new Set(apiRoutes.map(x => x.path + '|' + x.method.split(',')[0]));

  console.log('\n===== 前端API vs 后端路由 检查 =====');
  console.log('\n前端有但后端可能没有:');
  const backPaths = apiRoutes.map(x => x.path);
  const backPathMethods = apiRoutes.map(x => x.path + '|' + x.method.split(',')[0]);
  let missCount = 0;
  const seen = new Set();
  for (const f of frontPaths) {
    const key = f.path;
    if (seen.has(key)) continue;
    seen.add(key);
    // 查找后端是否有完全相同（去除尾 /:id 形式）
    const normalized = key.split('/').map(seg => seg.startsWith(':') ? ':param' : seg).join('/');
    const hasMatch = backPaths.some(b => {
      const bNorm = b.split('/').map(seg => seg.startsWith(':') ? ':param' : seg).join('/');
      return bNorm === normalized;
    });
    if (!hasMatch) { missCount++; console.log(`  MISS: [${f.file}] ${f.path}`); }
  }
  if (missCount === 0) console.log('  ✓ 全部匹配');

  console.log('\n后端路由总数:', apiRoutes.length);
  console.log('前端 API 调用路径数:', frontSet.size);
}
