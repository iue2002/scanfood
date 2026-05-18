const http = require('http');

const TARGET_URL = 'http://localhost:3000';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjM1LCJyb2xlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NzkwOTE0NDYsImV4cCI6MTc3OTY5NjI0Nn0.KXHmGrmIGsCG6s__eHr6i4uNfH9HNI0hrqw3rLr4P88';

const results = {
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  totalTime: 0,
  responseTimes: [],
  errors: []
};

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Authorization': TOKEN,
        'Content-Type': 'application/json'
      }
    };

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        results.totalTime += responseTime;
        results.responseTimes.push(responseTime);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          results.successRequests++;
          resolve({ statusCode: res.statusCode, responseTime });
        } else {
          results.failedRequests++;
          results.errors.push({ path, statusCode: res.statusCode, responseTime });
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (e) => {
      results.failedRequests++;
      results.errors.push({ path, error: e.message });
      reject(e);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runPerformanceTest(durationSeconds = 30, concurrentRequests = 10) {
  console.log(`\n=== 性能测试开始 ===`);
  console.log(`测试时长: ${durationSeconds}秒`);
  console.log(`并发数: ${concurrentRequests}`);
  console.log(`\n测试接口:`);
  console.log('- GET /api/dishes');
  console.log('- GET /api/dishes/categories');
  console.log('- GET /api/tables/board');
  console.log('- POST /api/orders');

  const endTime = Date.now() + durationSeconds * 1000;
  const requests = [];

  while (Date.now() < endTime) {
    const promises = [];
    
    for (let i = 0; i < concurrentRequests; i++) {
      const rand = Math.random();
      let promise;
      
      if (rand < 0.35) {
        promise = makeRequest('/api/dishes');
      } else if (rand < 0.6) {
        promise = makeRequest('/api/dishes/categories');
      } else if (rand < 0.85) {
        promise = makeRequest('/api/tables/board');
      } else {
        promise = makeRequest('/api/orders', 'POST', {
          table_id: 38,
          items: [{ dish_id: 4, quantity: 2, price: 5.0, dish_name: '羊肉串' }]
        });
      }
      
      promises.push(promise);
      results.totalRequests++;
    }
    
    await Promise.allSettled(promises);
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  printResults();
}

function printResults() {
  console.log(`\n=== 测试结果 ===`);
  console.log(`总请求数: ${results.totalRequests}`);
  console.log(`成功请求数: ${results.successRequests}`);
  console.log(`失败请求数: ${results.failedRequests}`);
  console.log(`成功率: ${((results.successRequests / results.totalRequests) * 100).toFixed(2)}%`);
  
  if (results.responseTimes.length > 0) {
    const avgTime = results.totalTime / results.responseTimes.length;
    const p95 = results.responseTimes.sort((a, b) => a - b)[Math.floor(results.responseTimes.length * 0.95)];
    const p99 = results.responseTimes.sort((a, b) => a - b)[Math.floor(results.responseTimes.length * 0.99)];
    const maxTime = Math.max(...results.responseTimes);
    const minTime = Math.min(...results.responseTimes);
    
    console.log(`\n响应时间统计:`);
    console.log(`平均响应时间: ${avgTime.toFixed(2)}ms`);
    console.log(`P95响应时间: ${p95}ms`);
    console.log(`P99响应时间: ${p99}ms`);
    console.log(`最大响应时间: ${maxTime}ms`);
    console.log(`最小响应时间: ${minTime}ms`);
  }
  
  if (results.errors.length > 0) {
    console.log(`\n错误详情 (前5条):`);
    results.errors.slice(0, 5).forEach((err, i) => {
      console.log(`${i + 1}. ${err.path} - ${err.statusCode || err.error}`);
    });
  }
  
  console.log(`\n=== 测试结束 ===`);
}

const args = process.argv.slice(2);
const duration = parseInt(args[0]) || 30;
const concurrency = parseInt(args[1]) || 10;

runPerformanceTest(duration, concurrency);